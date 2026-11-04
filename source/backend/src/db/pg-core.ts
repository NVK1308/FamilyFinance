import { toSafeNumber, type DatabaseAdapter, type SqlParam } from './types.ts';

// OID kiểu Postgres cần đọc giống SQLite: ngày/giờ giữ chuỗi, BIGINT thành number
export const PG_OID = {
  INT8: 20,
  DATE: 1082,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
} as const;

// '2026-11-04 01:02:03.456+00' → '2026-11-04T01:02:03.456Z' (cùng dạng chuỗi ISO app ghi vào)
export function pgTimestampToIso(value: string): string {
  const normalized = value.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

export const PG_TEXT_PARSERS: Record<number, (value: string) => unknown> = {
  [PG_OID.INT8]: (v) => toSafeNumber(v),
  [PG_OID.DATE]: (v) => v,
  [PG_OID.TIMESTAMP]: (v) => pgTimestampToIso(`${v}+00`),
  [PG_OID.TIMESTAMPTZ]: (v) => pgTimestampToIso(v),
};

export interface PgExecResult {
  rows: Record<string, unknown>[];
  rowCount: number;
}

// Một kết nối chạy SQL kiểu `pg` ($1, $2...)
export interface PgExecutor {
  run(sql: string, params: unknown[]): Promise<PgExecResult>;
}

// Mở transaction trên kết nối, chạy fn, tự COMMIT/ROLLBACK
export type PgTransactionRunner = <T>(fn: (exec: PgExecutor) => Promise<T>) => Promise<T>;

function normalizeParams(params: readonly SqlParam[]): unknown[] {
  return params.map((p) => {
    if (p === undefined) {
      return null;
    }
    if (typeof p === 'bigint') {
      return p.toString();
    }
    return p;
  });
}

export class PgCoreAdapter implements DatabaseAdapter {
  private readonly exec: PgExecutor;
  private readonly runTransaction: PgTransactionRunner;
  private readonly inTransaction: boolean;

  constructor(exec: PgExecutor, runTransaction: PgTransactionRunner, inTransaction = false) {
    this.exec = exec;
    this.runTransaction = runTransaction;
    this.inTransaction = inTransaction;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<T[]> {
    const res = await this.exec.run(sql, normalizeParams(params));
    return res.rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async execute(sql: string, params: readonly SqlParam[] = []): Promise<{ changes: number }> {
    const res = await this.exec.run(sql, normalizeParams(params));
    return { changes: res.rowCount };
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    if (this.inTransaction) {
      return fn(this);
    }
    return this.runTransaction((txExec) =>
      fn(new PgCoreAdapter(txExec, this.runTransaction, true)),
    );
  }

  async nextVersion(): Promise<number> {
    const row = await this.queryOne<{ v: unknown }>("SELECT nextval('sync_version_seq') AS v");
    return toSafeNumber(row?.v);
  }
}

// Chạy fn lần lượt trên 1 kết nối, tránh câu lệnh khác chen vào giữa BEGIN...COMMIT
export function createSerialQueue(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn, fn);
    tail = next.catch(() => undefined);
    return next;
  };
}
