/**
 * One-shot data migration: SQLite → PostgreSQL.
 *
 * Run manually, inside the pod, against a stopped-or-idle instance. It does not
 * change which backend the server uses — that is a separate `DATABASE_URL`
 * change in the deploy repo, made only after this has run and been verified.
 *
 *   tsx server/migrate/sqlite-to-postgres.js                 # dry run (default)
 *   tsx server/migrate/sqlite-to-postgres.js --apply         # actually write
 *
 * Source: `SOURCE_SQLITE_PATH`, else `DATABASE_URL` when it points at a file,
 * else `/data/tokens.db`.
 *
 * Target: `TARGET_DATABASE_URL` (a `postgres://` URL), or the standard libpq
 * variables `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`.
 *
 * ⚠️ `ENCRYPTION_KEY` is NOT part of this migration and must not change.
 * Tokens and cookies are stored encrypted; this copies the ciphertext verbatim.
 * If the instance that later points at PostgreSQL runs with a different
 * `ENCRYPTION_KEY`, every migrated credential is undecryptable and every user
 * has to reconnect — which is the whole thing this migration exists to avoid.
 *
 * Flags:
 *   --apply             perform the writes (without it, nothing is written)
 *   --allow-nonempty    proceed even if the target already holds rows
 *   --skip=a,b          skip these tables (e.g. --skip=audit_log)
 */
import { createDb, applySchema } from "../db";
import type { DbAdapter, SqlParam } from "../db-adapter";
import { TABLES, READ_BATCH, WRITE_BATCH, parseArgs, sourcePath, targetUrl, redact, coerce } from "./plan";
import type { TargetColumn } from "./plan";

