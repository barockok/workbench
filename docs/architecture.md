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

Static MCP meta-tools:

| Tool | Purpose |
|------|---------|
| `search_tools` | Keyword search across all plugin tools |
| `get_tool_schema` | Get a tool's input schema as portable JSON Schema |
| `execute_tool` | Execute a tool by slug with args |
| `execute_tools` | Execute many tools in one call (bounded-concurrent, ordered results, per-item error isolation) |
| `whoami` | Return the current authenticated user (id + email); identity only, not connected integrations |
| `list_integrations` | List all integrations + connection status |
| `connect` / `wait_for_connection` | Start a connection (OAuth/cookie) and block until it completes |
| `get_auth_url` | Deprecated alias of `connect` |

These 8 are the only top-level MCP tools. Everything else — integration tools *and* the internal `browser`/`jots` plugins — lives in the registry and is reached via `search_tools` → `execute_tool` (since v0.12.0).

Tool results returned as text are capped at 60k chars; oversized results are truncated with a notice telling the caller to narrow the request (limit/fields/pagination).

### Internal plugins (registry, not `PLUGINS_DIR`)

| Tools | Purpose |
|------|---------|
| `browser_navigate` / `browser_screenshot` / `browser_read_text` | Drive the warm per-user Chromium (owned by `browser-session.ts`): navigate, view (downscaled JPEG, change-detected), read page text |
| `browser_click` / `browser_type` / `browser_key` / `browser_scroll` | Computer-use input into the warm session |
| `browser_live_url` / `browser_close` | Human watch-and-take-over link; end the session |
| `deploy_jot` / `list_jots` / `delete_jot` | `deploy_jot` returns a single-use upload URL (~5 min TTL); the client uploads the site as a gzip tarball (`tar czf - -C dir . \| curl --data-binary @- <uploadUrl>`), extracted + published at `/j/<name>/` (≤5 MiB decompressed, ≤1000 files; symlinks/traversal entries rejected). `list_jots`/`delete_jot` operate on your own. Global namespace, creator-locked writes, account-less viewing. Jot pages are sandboxed (CSP opaque origin) so they can't reach app cookies/APIs — keep them self-contained |

### Shared Browser Session

There is **one** per-user Chromium process, owned by `browser-session.ts`. Both browser-use driving (the `browser_*` tools above) and cookie-auth connect operate on that single warm session. Connecting a cookie integration always opens the login live view (it never auto-connects from existing session cookies — re-login re-verifies the session); the actual capture happens when the user clicks **Capture**, which reads live cookies via `Storage.getCookies` over the shared session's CDP endpoint, filtered to the integration's target domains. Capture does not spawn a second browser or tear the session down. The idle reaper (controlled by `BROWSER_SESSION_TTL_SECONDS`) owns the Chromium lifecycle.

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

### MCP Authorization (OAuth 2.1)

a-workbench acts as both the resource server and the authorization server for the `/mcp` endpoint, implementing OAuth 2.1 with Dynamic Client Registration (RFC 7591) so MCP clients need no pre-shared credentials. Authorization Code + PKCE (S256 only) is the sole supported grant; user authentication is delegated to the existing Google SSO flow, keeping identity management out of the authorization server. Access tokens are short-lived JWTs scoped to the audience `<SERVER_PUBLIC_URL>/mcp`; refresh tokens are opaque, single-use, and rotated on every redemption.

`/mcp` accepts two authentication modes: `Authorization: Bearer <access-token>` for interactive OAuth clients, and the `x-workbench-api-key` header for headless or non-interactive clients. A request that arrives with no valid credential receives a JSON-RPC 401 with a `WWW-Authenticate` header pointing to the resource metadata document, which is the standard entry-point for client discovery.
