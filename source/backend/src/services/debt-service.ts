import {
  AUDIT_ACTION,
  DEBT_CHANGE_TYPE,
  LOAN_DIRECTION,
  LOAN_STATUS,
  MONEY_HOLDER_ID,
  TABLE_NAME,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  type LoanDirection,
  type LoanStatus,
  type MemberId,
  type MoneyHolderId,
} from '../config/constants.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import {
  decreaseLoanBalance,
  getLoanById,
  getTransactionByIdempotencyKey,
  insertDebtHistory,
  insertLoan,
  insertTransaction,
  listLoans,
  sumLoanLedger,
  updateLoanState,
} from '../db/repositories/index.ts';
import type { DatabaseAdapter, GiaoDichRecord, KhoanNoRecord } from '../db/types.ts';
import {
  DomainError,
  assertApiKey,
  assertDate,
  assertPositiveAmount,
  isUniqueViolation,
  newId,
  resolveClock,
  type ServiceOptions,
} from './common.ts';

export function assertMoneyHolder(value: string): asserts value is MoneyHolderId {
  if (!Object.values(MONEY_HOLDER_ID).includes(value as MoneyHolderId)) {
    throw new DomainError('INVALID_INPUT', `Người giữ tiền không hợp lệ: ${value}`);
  }
}

// Tính lại dư nợ + trạng thái từ lich_su_no chưa xoá (nguồn đúng duy nhất của dư nợ)
export async function recomputeLoan(
  tx: DatabaseAdapter,
  loanId: string,
  nowIso: string,
): Promise<KhoanNoRecord> {
  const { giaiNgan, goc } = await sumLoanLedger(tx, loanId);
  const duNo = giaiNgan - goc;
  if (duNo < 0) {
    throw new DomainError('OVERPAY', `Khoản nợ ${loanId}: trả/thu gốc vượt số đã giải ngân`);
  }
  let status: LoanStatus = LOAN_STATUS.DANG_NO;
  if (giaiNgan === 0) {
    status = LOAN_STATUS.DA_HUY;
  } else if (duNo === 0 && goc > 0) {
    status = LOAN_STATUS.DA_TAT_TOAN;
  }
  await updateLoanState(tx, loanId, duNo, status, nowIso);
  const loan = await getLoanById(tx, loanId);
  if (!loan) {
    throw new DomainError('NOT_FOUND', `Không tìm thấy khoản nợ ${loanId}`);
  }
  return loan;
}

interface DebtTxBase {
  idempotencyKey: string;
  soTien: number;
  ngay: string;
  nguoiTaoId: MemberId;
  nguoiThucHienId?: MemberId;
  nguoiGiuTienId: MoneyHolderId;
  moTa?: string;
}

export interface CreateLoanInput extends DebtTxBase {
  chieuNo: LoanDirection;
  tenKhoanNo: string;
  doiTac: string;
  ngayDaoHan?: string | null;
  ghiChu?: string | null;
}

export interface LoanPaymentInput extends DebtTxBase {
  khoanNoId: string;
}

export interface DebtWriteResult {
  duplicate: boolean;
  loan: KhoanNoRecord;
  transaction: GiaoDichRecord;
}

export interface OutstandingLoan {
  loan: KhoanNoRecord;
  duNoTheoLichSu: number;
}

function validateBase(input: DebtTxBase): void {
  assertApiKey(input.idempotencyKey);
  assertPositiveAmount(input.soTien);
  assertDate(input.ngay, 'ngay');
  assertMoneyHolder(input.nguoiGiuTienId);
}

