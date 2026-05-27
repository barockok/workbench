declare module "better-sqlite3" {
  class Database {
    constructor(filename: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
  class Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  export = Database;
}
