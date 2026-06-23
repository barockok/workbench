# Contributing to a-workbench

Thanks for your interest in contributing. This guide covers local setup,
testing, and the pull-request workflow.

## Prerequisites

- Node.js 20+
- npm
- Docker (optional, for `docker-compose up`)

## Setup

```bash
git clone https://github.com/<your-fork>/workbench.git
cd workbench
cp .env.example .env   # fill in required values
npm install
npm run dev            # start dev servers
```

This is a TypeScript monorepo orchestrated with Turbo:

```
packages/
  shared/   # shared types + schemas
  server/   # Fastify + MCP + auth + plugins
  portal/   # React connection-management UI
  plugins/  # built-in integrations (jira, slack, github, ...)
```

## Workflow

1. Fork the repo and create a branch off `main`.
2. Make your change. Add or update tests.
3. Run the checks below — all must pass.
4. Open a pull request with a clear description of the change and its rationale.

## Checks

Run before pushing:

```bash
npm run lint     # lint
npm run test     # unit tests (vitest)
npm run build    # type-check + build all packages
```

CI runs the same checks on every PR. PRs that fail CI will not be merged.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(slack): add reaction tool
fix(oauth): handle form-encoded token response
chore: bump deps
docs: clarify onboarding steps
```

Scope is the affected package or plugin. Keep the subject under ~72 chars.

## Adding a Plugin

Plugins live under `packages/plugins/<name>/` with a `manifest.ts` and a
`tools/` directory. See an existing plugin (e.g. `packages/plugins/slack`) as a
template and `docs/how-to-onboard.md` for the full walkthrough. New external
integrations should:

- Read all secrets from environment / per-user OAuth — never hardcode.
- Validate user-supplied URLs and reject internal/RFC-1918 hosts.
- Ship tests under `packages/server/tests/`.

## Reporting Bugs & Requesting Features

Open a GitHub issue. For security vulnerabilities, **do not** open a public
issue — follow [SECURITY.md](SECURITY.md) instead.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
