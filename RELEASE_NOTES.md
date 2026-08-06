# a-workbench v0.22.0

_2026-08-06_

Headline: **A migration path onto PostgreSQL — v0.21.0 made the backend selectable, this brings the data across.**

## Features

- **`migrate/sqlite-to-postgres`** — a one-shot data migration, run by hand inside the container against an idle instance. Without it, pointing `DATABASE_URL` at a PostgreSQL server gives that server an empty schema: every user is logged out of every cookie-auth integration and has to reconnect. (`packages/server/src/migrate/`)

```bash
# dry run by default — writes nothing without --apply
TARGET_DATABASE_URL=postgres://user:pass@host:5432/workbench \
  tsx server/migrate/sqlite-to-postgres.js

TARGET_DATABASE_URL=postgres://user:pass@host:5432/workbench \
  tsx server/migrate/sqlite-to-postgres.js --apply
```

  Credentials may instead come from the standard libpq variables (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`). The source defaults to `DATABASE_URL` while it still names a file, else `/data/tokens.db`; override with `SOURCE_SQLITE_PATH`.

  It creates the target schema with `applySchema()` — the same function the server runs at boot, so it cannot drift from a second copy of the DDL. Columns are discovered by intersecting `PRAGMA table_info` with `information_schema` rather than hardcoded, and any column present only in the source is **reported**, not silently dropped. Values are coerced per target column type: SQLite's 0/1 becomes a real boolean, and a BLOB becomes BYTEA even when TEXT affinity handed back a string. The whole copy runs in one transaction, `SERIAL` sequences are resynced afterwards (explicit id inserts do not advance them, so without this the next `INSERT` collides on the primary key), and row counts are verified per table before it reports success.

  Safety: dry run unless `--apply`; refuses a non-empty target unless `--allow-nonempty`; never writes to the source; redacts the password before logging the connection string; `--skip=a,b` to omit tables.

## Config

No new environment variables. The migration reads `TARGET_DATABASE_URL` or the libpq variables only while it runs.

**Upgrade note.** Nothing changes for existing deployments — this adds a tool, not a behaviour. **`ENCRYPTION_KEY` must not change across a migration:** tokens and cookies are stored encrypted and are copied as ciphertext, so a different key on the instance that later points at PostgreSQL makes every migrated credential undecryptable — exactly the mass reconnect the migration exists to avoid.

## Tests

- `packages/server/tests/migrate-plan.test.ts` — 27 tests over the pure half (argument parsing, source/target resolution, credential percent-encoding, password redaction, every coercion branch). The planning logic lives in `migrate/plan.ts`, which imports nothing from `../db`, so testing a string helper does not require a database.
- The I/O half needs both engines running and is exercised by running the script; the dry-run default exists so the first attempt is free.

## Docs

- `docs/how-to-use.md` — "Moving an existing instance to PostgreSQL", including why `DATABASE_URL` alone is not a migration.

**Full diff:** https://github.com/barockok/workbench/compare/v0.21.0...v0.22.0

---

# a-workbench v0.21.0

_2026-08-06_

Headline: **PostgreSQL is now a supported backend — set `DATABASE_URL` to a `postgres://` URL and nothing else changes.**

## Features

- **`DbAdapter` with SQLite and PostgreSQL implementations** — `exec`/`run`/`get`/`all`/`transaction`/`close`, all async. `DATABASE_URL` picks the backend: `postgres://` or `postgresql://` selects PostgreSQL, anything else is a SQLite file path, so existing deployments are untouched. SQL is written once in SQLite's `?` placeholder style; the PostgreSQL adapter renumbers placeholders on the way out. (`packages/server/src/db-adapter.ts`, `db-sqlite.ts`, `db-postgres.ts`)
- **Dialect-aware schema and migrations** — `BYTEA`/`BLOB`, `SERIAL`/`AUTOINCREMENT`, `EXTRACT(EPOCH FROM NOW())::INTEGER`/`unixepoch()`, `STRING_AGG`/`GROUP_CONCAT`, and `ADD COLUMN IF NOT EXISTS` vs guarded try/catch. Applied by `initDb()` at startup, or `applySchema(adapter)` against any adapter.
- **`transaction()`** — runs a callback atomically. On PostgreSQL it checks out one pooled client and pins every statement in the callback to it; on SQLite it serializes transactions against each other, which async methods over a synchronous driver otherwise allow to nest.

## Fixes

- **Audit writes would have failed on every PostgreSQL instance** — `audit_log.success` is `BOOLEAN` and the insert bound `1`/`0`. PostgreSQL rejects an integer there with no implicit cast. Call sites now pass real booleans and the SQLite adapter converts when binding; `SqlParam` includes `boolean` so this is the typed, obvious thing to write. (`packages/server/src/audit/destinations.ts`)
- **Refresh tokens stopped being single-use under concurrency** — `rotateRefreshToken` was SELECT → DELETE → INSERT as three separate pool queries with no transaction, so two simultaneous presentations of one token both saw the row and both minted a valid successor. The sequence now runs in one transaction and the winner is decided by the DELETE's affected-row count rather than by the preceding SELECT. (`packages/server/src/auth/oauth-server/refresh.ts`)
- **`?` placeholder rewriting no longer corrupts SQL** — a naive global replace also consumed `?` inside string literals, quoted identifiers, comments, and PostgreSQL's own JSONB `?` / `?|` / `?&` operators, shifting every later placeholder. The rewriter now substitutes only in ordinary SQL text. (`packages/server/src/db-postgres.ts`)
- **Slack file download** — `res` could be read as possibly-undefined across redirect hops. (`packages/plugins/slack/tools/index.ts`)

## Config

| Env | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `./data/tokens.db` | SQLite file path, or a `postgres://` / `postgresql://` URL to use PostgreSQL |

**Upgrade note.** Nothing to do for existing SQLite deployments — the default is unchanged and no migration runs. There is **no data migration path** between the two backends: pointing an existing instance at PostgreSQL gives it an empty schema, and every user has to reconnect. Treat a switch as a new instance.

## Tests

- `packages/server/tests/db-adapter.integration.test.ts` — one set of assertions run against **both** backends: schema idempotency, placeholder handling, BLOB/BYTEA round trip, booleans, NULLs, schema defaults, affected-row counts, UNIQUE violations, transaction commit and rollback, and a concurrent single-winner claim. PostgreSQL runs from `TEST_POSTGRES_URL` and skips loudly without it; CI supplies a `postgres:16` service container, so both backends are exercised on every pull request.
- `packages/server/tests/db-params.test.ts` — the placeholder rewriter directly.
- `packages/server/tests/setup.ts` — a vitest `setupFile` calling `initDb()`. Schema creation moved out of a module-import side effect, so tests get no tables without it.
- `packages/server/tsconfig.test.json` + a `Typecheck tests` CI step — the build's `tsconfig.json` only covers `src/`, so the suite was never type-checked. It carries an explicit exclude list of files that were already failing; that is recorded debt, not design.

## Docs

- `docs/findings/2026-08-06-postgres-dialect-gotchas.md` — what a second SQL backend forces you to handle, including the three bugs above and why each was invisible until PostgreSQL ran.

**Full diff:** https://github.com/barockok/workbench/compare/v0.20.0...v0.21.0

---

# a-workbench v0.20.0

_2026-08-06_

Headline: **Persistent browser profiles now reclaim their own disk — they never did before.**

## Fixes

- **Browser profiles grew without bound** — nothing in the codebase ever reclaimed profile disk. `resetBrowserProfile()` is the only function that deletes one and its sole caller is a manual API route; `closeBrowserSession()` and `reapIdleSessions()` never touched disk. On a running instance this filled 88% of the volume that also holds the SQLite token database: 8.6G across 141 profiles, of which 2.85G was the Safe Browsing blocklist stored once per profile, against ~4MB per profile of actual session state. This is the 2026-05-30 abandoned-session leak returning as a disk leak — that fix reaped `mkdtemp` session dirs, profiles then moved to persistent per-user directories, and the reaper was never extended. (`packages/server/src/auth/profile-disk.ts`, `packages/server/src/auth/profile-chromium.ts`, `packages/server/src/auth/browser-session.ts`)

## Features

- **Disk-discipline spawn flags** — `--disable-background-networking` (what pulls the Safe Browsing list and component updates), `--disable-component-update`, `--disable-client-side-phishing-detection`, `--disable-sync`, `--disable-breakpad`, and a `--disk-cache-size` cap. Stops the growth at source.
- **`trimProfileCaches()` on chromium exit** — deletes caches, Safe Browsing and crash dumps; keeps cookies, local storage, IndexedDB and history. **Nobody is logged out.** Hooked on the process `exit` event rather than inside `closeBrowserSession()`, so a crashed or reaped browser is cleaned up on the same path.
- **`reapProfileDisk()` periodic sweep** — trims every profile without a live session and deletes profiles unused past `BROWSER_PROFILE_TTL_DAYS`. Staleness is read from `Default/Cookies`, not the directory mtime: trimming mutates the directory mtime, so an mtime-based reaper would reset its own clock every sweep and never expire anything.
- **Per-stage chromium spawn timings** — `prepareMs` / `devtoolsMs` / `targetMs` / `totalMs`, logged on every spawn. A single total is unactionable; the split separates chromium's own startup from our polling and from page load.

## Config

| Env | Default | Meaning |
|---|---|---|
| `BROWSER_PROFILE_TTL_DAYS` | `30` | delete a profile unused this long; `0` = never |
| `BROWSER_PROFILE_REAP_INTERVAL_SECONDS` | `3600` | sweep interval |
| `BROWSER_DISK_CACHE_MB` | `32` | per-profile HTTP cache cap |

**Upgrade note.** The first sweep runs at boot. With the default `BROWSER_PROFILE_TTL_DAYS=30`, profiles unused for 30 days are **deleted** on first run — those users are logged out of every cookie-auth integration and must reconnect. Deploy with `BROWSER_PROFILE_TTL_DAYS=0` first if you want the cache reclaim (the bulk of the space) without any logouts, then enable the TTL in a later deploy.

**Also worth checking on upgrade:** if `BROWSER_PROFILES_DIR` is unset, profiles fall back to `dirname(DATABASE_URL)/browser-profiles` and share a volume with the token database. When that volume fills, SQLite writes fail and every connection breaks. Point `BROWSER_PROFILES_DIR` at its own volume to remove the shared-fate failure mode.

## Tests

- New `packages/server/tests/profile-disk.test.ts` — trim keeps session state, trim is idempotent, staleness ignores the directory mtime, TTL deletion, live-session profiles are never touched, missing base dir.

## Docs

- `docs/findings/2026-08-06-browser-profile-disk-growth.md` — full investigation, including the storage-latency hypothesis that was measured and refuted (`ext4` on a local block device, 256 MB/s sequential, ~11ms small-file writes) so it does not get revived.

**Full diff:** https://github.com/barockok/workbench/compare/v0.19.1...v0.20.0

---

# a-workbench v0.19.1

_2026-08-03_

Headline: **Bitbucket PR author reviewer bug fix — silent failure when author included in reviewers.**

## Fixes

- **Bitbucket `create_pr` author-as-reviewer bug** — When calling `bitbucket_create_pr` with the PR author's UUID in the `reviewers` array, Bitbucket API fails silently returning `{"reviewers":[]}`. Added validation to filter out PR author from reviewers list before sending to API. (`packages/plugins/atlassian-bitbucket/tools/index.ts`)
- **Documented "upsert" behavior** — `bitbucket_create_pr` updates existing PRs when the same `sourceBranch` is used instead of creating duplicates. Updated tool description to document this behavior.

## Tests

- New unit tests for author validation logic (filter author UUID, handle braces format, warn on exclusion). (`packages/server/tests/bitbucket-tools.test.ts`)

**Full diff:** https://github.com/barockok/workbench/compare/v0.19.0...v0.19.1

---

# a-workbench v0.19.0

_2026-07-27_

Headline: **Keycloak OIDC joins Google as a configurable SSO provider, plus new Bitbucket reviewer tools.**

## Features

- **Keycloak OIDC auth provider** — operators can now wire Keycloak as an SSO option alongside (or instead of) Google. Set `KEYCLOAK_ISSUER_URL`, `KEYCLOAK_CLIENT_ID`, and `KEYCLOAK_CLIENT_SECRET` to enable it. The login page calls `/api/auth/providers` at runtime and renders only the buttons for configured providers — no code changes needed to add or remove providers. Standard OIDC discovery, JWKS token verification, and `keycloak_sub` user upsert. (`packages/server/src/auth/keycloak.ts`, `packages/server/src/api/routes.ts`, `packages/portal/src/pages/Login.tsx`)

- **Bitbucket: reviewer tools** — two new Bitbucket tools:
  - `bitbucket_get_users` — list workspace members and default reviewers for a repo.
  - `bitbucket_create_pull_request` now accepts an optional `reviewers` field to pre-assign reviewers at creation time.
  (`packages/plugins/atlassian-bitbucket/tools/index.ts`)

## Internal

- **Commit-msg hook** — `.githooks/commit-msg` blocks AI co-authorship trailers (`Co-Authored-By: Claude`, `Generated with`, etc.) from landing in commits. Enable once per clone: `git config core.hooksPath .githooks`.
- **Public release hardening** — added `LICENSE` (MIT), `SECURITY.md` (GitHub Security Advisories as the sole vuln-report channel), and `CONTRIBUTING.md`. Scrubbed personal PII and internal references from docs and test fixtures. Added public-repo hygiene guard to `CLAUDE.md`. Removed internal `uat-dir/` UAT reports.
- **Test coverage** — extended Bitbucket tool tests to cover `get_users` and the reviewer option on PR creation.

## Commits

- `feat(auth): add Keycloak OIDC provider` (dc82bdf)
- `chore: add tool get users and default reviewer` (e2f1735)
- `chore: add reviewer opt when creating pr` (ec130f6)
- `chore: add commit-msg hook blocking AI co-authorship` (ffcca84)
- `docs: add LICENSE, SECURITY.md, CONTRIBUTING.md for public release` (b79f742)
- `chore: scrub personal PII and internal refs for public release` (53f8098)

**Full diff:** https://github.com/barockok/workbench/compare/v0.18.0...v0.19.0
