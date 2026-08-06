/**
 * Vitest setup — creates the schema before any test runs.
 *
 * Schema creation used to be a side effect of importing `src/db`; it now lives
 * behind `initDb()` so the PostgreSQL path can run its own DDL. Tests get no
 * tables at all unless something calls it, and on a fresh checkout (CI) that
 * surfaces as `no such table: users` in every DB-touching suite.
 *
 * `initDb()` is idempotent (CREATE TABLE IF NOT EXISTS + guarded migrations),
 * so running it once per test file is free.
 */
import { beforeAll } from "vitest";
import { initDb } from "../src/db";

beforeAll(async () => {
  await initDb();
});
