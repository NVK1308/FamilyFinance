import { CATEGORY_CODE, CONFIRMATION_TYPE, MESSAGE_STATUS, type MemberId } from '../config/constants.ts';
import {
  getCategoryById,
  getFundMoveByIdempotencyKey,
  getMessageById,
  getMessageByUpdateId,
  getSavingsMoveByIdempotencyKey,
  getTransactionByIdempotencyKey,
  getTransferByIdempotencyKey,
  insertMessageIfNew,
  listConfirmationsByMessage,
  updateMessageStatus,
} from '../db/repositories/index.ts';
import type {
  ChuyenQuyChungRecord,
  ChuyenTienNoiBoRecord,
  DatabaseAdapter,
  GiaoDichRecord,
  HuTietKiemRecord,
  TinNhanGocRecord,
  YeuCauXacNhanRecord,
} from '../db/types.ts';
import type { ParseResult } from '../parser/types.ts';
import { isUniqueViolation, newId } from './common.ts';

export interface IncomingMessage {
  updateId: number;
  messageId: number;
  chatId: number;
  senderTelegramUserId: number;
  text: string;
  // Thời điểm nhận (ISO). Ngày giao dịch mặc định = ngày theo giờ VN của thời điểm này.
  receivedAt: string;
}

export type RecordOutcome =
  | {
      kind: 'RECORDED';
      duplicate: boolean;
      message: TinNhanGocRecord;
      transaction: GiaoDichRecord;
      confirmations: YeuCauXacNhanRecord[];
      // Q4: ghi vào danh mục mặc định / chưa rõ loại → bot hiện nút đổi danh mục
      chonDanhMuc: boolean;
    }
  | { kind: 'PENDING'; duplicate: boolean; message: TinNhanGocRecord; confirmations: YeuCauXacNhanRecord[] }
  | {
      kind: 'TRANSFER';
      duplicate: boolean;
      message: TinNhanGocRecord;
      transfer: ChuyenTienNoiBoRecord;
      confirmation: YeuCauXacNhanRecord | null;
      // Người chuyển giữ ít hơn số chuyển (chỉ cảnh báo, không chặn — Q7)
      canhBaoVuotSoDu: boolean;
    }
  | {
      kind: 'FUND_MOVE';
      duplicate: boolean;
      message: TinNhanGocRecord;
      fundMove: ChuyenQuyChungRecord;
      canhBaoVuotSoDu: boolean;
    }
  | {
      kind: 'SAVINGS_MOVE';
      duplicate: boolean;
      message: TinNhanGocRecord;
      move: HuTietKiemRecord;
      // Bỏ vào nhiều hơn nguồn đang giữ / lấy ra nhiều hơn hũ đang có (chỉ cảnh báo)
      canhBaoVuotSoDu: boolean;
    }
  | { kind: 'IGNORED'; duplicate: boolean; message: TinNhanGocRecord; reason: string }
  | { kind: 'NOT_TRANSACTION'; parsed: ParseResult };

export function telegramKey(updateId: number): string {
  return `tg:${updateId}`;
}

export async function requireMessage(db: DatabaseAdapter, id: string): Promise<TinNhanGocRecord> {
  const message = await getMessageById(db, id);
  if (!message) {
    throw new Error(`Không tìm thấy tin nhắn ${id}`);
  }
  return message;
}

// Lưu tin nhắn mới (DA_NHAN). Trả null nếu update đã có (Telegram gửi lại).
export async function insertIncomingMessage(
  tx: DatabaseAdapter,
  msg: IncomingMessage,
  senderId: MemberId | null,
  nowIso: string,
): Promise<string | null> {
  const messageId = newId('TN');
  const inserted = await insertMessageIfNew(tx, {
    id: messageId,
    telegram_update_id: msg.updateId,
    telegram_message_id: msg.messageId,
    telegram_chat_id: msg.chatId,
    nguoi_gui_id: senderId,
    noi_dung_goc: msg.text,
    thoi_gian_nhan: msg.receivedAt,
    trang_thai_xu_ly: MESSAGE_STATUS.DA_NHAN,
    nowIso,
  });
  return inserted ? messageId : null;
}

// Đánh dấu tin bỏ qua kèm lý do, trả kết quả IGNORED
export async function ignoreMessage(
  tx: DatabaseAdapter,
  messageId: string,
  reason: string,
  nowIso: string,
): Promise<RecordOutcome> {
  await updateMessageStatus(tx, messageId, MESSAGE_STATUS.DA_BO_QUA, nowIso, reason);
  return { kind: 'IGNORED', duplicate: false, message: await requireMessage(tx, messageId), reason };
}

// Update đã xử lý trước đó: trả lại kết quả cũ, không ghi gì. Tìm bản ghi theo key trước, rồi mới xét DA_BO_QUA.
export async function loadExistingOutcome(db: DatabaseAdapter, updateId: number): Promise<RecordOutcome> {
  const message = await getMessageByUpdateId(db, updateId);
  if (!message) {
    throw new Error(`Không tìm thấy tin nhắn update ${updateId}`);
  }
  const key = telegramKey(updateId);
  const confirmations = await listConfirmationsByMessage(db, message.id);
  const transaction = await getTransactionByIdempotencyKey(db, key);
  if (transaction) {
    const category = transaction.danh_muc_id ? await getCategoryById(db, transaction.danh_muc_id) : null;
    const chonDanhMuc = category?.ma_danh_muc === CATEGORY_CODE.CHI_KHAC || category?.ma_danh_muc === CATEGORY_CODE.THU_KHAC;
    return { kind: 'RECORDED', duplicate: true, message, transaction, confirmations, chonDanhMuc };
  }
  const transfer = await getTransferByIdempotencyKey(db, key);
  if (transfer) {
    const confirmation = confirmations.find((c) => c.loai_xac_nhan === CONFIRMATION_TYPE.CHUYEN_TIEN) ?? null;
    return { kind: 'TRANSFER', duplicate: true, message, transfer, confirmation, canhBaoVuotSoDu: false };
  }
  const fundMove = await getFundMoveByIdempotencyKey(db, key);
  if (fundMove) {
    return { kind: 'FUND_MOVE', duplicate: true, message, fundMove, canhBaoVuotSoDu: false };
  }
  const move = await getSavingsMoveByIdempotencyKey(db, key);
  if (move) {
    return { kind: 'SAVINGS_MOVE', duplicate: true, message, move, canhBaoVuotSoDu: false };
  }
  if (message.trang_thai_xu_ly === MESSAGE_STATUS.LOI) {
    return { kind: 'IGNORED', duplicate: true, message, reason: MESSAGE_STATUS.LOI };
  }
  if (message.trang_thai_xu_ly === MESSAGE_STATUS.DA_BO_QUA) {
    return { kind: 'IGNORED', duplicate: true, message, reason: message.chi_tiet_loi ?? '' };
  }
  return { kind: 'PENDING', duplicate: true, message, confirmations };
}

// Hai request cùng update chạy song song: bên thua UNIQUE đọc lại kết quả bên thắng
export async function withDuplicateFallback(
  db: DatabaseAdapter,
  updateId: number,
  run: () => Promise<RecordOutcome>,
): Promise<RecordOutcome> {
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error) && (await getMessageByUpdateId(db, updateId))) {
      return loadExistingOutcome(db, updateId);
    }
    throw error;
  }
}
