import { toSafeNumber, type DatabaseAdapter, type SqlParam } from '../types.ts';
import { TX_IN_RANGE } from './balance-queries.ts';

// Bộ lọc câu hỏi thống kê (Phase 5b). Chỉ nối tên cột cố định; giá trị luôn qua tham số.
export interface TxQueryFilter {
  from: string;
  to: string;
  // Loại giao dịch tính vào (vd Chi = CHI, PHI, LAI_VAY)
  loai: readonly string[];
  performer?: string | null;
  beneficiaries?: readonly string[] | null;
  categoryCodes?: readonly string[] | null;
  holder?: string | null;
}

export interface GroupTotal {
  key: string | null;
  label: string | null;
  loai: string;
  total: number;
  count: number;
}

function buildWhere(f: TxQueryFilter): { where: string; params: SqlParam[] } {
  const params: SqlParam[] = [f.from, f.to];
  const list = (values: readonly SqlParam[]): string =>
    values
      .map((v) => {
        params.push(v);
        return `$${params.length}`;
      })
      .join(', ');
  const conds = [TX_IN_RANGE, `g.loai_giao_dich IN (${list(f.loai)})`];
  if (f.performer) {
    conds.push(`g.nguoi_thuc_hien_id = ${list([f.performer])}`);
  }
  if (f.beneficiaries && f.beneficiaries.length > 0) {
    conds.push(`g.doi_tuong_thu_huong_id IN (${list(f.beneficiaries)})`);
  }
  if (f.categoryCodes && f.categoryCodes.length > 0) {
    conds.push(`g.danh_muc_id IN (SELECT d2.id FROM danh_muc d2 WHERE d2.ma_danh_muc IN (${list(f.categoryCodes)}))`);
  }
  if (f.holder) {
    conds.push(`g.nguoi_giu_tien_id = ${list([f.holder])}`);
  }
  return { where: conds.join(' AND '), params };
}

export async function sumTransactions(db: DatabaseAdapter, f: TxQueryFilter): Promise<{ total: number; count: number }> {
  const { where, params } = buildWhere(f);
  const row = await db.queryOne<{ total: unknown; so_khoan: unknown }>(
    `SELECT COALESCE(SUM(g.so_tien), 0) AS total, COUNT(*) AS so_khoan FROM giao_dich g WHERE ${where}`,
    params,
  );
  return { total: toSafeNumber(row?.total), count: toSafeNumber(row?.so_khoan) };
}

// Theo danh mục (khoản không danh mục — PHI, LAI_VAY — gom theo loại). Sắp xếp: tổng giảm dần, rồi mã.
export async function sumByCategory(db: DatabaseAdapter, f: TxQueryFilter): Promise<GroupTotal[]> {
  const { where, params } = buildWhere(f);
  const rows = await db.query<{ ma: string | null; ten: string | null; loai: string; total: unknown; so_khoan: unknown }>(
    `SELECT d.ma_danh_muc AS ma, d.ten_danh_muc AS ten, g.loai_giao_dich AS loai,
       COALESCE(SUM(g.so_tien), 0) AS total, COUNT(*) AS so_khoan
     FROM giao_dich g LEFT JOIN danh_muc d ON d.id = g.danh_muc_id
     WHERE ${where}
     GROUP BY d.ma_danh_muc, d.ten_danh_muc, g.loai_giao_dich`,
    params,
  );
  return sortGroups(rows.map((r) => ({ key: r.ma, label: r.ten, loai: r.loai, total: toSafeNumber(r.total), count: toSafeNumber(r.so_khoan) })));
}

// Theo đối tượng thụ hưởng (NULL = không ghi đối tượng)
export async function sumByBeneficiary(db: DatabaseAdapter, f: TxQueryFilter): Promise<GroupTotal[]> {
  const { where, params } = buildWhere(f);
  const rows = await db.query<{ id: string | null; ten: string | null; total: unknown; so_khoan: unknown }>(
    `SELECT g.doi_tuong_thu_huong_id AS id, t.ten_doi_tuong AS ten,
       COALESCE(SUM(g.so_tien), 0) AS total, COUNT(*) AS so_khoan
     FROM giao_dich g LEFT JOIN doi_tuong_thu_huong t ON t.id = g.doi_tuong_thu_huong_id
     WHERE ${where}
     GROUP BY g.doi_tuong_thu_huong_id, t.ten_doi_tuong`,
    params,
  );
  return sortGroups(rows.map((r) => ({ key: r.id, label: r.ten, loai: '', total: toSafeNumber(r.total), count: toSafeNumber(r.so_khoan) })));
}

// Thu và Chi trong 1 truy vấn (f.loai nên gồm cả THU và CHI/PHI/LAI_VAY)
export async function sumIncomeExpense(db: DatabaseAdapter, f: TxQueryFilter): Promise<{ thu: number; chi: number; count: number }> {
  const { where, params } = buildWhere(f);
  const row = await db.queryOne<{ thu: unknown; chi: unknown; so_khoan: unknown }>(
    `SELECT
       COALESCE(SUM(CASE WHEN g.loai_giao_dich = 'THU' THEN g.so_tien ELSE 0 END), 0) AS thu,
       COALESCE(SUM(CASE WHEN g.loai_giao_dich IN ('CHI', 'PHI', 'LAI_VAY') THEN g.so_tien ELSE 0 END), 0) AS chi,
       COUNT(*) AS so_khoan
     FROM giao_dich g WHERE ${where}`,
    params,
  );
  return { thu: toSafeNumber(row?.thu), chi: toSafeNumber(row?.chi), count: toSafeNumber(row?.so_khoan) };
}

