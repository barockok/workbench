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
- [x] Tests: 18 passing across 7 test files
- [x] **Plugins: Google (25 tools)**
- [x] **Plugins: Atlassian — Jira (6), Confluence (6), Bitbucket (5)**
- [x] **Plugins: Asana (5)**
- [x] **Plugins: GitHub (9)**
- [x] **Plugins: Slack (12)**
- [x] **Gap closure: 68 tools total (was 31)**
- [x] **Telemetry: OpenTelemetry tracing**
- [x] **Cookie auth: HITL browser-based authentication with Playwright**
- [x] **Sample plugin: httpbin-cookie for testing cookie auth flow**

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
- 130+ files
- 16 commits
- 33 tests passing
- 9 test files
- 8 built-in plugins
- 71 tools total

## Commands
```bash
cd workspace/a-workbench
npm install              # install deps
npm run test             # run tests (auto-sets test env)
npm run build            # production build
docker-compose up -d     # run with Docker
```

## Project Structure
```
a-workbench/
├── packages/
│   ├── shared/            # shared types + schemas
│   ├── server/            # Fastify + MCP + auth + plugins + telemetry
│   ├── portal/            # React connection management UI
│   └── sample-oauth/      # test OAuth provider
├── packages/plugins/      # built-in integrations
│   ├── google/            # Gmail, Drive, Sheets, Calendar, Gemini
│   ├── atlassian-jira/    # createIssue, searchIssues, getIssue
│   ├── atlassian-confluence/  # createPage, searchPages
│   ├── atlassian-bitbucket/   # listRepos, createPR
│   ├── asana/             # createTask, listTasks
│   ├── github/            # listRepos, createIssue, createPR
│   └── httpbin-cookie/    # sample cookie-auth plugin (getCookies, setCookie, getHeaders)
├── .github/workflows/     # CI/CD
├── .claude/commands/      # /prep-release slash command
├── docs/                  # architecture, usage, onboarding
├── docker-compose.yml
├── Dockerfile
├── codecov.yml
└── README.md
```
