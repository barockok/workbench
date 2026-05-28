# a-workbench

[![CI](https://github.com/barockok/workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/barockok/workbench/actions)
[![codecov](https://codecov.io/gh/barockok/workbench/branch/main/graph/badge.svg)](https://codecov.io/gh/barockok/workbench)

Self-hosted MCP tool aggregator for AI agents.

## Features

- **Meta-tool pattern** — 5 static tools, unlimited integrations
- **Plugin SDK** — easy to add new integrations
- **Per-user OAuth** — secure token storage with AES-256-GCM
- **React portal** — connection management UI
- **Pluggable audit log** — SQLite, stdout, or Kafka

## Quick Start

```bash
# Setup
cp .env.example .env
npm install

# Dev
npm run dev

# Test
npm run test

# Build
npm run build

# Docker
docker-compose up -d
```

## Configuration

Copy `.env.example` to `.env` and fill in the required values. See [docs/architecture.md](docs/architecture.md) for details on each variable.

### Google Workspace SSO (optional)

To enable Google Sign-In:

1. Create OAuth 2.0 credentials in [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Add `http://localhost:5173/auth/google/callback` as an authorized redirect URI
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in your `.env`
4. Set `SESSION_SECRET` to a random 32+ character string for JWT signing

## Architecture

See [docs/architecture.md](docs/architecture.md).

## Usage

See [docs/how-to-use.md](docs/how-to-use.md).

## Onboarding

See [docs/how-to-onboard.md](docs/how-to-onboard.md).

## Adding a Plugin

```typescript
// plugins/my-integration/manifest.ts
export default {
  name: "my-integration",
  version: "1.0.0",
  auth: { type: "none" },
};
```

## TODO

- [ ] Admin docs: how to get credentials (Google app ID, Slack token, Jira OAuth, etc.)
- [ ] Claude skill: `/run-workbench` — start local dev server
- [ ] Claude skill: `/new-plugin` — scaffold new integration plugin
- [ ] Claude skill: `/deploy-workbench` — deploy to production

## License

MIT
