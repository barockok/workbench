# a-workbench

## Goal
Self-hosted MCP tool aggregator for AI agents (Claude Code, etc.) with per-user OAuth.

## Status
- **Phase:** Implementation complete
- **Spec:** `docs/superpowers/specs/2026-05-27-internal-mcp-aggregator-design.md`
- **Plan:** `docs/superpowers/plans/2026-05-27-a-workbench.md`

## What's Done
- ✅ Monorepo scaffolding (turbo)
- ✅ Shared types + schemas + tests
- ✅ Server: Fastify + MCP SDK + meta-tools
- ✅ Auth: OAuth flow, token storage (AES-256-GCM), user management
- ✅ Plugin system: registry, loader, context
- ✅ Audit log: pluggable (sqlite/stdout/kafka)
- ✅ Portal: React + Vite + TanStack Query
- ✅ Docker: multi-stage Dockerfile + docker-compose
- ✅ CI/CD: GitHub Actions (test + Docker build + release)
- ✅ README with badges + codecov.yml (90% target)
- ✅ /prep-release slash command
- ✅ Sample OAuth app for testing
- ✅ CLAUDE.md + docs (architecture, usage, onboarding)

## Git History
- `chore: init monorepo with turbo`
- `docs: add CLAUDE.md, architecture, usage, onboarding`
- `feat(shared): add types, schemas, and tests`
- `feat: implement core server, portal, docker, ci/cd`
- `feat: add tests and sample OAuth app`
- `chore: add sample-oauth to docker-compose`

## Next Steps
- Install deps and run tests
- Add built-in plugins (jira, slack, google)
- Verify Docker build works
- Push to GitHub