export interface TxRow {
  id: string;
  ngay: string;
  loai: string;
  so_tien: number;
  danh_muc: string | null;
  ma_danh_muc: string | null;
  nguoi_thuc_hien_id: string;
  mo_ta: string | null;
}

// Từng giao dịch: 'amount' = lớn nhất trước; 'date' = mới nhất trước
export async function listTransactions(
  db: DatabaseAdapter,
  f: TxQueryFilter,
  order: 'amount' | 'date',
  limit: number,
): Promise<TxRow[]> {
  const { where, params } = buildWhere(f);
  params.push(limit);
  const orderBy = order === 'amount' ? 'g.so_tien DESC, g.ngay_giao_dich DESC, g.id' : 'g.ngay_giao_dich DESC, g.created_at DESC, g.id DESC';
  const rows = await db.query<Omit<TxRow, 'so_tien'> & { so_tien: unknown }>(
    `SELECT g.id, g.ngay_giao_dich AS ngay, g.loai_giao_dich AS loai, g.so_tien, d.ten_danh_muc AS danh_muc,
       d.ma_danh_muc, g.nguoi_thuc_hien_id, g.mo_ta
     FROM giao_dich g LEFT JOIN danh_muc d ON d.id = g.danh_muc_id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({ ...r, so_tien: toSafeNumber(r.so_tien) }));
}

// Theo người thực hiện
export async function sumByPerformer(db: DatabaseAdapter, f: TxQueryFilter): Promise<GroupTotal[]> {
  const { where, params } = buildWhere(f);
  const rows = await db.query<{ id: string; total: unknown; so_khoan: unknown }>(
    `SELECT g.nguoi_thuc_hien_id AS id, COALESCE(SUM(g.so_tien), 0) AS total, COUNT(*) AS so_khoan
     FROM giao_dich g WHERE ${where} GROUP BY g.nguoi_thuc_hien_id`,
    params,
  );
  return sortGroups(rows.map((r) => ({ key: r.id, label: null, loai: '', total: toSafeNumber(r.total), count: toSafeNumber(r.so_khoan) })));
}

export interface TransferFilter {
  from: string;
  to: string;
  statuses: readonly string[];
  sender?: string | null;
  receiver?: string | null;
}

export interface TransferRow {
  id: string;
  ngay_chuyen: string;
  nguoi_chuyen_id: string;
  nguoi_nhan_id: string;
  so_tien: number;
  trang_thai: string;
}

function transferWhere(f: TransferFilter): { where: string; params: SqlParam[] } {
  const params: SqlParam[] = [f.from, f.to];
  const add = (v: SqlParam): string => {
    params.push(v);
    return `$${params.length}`;
  };
  const conds = [
    'c.deleted_at IS NULL',
    'c.ngay_chuyen >= $1',
    'c.ngay_chuyen <= $2',
    `c.trang_thai IN (${f.statuses.map(add).join(', ')})`,
  ];
  if (f.sender) conds.push(`c.nguoi_chuyen_id = ${add(f.sender)}`);
  if (f.receiver) conds.push(`c.nguoi_nhan_id = ${add(f.receiver)}`);
  return { where: conds.join(' AND '), params };
}

// Chuyển nội bộ theo kỳ (ngay_chuyen) + trạng thái + chiều
export async function sumTransfersFiltered(db: DatabaseAdapter, f: TransferFilter): Promise<{ total: number; count: number }> {
  const { where, params } = transferWhere(f);
  const row = await db.queryOne<{ total: unknown; so_khoan: unknown }>(
    `SELECT COALESCE(SUM(c.so_tien), 0) AS total, COUNT(*) AS so_khoan FROM chuyen_tien_noi_bo c WHERE ${where}`,
    params,
  );
  return { total: toSafeNumber(row?.total), count: toSafeNumber(row?.so_khoan) };
}

export async function listTransfersFiltered(db: DatabaseAdapter, f: TransferFilter, limit: number): Promise<TransferRow[]> {
  const { where, params } = transferWhere(f);
  params.push(limit);
  const rows = await db.query<Omit<TransferRow, 'so_tien'> & { so_tien: unknown }>(
    `SELECT c.id, c.ngay_chuyen, c.nguoi_chuyen_id, c.nguoi_nhan_id, c.so_tien, c.trang_thai
     FROM chuyen_tien_noi_bo c WHERE ${where}
     ORDER BY c.ngay_chuyen DESC, c.created_at DESC, c.id DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({ ...r, so_tien: toSafeNumber(r.so_tien) }));
}

// Chuyển nội bộ đang chờ xác nhận (chưa tính vào số dư); memberId → chỉ khoản người đó chuyển hoặc nhận
export async function sumPendingTransfers(db: DatabaseAdapter, memberId: string | null): Promise<{ total: number; count: number }> {
  const byMember = memberId ? ' AND (nguoi_chuyen_id = $1 OR nguoi_nhan_id = $1)' : '';
  const row = await db.queryOne<{ total: unknown; so_khoan: unknown }>(
    `SELECT COALESCE(SUM(so_tien), 0) AS total, COUNT(*) AS so_khoan FROM chuyen_tien_noi_bo
     WHERE trang_thai = 'CHO_XAC_NHAN' AND deleted_at IS NULL${byMember}`,
    memberId ? [memberId] : [],
  );
  return { total: toSafeNumber(row?.total), count: toSafeNumber(row?.so_khoan) };
}

function sortGroups(rows: GroupTotal[]): GroupTotal[] {
  return rows.sort((a, b) => b.total - a.total || `${a.key ?? ''}${a.loai}`.localeCompare(`${b.key ?? ''}${b.loai}`));
}
