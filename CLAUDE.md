# a-workbench

Self-hosted MCP tool aggregator for AI agents. Connects to SaaS tools via per-user OAuth. Extensible via plugin SDK.

## Quick Links

- **Design Spec:** `docs/architecture.md`
- **Usage Guide:** `docs/how-to-use.md`
- **Onboarding:** `docs/how-to-onboard.md`
- **Findings:** `docs/findings/` — ongoing discoveries recorded here

## Architecture

Monorepo: TypeScript, Fastify + MCP SDK, React portal, SQLite.

See [docs/architecture.md](docs/architecture.md) for full details.

## Stack

| Layer | Tech |
|-------|------|
| Server | Fastify + MCP TypeScript SDK |
| Portal | Vite + React + TanStack Query |
| Database | SQLite (encrypted tokens) |
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
