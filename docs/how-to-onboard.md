# Onboarding Guide

## For Developers

### Prerequisites

- Node.js 20+
- Docker (optional)

### Setup

```bash
git clone <repo>
cd a-workbench
npm install
```

### Dev Workflow

```bash
npm run dev        # start all dev servers
npm run test       # run all tests
npm run lint       # check code style
npm run build      # production build
```

### Project Layout

| Directory | Purpose |
|-----------|---------|
| `packages/server/src/mcp/` | MCP transport + meta-tools |
| `packages/server/src/auth/` | OAuth + token storage |
| `packages/server/src/plugins/` | Plugin loader + registry |
| `packages/portal/src/` | React portal |
| `packages/shared/src/` | Shared types |
| `packages/plugins/` | Built-in integrations |

### Adding a Plugin

See [how-to-use.md](how-to-use.md#adding-a-plugin).

### Testing

```bash
cd packages/server
npx vitest run        # unit tests
npx vitest run --coverage  # with coverage
```

## For Admins

### Creating OAuth Apps

1. Go to each provider's developer console
2. Create OAuth app with redirect URL: `https://your-domain/callback/{integration}`
3. Copy client ID/secret into server config

### Creating Users

```bash
curl -X POST http://localhost:3000/api/admin/users \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{"id": "alice@company.com"}'
```

Returns API key (shown once).

### Audit Log

Set `AUDIT_LOG_DEST=stdout` or `AUDIT_LOG_DEST=kafka` for external logging.

## For End Users

1. Get API key from admin
2. Connect tools via portal (`/portal`)
3. Use Claude Code with MCP URL
