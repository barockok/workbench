import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import type { DbAdapter, DbExecutor, SqlParam } from "./db-adapter";

/**
 * better-sqlite3 binds only numbers, strings, bigints, buffers and null — it
 * throws on booleans and on undefined. PostgreSQL wants real booleans, so the
 * shared call sites pass booleans and the conversion happens here.
 */
function bind(params: SqlParam[]): unknown[] {
  return params.map((p) => {
    if (typeof p === "boolean") return p ? 1 : 0;
    if (p === undefined) return null;
    return p;
  });
}

export class SqliteAdapter implements DbAdapter {
  readonly dialect = "sqlite" as const;
  private db: InstanceType<typeof Database>;
  private closed = false;
  /**
   * better-sqlite3 is synchronous, but these methods are async, so an `await`
   * inside a transaction callback yields to the event loop. Without this queue
   * a second caller could issue BEGIN while the first is mid-transaction —
   * SQLite errors with "cannot start a transaction within a transaction".
   * Only transactions are serialized; single statements are already atomic.
   */
  private txQueue: Promise<unknown> = Promise.resolve();

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

  async run(sql: string, params: SqlParam[] = []): Promise<{ changes: number }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const info = this.db.prepare(sql).run(...(bind(params) as any[]));
    return { changes: info.changes };
  }

  async get<T>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.prepare(sql).get(...(bind(params) as any[])) as T | undefined;
  }

  async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.prepare(sql).all(...(bind(params) as any[])) as T[];
  }

  async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    const run = this.txQueue.then(async () => {
      this.db.exec("BEGIN");
      try {
        const result = await fn(this);
        this.db.exec("COMMIT");
        return result;
      } catch (e) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          /* SQLite already rolled the transaction back */
        }
        throw e;
      }
    });
    // Keep the chain alive when this transaction rejects, or every subsequent
    // transaction would inherit the rejection.
    this.txQueue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}
