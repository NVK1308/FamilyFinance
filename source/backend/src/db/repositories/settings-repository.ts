import type { DatabaseAdapter } from '../types.ts';

// ---------- Cấu hình (cau_hinh, migration 0008) ----------

export interface CauHinhRecord {
  khoa: string;
  gia_tri: string;
  mo_ta: string | null;
  nguoi_cap_nhat_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
}

export function listSettingRows(db: DatabaseAdapter): Promise<CauHinhRecord[]> {
  return db.query<CauHinhRecord>('SELECT * FROM cau_hinh WHERE deleted_at IS NULL ORDER BY khoa');
}

export function getSettingRow(db: DatabaseAdapter, khoa: string): Promise<CauHinhRecord | null> {
  return db.queryOne<CauHinhRecord>('SELECT * FROM cau_hinh WHERE khoa = $1', [khoa]);
}

// Ghi 1 khoá: chưa có (hoặc dòng seed đã mất) → thêm; có rồi → cập nhật (kể cả dòng đã xoá mềm → bỏ xoá)
export async function upsertSettingRow(
  db: DatabaseAdapter,
  i: { khoa: string; giaTri: string; moTa: string; nguoiCapNhatId: string; nowIso: string },
): Promise<void> {
  const version = await db.nextVersion();
  await db.execute(
    `INSERT INTO cau_hinh (khoa, gia_tri, mo_ta, nguoi_cap_nhat_id, created_at, updated_at, version)
     VALUES ($1, $2, $3, $4, $5, $5, $6)
     ON CONFLICT (khoa) DO UPDATE SET gia_tri = excluded.gia_tri, nguoi_cap_nhat_id = excluded.nguoi_cap_nhat_id,
       updated_at = excluded.updated_at, version = excluded.version, deleted_at = NULL`,
    [i.khoa, i.giaTri, i.moTa, i.nguoiCapNhatId, i.nowIso, version],
  );
}