async function sourceColumns(src: DbAdapter, table: string): Promise<string[]> {
  // PRAGMA takes no bound parameters, so the table name is interpolated. Every
  // name comes from the TABLES constant in ./plan — never from input.
  const rows = await src.all<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

async function targetColumns(dst: DbAdapter, table: string): Promise<TargetColumn[]> {
  const rows = await dst.all<{ column_name: string; data_type: string; column_default: string | null }>(
    `SELECT column_name, data_type, column_default
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ?`,
    [table]
  );
  return rows.map((r) => ({
    name: r.column_name,
    dataType: r.data_type,
    isSerial: (r.column_default ?? "").startsWith("nextval("),
  }));
}

export async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const srcPath = sourcePath();
  const dstUrl = targetUrl();

  console.log(`[migrate] source  : ${srcPath}`);
  console.log(`[migrate] target  : ${redact(dstUrl)}`);
  console.log(`[migrate] mode    : ${args.apply ? "APPLY (writes)" : "DRY RUN (no writes)"}`);
  if (args.skip.size) console.log(`[migrate] skipping: ${[...args.skip].join(", ")}`);

  const src = createDb(srcPath);
  const dst = createDb(dstUrl);
  if (dst.dialect !== "postgres") throw new Error("target did not resolve to a PostgreSQL adapter");

  try {
    // Production DDL, not a copy of it — the same function the server runs at boot.
    await applySchema(dst);

    const tables = TABLES.filter((t) => !args.skip.has(t));
    const plan: { table: string; rows: number; columns: string[]; dropped: string[] }[] = [];
    const targetOccupied: string[] = [];

    for (const table of tables) {
      const srcCols = await sourceColumns(src, table);
      const dstCols = await targetColumns(dst, table);
      const dstByName = new Map(dstCols.map((c) => [c.name, c]));
      const shared = srcCols.filter((c) => dstByName.has(c));
      const dropped = srcCols.filter((c) => !dstByName.has(c));

      const srcCount = Number((await src.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0);
      const dstCount = Number((await dst.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0);
      if (dstCount > 0) targetOccupied.push(`${table} (${dstCount})`);

      plan.push({ table, rows: srcCount, columns: shared, dropped });
    }

    console.log("");
    for (const p of plan) {
      console.log(`[migrate] ${p.table.padEnd(22)} ${String(p.rows).padStart(8)} rows  ${p.columns.length} columns`);
      if (p.dropped.length) {
        console.log(`[migrate]   ⚠ source-only columns, NOT copied: ${p.dropped.join(", ")}`);
      }
    }
    console.log("");

    if (targetOccupied.length && !args.allowNonEmpty) {
      throw new Error(
        `target is not empty: ${targetOccupied.join(", ")}. ` +
          `Re-run against a fresh database, or pass --allow-nonempty to insert alongside ` +
          `(existing primary keys are left untouched).`
      );
    }

    if (!args.apply) {
      console.log("[migrate] dry run complete — nothing was written. Re-run with --apply.");
      return;
    }

    // One transaction for the whole copy: a failure half way leaves the target
    // exactly as it was, rather than a partial dataset that looks migrated.
    await dst.transaction(async (tx) => {

      for (const p of plan) {
        const dstCols = await targetColumns(dst, p.table);
        const dstByName = new Map(dstCols.map((c) => [c.name, c]));
        const cols = p.columns;
        const colList = cols.map((c) => `"${c}"`).join(", ");
        let total = 0;
        let offered = 0;
        let cursor = 0;

        for (;;) {
          const rows = await src.all<Record<string, unknown>>(
            `SELECT rowid AS __rowid, ${cols.join(", ")} FROM ${p.table} WHERE rowid > ? ORDER BY rowid LIMIT ?`,
            [cursor, READ_BATCH]
          );
          if (rows.length === 0) break;
          cursor = Number(rows[rows.length - 1].__rowid);

          for (let i = 0; i < rows.length; i += WRITE_BATCH) {
            const chunk = rows.slice(i, i + WRITE_BATCH);
            const params: SqlParam[] = [];
            const tuples: string[] = [];
            for (const row of chunk) {
              tuples.push(`(${cols.map(() => "?").join(", ")})`);
              for (const c of cols) params.push(coerce(row[c], dstByName.get(c)!));
            }
            // ON CONFLICT DO NOTHING makes a re-run safe and makes
            // --allow-nonempty additive rather than destructive.
            // Count what PostgreSQL actually inserted, not what was offered —
            // ON CONFLICT DO NOTHING silently drops rows that already exist, and
            // reporting the offered count would overstate the migration.
            const res = await tx.run(
              `INSERT INTO ${p.table} (${colList}) VALUES ${tuples.join(", ")} ON CONFLICT DO NOTHING`,
              params
            );
            total += res.changes;
            offered += chunk.length;
          }
        }

        const skipped = offered - total;
        console.log(
          `[migrate] copied ${String(total).padStart(8)} rows → ${p.table}` +
            (skipped > 0 ? `  (${skipped} already present, left as-is)` : "")
        );

        // SERIAL columns keep their own sequence, which explicit id inserts do
        // not advance. Without this the next INSERT collides on the primary key.
        for (const c of dstCols.filter((x) => x.isSerial)) {
          await tx.run(
            `SELECT setval(pg_get_serial_sequence(?, ?),
                           COALESCE((SELECT MAX("${c.name}") FROM ${p.table}), 1),
                           (SELECT MAX("${c.name}") IS NOT NULL FROM ${p.table}))`,
            [p.table, c.name]
          );
          console.log(`[migrate]   sequence resynced: ${p.table}.${c.name}`);
        }
      }

    });

    console.log("");
    let mismatch = false;
    for (const p of plan) {
      const dstCount = Number((await dst.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${p.table}`))?.n ?? 0);
      const ok = dstCount >= p.rows;
      if (!ok) mismatch = true;
      console.log(
        `[migrate] verify ${p.table.padEnd(22)} source ${String(p.rows).padStart(8)} → target ${String(dstCount).padStart(8)} ${ok ? "ok" : "MISMATCH"}`
      );
    }

    if (mismatch) {
      throw new Error("row counts do not match after migration — do not cut over");
    }
    console.log("");
    console.log("[migrate] done. The server is still using the source database.");
    console.log("[migrate] Point DATABASE_URL at PostgreSQL in the deploy repo to cut over,");
    console.log("[migrate] keeping ENCRYPTION_KEY unchanged or every migrated credential breaks.");
  } finally {
    await src.close();
    await dst.close();
  }
}

// Only run when invoked directly. Importing this module (the unit tests do)
// must never kick off a migration.
if (require.main === module) {
  main().catch((err) => {
    console.error("[migrate] FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
