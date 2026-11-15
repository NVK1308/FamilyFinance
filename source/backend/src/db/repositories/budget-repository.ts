import { toSafeNumber, type DatabaseAdapter } from '../types.ts';

// ---------- Ngân sách theo danh mục (ngan_sach, ngan_sach_canh_bao — migration 0009) ----------

export interface BudgetRow {
  id: string;
  danh_muc_id: string;
  so_tien_thang: number;
  ten_danh_muc: string;
  ma_danh_muc: string;
  version: number;
}

const BUDGET_SELECT = `SELECT n.id, n.danh_muc_id, n.so_tien_thang, n.version, d.ten_danh_muc, d.ma_danh_muc
  FROM ngan_sach n JOIN danh_muc d ON d.id = n.danh_muc_id
  WHERE n.is_active = TRUE AND n.deleted_at IS NULL`;

function normalize(r: BudgetRow): BudgetRow {
  return { ...r, so_tien_thang: toSafeNumber(r.so_tien_thang), version: toSafeNumber(r.version) };
}

export async function listActiveBudgets(db: DatabaseAdapter): Promise<BudgetRow[]> {
  return (await db.query<BudgetRow>(`${BUDGET_SELECT} ORDER BY d.version, d.id`)).map(normalize);
}

export async function getActiveBudgetByCategory(db: DatabaseAdapter, danhMucId: string): Promise<BudgetRow | null> {
  const row = await db.queryOne<BudgetRow>(`${BUDGET_SELECT} AND n.danh_muc_id = $1`, [danhMucId]);
  return row ? normalize(row) : null;
}

export async function insertBudget(db: DatabaseAdapter, i: { id: string; danhMucId: string; soTien: number; nguoiTaoId: string; nowIso: string }): Promise<void> {
  const version = await db.nextVersion();
  await db.execute(
    `INSERT INTO ngan_sach (id, danh_muc_id, so_tien_thang, nguoi_tao_id, is_active, created_at, updated_at, version)
     VALUES ($1, $2, $3, $4, TRUE, $5, $5, $6)`,
    [i.id, i.danhMucId, i.soTien, i.nguoiTaoId, i.nowIso, version],
  );
}

export async function updateBudgetAmount(db: DatabaseAdapter, id: string, soTien: number, nowIso: string): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    'UPDATE ngan_sach SET so_tien_thang = $2, updated_at = $3, version = $4 WHERE id = $1 AND is_active = TRUE AND deleted_at IS NULL',
    [id, soTien, nowIso, version],
  );
  return res.changes;
}

// Bỏ ngân sách = is_active FALSE (giữ dòng)
export async function deactivateBudget(db: DatabaseAdapter, id: string, nowIso: string): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute('UPDATE ngan_sach SET is_active = FALSE, updated_at = $2, version = $3 WHERE id = $1 AND is_active = TRUE', [
    id,
    nowIso,
    version,
  ]);
  return res.changes;
}

// Đã chi của 1 danh mục trong khoảng ngày (CHI hoàn tất, cả nhà, cả chi từ hũ / quỹ chung)
export async function sumCategorySpend(db: DatabaseAdapter, danhMucId: string, from: string, to: string): Promise<number> {
  const row = await db.queryOne<{ total: unknown }>(
    `SELECT COALESCE(SUM(so_tien), 0) AS total FROM giao_dich
     WHERE danh_muc_id = $1 AND loai_giao_dich = 'CHI' AND trang_thai = 'HOAN_TAT' AND deleted_at IS NULL
       AND ngay_giao_dich BETWEEN $2 AND $3`,
    [danhMucId, from, to],
  );
  return toSafeNumber(row?.total);
}

// Giữ mốc cảnh báo (mỗi mốc 1 lần / ngân sách / tháng). true = lần đầu → cần báo
export async function claimBudgetWarning(db: DatabaseAdapter, i: { id: string; nganSachId: string; ky: string; muc: number; nowIso: string }): Promise<boolean> {
  const row = await db.queryOne<{ id: string }>(
    `INSERT INTO ngan_sach_canh_bao (id, ngan_sach_id, ky, muc, created_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (ngan_sach_id, ky, muc) DO NOTHING RETURNING id`,
    [i.id, i.nganSachId, i.ky, i.muc, i.nowIso],
  );
  return row !== null;
}

// Đã chi theo danh mục trong khoảng ngày (1 truy vấn cho bảng ngân sách)
export async function sumSpendByCategory(db: DatabaseAdapter, from: string, to: string): Promise<Map<string, number>> {
  const rows = await db.query<{ danh_muc_id: string; total: unknown }>(
    `SELECT danh_muc_id, COALESCE(SUM(so_tien), 0) AS total FROM giao_dich
     WHERE danh_muc_id IS NOT NULL AND loai_giao_dich = 'CHI' AND trang_thai = 'HOAN_TAT' AND deleted_at IS NULL
       AND ngay_giao_dich BETWEEN $1 AND $2
     GROUP BY danh_muc_id`,
    [from, to],
  );
  return new Map(rows.map((r) => [r.danh_muc_id, toSafeNumber(r.total)]));
}

// Đổi hạn mức → bỏ các mốc đã báo của tháng (dấu vận hành) để báo lại theo hạn mức mới
export async function resetBudgetWarnings(db: DatabaseAdapter, nganSachId: string, ky: string): Promise<void> {
  await db.execute('DELETE FROM ngan_sach_canh_bao WHERE ngan_sach_id = $1 AND ky = $2', [nganSachId, ky]);
}
