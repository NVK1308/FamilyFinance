import { AUDIT_ACTION, TABLE_NAME, type MemberId } from '../config/constants.ts';
import {
  SETTING_DEFS,
  crossRuleError,
  isSettingKey,
  parseSettingValue,
  resolveSettings,
  type SettingKey,
  type Settings,
} from '../config/settings.ts';
import { insertAuditLog } from '../db/audit-repository.ts';
import { getSettingRow, listSettingRows, upsertSettingRow } from '../db/repositories/settings-repository.ts';
import type { DatabaseAdapter } from '../db/types.ts';

// Bảng chưa tạo (deploy code trước khi chạy SQL 10) → dùng mặc định thay vì dừng cron / bot
function isMissingTable(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /no such table|does not exist/i.test(text);
}

export async function loadSettings(db: DatabaseAdapter): Promise<Settings> {
  let rows: Array<{ khoa: string; gia_tri: string }> = [];
  try {
    rows = await listSettingRows(db);
  } catch (error) {
    if (!isMissingTable(error)) {
      throw error;
    }
    console.error('Chưa có bảng cau_hinh — dùng cấu hình mặc định (chạy temp/neon/10_khoan_dinh_ky.sql)');
  }
  const { values, invalid } = resolveSettings(rows);
  if (invalid.length > 0) {
    console.error(`Cấu hình sai, dùng mặc định: ${[...new Set(invalid)].join(', ')}`);
  }
  return values;
}

export type SettingUpdate =
  | { kind: 'OK'; key: SettingKey; before: number; after: number }
  | { kind: 'ERROR'; message: string };

// Sửa 1 khoá (kiểm giới hạn + ràng buộc chéo), ghi lịch sử. Giá trị không đổi → vẫn OK, không ghi.
export async function updateSetting(
  db: DatabaseAdapter,
  key: string,
  raw: string,
  member: MemberId,
  nowIso: string,
): Promise<SettingUpdate> {
  if (!isSettingKey(key)) {
    return { kind: 'ERROR', message: `Không có khoá ${key}.` };
  }
  const value = parseSettingValue(key, raw);
  const def = SETTING_DEFS[key];
  if (value === null) {
    return { kind: 'ERROR', message: `${key} phải là số nguyên từ ${def.min} đến ${def.max}.` };
  }
  return db.transaction(async (tx): Promise<SettingUpdate> => {
    const current = await loadSettings(tx);
    const next = { ...current, [key]: value };
    const cross = crossRuleError(next);
    if (cross) {
      return { kind: 'ERROR', message: `Không đổi được: ${cross}.` };
    }
    if (current[key] === value) {
      return { kind: 'OK', key, before: value, after: value };
    }
    const before = await getSettingRow(tx, key);
    await upsertSettingRow(tx, { khoa: key, giaTri: String(value), moTa: before?.mo_ta ?? def.moTa, nguoiCapNhatId: member, nowIso });
    await insertAuditLog(tx, {
      ten_bang: TABLE_NAME.CAU_HINH,
      ban_ghi_id: key,
      hanh_dong: before ? AUDIT_ACTION.UPDATE : AUDIT_ACTION.CREATE,
      du_lieu_truoc: before,
      du_lieu_sau: await getSettingRow(tx, key),
      nguoi_thuc_hien_id: member,
      ly_do: '/cauhinh',
      nowIso,
    });
    return { kind: 'OK', key, before: current[key], after: value };
  });
}
