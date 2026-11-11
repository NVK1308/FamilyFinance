import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, MEMBER_ID } from './config/constants.ts';
import { createBotContext, handleFailure, handleUpdate } from './bot/handler.ts';
import { formatDay, formatMoney, memberName } from './bot/replies.ts';
import type { DatabaseAdapter } from './db/types.ts';
import { parseVietnameseFinanceMessage } from './parser/index.ts';
import { buildReport, previousMonth, reportActions } from './bot/report.ts';
import { claimReportSend, finishReportSend } from './db/repositories/report-repository.ts';
import { constantTimeEqual, newId, toVnDate } from './services/common.ts';
import { ExpiryService } from './services/expiry-service.ts';
import { runBotActions, type HtmlScreenshotter, type TelegramClient } from './telegram/client.ts';
import type { BotAction, TgUpdate } from './telegram/types.ts';

export interface Env {
  TIMEZONE?: string;
  CURRENCY?: string;
  ENVIRONMENT?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  NEON_DATABASE_URL?: string;
  // Phase 6: Cloudflare Browser Rendering (chụp ảnh báo cáo); thiếu → gửi tin chữ thay ảnh
  CF_ACCOUNT_ID?: string;
  CF_BROWSER_TOKEN?: string;
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
  // null = không chụp được ảnh (gửi tin chữ thay)
  screenshotFactory?(env: Env): HtmlScreenshotter | null;
  now?: () => Date;
}

// Lịch cron (wrangler.toml [triggers] crons): job hết hạn 1h sáng VN; báo cáo tháng 08:00 VN ngày 1, chạy bắt bù tới 21:00 ngày 3
export const EXPIRY_CRON = '0 18 * * *';
export const REPORT_CRON = '0 1-14 1-3 * *';
// Lần gửi trước kẹt ở DANG_GUI quá lâu (Worker bị dừng giữa chừng) → cho gửi lại
const REPORT_STALE_MS = 30 * 60_000;

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
            await runBotActions(client, actions, deps.screenshotFactory?.(env) ?? null);
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

  // Ngày 1–3 hằng tháng: gửi báo cáo tháng trước cho vợ + chồng; mỗi người đúng 1 lần (bao_cao_da_gui)
  async function runMonthlyReport(env: Env): Promise<void> {
    const db = deps.dbFactory(env);
    try {
      const current = now();
      const nowIso = current.toISOString();
      const today = toVnDate(current);
      const month = previousMonth(today);
      const ky = `${month.y}-${String(month.m).padStart(2, '0')}`;
      const members = await db.query<{ id: string; telegram_user_id: unknown }>(
        `SELECT id, telegram_user_id FROM thanh_vien
         WHERE is_active = TRUE AND deleted_at IS NULL AND vai_tro IN ('VO', 'CHONG') AND telegram_user_id IS NOT NULL ORDER BY id`,
      );
      const staleBeforeIso = new Date(current.getTime() - REPORT_STALE_MS).toISOString();
      const claimed: Array<{ id: string; chatId: number }> = [];
      for (const m of members) {
        if (await claimReportSend(db, { id: newId('BC'), ky, thanhVienId: m.id, nowIso, staleBeforeIso })) {
          claimed.push({ id: m.id, chatId: Number(m.telegram_user_id) });
        }
      }
      if (claimed.length === 0) {
        return;
      }
      const client = deps.telegramFactory(env);
      let results: boolean[] = [];
      let failure: string | null = null;
      try {
        if (!client) throw new Error('Thiếu TELEGRAM_BOT_TOKEN');
        const data = await buildReport(db, now, today, month);
        results = await runBotActions(client, reportActions(data, claimed.map((c) => c.chatId)), deps.screenshotFactory?.(env) ?? null);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
        console.error(`Báo cáo tháng ${ky} lỗi`, failure);
      }
      // reportActions: 2 lệnh / người (ảnh hoặc tin chữ thay, rồi file). Nhận được 1 trong 2 → coi là đã gửi
      // (gửi lại cả 2 sẽ trùng ảnh); không nhận được gì → LOI, giờ sau gửi lại (tối đa REPORT_MAX_ATTEMPTS lần)
      for (const [i, c] of claimed.entries()) {
        const ok = failure === null && (results[i * 2] === true || results[i * 2 + 1] === true);
        await finishReportSend(db, {
          ky,
          thanhVienId: c.id,
          status: ok ? 'DA_GUI' : 'LOI',
          error: ok ? null : (failure ?? 'Gửi Telegram lỗi').slice(0, 500),
          nowIso: now().toISOString(),
        });
      }
      console.log(`Báo cáo tháng ${ky}: gửi ${claimed.length} người`);
    } finally {
      await db.close().catch((e: unknown) => console.error('Đóng DB lỗi', e));
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

    // Rẽ nhánh theo lịch: REPORT_CRON → báo cáo tháng; còn lại (EXPIRY_CRON) → job hết hạn
    async scheduled(controller: { cron?: string } | null, env: Env, ctx: WorkerContext): Promise<void> {
      if (controller?.cron === REPORT_CRON) {
        ctx.waitUntil(runMonthlyReport(env).catch((e: unknown) => console.error('Job báo cáo tháng lỗi', e)));
        return;
      }
      ctx.waitUntil(runExpiry(env).catch((e: unknown) => console.error('Job hết hạn lỗi', e)));
    },
  };
}
