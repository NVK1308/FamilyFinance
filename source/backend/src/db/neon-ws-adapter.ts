import { Client, types as pgTypes } from '@neondatabase/serverless';
import {
  PG_TEXT_PARSERS,
  PgCoreAdapter,
  createSerialQueue,
  type PgExecutor,
  type PgTransactionRunner,
} from './pg-core.ts';

// Q1: adapter có transaction thật cho đường ghi (Neon WebSocket).
// Worker: tạo theo từng request, đóng bằng ctx.waitUntil(adapter.close()); không dùng lại giữa request.
// Không gọi API ngoài (Telegram...) bên trong transaction.
export class NeonWsAdapter extends PgCoreAdapter {
  private readonly client: Client;
  private connected: Promise<void> | null = null;

  constructor(connectionString: string) {
    const client = new Client({
      connectionString,
      types: {
        getTypeParser: (id, format) => {
          const custom = PG_TEXT_PARSERS[Number(id)];
          return custom ?? pgTypes.getTypeParser(id, format);
        },
      },
    });
    const ensureConnected = (): Promise<void> => {
      this.connected ??= client.connect();
      return this.connected;
    };
    const direct: PgExecutor = {
      run: async (sql, params) => {
        await ensureConnected();
        const res = await client.query(sql, params);
        return { rows: res.rows as Record<string, unknown>[], rowCount: res.rowCount ?? 0 };
      },
    };
    const serial = createSerialQueue();
    // Lệnh ngoài transaction xếp hàng sau transaction đang chạy để không lọt vào giữa
    const queued: PgExecutor = { run: (sql, params) => serial(() => direct.run(sql, params)) };
    const runTransaction: PgTransactionRunner = (fn) =>
      serial(async () => {
        await direct.run('BEGIN', []);
        try {
          const result = await fn(direct);
          await direct.run('COMMIT', []);
          return result;
        } catch (error) {
          // Kết nối rớt thì ROLLBACK cũng lỗi; giữ lỗi gốc để caller xử lý đúng
          await direct.run('ROLLBACK', []).catch(() => undefined);
          throw error;
        }
      });
    super(queued, runTransaction);
    this.client = client;
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.end();
    }
  }
}
