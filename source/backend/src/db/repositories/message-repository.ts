import type { MemberId, MessageStatus } from '../../config/constants.ts';
import type { DatabaseAdapter, TinNhanGocRecord } from '../types.ts';

export interface NewMessageInput {
  id: string;
  telegram_update_id: number;
  telegram_message_id: number;
  telegram_chat_id: number;
  nguoi_gui_id: MemberId | null;
  noi_dung_goc: string;
  thoi_gian_nhan: string;
  trang_thai_xu_ly: MessageStatus;
  nowIso: string;
}

// Trả false nếu telegram_update_id đã có (Telegram gửi lại update)
export async function insertMessageIfNew(
  db: DatabaseAdapter,
  input: NewMessageInput,
): Promise<boolean> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `INSERT INTO tin_nhan_goc (
      id, telegram_update_id, telegram_message_id, telegram_chat_id, nguoi_gui_id,
      noi_dung_goc, thoi_gian_nhan, trang_thai_xu_ly, chi_tiet_loi, created_at, updated_at, version
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, $9, $10)
    ON CONFLICT (telegram_update_id) DO NOTHING`,
    [
      input.id,
      input.telegram_update_id,
      input.telegram_message_id,
      input.telegram_chat_id,
      input.nguoi_gui_id,
      input.noi_dung_goc,
      input.thoi_gian_nhan,
      input.trang_thai_xu_ly,
      input.nowIso,
      version,
    ],
  );
  return res.changes === 1;
}

export function getMessageById(db: DatabaseAdapter, id: string): Promise<TinNhanGocRecord | null> {
  return db.queryOne<TinNhanGocRecord>('SELECT * FROM tin_nhan_goc WHERE id = $1', [id]);
}

export function getMessageByUpdateId(
  db: DatabaseAdapter,
  updateId: number,
): Promise<TinNhanGocRecord | null> {
  return db.queryOne<TinNhanGocRecord>(
    'SELECT * FROM tin_nhan_goc WHERE telegram_update_id = $1',
    [updateId],
  );
}

export async function updateMessageStatus(
  db: DatabaseAdapter,
  id: string,
  status: MessageStatus,
  nowIso: string,
  chiTietLoi: string | null = null,
): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE tin_nhan_goc SET trang_thai_xu_ly = $2, chi_tiet_loi = $3, updated_at = $4, version = $5
     WHERE id = $1`,
    [id, status, chiTietLoi, nowIso, version],
  );
  return res.changes;
}
