# How to Use

## Running Locally

```bash
cd workspace/a-workbench
npm install
npm run dev
```

In dev, `npm run dev` runs the API server on `:3000` and the Vite portal on its own port. In production (and the Docker image) the server **serves the built portal itself** at its own origin (`SERVER_PUBLIC_URL`, default `http://localhost:3000/`).

## Getting an API key

1. Open the portal (`http://localhost:3000/`) and sign in with Google SSO.
2. In the **MCP — Access Key** panel at the top, click **Generate key**. The key is shown **once** (masked, with a Show toggle) — copy it now; only its hash is stored. Use **Regenerate** to rotate, **Revoke** to disable.

The panel also shows a ready-to-paste MCP client config (see below). The same key works as the `/mcp` `Authorization: Bearer` token for any MCP client.

## Connecting Claude Code

```bash
claude config set mcpServers.workbench '{"url": "http://localhost:3000/mcp", "headers": {"Authorization": "Bearer YOUR_API_KEY"}}'
```

Or, for any MCP client, the generic JSON the portal hands you:

```json
{
  "mcpServers": {
    "workbench": {
      "url": "http://localhost:3000/mcp",
      "headers": { "Authorization": "Bearer YOUR_API_KEY" }
    }
  }
}
```

Then use tools:

```
You: search for jira tools
Claude: search_tools("jira")

You: create a ticket
Claude: execute_tool("jira_create_issue", {project: "PROJ", summary: "Bug"})

You: connect my jira
Claude: get_auth_url("jira") → open URL → authorize → done
```

## Connecting from MCP

Use `connect` (and `wait_for_connection`) to drive the auth flow entirely from within Claude — no manual URL copy-paste needed.

1. Call `connect(integration)`. Returns `{ connectionId, type, url }`.
   - **oauth2**: `url` is the provider's consent screen. Open it in any browser and complete the OAuth grant.
   - **cookie**: `url` is a magic-link (`/connect/<integration>?t=...`). Open it in a browser to start a headless session, log in on the remote browser page, and click **Capture session**.
2. Open the `url` in a browser and complete login.
3. Call `wait_for_connection(connectionId)` — it blocks until the status is `CONNECTED`, or returns `TIMEOUT` / `EXPIRED` if the deadline passes.

Example:

```
Claude: connect("jira")
→ { connectionId: "abc123", type: "oauth2", url: "https://auth.atlassian.com/..." }

// user opens URL, completes OAuth grant

Claude: wait_for_connection("abc123")
→ { status: "CONNECTED" }
```

> `get_auth_url` is a **deprecated alias** of `connect` — it still works but returns only the URL without a `connectionId`. Prefer `connect` for new code.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Server listen port |
| `ENCRYPTION_KEY` | — | Key used to encrypt stored tokens |
| `DATABASE_URL` | `./data/tokens.db` | SQLite database path |
| `PLUGINS_DIR` | `./plugins` | Directory scanned for plugin packages |
| `AUDIT_LOG_DEST` | `sqlite` | Audit log destination (`sqlite` or `stdout`) |
| `SESSION_SECRET` | — | 32+ char secret for JWT signing |
| `PORTAL_URL` | `http://localhost:5173` | Public URL of the portal (used in redirects) |
| `PORTAL_DIST_DIR` | `./portal` | Built portal dir the server serves (resolved to `/app/portal` in the image) |
| `SERVER_PUBLIC_URL` | `http://localhost:3000` | Public URL of the server (used in OAuth callbacks) |
| `CONNECT_TTL_SECONDS` | `600` | TTL (seconds) for pending connections and abandoned cookie login sessions before the reaper closes them |
| `GOOGLE_CLIENT_ID` / `_SECRET` | — | Google Workspace SSO credentials (optional) |

## Adding a Plugin

1. Create `packages/plugins/my-integration/`:

```ts
// manifest.ts
export default {
  name: "my-integration",
  version: "1.0.0",
  auth: { type: "none" },
};

// tools/hello.ts
export const hello = {
  name: "my_hello",
  description: "Say hello",
  inputSchema: z.object({ name: z.string() }),
  handler: async (ctx, args) => `Hello ${args.name}!`,
};
```

2. Restart server. Plugin auto-loaded.

## Docker

```bash
docker-compose up -d
```

Access at `http://localhost:3000`.
