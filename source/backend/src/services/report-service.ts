import {
  listTransactions,
  listTransfersFiltered,
  sumByBeneficiary,
  sumByCategory,
  sumByPerformer,
  sumFundMovesByGroup,
  sumIncomeExpense,
  sumPendingTransfers,
  sumSavingsFlows,
  type GroupTotal,
  type TransferRow,
  type TxQueryFilter,
  type TxRow,
} from '../db/repositories/index.ts';
import type { DatabaseAdapter } from '../db/types.ts';
import { monthPeriod, previousPeriod, type Period } from '../query/period-parser.ts';
import { BalanceService, type HolderBalancesResult } from './balance-service.ts';
import { resolveClock, type ServiceOptions } from './common.ts';
import { SavingsService, type SavingsSummary } from './savings-service.ts';

// Phase 6: số liệu báo cáo tháng (ảnh tóm tắt + file HTML). Chỉ đọc. Không giới hạn số dòng như tin nhắn.
const EXPENSE = ['CHI', 'PHI', 'LAI_VAY'] as const;
const INCOME = ['THU'] as const;
const ALL_ROWS = ['THU', 'CHI', 'PHI', 'LAI_VAY'] as const;
// Đủ lớn cho 1 tháng gia đình; vượt → báo cáo ghi rõ "còn N khoản"
export const REPORT_ROW_LIMIT = 2_000;
const TRANSFER_LIMIT = 500;

export interface ReportData {
  // "Tháng 10/2026"
  title: string;
  period: Period;
  // Tháng đang chạy: số liệu đến hôm nay
  asOf: string;
  partial: boolean;
  generatedAt: string;
  thu: number;
  chi: number;
  soKhoan: number;
  // Kỳ so sánh: tháng trước (tháng đang chạy → cùng đoạn ngày của tháng trước)
  compare: { period: Period; thu: number; chi: number; chiTheoDanhMuc: GroupTotal[] };
  chiTheoDanhMuc: GroupTotal[];
  thuTheoDanhMuc: GroupTotal[];
  chiTheoNguoi: GroupTotal[];
  // Có dòng key = null (khoản không ghi đối tượng) → cộng lại bằng tổng chi
  chiTheoDoiTuong: GroupTotal[];
  chiTuQuyChung: number;
  balances: HolderBalancesResult;
  pending: { total: number; count: number };
  savings: SavingsSummary;
  savingsFlows: { nop: number; soNop: number; rut: number; soRut: number };
  goldFlows: { nop: number; soNop: number; rut: number; soRut: number };
  fundMoves: Array<{ nhom: 'VO' | 'CHONG'; chieu: 'NOP' | 'RUT'; total: number }>;
  transfers: TransferRow[];
  transfersTruncated: boolean;
  // Mọi khoản thu / chi trong kỳ, cũ → mới
  rows: TxRow[];
  rowsTruncated: boolean;
}

// "/baocao 10" → tháng 10 năm nay; null = tháng hiện tại
export function reportPeriod(today: string, month: { y: number; m: number } | null): { period: Period; asOf: string; partial: boolean } {
  const [ty, tm] = today.split('-').map(Number) as [number, number];
  const p = monthPeriod(month?.y ?? ty, month?.m ?? tm);
  const partial = p.to > today && p.from <= today;
  return { period: p, asOf: partial ? today : p.to, partial };
}

export class ReportService {
  private readonly db: DatabaseAdapter;
  private readonly balances: BalanceService;
  private readonly savings: SavingsService;
  private readonly now: () => Date;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.balances = new BalanceService(db, options);
    this.savings = new SavingsService(db, options);
    this.now = resolveClock(options);
  }

  async build(period: Period, asOf: string, partial: boolean): Promise<ReportData> {
    // Tháng đang chạy: chỉ tính tới hôm nay, so với cùng đoạn ngày tháng trước
    const shown: Period = partial ? { ...period, to: asOf } : period;
    const prev = previousPeriod(shown);
    const f = (p: Period, loai: readonly string[], extra: Partial<TxQueryFilter> = {}): TxQueryFilter => ({ from: p.from, to: p.to, loai, ...extra });
    const [sums, prevSums, chiDm, thuDm, chiNguoi, chiDt, quy, prevDm, rows, balances, pending, savings, flows, gold, fundMoves, transfers] =
      await Promise.all([
        sumIncomeExpense(this.db, f(shown, ALL_ROWS)),
        sumIncomeExpense(this.db, f(prev, ALL_ROWS)),
        sumByCategory(this.db, f(shown, EXPENSE)),
        sumByCategory(this.db, f(shown, INCOME)),
        sumByPerformer(this.db, f(shown, EXPENSE)),
        sumByBeneficiary(this.db, f(shown, EXPENSE)),
        sumIncomeExpense(this.db, f(shown, EXPENSE, { holder: 'QUY_CHUNG' })),
        sumByCategory(this.db, f(prev, EXPENSE)),
        listTransactions(this.db, f(shown, ALL_ROWS), 'date', REPORT_ROW_LIMIT + 1),
        this.balances.getHolderBalances(asOf),
        partial ? sumPendingTransfers(this.db, null) : Promise.resolve({ total: 0, count: 0 }),
        this.savings.summary(asOf),
        sumSavingsFlows(this.db, shown.from, shown.to),
        sumSavingsFlows(this.db, shown.from, shown.to, null, 'VANG'),
        sumFundMovesByGroup(this.db, shown.from, shown.to),
        listTransfersFiltered(this.db, { from: shown.from, to: shown.to, statuses: ['DA_XAC_NHAN'] }, TRANSFER_LIMIT + 1),
      ]);
    const truncated = rows.length > REPORT_ROW_LIMIT;
    return {
      title: `Tháng ${Number(period.from.slice(5, 7))}/${period.from.slice(0, 4)}`,
      period: shown,
      asOf,
      partial,
      generatedAt: this.now().toISOString(),
      thu: sums.thu,
      chi: sums.chi,
      soKhoan: sums.count,
      compare: { period: prev, thu: prevSums.thu, chi: prevSums.chi, chiTheoDanhMuc: prevDm },
      chiTheoDanhMuc: chiDm,
      thuTheoDanhMuc: thuDm,
      chiTheoNguoi: chiNguoi,
      chiTheoDoiTuong: chiDt,
      chiTuQuyChung: quy.chi,
      balances,
      pending,
      savings,
      savingsFlows: flows,
      goldFlows: gold,
      fundMoves,
      transfers: transfers.slice(0, TRANSFER_LIMIT).reverse(),
      transfersTruncated: transfers.length > TRANSFER_LIMIT,
      rows: rows.slice(0, REPORT_ROW_LIMIT).reverse(),
      rowsTruncated: truncated,
    };
  }
}
