import type { DatabaseAdapter, SqlParam } from '../../src/db/types.ts';
import { TelegramApiError, type TelegramClient } from '../../src/telegram/client.ts';
import type { InlineKeyboard, TgUpdate } from '../../src/telegram/types.ts';
import { createWorker, type ClosableDb, type Env } from '../../src/worker.ts';
import { TELEGRAM_ID } from './phase3-env.ts';

export const SECRET = 'test-secret-123';
export const ENV: Env = { TELEGRAM_WEBHOOK_SECRET: SECRET, TELEGRAM_BOT_TOKEN: 'x', ENVIRONMENT: 'production' };
export const CHONG = TELEGRAM_ID.CHONG;
export const VO = TELEGRAM_ID.VO;
export const STRANGER = 999_999;

export interface SentCall {
  method: 'send' | 'edit' | 'answer';
  chatId?: number;
  messageId?: number;
  text?: string;
  keyboard?: InlineKeyboard;
  callbackQueryId?: string;
}

// Client giả: ghi lại lệnh gửi; failFor[chatId] → ném lỗi khi gửi cho chat đó
export class FakeTelegram implements TelegramClient {
  calls: SentCall[] = [];
  failFor = new Map<number, TelegramApiError>();
  failAll: Error | null = null;
  editError: TelegramApiError | null = null;

  async sendMessage(chatId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
    if (this.failAll) throw this.failAll;
    const err = this.failFor.get(chatId);
    if (err) throw err;
    this.calls.push({ method: 'send', chatId, text, ...(keyboard ? { keyboard } : {}) });
  }
  async editMessageText(chatId: number, messageId: number, text: string, keyboard?: InlineKeyboard): Promise<void> {
    if (this.failAll) throw this.failAll;
    if (this.editError) throw this.editError;
    this.calls.push({ method: 'edit', chatId, messageId, text, ...(keyboard ? { keyboard } : {}) });
  }
  async answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
    if (this.failAll) throw this.failAll;
    this.calls.push({ method: 'answer', callbackQueryId, ...(text ? { text } : {}) });
  }
  take(): SentCall[] {
    const out = this.calls;
    this.calls = [];
    return out;
  }
}

// DB dùng chung của test, close() không đóng thật; fail(sql) → ném lỗi giả lập
export class TestDb implements ClosableDb {
  private readonly inner: DatabaseAdapter;
  fail: ((sql: string) => Error | null) | null = null;
  // Chạy ngay sau câu SELECT trả kết quả — giả lập thao tác chen giữa lúc đọc và lúc ghi
  afterQuery: ((sql: string) => Promise<void>) | null = null;
  closed = 0;
  constructor(inner: DatabaseAdapter) {
    this.inner = inner;
  }
  private check(sql: string): void {
    const err = this.fail?.(sql);
    if (err) throw err;
  }
  async query<T>(sql: string, params?: readonly SqlParam[]): Promise<T[]> {
    this.check(sql);
    const rows = await this.inner.query<T>(sql, params);
    await this.afterQuery?.(sql);
    return rows;
  }
  async queryOne<T>(sql: string, params?: readonly SqlParam[]): Promise<T | null> {
    this.check(sql);
    return this.inner.queryOne<T>(sql, params);
  }
  async execute(sql: string, params?: readonly SqlParam[]): Promise<{ changes: number }> {
    this.check(sql);
    return this.inner.execute(sql, params);
  }
  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.inner.transaction((tx) => {
      const wrapped = new TestDb(tx);
      wrapped.fail = this.fail;
      return fn(wrapped);
    });
  }
  nextVersion(): Promise<number> {
    return this.inner.nextVersion();
  }
  async close(): Promise<void> {
    this.closed += 1;
  }
}

let updateSeq = 900_000;
let messageSeq = 1;

export interface BotHarness {
  tg: FakeTelegram;
  db: TestDb;
  setNow(iso: string): void;
  post(update: unknown, opts?: { secret?: string | null; env?: Env; raw?: string }): Promise<Response>;
  text(from: number, text: string, extra?: Record<string, unknown>): Promise<{ res: Response; update: TgUpdate }>;
  click(from: number, data: string, messageId?: number | null): Promise<Response>;
  cron(): Promise<void>;
}

export function createHarness(inner: DatabaseAdapter, startIso = '2026-11-05T03:00:00.000Z'): BotHarness {
  const tg = new FakeTelegram();
  const db = new TestDb(inner);
  let now = new Date(startIso);
  const worker = createWorker({ dbFactory: () => db, telegramFactory: () => tg, now: () => now });

  async function post(update: unknown, opts: { secret?: string | null; env?: Env; raw?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const secret = opts.secret === undefined ? SECRET : opts.secret;
    if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
    const pending: Promise<unknown>[] = [];
    const res = await worker.fetch(
      new Request('https://bot.test/telegram/webhook', { method: 'POST', headers, body: opts.raw ?? JSON.stringify(update) }),
      opts.env ?? ENV,
      { waitUntil: (p) => pending.push(p) },
    );
    await Promise.all(pending);
    return res;
  }

  return {
    tg,
    db,
    setNow: (iso) => {
      now = new Date(iso);
    },
    post,
    async text(from, text, extra = {}) {
      updateSeq += 1;
      messageSeq += 1;
      const update = {
        update_id: updateSeq,
        message: {
          message_id: messageSeq,
          date: Math.floor(now.getTime() / 1000),
          chat: { id: from, type: 'private' },
          from: { id: from },
          text,
          ...extra,
        },
      } as TgUpdate;
      return { res: await post(update), update };
    },
    async click(from, data, messageId = 77) {
      updateSeq += 1;
      const update = {
        update_id: updateSeq,
        callback_query: {
          id: `cb${updateSeq}`,
          from: { id: from },
          data,
          ...(messageId === null ? {} : { message: { message_id: messageId, date: 0, chat: { id: from, type: 'private' } } }),
        },
      };
      return post(update);
    },
    async cron() {
      const pending: Promise<unknown>[] = [];
      await worker.scheduled(null, ENV, { waitUntil: (p) => pending.push(p) });
      await Promise.all(pending);
    },
  };
}

// Tất cả callback_data trong 1 bàn phím
export function buttons(call: SentCall | undefined): Array<{ text: string; data: string }> {
  return (call?.keyboard ?? []).flat().map((b) => ({ text: b.text, data: b.callback_data }));
}

export function button(call: SentCall | undefined, prefix: string): string {
  const b = buttons(call).find((x) => x.data.startsWith(prefix));
  if (!b) throw new Error(`Không có nút ${prefix} trong ${JSON.stringify(call)}`);
  return b.data;
}

export function sentTo(calls: SentCall[], chatId: number): SentCall[] {
  return calls.filter((c) => c.method === 'send' && c.chatId === chatId);
}

export function answers(calls: SentCall[]): SentCall[] {
  return calls.filter((c) => c.method === 'answer');
}

export function edits(calls: SentCall[]): SentCall[] {
  return calls.filter((c) => c.method === 'edit');
}
