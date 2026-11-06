import type { BotAction, InlineKeyboard } from './types.ts';

export class TelegramApiError extends Error {
  readonly status: number;
  readonly description: string;

  constructor(method: string, status: number, description: string) {
    super(`Telegram ${method} lỗi ${status}: ${description}`);
    this.name = 'TelegramApiError';
    this.status = status;
    this.description = description;
  }
}

export interface TelegramClient {
  sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void>;
  editMessageText(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void>;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function markup(keyboard?: InlineKeyboard): { reply_markup: { inline_keyboard: InlineKeyboard } } {
  // Không truyền bàn phím = xoá bàn phím cũ khi sửa tin
  return { reply_markup: { inline_keyboard: keyboard ?? [] } };
}

// Gọi Bot API qua fetch (thay được khi test). Không log URL vì chứa token.
export class HttpTelegramClient implements TelegramClient {
  private readonly token: string;
  private readonly fetchFn: FetchLike;

  constructor(token: string, fetchFn: FetchLike = (input, init) => fetch(input, init)) {
    this.token = token;
    this.fetchFn = fetchFn;
  }

  async sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
    await this.call('sendMessage', { chat_id: chatId, text, ...(keyboard ? markup(keyboard) : {}) });
  }

  async editMessageText(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
    await this.call('editMessageText', { chat_id: chatId, message_id: messageId, text, ...markup(keyboard) });
  }

  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
  }

  private async call(method: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { description?: string };
      throw new TelegramApiError(method, res.status, data.description ?? res.statusText);
    }
  }
}

// Lỗi bỏ qua được: sửa tin không đổi nội dung, callback đã quá cũ
function isHarmless(error: unknown): boolean {
  return (
    error instanceof TelegramApiError &&
    /message is not modified|query is too old|query ID is invalid/i.test(error.description)
  );
}

// Chạy lần lượt các lệnh; lỗi 1 lệnh → log, làm tiếp (DB đã ghi xong, không rollback được)
export async function runBotActions(client: TelegramClient, actions: readonly BotAction[]): Promise<void> {
  for (const action of actions) {
    try {
      await runOne(client, action);
    } catch (error) {
      if (action.type === 'send' && action.onBlocked && error instanceof TelegramApiError && error.status === 403) {
        await runBotActions(client, [action.onBlocked]);
        continue;
      }
      if (!isHarmless(error)) {
        console.error(`Gửi Telegram (${action.type}) lỗi`, error instanceof Error ? error.message : error);
      }
    }
  }
}

function runOne(client: TelegramClient, action: BotAction): Promise<void> {
  switch (action.type) {
    case 'send':
      return client.sendMessage(action.chatId, action.text, action.keyboard);
    case 'edit':
      return client.editMessageText(action.chatId, action.messageId, action.text, action.keyboard);
    case 'answer':
      return client.answerCallbackQuery(action.callbackQueryId, action.text);
  }
}
