import { AUDIT_ACTION, TABLE_NAME, type MemberId } from '../config/constants.ts';
import type { Settings } from '../config/settings.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import {
  claimBudgetWarning,
  deactivateBudget,
  getActiveBudgetByCategory,
  insertBudget,
  listActiveBudgets,
  resetBudgetWarnings,
  sumCategorySpend,
  sumSpendByCategory,
  updateBudgetAmount,
  type BudgetRow,
} from '../db/repositories/budget-repository.ts';
import { listActiveCategoriesFor } from '../db/repositories/index.ts';
import type { DanhMucRecord, DatabaseAdapter, GiaoDichRecord } from '../db/types.ts';
import { findCategoryByKeyword } from '../parser/category-matcher.ts';
import { normalizeWhitespace, removeVietnameseDiacritics } from '../parser/normalizer.ts';
import { newId, resolveClock, toVnDate, type ServiceOptions } from './common.ts';

// Phase 8c: ngân sách tháng theo danh mục chi (cả gia đình). Chỉ tính CHI theo danh mục (LAI_VAY / PHI không có danh mục).

export interface BudgetLine {
  budget: BudgetRow;
  spent: number;
}

export interface BudgetWarning {
  ten: string;
  ky: string;
  spent: number;
  limit: number;
  // Mốc vừa vượt (phần trăm cấu hình hoặc 100)
  muc: number;
}

export type BudgetSetResult =
  | { kind: 'SET' | 'UPDATED' | 'REMOVED'; category: DanhMucRecord; soTien: number }
  | { kind: 'NO_BUDGET'; category: DanhMucRecord }
  | { kind: 'UNKNOWN_CATEGORY'; choices: string[] };

function key(text: string): string {
  return normalizeWhitespace(removeVietnameseDiacritics(text.normalize('NFC').toLowerCase()));
}

function monthRange(ky: string): { from: string; to: string } {
  const [y, m] = ky.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ky}-01`, to: `${ky}-${String(last).padStart(2, '0')}` };
}

export class BudgetService {
  private readonly db: DatabaseAdapter;
  private readonly now: () => Date;

  constructor(db: DatabaseAdapter, options?: ServiceOptions) {
    this.db = db;
    this.now = resolveClock(options);
  }

  // Tên gõ → danh mục chi: trùng tên danh mục (bỏ dấu) trước, rồi từ khoá ("tiền ăn" → Thức ăn)
  async resolveCategory(name: string): Promise<{ category: DanhMucRecord | null; choices: string[] }> {
    const categories = await listActiveCategoriesFor(this.db, 'CHI');
    const k = key(name);
    const byName = categories.find((c) => key(c.ten_danh_muc) === k);
    const match = byName ? null : findCategoryByKeyword(k);
    const category = byName ?? (match ? (categories.find((c) => c.ma_danh_muc === match.code) ?? null) : null);
    return { category, choices: categories.map((c) => c.ten_danh_muc) };
  }

  // Đặt / sửa (gõ lại) / bỏ (số 0) hạn mức tháng của 1 danh mục
  async set(member: MemberId, name: string, soTien: number): Promise<BudgetSetResult> {
    const { category, choices } = await this.resolveCategory(name);
    if (!category) {
      return { kind: 'UNKNOWN_CATEGORY', choices };
    }
    const nowIso = this.now().toISOString();
    return this.db.transaction(async (tx): Promise<BudgetSetResult> => {
      const before = await getActiveBudgetByCategory(tx, category.id);
      let kind: 'SET' | 'UPDATED' | 'REMOVED';
      let id: string;
      if (soTien === 0) {
        if (!before) {
          return { kind: 'NO_BUDGET', category };
        }
        await deactivateBudget(tx, before.id, nowIso);
        kind = 'REMOVED';
        id = before.id;
      } else if (before) {
        await updateBudgetAmount(tx, before.id, soTien, nowIso);
        await resetBudgetWarnings(tx, before.id, this.month());
        kind = 'UPDATED';
        id = before.id;
      } else {
        id = newId('NS');
        await insertBudget(tx, { id, danhMucId: category.id, soTien, nguoiTaoId: member, nowIso });
        kind = 'SET';
      }
      await insertAuditLog(tx, {
        ten_bang: TABLE_NAME.NGAN_SACH,
        ban_ghi_id: id,
        hanh_dong: kind === 'SET' ? AUDIT_ACTION.CREATE : kind === 'REMOVED' ? AUDIT_ACTION.CANCEL : AUDIT_ACTION.UPDATE,
        du_lieu_truoc: before,
        du_lieu_sau: kind === 'REMOVED' ? null : await getActiveBudgetByCategory(tx, category.id),
        nguoi_thuc_hien_id: member,
        ly_do: '/ngansach',
        nowIso,
      });
      return { kind, category, soTien };
    });
  }

  // Bảng ngân sách của tháng ky
  async overview(ky: string, db: DatabaseAdapter = this.db): Promise<BudgetLine[]> {
    const { from, to } = monthRange(ky);
    const [budgets, spent] = await Promise.all([listActiveBudgets(db), sumSpendByCategory(db, from, to)]);
    return budgets.map((budget) => ({ budget, spent: spent.get(budget.danh_muc_id) ?? 0 }));
  }

  // Đã chi tháng này của 1 danh mục
  spentThisMonth(danhMucId: string): Promise<number> {
    const { from, to } = monthRange(this.month());
    return sumCategorySpend(this.db, danhMucId, from, to);
  }

  // Tháng hiện tại theo giờ VN
  private month(): string {
    return toVnDate(this.now()).slice(0, 7);
  }

  // Sau khi ghi / sửa / đổi danh mục một khoản chi (đã commit): vượt mốc lần đầu trong tháng → cảnh báo.
  // Tháng theo ngày của khoản chi. Lỗi (vd chưa chạy migration 0009) → bỏ cảnh báo, không làm hỏng lệnh ghi.
  async checkAfterSpend(tx: GiaoDichRecord, loadSettings: () => Promise<Settings>): Promise<BudgetWarning | null> {
    if (tx.loai_giao_dich !== 'CHI' || tx.trang_thai !== 'HOAN_TAT' || !tx.danh_muc_id) {
      return null;
    }
    try {
      const budget = await getActiveBudgetByCategory(this.db, tx.danh_muc_id);
      if (!budget) {
        return null;
      }
      const settings = await loadSettings();
      const ky = tx.ngay_giao_dich.slice(0, 7);
      const { from, to } = monthRange(ky);
      const spent = await sumCategorySpend(this.db, budget.danh_muc_id, from, to);
      const pct = (spent * 100) / budget.so_tien_thang;
      const nowIso = this.now().toISOString();
      let crossed: number | null = null;
      // Giữ mọi mốc đã vượt (từ thấp tới cao); báo mốc cao nhất vừa giữ được
      for (const muc of [settings['ngan_sach.canh_bao_phan_tram'], 100]) {
        if (pct >= muc && (await claimBudgetWarning(this.db, { id: newId('NSC'), nganSachId: budget.id, ky, muc, nowIso }))) {
          crossed = muc;
        }
      }
      return crossed === null ? null : { ten: budget.ten_danh_muc, ky, spent, limit: budget.so_tien_thang, muc: crossed };
    } catch (error) {
      console.error('Ngân sách: kiểm cảnh báo lỗi, bỏ cảnh báo', error instanceof Error ? error.message : error);
      return null;
    }
  }
}
