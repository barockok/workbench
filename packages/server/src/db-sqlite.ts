import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import type { DbAdapter } from "./db-adapter";

export class SqliteAdapter implements DbAdapter {
  readonly dialect = "sqlite" as const;
  private db: InstanceType<typeof Database>;

  constructor(url: string) {
    const dir = path.dirname(url);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(url);
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = this.db.prepare(sql).run(...(params as any[]));
    return { changes: info.changes };
  }

  async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.prepare(sql).get(...(params as any[])) as T | undefined;
  }

  async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.prepare(sql).all(...(params as any[])) as T[];
  }
}
