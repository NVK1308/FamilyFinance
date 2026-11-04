import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createSerialQueue } from './pg-core.ts';
import type { DatabaseAdapter, SqlParam } from './types.ts';

function normalizeSqliteParam(val: SqlParam): SQLInputValue {
  if (val === undefined || val === null) {
    return null;
  }
  if (typeof val === 'boolean') {
    return val ? 1 : 0;
  }
  return val;
}

function prepareSqliteSqlAndParams(
  sql: string,
  params: readonly SqlParam[] = [],
): { sqliteSql: string; sqliteParams: SQLInputValue[] } {
  const sqliteParams: SQLInputValue[] = [];
  const sqliteSql = sql.replace(/\$(\d+)/g, (_match, indexStr: string) => {
    const idx = Number(indexStr) - 1;
    sqliteParams.push(normalizeSqliteParam(params[idx]));
    return '?';
  });
  return { sqliteSql, sqliteParams };
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.resolve(currentDir, '../../../desktop/FamilyFinance.Data/Migrations');
const SEED_DIR = path.resolve(currentDir, '../../seeds');

// Theo thứ tự chạy; migration và seed cùng số đi thành cặp
const SCHEMA_STEPS = [
  { migration: '0001_initial_schema.sqlite.sql', seed: '0001_seed_reference_data.sql' },
  { migration: '0002_giao_dich_chieu_dieu_chinh.sqlite.sql', seed: '0002_seed_lai_cho_vay.sql' },
] as const;

export interface SqliteMemoryOptions {
  // Chỉ nạp tới migration số này (mặc định nạp hết). Dùng cho test dữ liệu cũ.
  upToMigration?: number;
}

export class SqliteMemoryAdapter implements DatabaseAdapter {
  private readonly db: DatabaseSync;
  private versionCounter = 100;
  // 1 kết nối dùng chung: mọi lệnh ngoài transaction xếp hàng sau transaction đang mở (giống PgCoreAdapter)
  private readonly serial = createSerialQueue();

  constructor(options?: SqliteMemoryOptions) {
    this.db = new DatabaseSync(':memory:');
    const upTo = options?.upToMigration ?? SCHEMA_STEPS.length;
    SCHEMA_STEPS.slice(0, upTo).forEach((step) => {
      this.db.exec(fs.readFileSync(path.join(MIGRATION_DIR, step.migration), 'utf8'));
    });
    SCHEMA_STEPS.slice(0, upTo).forEach((step) => {
      const seedSql = fs
        .readFileSync(path.join(SEED_DIR, step.seed), 'utf8')
        .replace(/\bTRUE\b/g, '1')
        .replace(/\bFALSE\b/g, '0');
      this.db.exec(seedSql);
    });
  }

  query<T = Record<string, unknown>>(sql: string, params: readonly SqlParam[] = []): Promise<T[]> {
    return this.serial(async () => this.queryNow<T>(sql, params));
  }

  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  execute(sql: string, params: readonly SqlParam[] = []): Promise<{ changes: number }> {
    return this.serial(async () => this.executeNow(sql, params));
  }

  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(new SqliteTxScope(this));
        this.db.exec('COMMIT');
        return result;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    });
  }

  // Chạy ngay, không qua hàng đợi: chỉ SqliteTxScope (đang giữ lượt) được gọi
  queryNow<T>(sql: string, params: readonly SqlParam[] = []): T[] {
    const { sqliteSql, sqliteParams } = prepareSqliteSqlAndParams(sql, params);
    return this.db.prepare(sqliteSql).all(...sqliteParams) as T[];
  }

  executeNow(sql: string, params: readonly SqlParam[] = []): { changes: number } {
    const { sqliteSql, sqliteParams } = prepareSqliteSqlAndParams(sql, params);
    const result = this.db.prepare(sqliteSql).run(...sqliteParams);
    return { changes: Number(result.changes) };
  }

  async nextVersion(): Promise<number> {
    this.versionCounter += 1;
    return this.versionCounter;
  }
}

// Adapter bên trong transaction: transaction lồng nhau chạy thẳng trong transaction ngoài
class SqliteTxScope implements DatabaseAdapter {
  private readonly owner: SqliteMemoryAdapter;

  constructor(owner: SqliteMemoryAdapter) {
    this.owner = owner;
  }

  async query<T = Record<string, unknown>>(sql: string, params?: readonly SqlParam[]): Promise<T[]> {
    return this.owner.queryNow<T>(sql, params);
  }

  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params?: readonly SqlParam[],
  ): Promise<T | null> {
    return this.owner.queryNow<T>(sql, params)[0] ?? null;
  }

  async execute(sql: string, params?: readonly SqlParam[]): Promise<{ changes: number }> {
    return this.owner.executeNow(sql, params);
  }

  transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }

  nextVersion(): Promise<number> {
    return this.owner.nextVersion();
  }
}
