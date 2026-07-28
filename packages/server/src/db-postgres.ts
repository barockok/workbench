import { Pool } from "pg";
import type { DbAdapter } from "./db-adapter";

// Convert SQLite-style ? positional params to PostgreSQL $1, $2, ...
function toPgParams(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

export class PostgresAdapter implements DbAdapter {
  readonly dialect = "postgres" as const;
  private pool: Pool;

  constructor(url: string) {
    this.pool = new Pool({ connectionString: url });
  }

  async exec(sql: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(sql);
    } finally {
      client.release();
    }
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    const result = await this.pool.query(toPgParams(sql), params as unknown[]);
    return { changes: result.rowCount ?? 0 };
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const result = await this.pool.query(toPgParams(sql), params as unknown[]);
    return result.rows[0] as T | undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query(toPgParams(sql), params as unknown[]);
    return result.rows as T[];
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
