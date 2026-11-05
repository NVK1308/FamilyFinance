import {
  ADJUSTMENT_DIRECTION,
  AUDIT_ACTION,
  MONEY_HOLDER_ID,
  TABLE_NAME,
  TRANSACTION_TYPE,
  type MemberId,
  type MoneyHolderId,
} from '../config/constants.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import {
  getTransactionByIdempotencyKey,
  insertInitialBalance,
  listActiveInitialBalances,
  listAllInitialBalances,
  listCompletedWithoutHolder,
  listDebtTransactionMismatches,
  listLoanBalanceMismatches,
  listUnmappedTransfers,
  sumPeriodIncomeExpense,
  sumTransactionsByHolder,
  sumTransactionsByType,
  sumFundMovesByGroup,
  sumTransfersByRole,
  updateInitialBalance,
} from '../db/repositories/index.ts';
import { toSafeNumber, type DatabaseAdapter, type GiaoDichRecord } from '../db/types.ts';
import { DomainError, assertApiKey, assertDate, newId, resolveClock, type ServiceOptions } from './common.ts';
import { recordExplicitInTx } from './transaction-service.ts';

export const HOLDERS: readonly MoneyHolderId[] = [
  MONEY_HOLDER_ID.VO,
  MONEY_HOLDER_ID.CHONG,
  MONEY_HOLDER_ID.QUY_CHUNG,
  MONEY_HOLDER_ID.CHUA_XAC_DINH,
];

export type HolderAmounts = Record<MoneyHolderId, number>;

// Chưa nhập số dư ban đầu, hoặc asOf trước ngày áp dụng → trả cờ, không coi là 0
export type BalanceStatus = 'OK' | 'CHUA_CO_SO_DU_BAN_DAU' | 'ASOF_TRUOC_NGAY_AP_DUNG';

export type HolderBalancesResult =
  | { status: 'OK'; asOf: string; ngayApDung: string; nhom: HolderAmounts; tong: number }
  | { status: Exclude<BalanceStatus, 'OK'>; asOf: string; ngayApDung: string | null };

export type FamilyBalanceResult =
  | { status: 'OK'; asOf: string; ngayApDung: string; soDu: number }
  | { status: Exclude<BalanceStatus, 'OK'>; asOf: string; ngayApDung: string | null };

export interface SetInitialBalanceInput {
  ngayApDung: string;
  theoNhom: HolderAmounts;
  // Tổng người dùng báo ("hiện gia đình đang có bao nhiêu") để đối chiếu với 4 nhóm
  tongNhap: number;
  nguoiXacNhanId: MemberId;
  ghiChu?: string | null;
}

export interface ConsistencyReport {
  status: BalanceStatus;
  asOf: string;
  tongNhom: number | null;
  soDuGiaDinh: number | null;
  chenhLech: number | null;
  nghiVan: {
    giaoDichKhongNguoiGiu: Awaited<ReturnType<typeof listCompletedWithoutHolder>>;
    chuyenTienKhongMapDuoc: Awaited<ReturnType<typeof listUnmappedTransfers>>;
    giaoDichNoLech: Awaited<ReturnType<typeof listDebtTransactionMismatches>>;
    khoanNoLechLichSu: Awaited<ReturnType<typeof listLoanBalanceMismatches>>;
  };
}

export interface ReconciliationLine {
  nhom: MoneyHolderId;
  heThong: number;
  thucTe: number;
  chenh: number;
}

export interface ReconciliationProposal {
  status: BalanceStatus;
  asOf: string;
  dong: ReconciliationLine[];
}

export interface ApplyReconciliationInput {
  asOf: string;
  thucTeTheoNhom: Partial<HolderAmounts>;
  nguoiXacNhanId: MemberId;
  // Key gốc api:<uuid>; mỗi nhóm ghi với key `${idempotencyKey}:${nhom}`
  idempotencyKey: string;
}

function emptyAmounts(): HolderAmounts {
  return { VO: 0, CHONG: 0, QUY_CHUNG: 0, CHUA_XAC_DINH: 0 };
}

interface InitialState {
  ngayApDung: string;
  theoNhom: HolderAmounts;
}

