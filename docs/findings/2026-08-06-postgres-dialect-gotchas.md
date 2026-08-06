# 2026-08-06 — PostgreSQL support: what the adapter has to paper over

Adding a second SQL backend behind `DbAdapter` is mostly mechanical. These are
the parts that are not, recorded so the next person does not rediscover them
from a production stack trace.

## Booleans are not 1 and 0

The schema has genuine `BOOLEAN` columns (`users.is_admin`, `audit_log.success`).
SQLite has no boolean type, so `event.success ? 1 : 0` was correct there and had
been correct for years. PostgreSQL rejects it outright:

```
error: column "success" is of type boolean but expression is of type integer
```

This is not a warning and there is no implicit cast — every audit write would
have failed on PostgreSQL, silently in production because audit failures are
swallowed.

The fix is directional. Call sites pass a real `boolean`; `SqliteAdapter`
converts to 1/0 when binding, because better-sqlite3 refuses booleans in the
other direction ("can only bind numbers, strings, bigints, buffers, and null").
`SqlParam` includes `boolean` to make that the typed, obvious thing to write.

Note the asymmetry on read: PostgreSQL returns `true`/`false`, SQLite returns
`1`/`0`. Nothing in the codebase reads these columns today, but anything that
starts to must coerce with `Boolean(...)` rather than compare with `===`.

## `?` is not always a placeholder

Rewriting SQLite's `?` placeholders to PostgreSQL's `$1, $2, …` with
`sql.replace(/\?/g, …)` is wrong in four ways. A `?` can appear:

- inside a string literal — `WHERE path LIKE '%?%'`
- inside a quoted identifier — `SELECT "weird?col"`
- inside a comment
- as a PostgreSQL operator — JSONB `?`, `?|`, `?&`

Any of these consumes a placeholder number, so the real placeholders shift and
the query fails with `bind message supplies N parameters, but prepared statement
requires M` — but only when that particular statement runs. No current query
trips it, which is exactly why it would have been found late. `toPgParams` walks
the string and substitutes only in ordinary SQL text; `tests/db-params.test.ts`
covers each case.

## A pool is not a connection

SQLite gives statement-level atomicity for free and, being one file accessed
through one synchronous handle, made read-then-write sequences *look* safe.
`pg.Pool` does not: consecutive `pool.query()` calls may land on different
backends, so a SELECT/DELETE/INSERT sequence is three independent transactions
with two windows in between.

`rotateRefreshToken` was exactly that shape. Two concurrent presentations of the
same refresh token would both SELECT the row, both proceed, and both mint a
valid successor — single-use refresh tokens silently stop being single-use.

Two things fix it, and both are needed:

1. `DbAdapter.transaction()` — on PostgreSQL it checks out one client, issues
   `BEGIN`, and hands the callback an executor **pinned to that client**. A
   stray `db.run()` inside the callback would take a different connection and
   run outside the transaction, so the callback must use what it is given.
2. Deciding the winner on the **DELETE's row count**, not on the SELECT. Both
   callers see the row; only one `DELETE` can report `changes === 1`.

`SqliteAdapter.transaction()` needs a small serialization queue for an unrelated
reason: better-sqlite3 is synchronous, but the adapter methods are `async`, so
an `await` inside a transaction callback yields to the event loop and a second
caller could issue `BEGIN` inside the first transaction ("cannot start a
transaction within a transaction").

## Schema creation is no longer an import side effect

`db.ts` used to run its DDL at module scope, so importing `db` anywhere created
the tables. That cannot work with two dialects, so it moved into `initDb()`.

The consequence is easy to miss: **anything that used to get tables for free now
gets none**. The test suite had no tables at all on a fresh checkout until
`tests/setup.ts` was added as a vitest `setupFile`. `applySchema(adapter)` takes
the adapter explicitly so the integration suite can stand up a throwaway
database of either dialect and run exactly the production DDL against it.

## The tests were not type-checked

`packages/server/tsconfig.json` has `"include": ["src/**/*"]`. Nothing ever
type-checked `tests/`, so converting 23 source files to `async` left ~40 broken
call sites in the suite while `npm run build` stayed perfectly green — the
failure only appeared in CI's test step, which reads as a flaky-test problem
rather than a compile problem.

`tsconfig.test.json` + the `typecheck:tests` CI step close that gap. It carries
an explicit exclude list of files that were already failing before any of this;
that is recorded debt, not a design choice.

## Verifying the PostgreSQL path

`tests/db-adapter.integration.test.ts` runs the same assertions against both
backends. SQLite always runs; PostgreSQL runs only when `TEST_POSTGRES_URL` is
set and skips **loudly** otherwise. CI provides it from a `postgres:16` service
container. Locally:

```bash
docker run --rm -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:16
TEST_POSTGRES_URL=postgres://postgres:pw@127.0.0.1:5432/postgres npm run test -w @a-workbench/server
```

A skipped backend that reports success is worse than no test.
