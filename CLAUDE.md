# a-workbench

Self-hosted MCP tool aggregator for AI agents. Connects to SaaS tools via per-user OAuth. Extensible via plugin SDK.

## Quick Links

- **Design Spec:** `docs/architecture.md`
- **Usage Guide:** `docs/how-to-use.md`
- **Onboarding:** `docs/how-to-onboard.md`
- **Findings:** `docs/findings/` — ongoing discoveries recorded here

## Architecture

Monorepo: TypeScript, Fastify + MCP SDK, React portal, SQLite or PostgreSQL.

See [docs/architecture.md](docs/architecture.md) for full details.

## Stack

| Layer | Tech |
|-------|------|
| Server | Fastify + MCP TypeScript SDK |
| Portal | Vite + React + TanStack Query |
| Database | SQLite or PostgreSQL (encrypted tokens) |
| Auth | OAuth 2.0 (DIY flows) |
| Plugins | TypeScript (dynamic import) |
| Deployment | Docker Compose |

## Commands

```bash
npm install      # install deps
npm run dev      # start dev servers
npm run test     # run tests
npm run build    # build all packages
```

## Public Repo Hygiene

This repo is **public**. History is published too — a leak in any commit is permanent.
Before staging/committing, scrub. Never commit:

- **Personal PII** — real names, emails, phone numbers. Test fixtures use synthetic
  values only: `Test User`, `dev@example.com`, `acme`/`demo-repo`.
- **Internal/company refs** — company names, internal project/service names,
  internal hostnames, IPs, infra endpoints (k8s/CD/secrets-manager), Jira keys,
  Slack workspace IDs. Generic examples only: `example.com`, `acme`.
- **Secrets** — keys, tokens, OAuth client secrets, passwords. All secrets come from
  env vars; `.env.example` holds placeholders only. Never hardcode, even in tests
  (use obvious fakes like `gsecret`, `tok-abc`).
- **Internal-only refs in code** — RFC-1918 / `.internal` URLs are fine ONLY as SSRF
  test fixtures (asserting they get blocked).

Pre-commit check:

```bash
git diff --cached | grep -inIE '<company>|<internal-project>|@(icloud|gmail)\.com|<real-name>'
```

**No AI co-authorship.** Never add a `Co-Authored-By:` or "Generated with …" trailer naming Claude/Anthropic to commits or PRs, and never commit under an AI author identity. The `.githooks/commit-msg` hook enforces this — enable once per clone:

```bash
git config core.hooksPath .githooks
```

If publishing existing history, also purge stray blobs (e.g. committed `node_modules`)
with `git filter-repo`.

## Project Structure

```
packages/
  shared/        # shared types + schemas
  server/        # Fastify + MCP + auth + plugins
  portal/        # React connection management UI
  plugins/       # built-in integrations (jira, slack, etc.)
docs/
  architecture.md
  how-to-use.md
  how-to-onboard.md
  findings/      # ← record new findings here
```

## Recording Findings

When you learn something non-obvious:

1. Create `docs/findings/YYYY-MM-DD-<topic>.md`
2. One finding per file
3. Link from relevant code comments if applicable
4. Update this section index below

### Findings Index

