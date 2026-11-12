import type { DatabaseAdapter, GiaoDichRecord, TinNhanGocRecord } from '../types.ts';
import { toSafeNumber } from '../types.ts';

// ---------- Sửa số tiền khoản đã ghi (không migration) ----------

// Mọi dòng tin_nhan_goc của 1 tin Telegram (tin gốc + các lần sửa), cũ → mới
export function listMessagesByTelegramId(db: DatabaseAdapter, chatId: number, messageId: number): Promise<TinNhanGocRecord[]> {
  return db.query<TinNhanGocRecord>(
    `SELECT * FROM tin_nhan_goc WHERE telegram_chat_id = $1 AND telegram_message_id = $2 AND deleted_at IS NULL
     ORDER BY thoi_gian_nhan, created_at, id`,
    [chatId, messageId],
  );
}

// Giao dịch sinh ra từ 1 tin Telegram (qua bất kỳ dòng tin nào của tin đó) + câu đã tạo ra nó.
// Kể cả khoản đã xoá mềm (bên sửa báo "không tìm thấy" thay vì "loại không sửa được").
export async function getTransactionByTelegramMessage(
  db: DatabaseAdapter,
  chatId: number,
  messageId: number,
): Promise<{ transaction: GiaoDichRecord; text: string } | null> {
  const row = await db.queryOne<GiaoDichRecord & { cau_goc: string }>(
    `SELECT g.*, t.noi_dung_goc AS cau_goc FROM giao_dich g JOIN tin_nhan_goc t ON t.id = g.source_message_id
     WHERE t.telegram_chat_id = $1 AND t.telegram_message_id = $2
     ORDER BY g.created_at, g.id LIMIT 1`,
    [chatId, messageId],
  );
  if (!row) {
    return null;
  }
  const { cau_goc: text, ...transaction } = row;
  return { transaction: transaction as GiaoDichRecord, text };
}

// Đổi số tiền khi version chưa đổi từ lúc đọc (tránh ghi đè lần sửa khác). 0 = không đổi.
export async function updateTransactionAmount(
  db: DatabaseAdapter,
  i: { id: string; soTien: number; expectedVersion: number; nowIso: string },
): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE giao_dich SET so_tien = $2, updated_at = $4, version = $5
     WHERE id = $1 AND version = $3 AND trang_thai = 'HOAN_TAT' AND deleted_at IS NULL`,
    [i.id, i.soTien, i.expectedVersion, i.nowIso, version],
  );
  return res.changes;
}

// Dòng lấy ra hũ đi kèm khoản chi trả từ hũ: đổi số tiền theo khoản chi
export async function updateLinkedSavingsAmount(db: DatabaseAdapter, giaoDichId: string, soTien: number, nowIso: string): Promise<number> {
  const version = await db.nextVersion();
  const res = await db.execute(
    `UPDATE hu_tiet_kiem SET so_tien = $2, updated_at = $3, version = $4
     WHERE giao_dich_id = $1 AND trang_thai = 'HOAN_TAT' AND deleted_at IS NULL`,
    [giaoDichId, soTien, nowIso, version],
  );
  return res.changes;
}

// Đã xử lý 1 bản sửa mới hơn của cùng tin Telegram (đã áp, hoặc "không đổi") → bản cũ đến muộn bỏ qua.
// Cùng giây (edit_date tính bằng giây) → update_id lớn hơn là bản mới hơn.
export async function hasNewerAppliedEdit(
  db: DatabaseAdapter,
  i: { chatId: number; messageId: number; receivedAt: string; updateId: number; selfId: string },
): Promise<boolean> {
  const row = await db.queryOne<{ c: unknown }>(
    `SELECT COUNT(*) AS c FROM tin_nhan_goc
     WHERE telegram_chat_id = $1 AND telegram_message_id = $2 AND id <> $3 AND deleted_at IS NULL
       AND (trang_thai_xu_ly = 'DA_GHI' OR (trang_thai_xu_ly = 'DA_BO_QUA' AND chi_tiet_loi = 'SUA_KHONG_DOI'))
       AND (thoi_gian_nhan > $4 OR (thoi_gian_nhan = $4 AND telegram_update_id > $5))`,
    [i.chatId, i.messageId, i.selfId, i.receivedAt, i.updateId],
  );
  return toSafeNumber(row?.c) > 0;
}
