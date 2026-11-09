import { MONEY_HOLDER_ID } from '../config/constants.ts';
import {
  listTransactions,
  listTransfersFiltered,
  sumByBeneficiary,
  sumByPerformer,
  sumByCategory,
  sumPendingTransfers,
  sumTransactions,
  sumIncomeExpense,
  getJarByNormalizedName,
  sumSavingsCash,
  sumSavingsFlows,
  sumTransfersFiltered,
  type GroupTotal,
  type TransferRow,
  type TxRow,
  type TxQueryFilter,
} from '../db/repositories/index.ts';
import type { DatabaseAdapter, HuRecord } from '../db/types.ts';
import type { Period } from '../query/period-parser.ts';
import type { QuerySpec } from '../query/types.ts';
import { BalanceService, type HolderBalancesResult } from './balance-service.ts';
import { SavingsService } from './savings-service.ts';
import type { ServiceOptions } from './common.ts';

// Chi = CHI + PHI + LAI_VAY; Thu = THU (Runbook 4.1). VAY/TRA_NO/DIEU_CHINH, chuyển nội bộ, quỹ không tính.
const EXPENSE_TYPES = ['CHI', 'PHI', 'LAI_VAY'] as const;
const INCOME_TYPES = ['THU'] as const;
const ALL_TYPES = [...INCOME_TYPES, ...EXPENSE_TYPES];
export const TOP_CATEGORIES = 3;
export const MAX_GROUPS = 8;
export const TOP_ITEMS = 5;
export const LIST_LIMIT = 10;

export interface Sum {
  total: number;
  count: number;
}

export type QueryAnswer =
  | {
      kind: 'TONG';
      spec: QuerySpec;
      thu: Sum | null;
      chi: Sum | null;
      // Q2: phần chi lấy từ quỹ chung (cùng bộ lọc); null khi câu đã lọc theo người giữ
      chiTuQuyChung: number | null;
      topDanhMuc: GroupTotal[];
    }
  | { kind: 'SO_DU'; spec: QuerySpec; asOf: string; balances: HolderBalancesResult; dangChoChuyen: Sum | null; hu: number }
  | {
      kind: 'HU_TIET_KIEM';
      spec: QuerySpec;
      asOf: string;
      // Hũ được hỏi; null = mọi hũ
      jar: HuRecord | null;
      tien: number;
      // Hỏi dòng tiền trong kỳ (savingsFlow)
      flows: { nop: number; soNop: number; rut: number; soRut: number } | null;
      // Hỏi số dư mọi hũ → từng hũ
      jars: Array<{ jar: HuRecord; tien: number }> | null;
    }
  | { kind: 'THEO_DANH_MUC' | 'THEO_DOI_TUONG'; spec: QuerySpec; tong: Sum; nhom: GroupTotal[] }
  | { kind: 'AI_NHIEU_NHAT'; spec: QuerySpec; tong: Sum; nhom: GroupTotal[] }
  | { kind: 'LON_NHAT'; spec: QuerySpec; rows: TxRow[] }
  // Liệt kê: thu và chi tách riêng, không cộng lẫn
  | { kind: 'LIET_KE'; spec: QuerySpec; thu: number; chi: number; count: number; rows: TxRow[] }
  | { kind: 'SO_SANH'; spec: QuerySpec; ky: [PeriodTotals, PeriodTotals] }
  // daNhan: tổng khoản đã nhận khi hỏi nhiều trạng thái (khoản huỷ / chờ / hết hạn không tính là đã chuyển)
  | { kind: 'CHUYEN_TIEN'; spec: QuerySpec; tong: Sum; daNhan: number | null; rows: TransferRow[] }
  | { kind: 'NO'; spec: QuerySpec };

export interface PeriodTotals {
  period: Period;
  thu: number;
  chi: number;
}

