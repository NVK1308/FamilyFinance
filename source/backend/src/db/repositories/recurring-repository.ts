import type { MoneyHolderId } from '../../config/constants.ts';
import type { DatabaseAdapter } from '../types.ts';

// ---------- Khoản định kỳ (migration 0008) ----------

export type RecurringType = 'THU' | 'CHI';
export type DueStatus = 'CHO' | 'DA_GHI' | 'BO_QUA' | 'QUA_HAN' | 'DA_DUNG';
export type ReminderStatus = 'DANG_GUI' | 'DA_GUI' | 'LOI';

export interface KhoanDinhKyRecord {
  id: string;
  ten: string;
  ten_chuan: string;
  loai_giao_dich: RecurringType;
  so_tien: number;
  danh_muc_id: string;
  nguoi_giu_tien_id: MoneyHolderId;
  ngay_trong_thang: number | null;
  bat_dau_ky: string;
  nguoi_tao_id: string;
  is_active: boolean | number;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

export interface KhoanDinhKyLanRecord {
  id: string;
  khoan_dinh_ky_id: string;
  ky: string;
  ngay_den_han: string;
  han_dong: string;
  loai_giao_dich: RecurringType;
  so_tien: number;
  danh_muc_id: string;
  nguoi_giu_tien_id: MoneyHolderId;
  trang_thai: DueStatus;
  giao_dich_id: string | null;
  so_lan_ghi: number;
  nguoi_xu_ly_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

// Lần đến hạn + tên khoản, khoản còn chạy, mã danh mục, số đã ghi thật (đọc 1 câu, không hỏi lại từng dòng)
export type DueRow = KhoanDinhKyLanRecord & { ten: string; khoan_active: boolean; ma_danh_muc: string | null; so_tien_da_ghi: number | null };

const DUE_SELECT = `SELECT l.*, k.ten, k.is_active AS khoan_active, d.ma_danh_muc, g.so_tien AS so_tien_da_ghi
  FROM khoan_dinh_ky_lan l
  JOIN khoan_dinh_ky k ON k.id = l.khoan_dinh_ky_id
  LEFT JOIN danh_muc d ON d.id = l.danh_muc_id
  LEFT JOIN giao_dich g ON g.id = l.giao_dich_id`;

export interface NhacDinhKyRecord {
  id: string;
  ky: string;
  thanh_vien_id: string;
  lan_nhac: number;
  trang_thai: ReminderStatus;
  ngay_thu: string;
  so_lan_thu: number;
  telegram_message_id: number | null;
  gui_luc: string | null;
  loi: string | null;
}

const ACTIVE_ITEM = 'is_active = TRUE AND deleted_at IS NULL';

// DATE của Postgres có thể về dạng Date / chuỗi dài → luôn 'YYYY-MM-DD'
function day(value: unknown): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function normalizeDue(r: DueRow): DueRow {
  return {
    ...r,
    ngay_den_han: day(r.ngay_den_han),
    han_dong: day(r.han_dong),
    so_tien: Number(r.so_tien),
    so_lan_ghi: Number(r.so_lan_ghi),
    khoan_active: Boolean(Number(r.khoan_active)) || r.khoan_active === true,
    so_tien_da_ghi: r.so_tien_da_ghi === null || r.so_tien_da_ghi === undefined ? null : Number(r.so_tien_da_ghi),
  };
}

function normalizeItem(r: KhoanDinhKyRecord): KhoanDinhKyRecord {
  return { ...r, so_tien: Number(r.so_tien) };
}

// ----- Khoản -----

export async function listActiveItems(db: DatabaseAdapter): Promise<KhoanDinhKyRecord[]> {
  const rows = await db.query<KhoanDinhKyRecord>(`SELECT * FROM khoan_dinh_ky WHERE ${ACTIVE_ITEM} ORDER BY created_at, id`);
  return rows.map(normalizeItem);
}

export async function getItemById(db: DatabaseAdapter, id: string): Promise<KhoanDinhKyRecord | null> {
  const row = await db.queryOne<KhoanDinhKyRecord>('SELECT * FROM khoan_dinh_ky WHERE id = $1', [id]);
  return row ? normalizeItem(row) : null;
}

export async function getActiveItemByName(db: DatabaseAdapter, tenChuan: string): Promise<KhoanDinhKyRecord | null> {
  const row = await db.queryOne<KhoanDinhKyRecord>(`SELECT * FROM khoan_dinh_ky WHERE ten_chuan = $1 AND ${ACTIVE_ITEM}`, [tenChuan]);
  return row ? normalizeItem(row) : null;
}

export interface ItemFields {
  ten: string;
  tenChuan: string;
  loai: RecurringType;
  soTien: number;
  danhMucId: string;
  nguoiGiuTienId: MoneyHolderId;
}

export async function insertItem(
  db: DatabaseAdapter,
  i: ItemFields & { id: string; batDauKy: string; nguoiTaoId: string; nowIso: string },
): Promise<void> {
  const version = await db.nextVersion();
  await db.execute(
    `INSERT INTO khoan_dinh_ky (id, ten, ten_chuan, loai_giao_dich, so_tien, danh_muc_id, nguoi_giu_tien_id, bat_dau_ky,
       nguoi_tao_id, is_active, created_at, updated_at, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE, $10, $10, $11)`,
    [i.id, i.ten, i.tenChuan, i.loai, i.soTien, i.danhMucId, i.nguoiGiuTienId, i.batDauKy, i.nguoiTaoId, i.nowIso, version],
  );
}

export async function updateItem(db: DatabaseAdapter, id: string, i: ItemFields, nowIso: string): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE khoan_dinh_ky SET ten = $2, ten_chuan = $3, loai_giao_dich = $4, so_tien = $5, danh_muc_id = $6, nguoi_giu_tien_id = $7,
       updated_at = $8, version = $9
     WHERE id = $1 AND ${ACTIVE_ITEM}`,
    [id, i.ten, i.tenChuan, i.loai, i.soTien, i.danhMucId, i.nguoiGiuTienId, nowIso, version],
  );
  return res.changes;
}

// Dừng khoản: chỉ đổi is_active (deleted_at dành cho xoá thật / dọn dữ liệu)
export async function stopItem(db: DatabaseAdapter, id: string, nowIso: string): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(`UPDATE khoan_dinh_ky SET is_active = FALSE, updated_at = $2, version = $3 WHERE id = $1 AND ${ACTIVE_ITEM}`, [
    id,
    nowIso,
    version,
  ]);
  return res.changes;
}

// Khoản đang chạy được nhắc ở kỳ này (bắt đầu từ kỳ ≤ ky)
export async function listItemsForMonth(db: DatabaseAdapter, ky: string): Promise<KhoanDinhKyRecord[]> {
  const rows = await db.query<KhoanDinhKyRecord>(`SELECT * FROM khoan_dinh_ky WHERE ${ACTIVE_ITEM} AND bat_dau_ky <= $1 ORDER BY created_at, id`, [ky]);
  return rows.map(normalizeItem);
}

// ----- Lần đến hạn -----

export async function insertDueIfMissing(
  db: DatabaseAdapter,
  i: { id: string; item: KhoanDinhKyRecord; ky: string; ngayDenHan: string; hanDong: string; nowIso: string },
): Promise<boolean> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `INSERT INTO khoan_dinh_ky_lan (id, khoan_dinh_ky_id, ky, ngay_den_han, han_dong, loai_giao_dich, so_tien, danh_muc_id,
       nguoi_giu_tien_id, trang_thai, so_lan_ghi, created_at, updated_at, version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CHO', 0, $10, $10, $11)
     ON CONFLICT (khoan_dinh_ky_id, ky) DO NOTHING`,
    [i.id, i.item.id, i.ky, i.ngayDenHan, i.hanDong, i.item.loai_giao_dich, i.item.so_tien, i.item.danh_muc_id, i.item.nguoi_giu_tien_id, i.nowIso, version],
  );
  return res.changes > 0;
}

export async function getDue(db: DatabaseAdapter, id: string): Promise<DueRow | null> {
  const row = await db.queryOne<DueRow>(`${DUE_SELECT} WHERE l.id = $1 AND l.deleted_at IS NULL`, [id]);
  return row ? normalizeDue(row) : null;
}

// Lần của 1 kỳ; memberId → chỉ khoản người đó trả / nhận + quỹ chung
export async function listDues(db: DatabaseAdapter, ky: string, memberId?: string): Promise<DueRow[]> {
  const params: string[] = [ky];
  let who = '';
  if (memberId) {
    params.push(memberId);
    who = `AND l.nguoi_giu_tien_id IN ($2, 'QUY_CHUNG')`;
  }
  const rows = await db.query<DueRow>(`${DUE_SELECT} WHERE l.ky = $1 AND l.deleted_at IS NULL ${who} ORDER BY k.created_at, k.id`, params);
  return rows.map(normalizeDue);
}

// Đổi trạng thái lần đang CHO (khoá dòng: 2 người bấm cùng lúc xếp hàng). 0 = đã có người xử lý.
export async function closeDue(db: DatabaseAdapter, id: string, to: Exclude<DueStatus, 'CHO'>, nguoiXuLyId: string, nowIso: string): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE khoan_dinh_ky_lan SET trang_thai = $2, nguoi_xu_ly_id = $3, updated_at = $4, version = $5
     WHERE id = $1 AND trang_thai = 'CHO' AND deleted_at IS NULL`,
    [id, to, nguoiXuLyId, nowIso, version],
  );
  return res.changes;
}

export async function setDueTransaction(db: DatabaseAdapter, id: string, giaoDichId: string, nowIso: string): Promise<void> {
  const version = await db.nextVersion();
  await db.execute('UPDATE khoan_dinh_ky_lan SET giao_dich_id = $2, updated_at = $3, version = $4 WHERE id = $1', [id, giaoDichId, nowIso, version]);
}

// Dừng khoản → các lần còn chờ đóng luôn
export async function stopPendingDues(db: DatabaseAdapter, itemId: string, nguoiXuLyId: string, nowIso: string): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE khoan_dinh_ky_lan SET trang_thai = 'DA_DUNG', nguoi_xu_ly_id = $2, updated_at = $3, version = $4
     WHERE khoan_dinh_ky_id = $1 AND trang_thai = 'CHO' AND deleted_at IS NULL`,
    [itemId, nguoiXuLyId, nowIso, version],
  );
  return res.changes;
}

// Quá hạn đóng chưa bấm → QUA_HAN (không ghi). Không có dòng nào → không lấy version.
export async function expireDues(db: DatabaseAdapter, today: string, nowIso: string): Promise<number> {
  const any = await db.queryOne<{ id: string }>(
    `SELECT id FROM khoan_dinh_ky_lan WHERE trang_thai = 'CHO' AND han_dong < $1 AND deleted_at IS NULL LIMIT 1`,
    [today],
  );
  if (!any) {
    return 0;
  }
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE khoan_dinh_ky_lan SET trang_thai = 'QUA_HAN', updated_at = $2, version = $3
     WHERE trang_thai = 'CHO' AND han_dong < $1 AND deleted_at IS NULL`,
    [today, nowIso, version],
  );
  return res.changes;
}

