# Architecture

## High-Level

```
┌─────────────────────────────────────────┐
│  MCP Server (Fastify)                   │
│  ├─ MCP transport    (/mcp)             │
│  ├─ API endpoints    (/api/*)           │
│  ├─ React SPA        (/portal/*)        │
│  └─ OAuth callbacks  (/callback/*)      │
│                                         │
│  ┌─────────────┐  ┌─────────────┐       │
│  │  Registry   │  │ Auth Manager│       │
│  │  (tools)    │  │ (OAuth)     │       │
│  └─────────────┘  └─────────────┘       │
│         │                │              │
│  ┌──────┴────────┐  ┌────┴─────┐       │
│  │  Plugin SDK   │  │  Token   │       │
│  │  (Jira, etc.) │  │  Store   │       │
│  └───────────────┘  └──────────┘       │
│                                         │
└─────────────────────────────────────────┘
                    │
                    ▼
            ┌──────────────┐
            │  SQLite      │
            │  (encrypted) │
            └──────────────┘
```

## Meta-Tools

5 static MCP tools:

| Tool | Purpose |
|------|---------|
| `search_tools` | Keyword search across all plugin tools |
| `get_tool_schema` | Get input schema for a specific tool |
| `execute_tool` | Execute a tool by slug with args |
| `list_integrations` | List all integrations + connection status |
| `get_auth_url` | Generate OAuth URL for an integration |

## Plugin SDK

Each integration is a self-contained plugin:

```
plugins/jira/
├── manifest.ts          # name, version, auth + optional displayName/description/logo/categories
├── logo.svg             # optional bundled logo (served at /api/integrations/<name>/logo)
├── tools/
│   ├── create_issue.ts  # schema + handler
│   └── search_issues.ts # schema + handler
└── client.ts            # optional API client
```

### Handler Context

```ts
interface ToolContext {
  userId: string;
  getToken(): Promise<string>;     // auto-refreshed
  http(url, init): Promise<Response>; // with auth, retry, rate limit
}
```

## Auth Flow

```
User: "create jira ticket"
Claude: execute_tool("jira_create_issue", {...})
MCP: { error: "NOT_CONNECTED", integration: "jira" }

Claude: get_auth_url("jira")
MCP: { url: "https://auth.atlassian.com/authorize?..." }

User: opens URL → authorizes → callback stores token

User: retry "create jira ticket"
Claude: execute_tool("jira_create_issue", {...})
MCP: success
```

## Data Flow

1. Claude Code connects to `/mcp` with bearer token
2. Server verifies token → maps to `user_id`
3. `execute_tool` checks connection → fetches encrypted token
4. Plugin handler calls external API with token
5. Result returned to Claude

## Security

- Tokens encrypted at rest (AES-256-GCM)
- Per-user OAuth (not service account)
- CSRF protection on OAuth (state parameter)
- API key auth on all endpoints
- Audit log: sqlite/stdout/kafka
