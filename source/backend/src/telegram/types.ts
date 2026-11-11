// Kiểu Telegram Bot API tối thiểu bot dùng (https://core.telegram.org/bots/api)

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
  // Có một trong các trường này = tin chuyển tiếp
  forward_origin?: unknown;
  forward_from?: unknown;
  forward_date?: number;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  edited_message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineButton {
  text: string;
  callback_data: string;
}

export type InlineKeyboard = InlineButton[][];

// Lệnh gửi Telegram do bot sinh ra; worker chạy tuần tự sau khi DB đã commit
export type BotAction =
  | {
      type: 'send';
      chatId: number;
      text: string;
      keyboard?: InlineKeyboard;
      // Người nhận chặn bot / chưa /start (403) → gửi tin này thay
      onBlocked?: BotAction;
    }
  | { type: 'edit'; chatId: number; messageId: number; text: string; keyboard?: InlineKeyboard }
  | { type: 'answer'; callbackQueryId: string; text?: string }
  // Ảnh chụp từ trang HTML (Phase 6); chụp lỗi / không có dịch vụ chụp → gửi fallbackText
  | { type: 'photo'; chatId: number; html: string; width: number; height: number; caption: string; fallbackText: string }
  // content là hàm → dựng lúc gửi (sau khi đã gửi ảnh: hết CPU giữa chừng thì người nhận vẫn có ảnh / tin chữ)
  | { type: 'document'; chatId: number; filename: string; content: string | (() => string); caption?: string }
  // Việc nặng (dựng báo cáo) chạy sau khi webhook đã trả 200; lỗi → gửi onError
  | { type: 'deferred'; build: () => Promise<BotAction[]>; onError: BotAction };