// Huỷ giao dịch ghi từ định kỳ → lần về CHO (chưa quá hạn đóng) / QUA_HAN / DA_DUNG (khoản đã dừng);
// khoá ghi mới (so_lan_ghi + 1)
export async function reopenDueOfTransaction(db: DatabaseAdapter, giaoDichId: string, today: string, nowIso: string): Promise<DueRow | null> {
  const due = await db.queryOne<DueRow>(`${DUE_SELECT} WHERE l.giao_dich_id = $1 AND l.trang_thai = 'DA_GHI' AND l.deleted_at IS NULL`, [giaoDichId]);
  if (!due) {
    return null;
  }
  const d = normalizeDue(due);
  const to: DueStatus = !d.khoan_active ? 'DA_DUNG' : today <= d.han_dong ? 'CHO' : 'QUA_HAN';
  const version = await db.nextVersion();
  await db.execute(
    `UPDATE khoan_dinh_ky_lan SET trang_thai = $2, giao_dich_id = NULL, nguoi_xu_ly_id = NULL, so_lan_ghi = so_lan_ghi + 1,
       updated_at = $3, version = $4
     WHERE id = $1 AND trang_thai = 'DA_GHI'`,
    [d.id, to, nowIso, version],
  );
  return { ...d, trang_thai: to, giao_dich_id: null, nguoi_xu_ly_id: null, so_lan_ghi: d.so_lan_ghi + 1, so_tien_da_ghi: null };
}

