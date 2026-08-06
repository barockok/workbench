/**
 * Minimal database surface shared by the SQLite and PostgreSQL backends.
 *
 * SQL is written once, in SQLite's `?` placeholder style; the PostgreSQL
 * adapter rewrites placeholders to `$1, $2, …` on the way out. Dialect
 * differences that cannot be papered over (DDL, aggregate function names)
 * are branched on `dialect` at the call site.
 */

/**
 * A value that can be bound to a placeholder.
 *
 * `boolean` is included deliberately: the schema has real BOOLEAN columns and
 * PostgreSQL refuses an integer for them, so callers must pass `true`/`false`.
 * better-sqlite3 rejects booleans in the other direction, so the SQLite adapter
 * converts them to 1/0 when binding. Write booleans; let the adapters cope.
 */
export type SqlParam = string | number | bigint | boolean | Buffer | Uint8Array | null | undefined;

/** The query subset available both on the pool and inside a transaction. */
export interface DbExecutor {
  readonly dialect: "sqlite" | "postgres";
  run(sql: string, params?: SqlParam[]): Promise<{ changes: number }>;
  get<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlParam[]): Promise<T[]>;
}

export interface DbAdapter extends DbExecutor {
  /** Run one or more statements with no parameters — DDL and migrations only. */
  exec(sql: string): Promise<void>;
  /**
   * Run `fn` inside a transaction, committing on return and rolling back on throw.
   *
   * Every statement `fn` issues MUST go through the executor it is handed, not
   * through the shared `db`. On PostgreSQL the transaction is pinned to one
   * pooled connection; a stray `db.run()` inside the callback would take a
   * *different* connection and silently execute outside the transaction.
   */
  transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T>;
  /** Release underlying handles. Idempotent. */
  close(): Promise<void>;
}
