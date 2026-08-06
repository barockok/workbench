import { Pool, type PoolClient } from "pg";
import type { DbAdapter, DbExecutor, SqlParam } from "./db-adapter";

/**
 * Rewrite SQLite-style `?` placeholders to PostgreSQL's `$1, $2, …`.
 *
 * Deliberately not a blind `String.replace(/\?/g, …)`: a `?` can legitimately
 * appear inside a string literal (`WHERE path LIKE '%?%'`), inside a quoted
 * identifier, in a comment, or as one of PostgreSQL's own JSONB operators
 * (`?`, `?|`, `?&`). Rewriting those corrupts the statement, and the bug stays
 * invisible until that exact query runs. Only placeholders in ordinary SQL
 * text are substituted.
 */
export function toPgParams(sql: string): string {
  let out = "";
  let idx = 0;
  let i = 0;

  while (i < sql.length) {
    const c = sql[i];

    // Line comment — runs to end of line.
    if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // Block comment — nestable in PostgreSQL.
    if (c === "/" && sql[i + 1] === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }

    // String literal or quoted identifier. A doubled quote is an escape, which
    // this handles for free: the closing quote simply reopens on the next char.
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length && sql[j] !== c) j++;
      out += sql.slice(i, Math.min(j + 1, sql.length));
      i = j + 1;
      continue;
    }

    // Dollar-quoted string: $tag$ … $tag$ (tag may be empty).
    if (c === "$") {
      const tag = /^\$\$|^\$[A-Za-z_][A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (tag) {
        const close = sql.indexOf(tag[0], i + tag[0].length);
        const stop = close === -1 ? sql.length : close + tag[0].length;
        out += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }

    if (c === "?") {
      // PostgreSQL JSONB operators — leave them alone.
      if (sql[i + 1] === "|" || sql[i + 1] === "&" || sql[i + 1] === "?") {
        out += sql.slice(i, i + 2);
        i += 2;
        continue;
      }
      out += `$${++idx}`;
      i++;
      continue;
    }

    out += c;
    i++;
  }

  return out;
}

/** Wraps a checked-out client so a transaction's statements stay on one connection. */
class PostgresTxExecutor implements DbExecutor {
  readonly dialect = "postgres" as const;
  constructor(private client: PoolClient) {}

  async run(sql: string, params: SqlParam[] = []): Promise<{ changes: number }> {
    const result = await this.client.query(toPgParams(sql), params);
    return { changes: result.rowCount ?? 0 };
  }

  async get<T>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    const result = await this.client.query(toPgParams(sql), params);
    return result.rows[0] as T | undefined;
  }

  async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const result = await this.client.query(toPgParams(sql), params);
    return result.rows as T[];
  }
}

export class PostgresAdapter implements DbAdapter {
  readonly dialect = "postgres" as const;
  private pool: Pool;
  private closed = false;

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

  async run(sql: string, params: SqlParam[] = []): Promise<{ changes: number }> {
    const result = await this.pool.query(toPgParams(sql), params);
    return { changes: result.rowCount ?? 0 };
  }

  async get<T>(sql: string, params: SqlParam[] = []): Promise<T | undefined> {
    const result = await this.pool.query(toPgParams(sql), params);
    return result.rows[0] as T | undefined;
  }

  async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
    const result = await this.pool.query(toPgParams(sql), params);
    return result.rows as T[];
  }

  async transaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new PostgresTxExecutor(client));
      await client.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* connection already broken; releasing it discards the transaction */
      }
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}
