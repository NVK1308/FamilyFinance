import { toSafeNumber, type DatabaseAdapter, type SqlParam } from './types.ts';

export interface NeonHttpConfig {
  connectionString: string;
  httpEndpoint?: string;
}

interface NeonHttpResponse<T> {
  rows?: T[];
  rowCount?: number;
}

export class NeonHttpAdapter implements DatabaseAdapter {
  private readonly endpointUrl: string;
  private readonly connectionString: string;

  constructor(config: NeonHttpConfig) {
    this.connectionString = config.connectionString;
    if (config.httpEndpoint) {
      this.endpointUrl = config.httpEndpoint;
    } else {
      const parsed = new URL(config.connectionString);
      this.endpointUrl = `https://${parsed.hostname}/sql`;
    }
  }

  private async sendSql<T>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<NeonHttpResponse<T>> {
    const normalizedParams = params.map((p) => (p === undefined ? null : p));
    const response = await fetch(this.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Neon-Connection-String': this.connectionString,
      },
      body: JSON.stringify({
        query: sql,
        params: normalizedParams,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Neon SQL HTTP error (${response.status}): ${errorText}`);
    }

    return (await response.json()) as NeonHttpResponse<T>;
  }

  async query<T = Record<string, unknown>>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<T[]> {
    const res = await this.sendSql<T>(sql, params);
    return res.rows ?? [];
  }

  async queryOne<T = Record<string, unknown>>(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async execute(
    sql: string,
    params: readonly SqlParam[] = [],
  ): Promise<{ changes: number }> {
    const res = await this.sendSql<Record<string, unknown>>(sql, params);
    return { changes: res.rowCount ?? 0 };
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async nextVersion(): Promise<number> {
    const row = await this.queryOne<{ v: string | number }>(
      "SELECT nextval('sync_version_seq') AS v",
    );
    return toSafeNumber(row?.v);
  }
}

