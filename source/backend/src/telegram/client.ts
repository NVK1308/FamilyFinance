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
  sendPhoto(chatId: number, png: Uint8Array, caption: string): Promise<void>;
  sendDocument(chatId: number, filename: string, content: Uint8Array, mimeType: string, caption?: string): Promise<void>;
}

// Chụp trang HTML thành PNG (Cloudflare Browser Rendering); null ở deps = không có cấu hình
export interface HtmlScreenshotter {
  screenshot(html: string, width: number, height: number): Promise<Uint8Array>;
}

// Telegram giới hạn chú thích 1024 ký tự
const CAPTION_MAX = 1024;

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

  async sendPhoto(chatId: number, png: Uint8Array, caption: string): Promise<void> {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('caption', caption.slice(0, CAPTION_MAX));
    form.set('protect_content', 'true');
    form.set('photo', new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }), 'bao-cao.png');
    await this.upload('sendPhoto', form);
  }

  async sendDocument(chatId: number, filename: string, content: Uint8Array, mimeType: string, caption?: string): Promise<void> {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    if (caption) form.set('caption', caption.slice(0, CAPTION_MAX));
    form.set('document', new Blob([content as Uint8Array<ArrayBuffer>], { type: mimeType }), filename);
    await this.upload('sendDocument', form);
  }

  // Gửi file: multipart (fetch tự đặt content-type + boundary)
  private async upload(method: string, form: FormData): Promise<void> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, { method: 'POST', body: form });
    await this.check(method, res);
  }

  private async call(method: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    await this.check(method, res);
  }

  private async check(method: string, res: Response): Promise<void> {
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

// Chạy lần lượt các lệnh; lỗi 1 lệnh → log, làm tiếp (DB đã ghi xong, không rollback được).
// Trả về kết quả từng lệnh (true = đã gửi; ảnh lỗi nhưng đã gửi tin dự phòng cũng tính true).
export async function runBotActions(
  client: TelegramClient,
  actions: readonly BotAction[],
  screenshotter: HtmlScreenshotter | null = null,
): Promise<boolean[]> {
  // Cùng 1 trang (báo cáo gửi 2 người) → chụp 1 lần (Browser Rendering Free: 1 lần / 10 giây)
  const shots = new Map<string, Promise<Uint8Array | null>>();
  const results: boolean[] = [];
  for (const action of actions) {
    try {
      await runOne(client, action, screenshotter, shots);
      results.push(true);
    } catch (error) {
      if (action.type === 'send' && action.onBlocked && error instanceof TelegramApiError && error.status === 403) {
        await runBotActions(client, [action.onBlocked]);
        results.push(false);
        continue;
      }
      if (!isHarmless(error)) {
        console.error(`Gửi Telegram (${action.type}) lỗi`, error instanceof Error ? error.message : error);
      }
      results.push(isHarmless(error));
    }
  }
  return results;
}

async function runOne(
  client: TelegramClient,
  action: BotAction,
  screenshotter: HtmlScreenshotter | null,
  shots: Map<string, Promise<Uint8Array | null>>,
): Promise<void> {
  switch (action.type) {
    case 'send':
      return client.sendMessage(action.chatId, action.text, action.keyboard);
    case 'edit':
      return client.editMessageText(action.chatId, action.messageId, action.text, action.keyboard);
    case 'answer':
      return client.answerCallbackQuery(action.callbackQueryId, action.text);
    case 'document': {
      const content = typeof action.content === 'function' ? action.content() : action.content;
      return client.sendDocument(action.chatId, action.filename, new TextEncoder().encode(content), 'text/html', action.caption);
    }
    case 'deferred': {
      let built: BotAction[];
      try {
        built = await action.build();
      } catch (error) {
        console.error('Dựng nội dung lỗi', error instanceof Error ? error.message : error);
        built = [action.onError];
      }
      const ok = await runBotActions(client, built, screenshotter);
      if (ok.length > 0 && ok.every((x) => !x)) {
        throw new Error('Không gửi được lệnh nào');
      }
      return;
    }
    case 'photo': {
      let shot = shots.get(action.html);
      if (!shot) {
        shot = screenshotter
          ? screenshotter.screenshot(action.html, action.width, action.height).catch((error: unknown) => {
              console.error('Chụp ảnh báo cáo lỗi, gửi tin chữ thay', error instanceof Error ? error.message : error);
              return null;
            })
          : Promise.resolve(null);
        shots.set(action.html, shot);
      }
      const png = await shot;
      if (png) {
        try {
          return await client.sendPhoto(action.chatId, png, action.caption);
        } catch (error) {
          console.error('Gửi ảnh báo cáo lỗi, gửi tin chữ thay', error instanceof Error ? error.message : error);
        }
      }
      return client.sendMessage(action.chatId, action.fallbackText);
    }
  }
}

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

// Cloudflare Browser Rendering REST /screenshot: gửi HTML, nhận PNG. Token chỉ cần quyền Browser Rendering - Edit.
export class CloudflareScreenshotter implements HtmlScreenshotter {
  private readonly accountId: string;
  private readonly token: string;
  private readonly fetchFn: FetchFn;

  constructor(accountId: string, token: string, fetchFn: FetchFn = (input, init) => fetch(input, init)) {
    this.accountId = accountId;
    this.token = token;
    this.fetchFn = fetchFn;
  }

  async screenshot(html: string, width: number, height: number): Promise<Uint8Array> {
    const res = await this.fetchFn(`https://api.cloudflare.com/client/v4/accounts/${this.accountId}/browser-rendering/screenshot`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        html,
        viewport: { width, height },
        screenshotOptions: { type: 'png', fullPage: false },
        // Chờ font tải xong
        gotoOptions: { waitUntil: 'networkidle0', timeout: 30_000 },
      }),
    });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.startsWith('image/')) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Browser Rendering ${res.status}: ${detail.slice(0, 200)}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
}
