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