// Gợi ý trùng: khoản tự nhắn cùng danh mục, cùng người giữ tiền trong tháng
// (không tính khoản ghi từ bất kỳ lần định kỳ nào — 2 khoản định kỳ cùng danh mục không báo trùng nhau)
export async function findSameCategoryInMonth(
  db: DatabaseAdapter,
  i: { danhMucId: string; holder: string; from: string; to: string },
): Promise<{ so_tien: number; ngay_giao_dich: string } | null> {
  const row = await db.queryOne<{ so_tien: unknown; ngay_giao_dich: unknown }>(
    `SELECT g.so_tien, g.ngay_giao_dich FROM giao_dich g
     WHERE g.danh_muc_id = $1 AND g.nguoi_giu_tien_id = $2 AND g.ngay_giao_dich BETWEEN $3 AND $4
       AND g.trang_thai = 'HOAN_TAT' AND g.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM khoan_dinh_ky_lan l WHERE l.giao_dich_id = g.id)
     ORDER BY g.ngay_giao_dich DESC, g.created_at DESC LIMIT 1`,
    [i.danhMucId, i.holder, i.from, i.to],
  );
  return row ? { so_tien: Number(row.so_tien), ngay_giao_dich: day(row.ngay_giao_dich) } : null;
}

// ----- Tin nhắc chung (nhac_dinh_ky, bảng vận hành) -----

