import type { MoneyHolderId, TransactionType } from '../../config/constants.ts';
import { toSafeNumber, type DatabaseAdapter } from '../types.ts';

// Điều kiện chung: giao dịch đã hoàn tất, chưa xoá, ngày trong [$1, $2]
const TX_IN_RANGE = `g.trang_thai = 'HOAN_TAT' AND g.deleted_at IS NULL
  AND g.ngay_giao_dich >= $1 AND g.ngay_giao_dich <= $2`;

const TRANSFER_IN_RANGE = `c.trang_thai = 'DA_XAC_NHAN' AND c.deleted_at IS NULL
  AND c.ngay_chuyen >= $1 AND c.ngay_chuyen <= $2`;

// Cách 1 (theo nhóm): dấu tiền vào/ra nhóm giữ tiền, gom theo nguoi_giu_tien_id
export async function sumTransactionsByHolder(
  db: DatabaseAdapter,
  from: string,
  to: string,
): Promise<Map<MoneyHolderId, number>> {
  const rows = await db.query<{ holder: MoneyHolderId; total: unknown }>(
    `SELECT g.nguoi_giu_tien_id AS holder,
       COALESCE(SUM(CASE
         WHEN g.loai_giao_dich = 'THU' THEN g.so_tien
         WHEN g.loai_giao_dich IN ('CHI', 'LAI_VAY', 'PHI') THEN -g.so_tien
         WHEN g.loai_giao_dich = 'VAY' AND k.chieu_no = 'CHO_VAY' THEN -g.so_tien
         WHEN g.loai_giao_dich = 'VAY' THEN g.so_tien
         WHEN g.loai_giao_dich = 'TRA_NO' AND k.chieu_no = 'CHO_VAY' THEN g.so_tien
         WHEN g.loai_giao_dich = 'TRA_NO' THEN -g.so_tien
         WHEN g.loai_giao_dich = 'DIEU_CHINH' AND g.chieu_dieu_chinh = 'GIAM' THEN -g.so_tien
         WHEN g.loai_giao_dich = 'DIEU_CHINH' THEN g.so_tien
         ELSE 0 END), 0) AS total
     FROM giao_dich g LEFT JOIN khoan_no k ON k.id = g.khoan_no_id
     WHERE ${TX_IN_RANGE} AND g.nguoi_giu_tien_id IS NOT NULL
     GROUP BY g.nguoi_giu_tien_id`,
    [from, to],
  );
  return new Map(rows.map((r) => [r.holder, toSafeNumber(r.total)]));
}

// Chuyển nội bộ đã xác nhận, map người chuyển/nhận sang nhóm qua vai_tro; bên nào không map được thì bỏ cả 2 vế
export async function sumTransfersByRole(
  db: DatabaseAdapter,
  from: string,
  to: string,
): Promise<Array<{ tu: MoneyHolderId; den: MoneyHolderId; total: number }>> {
  const rows = await db.query<{ tu: MoneyHolderId; den: MoneyHolderId; total: unknown }>(
    `SELECT s.vai_tro AS tu, r.vai_tro AS den, COALESCE(SUM(c.so_tien), 0) AS total
     FROM chuyen_tien_noi_bo c
       JOIN thanh_vien s ON s.id = c.nguoi_chuyen_id
       JOIN thanh_vien r ON r.id = c.nguoi_nhan_id
     WHERE ${TRANSFER_IN_RANGE}
       AND s.vai_tro IN ('VO', 'CHONG') AND r.vai_tro IN ('VO', 'CHONG')
     GROUP BY s.vai_tro, r.vai_tro`,
    [from, to],
  );
  return rows.map((r) => ({ tu: r.tu, den: r.den, total: toSafeNumber(r.total) }));
}

