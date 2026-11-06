import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  PG_TEXT_PARSERS,
  PgCoreAdapter,
  createSerialQueue,
  type PgExecutor,
} from '../../src/db/pg-core.ts';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.resolve(currentDir, '../../migrations');
const SEED_DIR = path.resolve(currentDir, '../../seeds');

const SCHEMA_STEPS: ReadonlyArray<{ migration: string; seed?: string }> = [
  { migration: '0001_initial_schema.postgres.sql', seed: '0001_seed_reference_data.sql' },
  { migration: '0002_giao_dich_chieu_dieu_chinh.postgres.sql', seed: '0002_seed_lai_cho_vay.sql' },
  { migration: '0003_chuyen_quy_chung.postgres.sql', seed: '0003_seed_cac_con.sql' },
  { migration: '0004_hu_tiet_kiem.postgres.sql' },
];

// Q12: Postgres thật chạy trong tiến trình (PGlite) để test cùng bộ SQL với Neon
export class PgliteTestAdapter extends PgCoreAdapter {
  private readonly pg: PGlite;

  private constructor(pg: PGlite, exec: PgExecutor, serial: ReturnType<typeof createSerialQueue>) {
    super(exec, (fn) =>
      serial(() =>
        pg.transaction((tx) =>
          fn({
            run: async (sql, params) => {
              const res = await tx.query(sql, params);
              return { rows: res.rows as Record<string, unknown>[], rowCount: res.affectedRows ?? 0 };
            },
          }),
        ),
      ),
    );
    this.pg = pg;
  }

  static async create(options?: { skipMigration?: number }): Promise<PgliteTestAdapter> {
    const pg = await PGlite.create({ parsers: PG_TEXT_PARSERS });
    // Bỏ qua migration số skipMigration (test dữ liệu cũ)
    const steps = SCHEMA_STEPS.filter((_step, index) => index + 1 !== options?.skipMigration);
    for (const step of steps) {
      await pg.exec(fs.readFileSync(path.join(MIGRATION_DIR, step.migration), 'utf8'));
    }
    for (const step of steps) {
      if (step.seed) {
        await pg.exec(fs.readFileSync(path.join(SEED_DIR, step.seed), 'utf8'));
      }
    }
    const serial = createSerialQueue();
    const exec: PgExecutor = {
      run: (sql, params) =>
        serial(async () => {
          const res = await pg.query(sql, params);
          return { rows: res.rows as Record<string, unknown>[], rowCount: res.affectedRows ?? 0 };
        }),
    };
    return new PgliteTestAdapter(pg, exec, serial);
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}
