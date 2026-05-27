import { z } from "zod";

function sanitizeQuery(sql: string): boolean {
  const normalized = sql.trim().toLowerCase();
  const forbidden = [
    /^\s*insert\s+/,
    /^\s*update\s+/,
    /^\s*delete\s+/,
    /^\s*drop\s+/,
    /^\s*alter\s+/,
    /^\s*create\s+/,
    /^\s*truncate\s+/,
    /^\s*grant\s+/,
    /^\s*revoke\s+/,
  ];
  return !forbidden.some((re) => re.test(normalized));
}

export const query = {
  name: "postgres_query",
  description: "Run a read-only SQL query against PostgreSQL",
  integration: "postgres",
  inputSchema: z.object({
    connectionString: z.string(),
    sql: z.string(),
  }),
  handler: async (_ctx: any, args: any) => {
    if (!sanitizeQuery(args.sql)) {
      return { error: "Only SELECT queries allowed" };
    }
    const { Client } = await import("pg");
    const client = new Client({ connectionString: args.connectionString });
    try {
      await client.connect();
      const result = await client.query(args.sql);
      return { rows: result.rows, rowCount: result.rowCount };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    } finally {
      await client.end();
    }
  },
};

export const listTables = {
  name: "postgres_list_tables",
  description: "List tables in a PostgreSQL database",
  integration: "postgres",
  inputSchema: z.object({
    connectionString: z.string(),
    schema: z.string().default("public"),
  }),
  handler: async (_ctx: any, args: any) => {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: args.connectionString });
    try {
      await client.connect();
      const result = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`,
        [args.schema]
      );
      return { tables: result.rows.map((r: any) => r.table_name) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    } finally {
      await client.end();
    }
  },
};

export const describeTable = {
  name: "postgres_describe_table",
  description: "Describe columns of a PostgreSQL table",
  integration: "postgres",
  inputSchema: z.object({
    connectionString: z.string(),
    table: z.string(),
    schema: z.string().default("public"),
  }),
  handler: async (_ctx: any, args: any) => {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: args.connectionString });
    try {
      await client.connect();
      const result = await client.query(
        `SELECT column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2`,
        [args.schema, args.table]
      );
      return { columns: result.rows };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    } finally {
      await client.end();
    }
  },
};
