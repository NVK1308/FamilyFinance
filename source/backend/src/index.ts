import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE, MEMBER_ID } from './config/constants.ts';
import { parseVietnameseFinanceMessage } from './parser/index.ts';

export interface Env {
  TIMEZONE?: string;
  CURRENCY?: string;
  ENVIRONMENT?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  NEON_DATABASE_URL?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    if (request.method === 'POST' && url.pathname === '/api/parser/preview') {
      const body = (await request.json()) as {
        rawText?: string;
        senderId?: 'VO' | 'CHONG';
        referenceDate?: string;
      };
      const rawText = body.rawText ?? '';
      const senderId = body.senderId ?? MEMBER_ID.CHONG;
      const parsed = parseVietnameseFinanceMessage(rawText, {
        senderId,
        referenceDate: body.referenceDate,
      });
      return Response.json(parsed);
    }

    return Response.json({ error: 'Not Found' }, { status: 404 });
  },
};

