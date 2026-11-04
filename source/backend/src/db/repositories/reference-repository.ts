import type { DatabaseAdapter, DanhMucRecord, ThanhVienRecord } from '../types.ts';

export function getMemberByTelegramUserId(
  db: DatabaseAdapter,
  telegramUserId: number,
): Promise<ThanhVienRecord | null> {
  return db.queryOne<ThanhVienRecord>('SELECT * FROM thanh_vien WHERE telegram_user_id = $1', [
    telegramUserId,
  ]);
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