// Nộp/rút quỹ chung đã ghi: NOP = nhóm thành viên → QUY_CHUNG, RUT = ngược lại (theo cột snapshot nhom_id)
export async function sumFundMovesByGroup(
  db: DatabaseAdapter,
  from: string,
  to: string,
): Promise<Array<{ nhom: 'VO' | 'CHONG'; chieu: 'NOP' | 'RUT'; total: number }>> {
  const rows = await db.query<{ nhom: 'VO' | 'CHONG'; chieu: 'NOP' | 'RUT'; total: unknown }>(
    `SELECT q.nhom_id AS nhom, q.chieu AS chieu, COALESCE(SUM(q.so_tien), 0) AS total
     FROM chuyen_quy_chung q
     WHERE q.trang_thai = 'HOAN_TAT' AND q.deleted_at IS NULL
       AND q.ngay_chuyen >= $1 AND q.ngay_chuyen <= $2
     GROUP BY q.nhom_id, q.chieu`,
    [from, to],
  );
  return rows.map((r) => ({ nhom: r.nhom, chieu: r.chieu, total: toSafeNumber(r.total) }));
}

export interface FamilyComponentRow {
  loai: TransactionType;
  chieuNo: 'DI_VAY' | 'CHO_VAY';
  chieuDieuChinh: 'TANG' | 'GIAM' | '';
  total: number;
}

// Cách 2 (độc lập, mục 4.1): tổng từng loại giao dịch không gom theo nhóm, kể cả holder NULL
export async function sumTransactionsByType(
  db: DatabaseAdapter,
  from: string,
  to: string,
): Promise<FamilyComponentRow[]> {
  const rows = await db.query<{ loai: TransactionType; chieu_no: string; chieu_dc: string; total: unknown }>(
    `SELECT g.loai_giao_dich AS loai,
       COALESCE(k.chieu_no, 'DI_VAY') AS chieu_no,
       COALESCE(g.chieu_dieu_chinh, '') AS chieu_dc,
       COALESCE(SUM(g.so_tien), 0) AS total
     FROM giao_dich g LEFT JOIN khoan_no k ON k.id = g.khoan_no_id
     WHERE ${TX_IN_RANGE}
     GROUP BY g.loai_giao_dich, COALESCE(k.chieu_no, 'DI_VAY'), COALESCE(g.chieu_dieu_chinh, '')`,
    [from, to],
  );
  return rows.map((r) => ({
    loai: r.loai,
    chieuNo: r.chieu_no === 'CHO_VAY' ? 'CHO_VAY' : 'DI_VAY',
    chieuDieuChinh: r.chieu_dc === 'TANG' || r.chieu_dc === 'GIAM' ? r.chieu_dc : '',
    total: toSafeNumber(r.total),
  }));
}

// Tổng kỳ: THU = THU; CHI = CHI + LAI_VAY + PHI
export async function sumPeriodIncomeExpense(
  db: DatabaseAdapter,
  from: string,
  to: string,
): Promise<{ tongThu: number; tongChi: number }> {
  const row = await db.queryOne<{ tong_thu: unknown; tong_chi: unknown }>(
    `SELECT
       COALESCE(SUM(CASE WHEN g.loai_giao_dich = 'THU' THEN g.so_tien ELSE 0 END), 0) AS tong_thu,
       COALESCE(SUM(CASE WHEN g.loai_giao_dich IN ('CHI', 'LAI_VAY', 'PHI') THEN g.so_tien ELSE 0 END), 0) AS tong_chi
     FROM giao_dich g
     WHERE ${TX_IN_RANGE}`,
    [from, to],
  );
  return { tongThu: toSafeNumber(row?.tong_thu), tongChi: toSafeNumber(row?.tong_chi) };
}

// ---- Bản ghi nghi vấn cho checkConsistency ----

export function listCompletedWithoutHolder(
  db: DatabaseAdapter,
  from: string,
  to: string,
): Promise<Array<{ id: string; loai_giao_dich: string; so_tien: number; ngay_giao_dich: string }>> {
  return db.query(
    `SELECT g.id, g.loai_giao_dich, g.so_tien, g.ngay_giao_dich FROM giao_dich g
     WHERE ${TX_IN_RANGE} AND g.nguoi_giu_tien_id IS NULL ORDER BY g.ngay_giao_dich, g.id`,
    [from, to],
  );
}