export class DebtService {
  private readonly db: DatabaseAdapter;
  private readonly now: () => Date;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.now = resolveClock(options);
  }

  // Tạo khoản nợ + giao dịch VAY + lich_su_no GIAI_NGAN trong 1 transaction
  async createLoan(input: CreateLoanInput): Promise<DebtWriteResult> {
    validateBase(input);
    if (!input.tenKhoanNo.trim() || !input.doiTac.trim()) {
      throw new DomainError('INVALID_INPUT', 'Thiếu tên khoản nợ hoặc đối tác');
    }
    if (input.ngayDaoHan) {
      assertDate(input.ngayDaoHan, 'ngayDaoHan');
    }
    const nowIso = this.now().toISOString();
    return this.idempotent(input.idempotencyKey, () => this.db.transaction(async (tx) => {
      const existing = await this.findDuplicate(tx, input.idempotencyKey);
      if (existing) {
        return existing;
      }
      const loanId = newId('KN');
      await insertLoan(tx, {
        id: loanId,
        ten_khoan_no: input.tenKhoanNo.trim(),
        chieu_no: input.chieuNo,
        doi_tac: input.doiTac.trim(),
        so_tien_goc: input.soTien,
        ngay_phat_sinh: input.ngay,
        ngay_dao_han: input.ngayDaoHan ?? null,
        ghi_chu: input.ghiChu ?? null,
        nowIso,
      });
      const label = input.chieuNo === LOAN_DIRECTION.CHO_VAY ? 'Cho vay' : 'Vay';
      const transaction = await insertTransaction(tx, {
        id: newId('GD'),
        loai_giao_dich: TRANSACTION_TYPE.VAY,
        so_tien: input.soTien,
        danh_muc_id: null,
        nguoi_tao_id: input.nguoiTaoId,
        nguoi_thuc_hien_id: input.nguoiThucHienId ?? input.nguoiTaoId,
        nguoi_giu_tien_id: input.nguoiGiuTienId,
        doi_tuong_thu_huong_id: null,
        khoan_no_id: loanId,
        chieu_dieu_chinh: null,
        mo_ta: input.moTa ?? `${label}: ${input.tenKhoanNo.trim()} (${input.doiTac.trim()})`,
        ngay_giao_dich: input.ngay,
        trang_thai: TRANSACTION_STATUS.HOAN_TAT,
        source_message_id: null,
        idempotency_key: input.idempotencyKey,
        nowIso,
      });
      await insertDebtHistory(tx, {
        id: newId('LSN'),
        khoan_no_id: loanId,
        giao_dich_id: transaction.id,
        loai_bien_dong: DEBT_CHANGE_TYPE.GIAI_NGAN,
        so_tien: input.soTien,
        ngay_ghi_nhan: input.ngay,
        ghi_chu: null,
        nowIso,
      });
      const loan = await recomputeLoan(tx, loanId, nowIso);
      await this.audit(tx, loan, transaction, input.nguoiTaoId, nowIso);
      return { duplicate: false, loan, transaction };
    }));
  }

  // DI_VAY: trả gốc; CHO_VAY: thu gốc về. Trả vượt dư nợ → lỗi, rollback.
  async repayPrincipal(input: LoanPaymentInput): Promise<DebtWriteResult> {
    validateBase(input);
    const nowIso = this.now().toISOString();
    return this.idempotent(input.idempotencyKey, () => this.db.transaction(async (tx) => {
      const existing = await this.findDuplicate(tx, input.idempotencyKey);
      if (existing) {
        return existing;
      }
      const before = await this.requireOpenLoan(tx, input.khoanNoId);
      const changed = await decreaseLoanBalance(tx, before.id, input.soTien, nowIso);
      if (changed === 0) {
        throw new DomainError(
          'OVERPAY',
          `Trả ${input.soTien} vượt dư nợ ${before.du_no_hien_tai} của khoản ${before.id}`,
        );
      }
      const isLending = before.chieu_no === LOAN_DIRECTION.CHO_VAY;
      const transaction = await insertTransaction(tx, {
        id: newId('GD'),
        loai_giao_dich: TRANSACTION_TYPE.TRA_NO,
        so_tien: input.soTien,
        danh_muc_id: null,
        nguoi_tao_id: input.nguoiTaoId,
        nguoi_thuc_hien_id: input.nguoiThucHienId ?? input.nguoiTaoId,
        nguoi_giu_tien_id: input.nguoiGiuTienId,
        doi_tuong_thu_huong_id: null,
        khoan_no_id: before.id,
        chieu_dieu_chinh: null,
        mo_ta: input.moTa ?? `${isLending ? 'Thu gốc' : 'Trả gốc'}: ${before.ten_khoan_no}`,
        ngay_giao_dich: input.ngay,
        trang_thai: TRANSACTION_STATUS.HOAN_TAT,
        source_message_id: null,
        idempotency_key: input.idempotencyKey,
        nowIso,
      });
      await insertDebtHistory(tx, {
        id: newId('LSN'),
        khoan_no_id: before.id,
        giao_dich_id: transaction.id,
        loai_bien_dong: isLending ? DEBT_CHANGE_TYPE.THU_GOC : DEBT_CHANGE_TYPE.TRA_GOC,
        so_tien: input.soTien,
        ngay_ghi_nhan: input.ngay,
        ghi_chu: null,
        nowIso,
      });
      const loan = await recomputeLoan(tx, before.id, nowIso);
      await this.audit(tx, loan, transaction, input.nguoiTaoId, nowIso);
      return { duplicate: false, loan, transaction };
    }));
  }

  // Trả lãi khoản đi vay: chi phí LAI_VAY, không giảm dư nợ. Lãi cho vay thu về ghi THU LAI_CHO_VAY.
  async payInterest(input: LoanPaymentInput): Promise<DebtWriteResult> {
    validateBase(input);
    const nowIso = this.now().toISOString();
    return this.idempotent(input.idempotencyKey, () => this.db.transaction(async (tx) => {
      const existing = await this.findDuplicate(tx, input.idempotencyKey);
      if (existing) {
        return existing;
      }
      const loan = await getLoanById(tx, input.khoanNoId);
      if (!loan) {
        throw new DomainError('NOT_FOUND', `Không tìm thấy khoản nợ ${input.khoanNoId}`);
      }
      if (loan.chieu_no !== LOAN_DIRECTION.DI_VAY) {
        throw new DomainError('NOT_SUPPORTED', 'Lãi cho vay thu về: ghi THU danh mục LAI_CHO_VAY');
      }
      if (loan.trang_thai === LOAN_STATUS.DA_HUY) {
        throw new DomainError('LOAN_CLOSED', `Khoản nợ ${loan.id} đã huỷ`);
      }
      const transaction = await insertTransaction(tx, {
        id: newId('GD'),
        loai_giao_dich: TRANSACTION_TYPE.LAI_VAY,
        so_tien: input.soTien,
        danh_muc_id: null,
        nguoi_tao_id: input.nguoiTaoId,
        nguoi_thuc_hien_id: input.nguoiThucHienId ?? input.nguoiTaoId,
        nguoi_giu_tien_id: input.nguoiGiuTienId,
        doi_tuong_thu_huong_id: null,
        khoan_no_id: loan.id,
        chieu_dieu_chinh: null,
        mo_ta: input.moTa ?? `Trả lãi: ${loan.ten_khoan_no}`,
        ngay_giao_dich: input.ngay,
        trang_thai: TRANSACTION_STATUS.HOAN_TAT,
        source_message_id: null,
        idempotency_key: input.idempotencyKey,
        nowIso,
      });
      await insertDebtHistory(tx, {
        id: newId('LSN'),
        khoan_no_id: loan.id,
        giao_dich_id: transaction.id,
        loai_bien_dong: DEBT_CHANGE_TYPE.TRA_LAI,
        so_tien: input.soTien,
        ngay_ghi_nhan: input.ngay,
        ghi_chu: null,
        nowIso,
      });
      await this.audit(tx, loan, transaction, input.nguoiTaoId, nowIso);
      return { duplicate: false, loan, transaction };
    }));
  }

  // Danh sách khoản nợ kèm dư nợ tính lại từ lich_su_no để đối chiếu
  async getOutstanding(): Promise<OutstandingLoan[]> {
    const loans = await listLoans(this.db);
    const result: OutstandingLoan[] = [];
    for (const loan of loans) {
      const { giaiNgan, goc } = await sumLoanLedger(this.db, loan.id);
      result.push({ loan, duNoTheoLichSu: giaiNgan - goc });
    }
    return result;
  }

  // Hai lời gọi cùng key chạy song song: bên thua UNIQUE đọc lại kết quả bên thắng
  private async idempotent(key: string, run: () => Promise<DebtWriteResult>): Promise<DebtWriteResult> {
    try {
      return await run();
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.findDuplicate(this.db, key);
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  }

  private async findDuplicate(tx: DatabaseAdapter, key: string): Promise<DebtWriteResult | null> {
    const transaction = await getTransactionByIdempotencyKey(tx, key);
    if (!transaction) {
      return null;
    }
    const loan = transaction.khoan_no_id ? await getLoanById(tx, transaction.khoan_no_id) : null;
    if (!loan) {
      throw new DomainError('INVALID_INPUT', `idempotency_key ${key} đã dùng cho giao dịch không phải nợ`);
    }
    return { duplicate: true, loan, transaction };
  }

  private async requireOpenLoan(tx: DatabaseAdapter, loanId: string): Promise<KhoanNoRecord> {
    const loan = await getLoanById(tx, loanId);
    if (!loan) {
      throw new DomainError('NOT_FOUND', `Không tìm thấy khoản nợ ${loanId}`);
    }
    if (loan.trang_thai !== LOAN_STATUS.DANG_NO) {
      throw new DomainError('LOAN_CLOSED', `Khoản nợ ${loan.id} đã ${loan.trang_thai === LOAN_STATUS.DA_HUY ? 'huỷ' : 'tất toán'}`);
    }
    return loan;
  }

  private async audit(
    tx: DatabaseAdapter,
    loan: KhoanNoRecord,
    transaction: GiaoDichRecord,
    actor: MemberId,
    nowIso: string,
  ): Promise<void> {
    await insertAuditLog(tx, {
      ten_bang: TABLE_NAME.GIAO_DICH,
      ban_ghi_id: transaction.id,
      hanh_dong: AUDIT_ACTION.CREATE,
      du_lieu_sau: { giao_dich: transaction, khoan_no: loan },
      nguoi_thuc_hien_id: actor,
      nowIso,
    });
  }
}
