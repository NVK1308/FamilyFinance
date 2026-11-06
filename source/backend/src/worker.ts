import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, MEMBER_ID } from './config/constants.ts';
import { createBotContext, handleFailure, handleUpdate } from './bot/handler.ts';
import { formatDay, formatMoney, memberName } from './bot/replies.ts';
import type { DatabaseAdapter } from './db/types.ts';
import { parseVietnameseFinanceMessage } from './parser/index.ts';
import { constantTimeEqual } from './services/common.ts';
import { ExpiryService } from './services/expiry-service.ts';
import { runBotActions, type TelegramClient } from './telegram/client.ts';
import type { BotAction, TgUpdate } from './telegram/types.ts';

export interface Env {
  TIMEZONE?: string;
  CURRENCY?: string;
  ENVIRONMENT?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  NEON_DATABASE_URL?: string;
}

export interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

export type ClosableDb = DatabaseAdapter & { close(): Promise<void> };

export interface WorkerDeps {
  // Tạo theo từng request, đóng sau khi xong (Neon WS không dùng lại giữa request)
  dbFactory(env: Env): ClosableDb;
  // null = thiếu token → không gửi được
  telegramFactory(env: Env): TelegramClient | null;
  now?: () => Date;
}

const EXPIRY_BATCH = 50;
const EXPIRY_MAX_BATCHES = 20;
const PG_TRANSIENT = new Set(['57P01', '40001', '40P01']);

// 3.1: lỗi tạm thời → 500 để Telegram gửi lại; lỗi khác → ghi LOI, trả 200
export function isTransientError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && (code.startsWith('08') || PG_TRANSIENT.has(code))) {
    return true;
  }
  const text = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|timeout|timed out|connection (terminated|closed|refused)|websocket|fetch failed|network/i.test(
    text,
  );
}

function notFound(): Response {
  return Response.json({ error: 'Not Found' }, { status: 404 });
}

export function createWorker(deps: WorkerDeps) {
  const now = deps.now ?? (() => new Date());

  // Gửi Telegram + đóng DB sau khi đã trả 200 (AC9)
  function finish(env: Env, ctx: WorkerContext, db: ClosableDb, actions: BotAction[]): void {
    ctx.waitUntil(
      (async () => {
        try {
          const client = actions.length > 0 ? deps.telegramFactory(env) : null;
          if (actions.length > 0 && !client) {
            console.error('Thiếu TELEGRAM_BOT_TOKEN, bỏ gửi tin');
          }
          if (client) {
            await runBotActions(client, actions);
          }
        } finally {
          await db.close().catch((e: unknown) => console.error('Đóng DB lỗi', e));
        }
      })(),
    );
  }

  async function webhook(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    const secret = env.TELEGRAM_WEBHOOK_SECRET;
    const header = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
    // Fail-closed: thiếu cấu hình hoặc sai secret → 401 trước khi đọc body
    if (!secret) {
      console.error('Thiếu TELEGRAM_WEBHOOK_SECRET, chặn webhook');
      return new Response('Unauthorized', { status: 401 });
    }
    if (!constantTimeEqual(header, secret)) {
      return new Response('Unauthorized', { status: 401 });
    }
    let update: TgUpdate;
    try {
      update = (await request.json()) as TgUpdate;
    } catch {
      console.error('Webhook: JSON hỏng');
      return new Response('ok');
    }
    if (typeof update?.update_id !== 'number') {
      return new Response('ok');
    }
    const db = deps.dbFactory(env);
    const bot = createBotContext(db, now);
    let actions: BotAction[];
    try {
      actions = await handleUpdate(bot, update);
    } catch (error) {
      if (isTransientError(error)) {
        console.error(`Update ${update.update_id} lỗi tạm thời, trả 500`, error);
        ctx.waitUntil(db.close().catch(() => undefined));
        return new Response('retry', { status: 500 });
      }
      console.error(`Update ${update.update_id} lỗi`, error);
      try {
        actions = await handleFailure(bot, update, error);
      } catch (inner) {
        console.error(`Ghi tin LOI cho update ${update.update_id} lỗi`, inner);
        actions = [];
      }
    }
    finish(env, ctx, db, actions);
    return new Response('ok');
  }

  async function runExpiry(env: Env): Promise<void> {
    const db = deps.dbFactory(env);
    let actions: BotAction[] = [];
    try {
      const result = await new ExpiryService(db, { now }).expireAllOverdue(EXPIRY_BATCH, EXPIRY_MAX_BATCHES);
      console.log(`Job hết hạn: ${result.expired} yêu cầu, lỗi ${result.failed}`);
      const members = await db.query<{ id: string; telegram_user_id: unknown }>(
        'SELECT id, telegram_user_id FROM thanh_vien WHERE is_active = TRUE AND deleted_at IS NULL',
      );
      const chatOf = new Map(members.map((m) => [m.id, Number(m.telegram_user_id)]));
      // Q7: chỉ báo chuyển tiền hết hạn, cho người chuyển
      actions = result.transfers.flatMap((t): BotAction[] => {
        const chatId = chatOf.get(t.nguoi_chuyen_id);
        const receiver = memberName(t.nguoi_nhan_id).toLowerCase();
        return chatId === undefined
          ? []
          : [
              {
                type: 'send',
                chatId,
                text: `⌛ Khoản chuyển ${formatMoney(Number(t.so_tien))} cho ${receiver} (${formatDay(t.ngay_chuyen)}) đã hết hạn (${receiver} chưa xác nhận). Nếu đã chuyển thật, nhắn lại.`,
              },
            ];
      });
    } finally {
      await db.close().catch((e: unknown) => console.error('Đóng DB lỗi', e));
    }
    const client = actions.length > 0 ? deps.telegramFactory(env) : null;
    if (client) {
      await runBotActions(client, actions);
    }
  }

  return {
    async fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') {
        return Response.json({
          status: 'ok',
          service: 'familyfinance-backend',
          version: '4.0.0',
          timezone: env.TIMEZONE ?? DEFAULT_TIMEZONE,
          currency: env.CURRENCY ?? DEFAULT_CURRENCY,
        });
      }
      if (request.method === 'POST' && url.pathname === '/telegram/webhook') {
        return webhook(request, env, ctx);
      }
      // Q13: chỉ bật ở development
      if (request.method === 'POST' && url.pathname === '/api/parser/preview' && env.ENVIRONMENT === 'development') {
        const body = (await request.json().catch(() => ({}))) as {
          rawText?: string;
          senderId?: 'VO' | 'CHONG';
          referenceDate?: string;
        };
        return Response.json(
          parseVietnameseFinanceMessage(body.rawText ?? '', {
            senderId: body.senderId ?? MEMBER_ID.CHONG,
            referenceDate: body.referenceDate,
          }),
        );
      }
      return notFound();
    },

    // Cron 0 18 * * * (UTC) = 1h sáng giờ VN (Q8)
    async scheduled(_controller: unknown, env: Env, ctx: WorkerContext): Promise<void> {
      ctx.waitUntil(runExpiry(env).catch((e: unknown) => console.error('Job hết hạn lỗi', e)));
    },
  };
}