export function listUnmappedTransfers(
  db: DatabaseAdapter,
  from: string,
  to: string,
): Promise<Array<{ id: string; nguoi_chuyen_id: string; nguoi_nhan_id: string; so_tien: number }>> {
  return db.query(
    `SELECT c.id, c.nguoi_chuyen_id, c.nguoi_nhan_id, c.so_tien
     FROM chuyen_tien_noi_bo c
       LEFT JOIN thanh_vien s ON s.id = c.nguoi_chuyen_id
       LEFT JOIN thanh_vien r ON r.id = c.nguoi_nhan_id
     WHERE ${TRANSFER_IN_RANGE}
       AND (s.vai_tro IS NULL OR s.vai_tro NOT IN ('VO', 'CHONG')
         OR r.vai_tro IS NULL OR r.vai_tro NOT IN ('VO', 'CHONG'))
     ORDER BY c.ngay_chuyen, c.id`,
    [from, to],
  );
}

// Giao dịch nợ không có khoản nợ, hoặc số tiền lệch tổng lich_su_no đi kèm
export async function listDebtTransactionMismatches(
  db: DatabaseAdapter,
  from: string,
  to: string,
): Promise<Array<{ id: string; loai_giao_dich: string; so_tien: number; khoan_no_id: string | null; so_tien_lich_su: number }>> {
  const rows = await db.query<{
    id: string;
    loai_giao_dich: string;
    so_tien: unknown;
    khoan_no_id: string | null;
    so_tien_lich_su: unknown;
  }>(
    `SELECT g.id, g.loai_giao_dich, g.so_tien, g.khoan_no_id,
       COALESCE(SUM(l.so_tien), 0) AS so_tien_lich_su
     FROM giao_dich g
       LEFT JOIN lich_su_no l ON l.giao_dich_id = g.id AND l.deleted_at IS NULL
     WHERE ${TX_IN_RANGE}
       AND (g.loai_giao_dich IN ('VAY', 'TRA_NO') OR g.khoan_no_id IS NOT NULL)
     GROUP BY g.id, g.loai_giao_dich, g.so_tien, g.khoan_no_id
     HAVING g.khoan_no_id IS NULL OR COALESCE(SUM(l.so_tien), 0) <> g.so_tien
     ORDER BY g.id`,
    [from, to],
  );
  return rows.map((r) => ({
    id: r.id,
    loai_giao_dich: r.loai_giao_dich,
    so_tien: toSafeNumber(r.so_tien),
    khoan_no_id: r.khoan_no_id,
    so_tien_lich_su: toSafeNumber(r.so_tien_lich_su),
  }));
}

// Khoản nợ có du_no_hien_tai lệch sổ lich_su_no
export async function listLoanBalanceMismatches(
  db: DatabaseAdapter,
): Promise<Array<{ id: string; du_no_hien_tai: number; du_no_theo_lich_su: number }>> {
  const rows = await db.query<{ id: string; du_no_hien_tai: unknown; du_no_theo_lich_su: unknown }>(
    `SELECT k.id, k.du_no_hien_tai,
       COALESCE(SUM(CASE
         WHEN l.loai_bien_dong = 'GIAI_NGAN' THEN l.so_tien
         WHEN l.loai_bien_dong IN ('TRA_GOC', 'THU_GOC') THEN -l.so_tien
         ELSE 0 END), 0) AS du_no_theo_lich_su
     FROM khoan_no k
       LEFT JOIN lich_su_no l ON l.khoan_no_id = k.id AND l.deleted_at IS NULL
     WHERE k.deleted_at IS NULL
     GROUP BY k.id, k.du_no_hien_tai
     HAVING k.du_no_hien_tai <> COALESCE(SUM(CASE
         WHEN l.loai_bien_dong = 'GIAI_NGAN' THEN l.so_tien
         WHEN l.loai_bien_dong IN ('TRA_GOC', 'THU_GOC') THEN -l.so_tien
         ELSE 0 END), 0)
     ORDER BY k.id`,
  );
  return rows.map((r) => ({
    id: r.id,
    du_no_hien_tai: toSafeNumber(r.du_no_hien_tai),
    du_no_theo_lich_su: toSafeNumber(r.du_no_theo_lich_su),
  }));
}