export class QueryService {
  private readonly db: DatabaseAdapter;
  private readonly balances: BalanceService;
  private readonly savings: SavingsService;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.balances = new BalanceService(db, options);
    this.savings = new SavingsService(db, options);
  }

  // Chỉ đọc DB. today = ngày VN của tin nhắn (số dư kỳ chưa hết tính tới hôm nay).
  async run(spec: QuerySpec, today: string): Promise<QueryAnswer> {
    switch (spec.kind) {
      case 'TONG':
        return this.total(spec);
      case 'SO_DU': {
        const asOf = spec.period.to < today ? spec.period.to : today;
        const balances = await this.balances.getHolderBalances(asOf);
        // Chờ chuyển chỉ liên quan vợ/chồng: hỏi quỹ chung / chưa rõ người giữ thì không kèm
        const holder = spec.holder;
        const member = holder === MONEY_HOLDER_ID.VO || holder === MONEY_HOLDER_ID.CHONG ? holder : null;
        const dangChoChuyen =
          asOf === today && (holder === null || member !== null) ? await sumPendingTransfers(this.db, member) : null;
        // Hỏi số dư chung → kèm hũ tiết kiệm (tài sản chung)
        const hu = holder === null ? (await this.balances.getSavingsJar(asOf)).tien : 0;
        return { kind: 'SO_DU', spec, asOf, balances, dangChoChuyen, hu };
      }
      case 'HU_TIET_KIEM': {
        const asOf = spec.period.to < today ? spec.period.to : today;
        // 1 hũ ("quỹ y tế còn bao nhiêu") hoặc mọi hũ
        const jar = spec.huTen ? await getJarByNormalizedName(this.db, spec.huTen) : null;
        if (!jar && !spec.savingsFlow) {
          // Số dư mọi hũ: từng hũ + tổng (cùng hàm với /tietkiem)
          const jars = await this.savings.listJarBalances(asOf);
          return { kind: 'HU_TIET_KIEM', spec, asOf, jar, tien: jars.reduce((s, r) => s + r.tien, 0), flows: null, jars };
        }
        const huId = jar?.id ?? null;
        const [flows, cash] = await Promise.all([
          spec.savingsFlow ? sumSavingsFlows(this.db, spec.period.from, spec.period.to, huId) : null,
          sumSavingsCash(this.db, asOf, huId),
        ]);
        return { kind: 'HU_TIET_KIEM', spec, asOf, jar, tien: cash.tien, flows, jars: null };
      }
      case 'THEO_DANH_MUC':
      case 'THEO_DOI_TUONG': {
        const f = this.filter(spec, spec.measure === 'THU' ? INCOME_TYPES : EXPENSE_TYPES);
        const nhom = spec.kind === 'THEO_DANH_MUC' ? await sumByCategory(this.db, f) : await sumByBeneficiary(this.db, f);
        return { kind: spec.kind, spec, tong: sumGroups(nhom), nhom };
      }
      case 'AI_NHIEU_NHAT': {
        const nhom = await sumByPerformer(this.db, this.filter(spec, this.types(spec)));
        return { kind: 'AI_NHIEU_NHAT', spec, tong: sumGroups(nhom), nhom };
      }
      case 'LON_NHAT':
        return { kind: 'LON_NHAT', spec, rows: await listTransactions(this.db, this.filter(spec, this.types(spec)), 'amount', TOP_ITEMS) };
      case 'LIET_KE': {
        const f = this.filter(spec, this.types(spec));
        const [sums, rows] = await Promise.all([sumIncomeExpense(this.db, f), listTransactions(this.db, f, 'date', LIST_LIMIT)]);
        return { kind: 'LIET_KE', spec, ...sums, rows };
      }
      case 'SO_SANH': {
        const periods = [spec.period, spec.comparePeriod ?? spec.period];
        const ky = await Promise.all(
          periods.map(async (p) => ({ period: p, ...(await sumIncomeExpense(this.db, this.filter({ ...spec, period: p }, ALL_TYPES))) })),
        );
        return { kind: 'SO_SANH', spec, ky: [ky[0]!, ky[1]!] };
      }
      case 'CHUYEN_TIEN': {
        const t = spec.transfer!;
        const f = { from: spec.period.from, to: spec.period.to, statuses: t.statuses, sender: t.from, receiver: t.to };
        const mixed = t.statuses.length > 1 && t.statuses.includes('DA_XAC_NHAN');
        const [tong, daNhan, rows] = await Promise.all([
          sumTransfersFiltered(this.db, f),
          mixed ? sumTransfersFiltered(this.db, { ...f, statuses: ['DA_XAC_NHAN'] }).then((s) => s.total) : null,
          t.list ? listTransfersFiltered(this.db, f, LIST_LIMIT) : Promise.resolve([]),
        ]);
        return { kind: 'CHUYEN_TIEN', spec, tong, daNhan, rows };
      }
      case 'NO':
        return { kind: 'NO', spec };
    }
  }

  // Thu → THU; Chi → CHI/PHI/LAI_VAY; tổng quan (liệt kê) → cả hai
  private types(spec: QuerySpec): readonly string[] {
    if (spec.measure === 'THU') return INCOME_TYPES;
    if (spec.measure === 'CHI') return EXPENSE_TYPES;
    return ALL_TYPES;
  }

  private filter(spec: QuerySpec, loai: readonly string[]): TxQueryFilter {
    return {
      from: spec.period.from,
      to: spec.period.to,
      loai,
      performer: spec.performer,
      beneficiaries: spec.beneficiaries?.ids ?? null,
      categoryCodes: spec.categories?.codes ?? null,
      holder: spec.holder,
    };
  }

  private async total(spec: QuerySpec): Promise<QueryAnswer> {
    const chiFilter = this.filter(spec, EXPENSE_TYPES);
    // Top danh mục khi hỏi 1 chiều thu/chi và không lọc đúng 1 danh mục
    const single = spec.measure === 'THU' || spec.measure === 'CHI';
    const wantTop = single && (spec.categories?.codes.length ?? 0) !== 1;
    // Các truy vấn độc lập → chạy song song (bớt round trip tới Neon)
    const [thu, chi, chiTuQuyChung, top] = await Promise.all([
      spec.measure !== 'CHI' ? sumTransactions(this.db, this.filter(spec, INCOME_TYPES)) : null,
      spec.measure !== 'THU' ? sumTransactions(this.db, chiFilter) : null,
      spec.measure !== 'THU' && !spec.holder
        ? sumTransactions(this.db, { ...chiFilter, holder: MONEY_HOLDER_ID.QUY_CHUNG }).then((s) => s.total)
        : null,
      wantTop ? sumByCategory(this.db, this.filter(spec, spec.measure === 'THU' ? INCOME_TYPES : EXPENSE_TYPES)) : [],
    ]);
    return { kind: 'TONG', spec, thu, chi, chiTuQuyChung, topDanhMuc: top.slice(0, TOP_CATEGORIES) };
  }
}

function sumGroups(groups: readonly GroupTotal[]): Sum {
  return groups.reduce((s, g) => ({ total: s.total + g.total, count: s.count + g.count }), { total: 0, count: 0 });
}