export const REMINDER_TRIES_PER_DAY = 3;

export async function getReminder(db: DatabaseAdapter, ky: string, memberId: string, lanNhac: number): Promise<NhacDinhKyRecord | null> {
  const row = await db.queryOne<NhacDinhKyRecord>('SELECT * FROM nhac_dinh_ky WHERE ky = $1 AND thanh_vien_id = $2 AND lan_nhac = $3', [
    ky,
    memberId,
    lanNhac,
  ]);
  return row
    ? { ...row, ngay_thu: day(row.ngay_thu), so_lan_thu: Number(row.so_lan_thu), telegram_message_id: row.telegram_message_id === null ? null : Number(row.telegram_message_id) }
    : null;
}

// Giữ chỗ gửi 1 tin nhắc. true = cần gửi (lần đầu / lần trước lỗi / kẹt DANG_GUI quá stale); tối đa N lần mỗi ngày VN
export async function claimReminder(
  db: DatabaseAdapter,
  i: { id: string; ky: string; memberId: string; lanNhac: number; today: string; nowIso: string; staleBeforeIso: string },
): Promise<boolean> {
  const inserted = await db.queryOne<{ id: string }>(
    `INSERT INTO nhac_dinh_ky (id, ky, thanh_vien_id, lan_nhac, trang_thai, ngay_thu, so_lan_thu, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'DANG_GUI', $5, 1, $6, $6)
     ON CONFLICT (ky, thanh_vien_id, lan_nhac) DO NOTHING RETURNING id`,
    [i.id, i.ky, i.memberId, i.lanNhac, i.today, i.nowIso],
  );
  if (inserted) {
    return true;
  }
  const res = await db.execute(
    `UPDATE nhac_dinh_ky SET trang_thai = 'DANG_GUI', so_lan_thu = CASE WHEN ngay_thu = $4 THEN so_lan_thu + 1 ELSE 1 END,
       ngay_thu = $4, updated_at = $5, loi = NULL
     WHERE ky = $1 AND thanh_vien_id = $2 AND lan_nhac = $3
       AND (trang_thai = 'LOI' OR (trang_thai = 'DANG_GUI' AND updated_at < $6))
       AND (ngay_thu <> $4 OR so_lan_thu < $7)`,
    [i.ky, i.memberId, i.lanNhac, i.today, i.nowIso, i.staleBeforeIso, REMINDER_TRIES_PER_DAY],
  );
  return res.changes > 0;
}

export async function finishReminder(
  db: DatabaseAdapter,
  i: { ky: string; memberId: string; lanNhac: number; ok: boolean; messageId: number | null; error: string | null; nowIso: string },
): Promise<void> {
  await db.execute(
    `UPDATE nhac_dinh_ky SET trang_thai = $4, telegram_message_id = $5, gui_luc = $6, loi = $7, updated_at = $8
     WHERE ky = $1 AND thanh_vien_id = $2 AND lan_nhac = $3`,
    [i.ky, i.memberId, i.lanNhac, i.ok ? 'DA_GUI' : 'LOI', i.messageId, i.ok ? i.nowIso : null, i.error, i.nowIso],
  );
}
