# a-workbench

## Goal
Self-hosted MCP tool aggregator for AI agents (Claude Code, etc.) with per-user OAuth.

## Status
- **Phase:** Implementation complete
- **Spec:** `docs/superpowers/specs/2026-05-27-internal-mcp-aggregator-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-27-a-workbench.md`

## What's Done
- [x] Monorepo scaffolding (turbo)
- [x] Shared types + schemas + tests
- [x] Server: Fastify + MCP SDK + meta-tools
- [x] Auth: OAuth flow, token storage (AES-256-GCM), user management
- [x] Plugin system: registry, loader, context
- [x] Audit log: pluggable (sqlite/stdout/kafka)
- [x] Portal: React + Vite + TanStack Query
- [x] Docker: multi-stage Dockerfile + docker-compose
- [x] CI/CD: GitHub Actions (test + Docker build + release)
- [x] README with badges + codecov.yml (90% target)
- [x] /prep-release slash command
- [x] Sample OAuth app for testing
- [x] CLAUDE.md + docs (architecture, usage, onboarding)
- [x] Tests: 15 passing across 6 test files

## Git History
```
1ca6034 fix: config accepts test env, ensure data dir exists
a3d7574 chore: add sample-oauth to docker-compose
486dfbd feat: add tests and sample OAuth app
be7c268 feat: implement core server, portal, docker, ci/cd
774f5f4 chore: add .gitignore, remove node_modules from git
4e30310 feat(shared): add types, schemas, and tests
a252780 docs: add CLAUDE.md, architecture, usage, onboarding
b8d73bf chore: init monorepo with turbo
```

## Stats
- 101 files
- 8 commits
- 15 tests passing
- 6 test files

## Commands
```bash
cd workspace/a-workbench
npm install              # install deps
ENCRYPTION_KEY=$(openssl rand -hex 32) npm run test  # run tests
npm run build            # production build
docker-compose up -d     # run with Docker
```

## Project Structure
```
a-workbench/
├── packages/
│   ├── shared/            # shared types + schemas
│   ├── server/            # Fastify + MCP + auth + plugins
│   ├── portal/            # React connection management UI
│   └── sample-oauth/      # test OAuth provider
├── .github/workflows/     # CI/CD
├── .claude/commands/      # /prep-release slash command
├── docs/                  # architecture, usage, onboarding
├── docker-compose.yml
├── Dockerfile
├── codecov.yml
└── README.md
```
