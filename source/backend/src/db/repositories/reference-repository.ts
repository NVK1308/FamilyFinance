import type { DatabaseAdapter, DanhMucRecord, ThanhVienRecord } from '../types.ts';

export function getMemberByTelegramUserId(
  db: DatabaseAdapter,
  telegramUserId: number,
): Promise<ThanhVienRecord | null> {
  return db.queryOne<ThanhVienRecord>('SELECT * FROM thanh_vien WHERE telegram_user_id = $1', [
    telegramUserId,
  ]);
}

export function getMemberById(db: DatabaseAdapter, id: string): Promise<ThanhVienRecord | null> {
  return db.queryOne<ThanhVienRecord>('SELECT * FROM thanh_vien WHERE id = $1', [id]);
}

export function isActiveMember(member: ThanhVienRecord | null): member is ThanhVienRecord {
  return member !== null && member.deleted_at === null && Boolean(member.is_active);
}

export function getActiveCategoryByCode(
  db: DatabaseAdapter,
  code: string,
): Promise<DanhMucRecord | null> {
  return db.queryOne<DanhMucRecord>(
    'SELECT * FROM danh_muc WHERE ma_danh_muc = $1 AND is_active = TRUE AND deleted_at IS NULL',
    [code],
  );
}

export function getCategoryById(db: DatabaseAdapter, id: string): Promise<DanhMucRecord | null> {
  return db.queryOne<DanhMucRecord>('SELECT * FROM danh_muc WHERE id = $1', [id]);
}

// Danh mục đang dùng được cho THU/CHI (gồm CA_HAI), trừ các mã truyền vào
export function listActiveCategoriesFor(
  db: DatabaseAdapter,
  loai: 'THU' | 'CHI',
  excludeCodes: readonly string[] = [],
): Promise<DanhMucRecord[]> {
  const placeholders = excludeCodes.map((_code, i) => `$${i + 2}`).join(', ');
  return db.query<DanhMucRecord>(
    `SELECT * FROM danh_muc
     WHERE loai_giao_dich IN ($1, 'CA_HAI') AND is_active = TRUE AND deleted_at IS NULL` +
      (placeholders ? ` AND ma_danh_muc NOT IN (${placeholders})` : '') +
      ' ORDER BY version, id',
    [loai, ...excludeCodes],
  );
}
