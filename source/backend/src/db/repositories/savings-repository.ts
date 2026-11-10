import type { AssetType, MemberId, SavingsDirection, SavingsSourceId } from '../../config/constants.ts';
import { toSafeNumber, type DatabaseAdapter, type HuRecord, type HuTietKiemRecord } from '../types.ts';

// ---------- Hũ tiết kiệm (hu_tiet_kiem, migration 0004) ----------

export interface NewSavingsMoveInput {
  id: string;
  chieu: SavingsDirection;
  loai_tai_san: AssetType;
  so_luong_phan: number | null;
  so_tien: number | null;
  nguon_id: SavingsSourceId | null;
  hu_id: string;
  giao_dich_id: string | null;
  thanh_vien_id: MemberId;
  ngay: string;
  source_message_id: string | null;
  idempotency_key: string;
  ghi_chu: string | null;
  nowIso: string;
}

// BIGINT có thể về dạng chuỗi (PG) → số
function normalize(row: HuTietKiemRecord): HuTietKiemRecord {
  return {
    ...row,
    so_tien: row.so_tien === null ? null : toSafeNumber(row.so_tien),
    so_luong_phan: row.so_luong_phan === null ? null : toSafeNumber(row.so_luong_phan),
  };
}

export async function insertSavingsMove(db: DatabaseAdapter, input: NewSavingsMoveInput): Promise<HuTietKiemRecord> {
  const version = await db.nextVersion();
  const row = await db.queryOne<HuTietKiemRecord>(
    `INSERT INTO hu_tiet_kiem (
      id, chieu, loai_tai_san, so_luong_phan, so_tien, nguon_id, thanh_vien_id, ngay, trang_thai,
      source_message_id, idempotency_key, ghi_chu, created_at, updated_at, version, hu_id, giao_dich_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'HOAN_TAT', $9, $10, $11, $12, $12, $13, $14, $15)
    RETURNING *`,
    [
      input.id,
      input.chieu,
      input.loai_tai_san,
      input.so_luong_phan,
      input.so_tien,
      input.nguon_id,
      input.thanh_vien_id,
      input.ngay,
      input.source_message_id,
      input.idempotency_key,
      input.ghi_chu,
      input.nowIso,
      version,
      input.hu_id,
      input.giao_dich_id,
    ],
  );
  if (!row) {
    throw new Error(`Không đọc lại được dòng hũ tiết kiệm vừa ghi: ${input.id}`);
  }
  return normalize(row);
}

export async function getSavingsMoveById(db: DatabaseAdapter, id: string): Promise<HuTietKiemRecord | null> {
  const row = await db.queryOne<HuTietKiemRecord>('SELECT * FROM hu_tiet_kiem WHERE id = $1 AND deleted_at IS NULL', [id]);
  return row ? normalize(row) : null;
}

export async function getSavingsMoveByIdempotencyKey(db: DatabaseAdapter, key: string): Promise<HuTietKiemRecord | null> {
  const row = await db.queryOne<HuTietKiemRecord>('SELECT * FROM hu_tiet_kiem WHERE idempotency_key = $1', [key]);
  return row ? normalize(row) : null;
}

