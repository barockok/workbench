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
- **Public release hardening** — added `LICENSE` (MIT), `SECURITY.md` (GitHub Security Advisories as the sole vuln-report channel), and `CONTRIBUTING.md`. Scrubbed personal PII and internal references from docs and test fixtures. Added public-repo hygiene guard to `CLAUDE.md`. Removed internal `staging-dir/` staging reports.
- **Test coverage** — extended Bitbucket tool tests to cover `get_users` and the reviewer option on PR creation.

## Commits

- `feat(auth): add Keycloak OIDC provider` (dc82bdf)
- `chore: add tool get users and default reviewer` (e2f1735)
- `chore: add reviewer opt when creating pr` (ec130f6)
- `chore: add commit-msg hook blocking AI co-authorship` (ffcca84)
- `docs: add LICENSE, SECURITY.md, CONTRIBUTING.md for public release` (b79f742)
- `chore: scrub personal PII and internal refs for public release` (53f8098)

**Full diff:** https://github.com/barockok/workbench/compare/v0.18.0...v0.19.0
