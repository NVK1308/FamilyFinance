import {
  ADJUSTMENT_DIRECTION,
  AUDIT_ACTION,
  CONFIRMATION_EXPIRY_DAYS,
  CONFIRMATION_STATUS,
  CONFIRMATION_TYPE,
  DEBT_CHANGE_TYPE,
  MESSAGE_INTENT,
  MESSAGE_STATUS,
  TABLE_NAME,
  TRANSACTION_STATUS,
  TRANSACTION_TYPE,
  type AdjustmentDirection,
  type BeneficiaryId,
  type ConfirmationType,
  type MemberId,
  type MoneyHolderId,
  type TransactionType,
} from '../config/constants.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import {
  closeConfirmation,
  getActiveCategoryByCode,
  getConfirmationById,
  getMemberByTelegramUserId,
  getTransactionById,
  getTransactionByIdempotencyKey,
  insertConfirmation,
  insertTransaction,
  isActiveMember,
  listConfirmationsByMessage,
  listDebtHistoryByTransaction,
  markTransactionCancelled,
  softDeleteDebtHistoryByTransaction,
  sumLoanLedger,
  updateMessageStatus,
} from '../db/repositories/index.ts';
import type {
  ChuyenTienNoiBoRecord,
  DatabaseAdapter,
  GiaoDichRecord,
  YeuCauXacNhanRecord,
} from '../db/types.ts';
import { parseVietnameseFinanceMessage } from '../parser/index.ts';
import type { ParsedTransactionResult } from '../parser/types.ts';
import {
  DomainError,
  addDaysIso,
  assertApiKey,
  assertDate,
  assertPositiveAmount,
  isUniqueViolation,
  newId,
  resolveClock,
  toVnDate,
  type ServiceOptions,
} from './common.ts';
import { assertMoneyHolder, recomputeLoan } from './debt-service.ts';
import {
  ignoreMessage,
  insertIncomingMessage,
  loadExistingOutcome,
  requireMessage,
  telegramKey,
  withDuplicateFallback,
  type IncomingMessage,
  type RecordOutcome,
} from './message-outcome.ts';
import { TransferService } from './transfer-service.ts';

// Dữ liệu người dùng bổ sung khi trả lời câu hỏi lại (GIAO_DICH_MO_HO / DANH_MUC_MOI)
export interface ConfirmationSupplement {
  loai_giao_dich?: TransactionType;
  so_tien?: number;
  ma_danh_muc?: string | null;
  nguoi_thuc_hien_id?: MemberId;
  nguoi_giu_tien_id?: MoneyHolderId;
  doi_tuong_thu_huong_id?: BeneficiaryId | null;
  ngay_giao_dich?: string;
  chieu_dieu_chinh?: AdjustmentDirection | null;
  mo_ta?: string;
}

export type ConfirmationAction = { type: 'ACCEPT'; data?: ConfirmationSupplement } | { type: 'REJECT' };

// Với yêu cầu CHUYEN_TIEN: ACCEPT = "Đã nhận", REJECT = "Chưa nhận" (vẫn chờ)
export interface ConfirmationResult {
  changed: boolean;
  confirmation: YeuCauXacNhanRecord;
  transaction: GiaoDichRecord | null;
  transfer?: ChuyenTienNoiBoRecord;
  // Yêu cầu không đổi vì đã quá hạn (job Phase 5 sẽ chuyển HET_HAN)
  expired: boolean;
}

export interface CancelResult {
  changed: boolean;
  transaction: GiaoDichRecord;
}

// Loại ghi được qua hàm tường minh; VAY/TRA_NO đi qua DebtService
const EXPLICIT_TYPES: readonly TransactionType[] = [
  TRANSACTION_TYPE.THU,
  TRANSACTION_TYPE.CHI,
  TRANSACTION_TYPE.PHI,
  TRANSACTION_TYPE.LAI_VAY,
  TRANSACTION_TYPE.DIEU_CHINH,
];

// Q8: nợ và điều chỉnh từ tin nhắn chưa ghi, chỉ hỏi lại
const NOT_FROM_MESSAGE_TYPES: readonly TransactionType[] = [
  TRANSACTION_TYPE.VAY,
  TRANSACTION_TYPE.TRA_NO,
  TRANSACTION_TYPE.DIEU_CHINH,
];