export async function markSavingsMoveCancelled(db: DatabaseAdapter, id: string, nowIso: string): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE hu_tiet_kiem SET trang_thai = 'DA_HUY', updated_at = $2, version = $3
     WHERE id = $1 AND trang_thai = 'HOAN_TAT' AND deleted_at IS NULL`,
    [id, nowIso, version],
  );
  return res.changes;
}

// Dòng hũ có tiền làm thay đổi tiền mặt (dùng chung cho 2 cách tính số dư → bất biến giữ)
const CASH_MOVES = `h.trang_thai = 'HOAN_TAT' AND h.deleted_at IS NULL
  AND h.chieu IN ('NOP', 'RUT') AND h.nguon_id IS NOT NULL AND h.so_tien IS NOT NULL
  AND h.ngay >= $1 AND h.ngay <= $2`;

// Theo nhóm nguồn: NOP (tiền mặt → hũ) / RUT (hũ → tiền mặt)
export async function sumSavingsCashByHolder(
  db: DatabaseAdapter,
  from: string,
  to: string,
): Promise<Array<{ nguon: SavingsSourceId; chieu: 'NOP' | 'RUT'; total: number }>> {
  const rows = await db.query<{ nguon: SavingsSourceId; chieu: 'NOP' | 'RUT'; total: unknown }>(
    `SELECT h.nguon_id AS nguon, h.chieu AS chieu, COALESCE(SUM(h.so_tien), 0) AS total
     FROM hu_tiet_kiem h WHERE ${CASH_MOVES}
     GROUP BY h.nguon_id, h.chieu`,
    [from, to],
  );
  return rows.map((r) => ({ nguon: r.nguon, chieu: r.chieu, total: toSafeNumber(r.total) }));
}

// Tiền trong hũ đến ngày asOf: khai báo + bỏ vào − lấy ra (loại TIEN); huId null = mọi hũ
export async function sumSavingsCash(db: DatabaseAdapter, asOf: string, huId: string | null = null): Promise<{ tien: number; soDong: number }> {
  // hu_id NULL (dòng cũ / worker cũ ghi sau khi chạy 0005) = hũ mặc định
  const byJar = huId ? ` AND COALESCE(h.hu_id, 'TIET_KIEM') = $2` : '';
  const row = await db.queryOne<{ tien: unknown; so_dong: unknown }>(
    `SELECT COALESCE(SUM(CASE WHEN h.chieu = 'RUT' THEN -h.so_tien ELSE h.so_tien END), 0) AS tien, COUNT(*) AS so_dong
     FROM hu_tiet_kiem h
     WHERE h.trang_thai = 'HOAN_TAT' AND h.deleted_at IS NULL AND h.loai_tai_san = 'TIEN' AND h.ngay <= $1${byJar}`,
    huId ? [asOf, huId] : [asOf],
  );
  return { tien: toSafeNumber(row?.tien), soDong: toSafeNumber(row?.so_dong) };
}

// Tiền từng hũ đến ngày asOf (hũ chưa có dòng nào → không có trong kết quả)
export async function sumSavingsCashByJar(db: DatabaseAdapter, asOf: string): Promise<Map<string, number>> {
  const rows = await db.query<{ hu_id: string; tien: unknown }>(
    `SELECT COALESCE(h.hu_id, 'TIET_KIEM') AS hu_id, COALESCE(SUM(CASE WHEN h.chieu = 'RUT' THEN -h.so_tien ELSE h.so_tien END), 0) AS tien
     FROM hu_tiet_kiem h
     WHERE h.trang_thai = 'HOAN_TAT' AND h.deleted_at IS NULL AND h.loai_tai_san = 'TIEN' AND h.ngay <= $1
     GROUP BY COALESCE(h.hu_id, 'TIET_KIEM')`,
    [asOf],
  );
  return new Map(rows.map((r) => [r.hu_id, toSafeNumber(r.tien)]));
}

// Vàng từng hũ đến ngày asOf (số phân): khai báo + mua − bán
export async function sumGoldByJar(db: DatabaseAdapter, asOf: string): Promise<Map<string, number>> {
  const rows = await db.query<{ hu_id: string; phan: unknown }>(
    `SELECT COALESCE(h.hu_id, 'TIET_KIEM') AS hu_id,
       COALESCE(SUM(CASE WHEN h.chieu = 'RUT' THEN -h.so_luong_phan ELSE h.so_luong_phan END), 0) AS phan
     FROM hu_tiet_kiem h
     WHERE h.trang_thai = 'HOAN_TAT' AND h.deleted_at IS NULL AND h.loai_tai_san = 'VANG' AND h.ngay <= $1
     GROUP BY COALESCE(h.hu_id, 'TIET_KIEM')`,
    [asOf],
  );
  return new Map(rows.map((r) => [r.hu_id, toSafeNumber(r.phan)]));
}

// Dòng vàng có giá gần nhất đến ngày asOf (định giá, giá chung mọi hũ): ưu tiên mua/bán; khai báo chỉ khi chưa có mua/bán
export async function latestGoldPrice(db: DatabaseAdapter, asOf: string): Promise<HuTietKiemRecord | null> {
  const row = await db.queryOne<HuTietKiemRecord>(
    `SELECT * FROM hu_tiet_kiem
     WHERE trang_thai = 'HOAN_TAT' AND deleted_at IS NULL AND loai_tai_san = 'VANG' AND so_tien IS NOT NULL AND ngay <= $1
     ORDER BY CASE WHEN chieu = 'KHAI_BAO' THEN 1 ELSE 0 END, ngay DESC, created_at DESC, version DESC LIMIT 1`,
    [asOf],
  );
  return row ? normalize(row) : null;
}

// Bỏ vào / lấy ra có tiền trong kỳ (không tính khai báo); huId null = mọi hũ
export async function sumSavingsFlows(
  db: DatabaseAdapter,
  from: string,
  to: string,
  huId: string | null = null,
  loai: AssetType | null = null,
): Promise<{ nop: number; soNop: number; rut: number; soRut: number }> {
  const byJar = huId ? ` AND COALESCE(h.hu_id, 'TIET_KIEM') = $3` : '';
  // Hằng số trong code (không phải dữ liệu người dùng)
  const byAsset = loai === 'VANG' ? ` AND h.loai_tai_san = 'VANG'` : loai === 'TIEN' ? ` AND h.loai_tai_san = 'TIEN'` : '';
  const row = await db.queryOne<{ nop: unknown; so_nop: unknown; rut: unknown; so_rut: unknown }>(
    `SELECT
       COALESCE(SUM(CASE WHEN h.chieu = 'NOP' THEN h.so_tien ELSE 0 END), 0) AS nop,
       COALESCE(SUM(CASE WHEN h.chieu = 'NOP' THEN 1 ELSE 0 END), 0) AS so_nop,
       COALESCE(SUM(CASE WHEN h.chieu = 'RUT' THEN h.so_tien ELSE 0 END), 0) AS rut,
       COALESCE(SUM(CASE WHEN h.chieu = 'RUT' THEN 1 ELSE 0 END), 0) AS so_rut
     FROM hu_tiet_kiem h WHERE ${CASH_MOVES}${byJar}${byAsset}`,
    huId ? [from, to, huId] : [from, to],
  );
  return {
    nop: toSafeNumber(row?.nop),
    soNop: toSafeNumber(row?.so_nop),
    rut: toSafeNumber(row?.rut),
    soRut: toSafeNumber(row?.so_rut),
  };
}

// Biến động gần nhất (cho /tietkiem)
export async function listRecentSavingsMoves(db: DatabaseAdapter, limit: number): Promise<HuTietKiemRecord[]> {
  const rows = await db.query<HuTietKiemRecord>(
    `SELECT * FROM hu_tiet_kiem WHERE trang_thai = 'HOAN_TAT' AND deleted_at IS NULL
     ORDER BY ngay DESC, created_at DESC, version DESC LIMIT $1`,
    [limit],
  );
  return rows.map(normalize);
}

// Dòng hũ đi kèm khoản chi trả từ hũ
export async function getSavingsMoveByTransaction(db: DatabaseAdapter, giaoDichId: string): Promise<HuTietKiemRecord | null> {
  const row = await db.queryOne<HuTietKiemRecord>(
    'SELECT * FROM hu_tiet_kiem WHERE giao_dich_id = $1 AND deleted_at IS NULL',
    [giaoDichId],
  );
  return row ? normalize(row) : null;
}

// ---------- Danh sách hũ (bảng hu, migration 0005) ----------

function normalizeJar(row: HuRecord): HuRecord {
  return { ...row, muc_tieu: row.muc_tieu === null ? null : toSafeNumber(row.muc_tieu) };
}

export async function listActiveJars(db: DatabaseAdapter): Promise<HuRecord[]> {
  const rows = await db.query<HuRecord>(
    // Hũ mặc định trước, còn lại theo thứ tự tạo (version tăng dần)
    `SELECT * FROM hu WHERE deleted_at IS NULL AND is_active = TRUE
     ORDER BY CASE WHEN id = 'TIET_KIEM' THEN 0 ELSE 1 END, version, id`,
  );
  return rows.map(normalizeJar);
}

export async function getJarById(db: DatabaseAdapter, id: string): Promise<HuRecord | null> {
  const row = await db.queryOne<HuRecord>('SELECT * FROM hu WHERE id = $1 AND deleted_at IS NULL', [id]);
  return row ? normalizeJar(row) : null;
}

export async function getJarByNormalizedName(db: DatabaseAdapter, tenKhongDau: string): Promise<HuRecord | null> {
  const row = await db.queryOne<HuRecord>('SELECT * FROM hu WHERE ten_khong_dau = $1 AND deleted_at IS NULL', [tenKhongDau]);
  return row ? normalizeJar(row) : null;
}

export interface NewJarInput {
  id: string;
  ten: string;
  ten_khong_dau: string;
  muc_tieu: number | null;
  nguoi_tao_id: MemberId;
  nowIso: string;
}

export async function insertJar(db: DatabaseAdapter, input: NewJarInput): Promise<HuRecord> {
  const version = await db.nextVersion();
  const row = await db.queryOne<HuRecord>(
    `INSERT INTO hu (id, ten, ten_khong_dau, muc_tieu, nguoi_tao_id, is_active, created_at, updated_at, version)
     VALUES ($1, $2, $3, $4, $5, TRUE, $6, $6, $7)
     RETURNING *`,
    [input.id, input.ten, input.ten_khong_dau, input.muc_tieu, input.nguoi_tao_id, input.nowIso, version],
  );
  if (!row) {
    throw new Error(`Không đọc lại được hũ vừa tạo: ${input.id}`);
  }
  return normalizeJar(row);
}
