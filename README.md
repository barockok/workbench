# a-workbench

[![CI](https://github.com/YOUR_ORG/a-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_ORG/a-workbench/actions)
[![codecov](https://codecov.io/gh/YOUR_ORG/a-workbench/branch/main/graph/badge.svg)](https://codecov.io/gh/YOUR_ORG/a-workbench)

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
npm install

# Dev
npm run dev

# Test
npm run test

# Docker
docker-compose up -d
```

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

## License

MIT
