import { NeonWsAdapter } from './db/neon-ws-adapter.ts';
import { CloudflareScreenshotter, HttpTelegramClient } from './telegram/client.ts';
import { createWorker, type Env } from './worker.ts';

export type { Env } from './worker.ts';

// Lớp mỏng: nối Neon WebSocket + Telegram thật vào worker (logic ở worker.ts để test thay phụ thuộc)
const worker = createWorker({
  dbFactory: (env: Env) => {
    if (!env.NEON_DATABASE_URL) {
      throw new Error('Thiếu NEON_DATABASE_URL');
    }
    return new NeonWsAdapter(env.NEON_DATABASE_URL);
  },
  telegramFactory: (env: Env) => (env.TELEGRAM_BOT_TOKEN ? new HttpTelegramClient(env.TELEGRAM_BOT_TOKEN) : null),
  screenshotFactory: (env: Env) =>
    env.CF_ACCOUNT_ID && env.CF_BROWSER_TOKEN ? new CloudflareScreenshotter(env.CF_ACCOUNT_ID, env.CF_BROWSER_TOKEN) : null,
});

export default {
  fetch: worker.fetch,
  scheduled: worker.scheduled,
};