- [2026-05-30 abandoned cookie session leak](docs/findings/2026-05-30-abandoned-cookie-session-leak.md) — headless chromium + tmpdir leak on abandoned login; resolved by connect reaper
- [2026-05-30 capture zero cookies marks connected](docs/findings/2026-05-30-capture-zero-cookies-marks-connected.md) — capture with 0 cookies called markConnected, producing hollow CONNECTED state; capture now 400s on zero cookies
- [2026-05-30 relative PLUGINS_DIR import](docs/findings/2026-05-30-relative-plugins-dir-import.md) — relative PLUGINS_DIR reached import() as a bare specifier → 14 ERR_MODULE_NOT_FOUND on container boot; loader now resolves absolute + skips built-ins
- [2026-05-31 MCP OAuth 2.1](docs/findings/2026-05-31-mcp-oauth.md) — state-ticket SSO resumption (nonce keyed by full state), httpOnly login-CSRF binding, and the api-key vs OAuth-Bearer two-token model for /mcp
- [2026-05-31 root chromium needs --no-sandbox](docs/findings/2026-05-31-root-chromium-no-sandbox.md) — cookie-auth capture failed in the container (`fetch failed` on the CDP port); chromium refuses to run as root without `--no-sandbox`; added it + `--disable-dev-shm-usage`
- [2026-05-31 cookie domain scoping](docs/findings/2026-05-31-cookie-domain-scoping.md) — multi-subdomain cookie capture swept in sibling-host + short-lived junk; replaying all cookies to every host → proxy 400 (header too large) / empty-session. Scope cookies to target host (browser-like); liveness = ≥1 live cookie, not "none expired"
- [2026-06-09 chromium singleton lock stale](docs/findings/2026-06-09-chromium-singleton-lock-stale.md) — chromium exit 21 ("profile in use … on another computer") after a pod rollout; dead pod left SingletonLock on the shared profile PVC; clear stale Singleton* files before spawn
- [2026-06-10 empty JSON body on bodyless POST](docs/findings/2026-06-10-empty-json-body-bodyless-post.md) — portal cookie capture/cancel 400'd (FST_ERR_CTP_EMPTY_JSON_BODY) after the body was dropped but Content-Type: application/json stayed; use authHeaders() (no content-type) for bodyless POSTs
- [2026-06-14 self-hosted instance oauth](docs/findings/2026-06-14-self-hosted-instance-oauth.md) — per-connection `instance` URL (GitLab cloud + self-hosted): manifest `OAuthConfig.instance`, `connections.config`/`pending_auth.config`, `resolveOAuthUrls` origin-swap for authorize/token/refresh, `ctx.getConfig()` for tool API base, portal connect-time prompt
- [2026-06-12 builtin tools round review](docs/findings/2026-06-12-builtin-tools-round-review.md) — all built-in handlers raw-passthrough `res.json()`; jira boards 401 (missing Agile scope), jira/gmail list return bare IDs, jira project_types ships base64 icons; sheets search query unescaped; fix priorities listed
- [2026-06-12 builtin tools coverage gaps](docs/findings/2026-06-12-builtin-tools-coverage-gaps.md) — create-but-can't-follow-up pattern (github/asana/bitbucket ship entry-point writes, no lifecycle); github missing whole PR review loop; jira can't transition status; gmail can't reply in thread; sheets overwrite-only; build order listed
- [2026-06-12 confluence v1 content GET removed](docs/findings/2026-06-12-confluence-v1-content-get-removed.md) — `confluence_get_page` 410s (v1 `GET /rest/api/content/{id}` removed by Atlassian; auth fine); fix = CQL `id=` search like the `listSpaces` workaround; create/update/delete same family, untested. **Superseded by the 2026-06-22 v2 migration.**
- [2026-06-22 confluence v2 migration](docs/findings/2026-06-22-confluence-v2-migration.md) — whole Confluence integration moved off the removed v1 content API to REST v2 (`/wiki/api/v2/pages|spaces`); MCP tool contracts unchanged; internal spaceKey↔spaceId resolver; granular scopes (`read|write|delete:page:confluence`, `read:space:confluence`) → **users must reconnect**; search stays CQL (`/wiki/rest/api/search`)
- [2026-06-14 github token form-encoded](docs/findings/2026-06-14-github-token-form-encoded.md) — GitHub token endpoint returns form-urlencoded by default → `response.json()` threw "Unexpected token" on connect; fix = send `Accept: application/json` in `exchangeCode()`
- [2026-06-11 slack user-token oauth](docs/findings/2026-06-11-slack-user-token-oauth.md) — Slack reads `scope` as bot scopes (user scopes go in `user_scope`), nests the user token under `authed_user.access_token`, and returns errors as 200 {ok:false}; files.upload dead for new apps → external upload flow; search.all is user-token-only
- [2026-06-14 slack file download](docs/findings/2026-06-14-slack-file-download.md) — `slack_download_file` needs `files:read`; no-access returns 200 + login HTML (not 403), guard on `text/html`; ctx.http OAuth branch has NO host guard, so the tool allowlists slack hosts before sending the Bearer and drops it on the presigned-CDN redirect hop
- [2026-06-14 ci pipeline triggers](docs/findings/2026-06-14-ci-pipeline-triggers.md) — trigger/poll/rerun/cancel for GitHub Actions (workflow_dispatch needs `on:`, returns 204 no run-id → poll), GitLab Pipelines (`variables` = `[{key,value}]`), Bitbucket Pipelines (trailing-slash POST, needs `pipeline`+`pipeline:write` scope → reconnect); github/gitlab no scope change
- [2026-06-18 apikey auth + New Relic](docs/findings/2026-06-18-apikey-auth-and-newrelic.md) — wired the previously-unused `apikey` auth path end-to-end (manifest `fields[]` w/ one `secret`, secret→token + rest→config, `ctx.http` sets `headerName` verbatim no Bearer, portal `ApiKeyAuthModal`); New Relic plugin = NerdGraph (region-scoped endpoint via `ctx.getConfig().region`); legacy alert-channel mutations are best-effort/untested
- [2026-08-03 bitbucket pr author reviewer bug](docs/findings/2026-08-03-bitbucket-pr-author-reviewer-bug.md) — `bitbucket_create_pr` fails silently when PR author included in reviewers; added validation to filter author, documented upsert behavior
- [2026-08-06 browser profile disk growth](docs/findings/2026-08-06-browser-profile-disk-growth.md) — persistent profiles filled 88% of the volume shared with `tokens.db` (2.9G of it duplicate Safe Browsing blocklists); nothing ever reclaimed them — a regression of the 2026-05-30 leak fix after profiles moved from tmpdir to per-user. Fix = disk-discipline spawn flags + cache trim on exit + `reapProfileDisk` sweep; storage-latency theory measured and refuted
- [2026-08-06 postgres dialect gotchas](docs/findings/2026-08-06-postgres-dialect-gotchas.md) — what a second SQL backend forces you to handle: BOOLEAN columns reject 1/0 on PostgreSQL, `?` is not always a placeholder (string literals, JSONB operators), a pooled connection breaks read-then-write atomicity (refresh-token rotation), schema init stops being an import side effect, and `tests/` was never type-checked