// Yêu cầu chặn ghi giao dịch tới khi người dùng trả lời (Q9)
const BLOCKING_TYPES: readonly ConfirmationType[] = [
  CONFIRMATION_TYPE.GIAO_DICH_MO_HO,
  CONFIRMATION_TYPE.DANH_MUC_MOI,
];

export interface ExplicitTransactionInput {
  idempotencyKey: string;
  loai: TransactionType;
  soTien: number;
  maDanhMuc?: string | null;
  nguoiTaoId: MemberId;
  nguoiThucHienId?: MemberId;
  nguoiGiuTienId: MoneyHolderId;
  doiTuongThuHuongId?: BeneficiaryId | null;
  chieuDieuChinh?: AdjustmentDirection | null;
  moTa: string;
  ngayGiaoDich: string;
}

interface ValidatedTransaction {
  loai: TransactionType;
  soTien: number;
  danhMucId: string | null;
  nguoiThucHienId: MemberId;
  nguoiGiuTienId: MoneyHolderId;
  doiTuongThuHuongId: BeneficiaryId | null;
  chieuDieuChinh: AdjustmentDirection | null;
  moTa: string;
  ngayGiaoDich: string;
}

function categoryFits(scope: 'THU' | 'CHI' | 'CA_HAI', loai: TransactionType): boolean {
  return scope === 'CA_HAI' || scope === loai;
}

// Kiểm dữ liệu một giao dịch HOAN_TAT (không phải nợ) trước khi ghi
async function validateCompletedTransaction(
  db: DatabaseAdapter,
  v: Omit<ValidatedTransaction, 'danhMucId'> & { maDanhMuc: string | null },
): Promise<ValidatedTransaction> {
  if (!EXPLICIT_TYPES.includes(v.loai)) {
    throw new DomainError('NOT_SUPPORTED', `Loại ${v.loai}: dùng DebtService`);
  }
  assertPositiveAmount(v.soTien);
  assertDate(v.ngayGiaoDich, 'ngay_giao_dich');
  assertMoneyHolder(v.nguoiGiuTienId);
  if (!v.moTa.trim()) {
    throw new DomainError('INVALID_INPUT', 'Thiếu mô tả giao dịch');
  }
  const isAdjustment = v.loai === TRANSACTION_TYPE.DIEU_CHINH;
  if (isAdjustment !== (v.chieuDieuChinh !== null)) {
    throw new DomainError('INVALID_INPUT', 'Chỉ DIEU_CHINH có chiều TANG/GIAM, và bắt buộc có');
  }
  if (v.chieuDieuChinh !== null && !Object.values(ADJUSTMENT_DIRECTION).includes(v.chieuDieuChinh)) {
    throw new DomainError('INVALID_INPUT', `Chiều điều chỉnh không hợp lệ: ${v.chieuDieuChinh}`);
  }
  let danhMucId: string | null = null;
  const needsCategory = v.loai === TRANSACTION_TYPE.THU || v.loai === TRANSACTION_TYPE.CHI;
  if (!needsCategory && v.maDanhMuc) {
    throw new DomainError('INVALID_INPUT', `Loại ${v.loai} không gắn danh mục`);
  }
  if (needsCategory) {
    if (!v.maDanhMuc) {
      throw new DomainError('INVALID_INPUT', 'THU/CHI phải có danh mục');
    }
    const category = await getActiveCategoryByCode(db, v.maDanhMuc);
    if (!category || !categoryFits(category.loai_giao_dich, v.loai)) {
      throw new DomainError('INVALID_INPUT', `Danh mục ${v.maDanhMuc} chưa có hoặc không dùng cho ${v.loai}`);
    }
    danhMucId = category.id;
  }
  return { ...v, moTa: v.moTa.trim(), danhMucId };
}