export class BalanceService {
  private readonly db: DatabaseAdapter;
  private readonly now: () => Date;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.now = resolveClock(options);
  }

  // Q7: nhập đủ 4 nhóm, 1 ngày áp dụng chung, 1 transaction. Dòng có sẵn (kể cả xoá mềm) → UPDATE.
  async setInitialBalance(input: SetInitialBalanceInput): Promise<InitialState> {
    assertDate(input.ngayApDung, 'ngayApDung');
    let tong = 0;
    for (const holder of HOLDERS) {
      const amount = input.theoNhom[holder];
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new DomainError('INVALID_INPUT', `Số dư ban đầu nhóm ${holder} không hợp lệ: ${amount}`);
      }
      tong += amount;
    }
    if (tong !== input.tongNhap) {
      throw new DomainError('INVALID_INPUT', `Tổng 4 nhóm ${tong} khác tổng nhập ${input.tongNhap}`);
    }
    const nowIso = this.now().toISOString();
    await this.db.transaction(async (tx) => {
      const existing = new Map((await listAllInitialBalances(tx)).map((r) => [r.nguoi_giu_tien_id, r]));
      for (const holder of HOLDERS) {
        const data = {
          nguoi_giu_tien_id: holder,
          so_tien: input.theoNhom[holder],
          ngay_ap_dung: input.ngayApDung,
          nguoi_xac_nhan_id: input.nguoiXacNhanId,
          ghi_chu: input.ghiChu ?? null,
        };
        const row = { ...data, nowIso };
        const old = existing.get(holder);
        const id = old?.id ?? newId('SDBD');
        if (old) {
          await updateInitialBalance(tx, id, row);
        } else {
          await insertInitialBalance(tx, id, row);
        }
        await insertAuditLog(tx, {
          ten_bang: TABLE_NAME.SO_DU_BAN_DAU,
          ban_ghi_id: id,
          hanh_dong: old ? AUDIT_ACTION.UPDATE : AUDIT_ACTION.CREATE,
          du_lieu_truoc: old ?? null,
          du_lieu_sau: { id, ...data },
          nguoi_thuc_hien_id: input.nguoiXacNhanId,
          nowIso,
        });
      }
    });
    return { ngayApDung: input.ngayApDung, theoNhom: { ...input.theoNhom } };
  }

  // Cách 1: số dư từng nhóm = ban đầu + giao dịch theo người giữ + chuyển nội bộ đã xác nhận + nộp/rút quỹ chung
  async getHolderBalances(asOf: string): Promise<HolderBalancesResult> {
    assertDate(asOf, 'asOf');
    const gate = await this.checkInitial(asOf);
    if (gate.status !== 'OK') {
      return gate;
    }
    const nhom = { ...gate.initial.theoNhom };
    const txSums = await sumTransactionsByHolder(this.db, gate.initial.ngayApDung, asOf);
    for (const [holder, total] of txSums) {
      nhom[holder] += total;
    }
    for (const t of await sumTransfersByRole(this.db, gate.initial.ngayApDung, asOf)) {
      nhom[t.tu] -= t.total;
      nhom[t.den] += t.total;
    }
    for (const f of await sumFundMovesByGroup(this.db, gate.initial.ngayApDung, asOf)) {
      const sign = f.chieu === 'NOP' ? 1 : -1;
      nhom[f.nhom] -= sign * f.total;
      nhom.QUY_CHUNG += sign * f.total;
    }
    const tong = HOLDERS.reduce((sum, h) => sum + nhom[h], 0);
    return { status: 'OK', asOf, ngayApDung: gate.initial.ngayApDung, nhom, tong };
  }

  // Cách 2 (độc lập, mục 4.1): ban đầu + THU − (CHI+LAI_VAY+PHI) + VAY − TRA_NO ± DIEU_CHINH; CHO_VAY đảo dấu
  async getFamilyBalance(asOf: string): Promise<FamilyBalanceResult> {
    assertDate(asOf, 'asOf');
    const gate = await this.checkInitial(asOf);
    if (gate.status !== 'OK') {
      return gate;
    }
    let soDu = HOLDERS.reduce((sum, h) => sum + gate.initial.theoNhom[h], 0);
    for (const row of await sumTransactionsByType(this.db, gate.initial.ngayApDung, asOf)) {
      const lending = row.chieuNo === 'CHO_VAY';
      switch (row.loai) {
        case TRANSACTION_TYPE.THU:
          soDu += row.total;
          break;
        case TRANSACTION_TYPE.CHI:
        case TRANSACTION_TYPE.LAI_VAY:
        case TRANSACTION_TYPE.PHI:
          soDu -= row.total;
          break;
        case TRANSACTION_TYPE.VAY:
          soDu += lending ? -row.total : row.total;
          break;
        case TRANSACTION_TYPE.TRA_NO:
          soDu += lending ? row.total : -row.total;
          break;
        case TRANSACTION_TYPE.DIEU_CHINH:
          soDu += row.chieuDieuChinh === ADJUSTMENT_DIRECTION.GIAM ? -row.total : row.total;
          break;
      }
    }
    return { status: 'OK', asOf, ngayApDung: gate.initial.ngayApDung, soDu };
  }

  // Tổng kỳ: VAY/TRA_NO/DIEU_CHINH/chuyển nội bộ không vào thu/chi
  async getPeriodTotals(from: string, to: string): Promise<{ tongThu: number; tongChi: number; chenhLech: number }> {
    assertDate(from, 'from');
    assertDate(to, 'to');
    const { tongThu, tongChi } = await sumPeriodIncomeExpense(this.db, from, to);
    return { tongThu, tongChi, chenhLech: tongThu - tongChi };
  }

  // Lưới an toàn: tổng nhóm phải bằng số dư gia đình; lệch → chỉ ra bản ghi nghi vấn, không tự sửa
  async checkConsistency(asOf: string): Promise<ConsistencyReport> {
    const holders = await this.getHolderBalances(asOf);
    const family = await this.getFamilyBalance(asOf);
    const from = holders.status === 'OK' ? holders.ngayApDung : '0000-01-01';
    const nghiVan = {
      giaoDichKhongNguoiGiu: await listCompletedWithoutHolder(this.db, from, asOf),
      chuyenTienKhongMapDuoc: await listUnmappedTransfers(this.db, from, asOf),
      giaoDichNoLech: await listDebtTransactionMismatches(this.db, from, asOf),
      khoanNoLechLichSu: await listLoanBalanceMismatches(this.db),
    };
    if (holders.status !== 'OK' || family.status !== 'OK') {
      return { status: holders.status, asOf, tongNhom: null, soDuGiaDinh: null, chenhLech: null, nghiVan };
    }
    return {
      status: 'OK',
      asOf,
      tongNhom: holders.tong,
      soDuGiaDinh: family.soDu,
      chenhLech: holders.tong - family.soDu,
      nghiVan,
    };
  }

  // Người dùng báo tiền thực tế theo nhóm → chỉ tính chênh, không ghi
  async proposeReconciliation(asOf: string, thucTeTheoNhom: Partial<HolderAmounts>): Promise<ReconciliationProposal> {
    const holders = await this.getHolderBalances(asOf);
    if (holders.status !== 'OK') {
      return { status: holders.status, asOf, dong: [] };
    }
    const dong: ReconciliationLine[] = [];
    for (const nhom of HOLDERS) {
      const thucTe = thucTeTheoNhom[nhom];
      if (thucTe === undefined) {
        continue;
      }
      if (!Number.isSafeInteger(thucTe)) {
        throw new DomainError('INVALID_INPUT', `Số thực tế nhóm ${nhom} không hợp lệ: ${thucTe}`);
      }
      const heThong = holders.nhom[nhom];
      dong.push({ nhom, heThong, thucTe, chenh: thucTe - heThong });
    }
    return { status: 'OK', asOf, dong };
  }

  // Người dùng đồng ý đối soát → ghi DIEU_CHINH TANG/GIAM cho từng nhóm lệch, ngày = asOf, 1 transaction
  async applyReconciliation(input: ApplyReconciliationInput): Promise<GiaoDichRecord[]> {
    assertApiKey(input.idempotencyKey);
    const nowIso = this.now().toISOString();
    return this.db.transaction(async (tx) => {
      // Đã đối soát với key này (gọi lại sau khi mất phản hồi) → trả các dòng đã ghi, không tính lại
      const previous: GiaoDichRecord[] = [];
      for (const nhom of HOLDERS) {
        const row = await getTransactionByIdempotencyKey(tx, `${input.idempotencyKey}:${nhom}`);
        if (row) {
          previous.push(row);
        }
      }
      if (previous.length > 0) {
        return previous;
      }
      const scoped = new BalanceService(tx, { now: this.now });
      const proposal = await scoped.proposeReconciliation(input.asOf, input.thucTeTheoNhom);
      if (proposal.status !== 'OK') {
        throw new DomainError('INVALID_INPUT', `Chưa đối soát được: ${proposal.status}`);
      }
      const written: GiaoDichRecord[] = [];
      for (const line of proposal.dong) {
        if (line.chenh === 0) {
          continue;
        }
        const { transaction } = await recordExplicitInTx(
          tx,
          {
            idempotencyKey: `${input.idempotencyKey}:${line.nhom}`,
            loai: TRANSACTION_TYPE.DIEU_CHINH,
            soTien: Math.abs(line.chenh),
            nguoiTaoId: input.nguoiXacNhanId,
            nguoiGiuTienId: line.nhom,
            chieuDieuChinh: line.chenh > 0 ? ADJUSTMENT_DIRECTION.TANG : ADJUSTMENT_DIRECTION.GIAM,
            moTa: `Đối soát ${line.nhom}: hệ thống ${line.heThong}, thực tế ${line.thucTe}`,
            ngayGiaoDich: input.asOf,
          },
          nowIso,
        );
        written.push(transaction);
      }
      return written;
    });
  }

  private async checkInitial(
    asOf: string,
  ): Promise<
    | { status: 'OK'; initial: InitialState }
    | { status: Exclude<BalanceStatus, 'OK'>; asOf: string; ngayApDung: string | null }
  > {
    const rows = await listActiveInitialBalances(this.db);
    const dates = new Set(rows.map((r) => r.ngay_ap_dung));
    const firstDate = rows[0]?.ngay_ap_dung ?? null;
    if (rows.length !== HOLDERS.length || dates.size !== 1 || firstDate === null) {
      return { status: 'CHUA_CO_SO_DU_BAN_DAU', asOf, ngayApDung: null };
    }
    // Cả hai đã chuẩn YYYY-MM-DD nên so chuỗi = so ngày
    if (asOf < firstDate) {
      return { status: 'ASOF_TRUOC_NGAY_AP_DUNG', asOf, ngayApDung: firstDate };
    }
    const theoNhom = emptyAmounts();
    for (const r of rows) {
      theoNhom[r.nguoi_giu_tien_id] = toSafeNumber(r.so_tien);
    }
    return { status: 'OK', initial: { ngayApDung: firstDate, theoNhom } };
  }
}