// Ghi giao dịch tường minh trong transaction đang mở (dùng chung cho đối soát)
export async function recordExplicitInTx(
  tx: DatabaseAdapter,
  input: ExplicitTransactionInput,
  nowIso: string,
): Promise<{ duplicate: boolean; transaction: GiaoDichRecord }> {
  assertApiKey(input.idempotencyKey);
  const existing = await getTransactionByIdempotencyKey(tx, input.idempotencyKey);
  if (existing) {
    return { duplicate: true, transaction: existing };
  }
  const v = await validateCompletedTransaction(tx, {
    loai: input.loai,
    soTien: input.soTien,
    maDanhMuc: input.maDanhMuc ?? null,
    nguoiThucHienId: input.nguoiThucHienId ?? input.nguoiTaoId,
    nguoiGiuTienId: input.nguoiGiuTienId,
    doiTuongThuHuongId: input.doiTuongThuHuongId ?? null,
    chieuDieuChinh: input.chieuDieuChinh ?? null,
    moTa: input.moTa,
    ngayGiaoDich: input.ngayGiaoDich,
  });
  const transaction = await insertCompleted(tx, v, input.nguoiTaoId, null, input.idempotencyKey, nowIso);
  return { duplicate: false, transaction };
}

async function insertCompleted(
  tx: DatabaseAdapter,
  v: ValidatedTransaction,
  nguoiTaoId: MemberId,
  sourceMessageId: string | null,
  idempotencyKey: string,
  nowIso: string,
): Promise<GiaoDichRecord> {
  const transaction = await insertTransaction(tx, {
    id: newId('GD'),
    loai_giao_dich: v.loai,
    so_tien: v.soTien,
    danh_muc_id: v.danhMucId,
    nguoi_tao_id: nguoiTaoId,
    nguoi_thuc_hien_id: v.nguoiThucHienId,
    nguoi_giu_tien_id: v.nguoiGiuTienId,
    doi_tuong_thu_huong_id: v.doiTuongThuHuongId,
    khoan_no_id: null,
    chieu_dieu_chinh: v.chieuDieuChinh,
    mo_ta: v.moTa,
    ngay_giao_dich: v.ngayGiaoDich,
    trang_thai: TRANSACTION_STATUS.HOAN_TAT,
    source_message_id: sourceMessageId,
    idempotency_key: idempotencyKey,
    nowIso,
  });
  await insertAuditLog(tx, {
    ten_bang: TABLE_NAME.GIAO_DICH,
    ban_ghi_id: transaction.id,
    hanh_dong: AUDIT_ACTION.CREATE,
    du_lieu_sau: transaction,
    nguoi_thuc_hien_id: nguoiTaoId,
    nowIso,
  });
  return transaction;
}

export class TransactionService {
  private readonly db: DatabaseAdapter;
  private readonly now: () => Date;
  private readonly transfers: TransferService;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.now = resolveClock(options);
    this.transfers = new TransferService(db, options);
  }

  // Tin nhắn thô: kiểm người gửi, parse theo ngày VN, rồi ghi giao dịch / chuyển tiền / quỹ chung.
  // Câu hỏi, báo cáo, không rõ ý → không ghi gì.
  async recordFromText(msg: IncomingMessage): Promise<RecordOutcome> {
    const member = await getMemberByTelegramUserId(this.db, msg.senderTelegramUserId);
    if (!isActiveMember(member)) {
      return this.recordIgnored(msg, member ? 'NGUOI_GUI_KHONG_ACTIVE' : 'NGUOI_GUI_KHONG_CO');
    }
    const parsed = parseVietnameseFinanceMessage(msg.text, {
      senderId: member.id,
      referenceDate: toVnDate(new Date(msg.receivedAt)),
    });
    if (parsed.intent === MESSAGE_INTENT.INTERNAL_TRANSFER) {
      return this.transfers.recordTransferFromParsed(msg, parsed, member);
    }
    if (parsed.intent === MESSAGE_INTENT.FUND_TRANSFER) {
      return this.transfers.recordFundFromParsed(msg, parsed, member);
    }
    if (parsed.intent !== MESSAGE_INTENT.RECORD_TRANSACTION) {
      return { kind: 'NOT_TRANSACTION', parsed };
    }
    return this.recordFromParsed(msg, parsed);
  }

  // Ghi kết quả parser. Thứ tự trong 1 transaction: tin_nhan_goc → giao_dich → yeu_cau → audit → trạng thái tin.
  async recordFromParsed(msg: IncomingMessage, parsed: ParsedTransactionResult): Promise<RecordOutcome> {
    const member = await getMemberByTelegramUserId(this.db, msg.senderTelegramUserId);
    if (!isActiveMember(member)) {
      return this.recordIgnored(msg, member ? 'NGUOI_GUI_KHONG_ACTIVE' : 'NGUOI_GUI_KHONG_CO');
    }
    if (member.id !== parsed.nguoi_tao_id) {
      throw new DomainError('INVALID_INPUT', 'nguoi_tao_id của parser khác người gửi');
    }
    const now = this.now();
    const nowIso = now.toISOString();
    return withDuplicateFallback(this.db, msg.updateId, () =>
      this.db.transaction(async (tx): Promise<RecordOutcome> => {
        const messageId = await insertIncomingMessage(tx, msg, member.id, nowIso);
        if (!messageId) {
          return loadExistingOutcome(tx, msg.updateId);
        }

        const blocking = await this.findBlockingReasons(tx, parsed);
        const expiresAt = addDaysIso(now, CONFIRMATION_EXPIRY_DAYS);
        if (blocking.length > 0) {
          const confirmations: YeuCauXacNhanRecord[] = [];
          for (const b of blocking) {
            confirmations.push(
              await insertConfirmation(tx, {
                id: newId('YC'),
                source_message_id: messageId,
                nguoi_tao_id: member.id,
                nguoi_can_xac_nhan_id: member.id,
                loai_xac_nhan: b.type,
                du_lieu_de_xuat: { parsed, ly_do: b.reason },
                expires_at: expiresAt,
                nowIso,
              }),
            );
          }
          await updateMessageStatus(tx, messageId, MESSAGE_STATUS.CHO_XAC_NHAN, nowIso);
          return {
            kind: 'PENDING',
            duplicate: false,
            message: await requireMessage(tx, messageId),
            confirmations,
          };
        }

        // Q2: parser luôn gán người giữ tiền; null ở đây là lỗi lập trình
        if (!parsed.nguoi_giu_tien_id) {
          throw new Error('Parser trả nguoi_giu_tien_id null cho giao dịch hoàn tất');
        }
        const v = await validateCompletedTransaction(tx, {
          loai: parsed.loai_giao_dich as TransactionType,
          soTien: parsed.so_tien as number,
          maDanhMuc:
            parsed.loai_giao_dich === TRANSACTION_TYPE.THU || parsed.loai_giao_dich === TRANSACTION_TYPE.CHI
              ? parsed.ma_danh_muc
              : null,
          nguoiThucHienId: parsed.nguoi_thuc_hien_id,
          nguoiGiuTienId: parsed.nguoi_giu_tien_id,
          doiTuongThuHuongId: parsed.doi_tuong_thu_huong_id,
          chieuDieuChinh: null,
          moTa: parsed.mo_ta,
          ngayGiaoDich: parsed.ngay_giao_dich,
        });
        const transaction = await insertCompleted(tx, v, member.id, messageId, telegramKey(msg.updateId), nowIso);

        // DOI_TUONG_MOI không chặn ghi, chỉ kèm yêu cầu (tạo đối tượng mới ở Phase 5). Phân bổ đã bỏ (Phase 4).
        const confirmations: YeuCauXacNhanRecord[] = [];
        for (const type of parsed.requires_confirmation) {
          if (type !== CONFIRMATION_TYPE.DOI_TUONG_MOI) {
            continue;
          }
          confirmations.push(
            await insertConfirmation(tx, {
              id: newId('YC'),
              source_message_id: messageId,
              nguoi_tao_id: member.id,
              nguoi_can_xac_nhan_id: member.id,
              loai_xac_nhan: type,
              du_lieu_de_xuat: { parsed, giao_dich_id: transaction.id },
              expires_at: expiresAt,
              nowIso,
            }),
          );
        }
        await updateMessageStatus(tx, messageId, MESSAGE_STATUS.DA_GHI, nowIso);
        return {
          kind: 'RECORDED',
          duplicate: false,
          message: await requireMessage(tx, messageId),
          transaction,
          confirmations,
        };
      }),
    );
  }

  // Ghi THU/CHI/PHI/LAI_VAY/DIEU_CHINH qua hàm gọi tường minh (key api:<uuid> bắt buộc)
  async recordExplicit(input: ExplicitTransactionInput): Promise<{ duplicate: boolean; transaction: GiaoDichRecord }> {
    const nowIso = this.now().toISOString();
    try {
      return await this.db.transaction((tx) => recordExplicitInTx(tx, input, nowIso));
    } catch (error) {
      // Hai lời gọi cùng key chạy song song: bên thua đọc lại bản đã ghi
      if (isUniqueViolation(error)) {
        const existing = await getTransactionByIdempotencyKey(this.db, input.idempotencyKey);
        if (existing) {
          return { duplicate: true, transaction: existing };
        }
      }
      throw error;
    }
  }

  // Người dùng trả lời yêu cầu xác nhận. Bấm lặp / quá hạn → không ghi thêm.
  // CHUYEN_TIEN: ACCEPT = "Đã nhận", REJECT = "Chưa nhận" (giữ chờ); PHAN_BO cũ chỉ đóng yêu cầu.
  async resolveConfirmation(
    yeuCauId: string,
    nguoiBamId: MemberId,
    action: ConfirmationAction,
  ): Promise<ConfirmationResult> {
    const now = this.now();
    const nowIso = now.toISOString();
    return this.db.transaction(async (tx) => {
      const request = await getConfirmationById(tx, yeuCauId);
      if (!request || request.deleted_at !== null) {
        throw new DomainError('NOT_FOUND', `Không tìm thấy yêu cầu ${yeuCauId}`);
      }
      if (request.nguoi_can_xac_nhan_id !== nguoiBamId) {
        throw new DomainError('WRONG_CONFIRMER', 'Người bấm không phải người cần xác nhận');
      }
      if (request.loai_xac_nhan === CONFIRMATION_TYPE.CHUYEN_TIEN) {
        const reply = await this.transfers.respondTransferInTx(
          tx,
          request,
          action.type === 'ACCEPT' ? 'DA_NHAN' : 'CHUA_NHAN',
          now,
        );
        return {
          changed: reply.changed,
          confirmation: (await getConfirmationById(tx, request.id)) ?? request,
          transaction: null,
          transfer: reply.transfer,
          expired: reply.expired,
        };
      }
      const isBlocking = BLOCKING_TYPES.includes(request.loai_xac_nhan);
      const message = await requireMessage(tx, request.source_message_id);

      const status = action.type === 'ACCEPT' ? CONFIRMATION_STATUS.DA_XAC_NHAN : CONFIRMATION_STATUS.TU_CHOI;
      const changed = await closeConfirmation(
        tx,
        request.id,
        status,
        nowIso,
        action.type === 'ACCEPT' ? nowIso : null,
      );
      if (changed === 0) {
        const current = await getConfirmationById(tx, request.id);
        const existingTx = await getTransactionByIdempotencyKey(tx, telegramKey(message.telegram_update_id));
        return {
          changed: false,
          confirmation: current ?? request,
          transaction: existingTx,
          expired: current?.trang_thai === CONFIRMATION_STATUS.CHO_XAC_NHAN,
        };
      }

      // Đóng trước rồi mới kiểm dữ liệu bổ sung: bấm lặp/quá hạn trả no-op; dữ liệu sai → lỗi, rollback cả bước đóng
      const validated =
        action.type === 'ACCEPT' && isBlocking ? await this.buildFromSupplement(tx, request, action.data ?? {}) : null;

      let transaction: GiaoDichRecord | null = null;
      if (isBlocking) {
        // Đóng luôn các yêu cầu chặn khác của cùng tin nhắn
        for (const other of await listConfirmationsByMessage(tx, message.id)) {
          if (
            other.id !== request.id &&
            other.trang_thai === CONFIRMATION_STATUS.CHO_XAC_NHAN &&
            BLOCKING_TYPES.includes(other.loai_xac_nhan)
          ) {
            await closeConfirmation(tx, other.id, status, nowIso);
          }
        }
        if (validated) {
          transaction = await insertCompleted(
            tx,
            validated,
            request.nguoi_tao_id,
            message.id,
            telegramKey(message.telegram_update_id),
            nowIso,
          );
          await updateMessageStatus(tx, message.id, MESSAGE_STATUS.DA_GHI, nowIso);
        } else {
          await updateMessageStatus(tx, message.id, MESSAGE_STATUS.DA_BO_QUA, nowIso, 'TU_CHOI');
        }
      }

      await insertAuditLog(tx, {
        ten_bang: TABLE_NAME.YEU_CAU_XAC_NHAN,
        ban_ghi_id: request.id,
        hanh_dong: action.type === 'ACCEPT' ? AUDIT_ACTION.CONFIRM : AUDIT_ACTION.UPDATE,
        du_lieu_truoc: { trang_thai: request.trang_thai },
        du_lieu_sau: { trang_thai: status, giao_dich_id: transaction?.id ?? null },
        nguoi_thuc_hien_id: nguoiBamId,
        ly_do: action.type === 'REJECT' ? 'TU_CHOI' : null,
        nowIso,
      });
      const confirmation = await getConfirmationById(tx, request.id);
      return { changed: true, confirmation: confirmation ?? request, transaction, expired: false };
    });
  }

  // Huỷ giao dịch: DA_HUY + xoá mềm lich_su_no đi kèm + tính lại dư nợ + đóng yêu cầu còn chờ
  async cancelTransaction(giaoDichId: string, nguoiHuyId: MemberId, lyDo: string | null = null): Promise<CancelResult> {
    const nowIso = this.now().toISOString();
    return this.db.transaction(async (tx) => {
      const before = await getTransactionById(tx, giaoDichId);
      if (!before || before.deleted_at !== null) {
        throw new DomainError('NOT_FOUND', `Không tìm thấy giao dịch ${giaoDichId}`);
      }
      if (before.trang_thai === TRANSACTION_STATUS.DA_HUY) {
        return { changed: false, transaction: before };
      }
      if (before.khoan_no_id) {
        const history = await listDebtHistoryByTransaction(tx, before.id);
        if (history.some((h) => h.loai_bien_dong === DEBT_CHANGE_TYPE.GIAI_NGAN)) {
          const { goc } = await sumLoanLedger(tx, before.khoan_no_id);
          if (goc > 0) {
            throw new DomainError('CANCEL_BLOCKED', 'Khoản nợ đã có trả/thu gốc, huỷ các lần trả trước');
          }
        }
      }
      const changed = await markTransactionCancelled(tx, before.id, nowIso);
      if (changed === 0) {
        return { changed: false, transaction: (await getTransactionById(tx, before.id)) ?? before };
      }
      if (before.khoan_no_id) {
        await softDeleteDebtHistoryByTransaction(tx, before.id, nowIso);
        await recomputeLoan(tx, before.khoan_no_id, nowIso);
      }
      if (before.source_message_id) {
        for (const c of await listConfirmationsByMessage(tx, before.source_message_id)) {
          if (c.trang_thai === CONFIRMATION_STATUS.CHO_XAC_NHAN) {
            await closeConfirmation(tx, c.id, CONFIRMATION_STATUS.TU_CHOI, nowIso);
          }
        }
      }
      const after = await getTransactionById(tx, before.id);
      await insertAuditLog(tx, {
        ten_bang: TABLE_NAME.GIAO_DICH,
        ban_ghi_id: before.id,
        hanh_dong: AUDIT_ACTION.CANCEL,
        du_lieu_truoc: before,
        du_lieu_sau: after,
        nguoi_thuc_hien_id: nguoiHuyId,
        ly_do: lyDo,
        nowIso,
      });
      return { changed: true, transaction: after ?? before };
    });
  }

  private async findBlockingReasons(
    tx: DatabaseAdapter,
    parsed: ParsedTransactionResult,
  ): Promise<Array<{ type: ConfirmationType; reason: string }>> {
    const reasons: Array<{ type: ConfirmationType; reason: string }> = [];
    const type = parsed.loai_giao_dich;
    if (parsed.so_tien === null) {
      reasons.push({ type: CONFIRMATION_TYPE.GIAO_DICH_MO_HO, reason: 'THIEU_SO_TIEN' });
    } else if (type === null || parsed.requires_confirmation.includes(CONFIRMATION_TYPE.GIAO_DICH_MO_HO)) {
      reasons.push({ type: CONFIRMATION_TYPE.GIAO_DICH_MO_HO, reason: 'KHONG_RO_LOAI' });
    } else if (NOT_FROM_MESSAGE_TYPES.includes(type)) {
      reasons.push({ type: CONFIRMATION_TYPE.GIAO_DICH_MO_HO, reason: `${type}_TU_TIN_NHAN` });
    }
    let categoryMissing = parsed.requires_confirmation.includes(CONFIRMATION_TYPE.DANH_MUC_MOI);
    const needsCategory = type === TRANSACTION_TYPE.THU || type === TRANSACTION_TYPE.CHI;
    if (!categoryMissing && needsCategory && parsed.ma_danh_muc) {
      const category = await getActiveCategoryByCode(tx, parsed.ma_danh_muc);
      categoryMissing = category === null || !categoryFits(category.loai_giao_dich, type);
    }
    if (categoryMissing) {
      reasons.push({ type: CONFIRMATION_TYPE.DANH_MUC_MOI, reason: 'DANH_MUC_CHUA_CO' });
    }
    return reasons;
  }

  private async buildFromSupplement(
    tx: DatabaseAdapter,
    request: YeuCauXacNhanRecord,
    data: ConfirmationSupplement,
  ): Promise<ValidatedTransaction> {
    const proposal = JSON.parse(request.du_lieu_de_xuat_json) as { parsed?: ParsedTransactionResult };
    const parsed = proposal.parsed;
    if (!parsed) {
      throw new DomainError('INVALID_INPUT', `Yêu cầu ${request.id} không có dữ liệu đề xuất`);
    }
    const loai = data.loai_giao_dich ?? parsed.loai_giao_dich;
    const soTien = data.so_tien ?? parsed.so_tien;
    if (loai === null || soTien === null) {
      throw new DomainError('INVALID_INPUT', 'Thiếu loại giao dịch hoặc số tiền');
    }
    const nguoiThucHienId = data.nguoi_thuc_hien_id ?? parsed.nguoi_thuc_hien_id;
    // Q2: holder parser = người thực hiện cũ nghĩa là câu không nói ai giữ → đi theo người thực hiện mới
    const holderWasDefault = parsed.nguoi_giu_tien_id === parsed.nguoi_thuc_hien_id;
    const nguoiGiuTienId =
      data.nguoi_giu_tien_id ?? (holderWasDefault ? nguoiThucHienId : parsed.nguoi_giu_tien_id);
    return validateCompletedTransaction(tx, {
      loai,
      soTien,
      maDanhMuc: data.ma_danh_muc !== undefined ? data.ma_danh_muc : parsed.ma_danh_muc,
      nguoiThucHienId,
      nguoiGiuTienId,
      doiTuongThuHuongId:
        data.doi_tuong_thu_huong_id !== undefined ? data.doi_tuong_thu_huong_id : parsed.doi_tuong_thu_huong_id,
      chieuDieuChinh: data.chieu_dieu_chinh ?? null,
      moTa: data.mo_ta ?? parsed.mo_ta,
      ngayGiaoDich: data.ngay_giao_dich ?? parsed.ngay_giao_dich,
    });
  }

  // Người gửi không có / không active: lưu tin DA_BO_QUA (không gắn người gửi), không ghi gì khác
  private async recordIgnored(msg: IncomingMessage, reason: string): Promise<RecordOutcome> {
    const nowIso = this.now().toISOString();
    return withDuplicateFallback(this.db, msg.updateId, () =>
      this.db.transaction(async (tx): Promise<RecordOutcome> => {
        const messageId = await insertIncomingMessage(tx, msg, null, nowIso);
        if (!messageId) {
          return loadExistingOutcome(tx, msg.updateId);
        }
        return ignoreMessage(tx, messageId, reason, nowIso);
      }),
    );
  }
}
