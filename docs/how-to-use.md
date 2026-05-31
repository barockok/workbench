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
claude config set mcpServers.workbench '{"url": "http://localhost:3000/mcp", "headers": {"x-workbench-api-key": "YOUR_API_KEY"}}'
```

Or, for any MCP client, the generic JSON the portal hands you:

```json
{
  "mcpServers": {
    "workbench": {
      "url": "http://localhost:3000/mcp",
      "headers": { "x-workbench-api-key": "YOUR_API_KEY" }
    }
  }
}
```

> The API key authenticates via the **`x-workbench-api-key`** header. `Authorization: Bearer` is reserved for OAuth access tokens and the portal session JWT.

Then use tools:

```
You: search for jira tools
Claude: search_tools("jira")

You: create a ticket
Claude: execute_tool("jira_create_issue", {project: "PROJ", summary: "Bug"})

You: connect my jira
Claude: get_auth_url("jira") → open URL → authorize → done
```

## Connecting via OAuth (browser login)

MCP clients that support the [MCP OAuth flow](https://spec.modelcontextprotocol.io/specification/2025-11-05/basic/authorization/) (Claude Code ≥ 0.2, and other spec-compliant clients) need only the server URL — no API key required:

```bash
claude config set mcpServers.workbench '{"url": "http://localhost:3000/mcp"}'
```

On the first connection the client discovers the authorization server automatically, registers itself via Dynamic Client Registration, and opens a browser window for Google SSO. After you sign in, the client is authorized and receives tokens that refresh automatically — no further action needed.

For a production deployment substitute your `SERVER_PUBLIC_URL` for `http://localhost:3000`.

The `x-workbench-api-key` header remains available for headless or non-interactive clients (CI, scripts, existing configs) and does not require any browser interaction.

## Connecting Claude Code to a remote workbench — step by step

The OAuth handshake itself is one click. In practice the friction is everything *around* it — a malformed config file, a stale plugin cache, or pointing at the wrong server. Follow these steps in order and check each before moving on.

### 1. Pick which auth you want

| Use | Auth | Config needs |
|---|---|---|
| Interactive (you, at a terminal) | **OAuth browser login** | server `url` only |
| Headless / CI / scripts | **API key** | `url` + `x-workbench-api-key` header |

These are two different tokens. `Authorization: Bearer` is **OAuth/session only**; the API key travels in its own `x-workbench-api-key` header. Don't put the API key in a `Bearer` header — it won't authenticate.

### 2. Write a **valid** `.mcp.json`

A single trailing comma makes the entire file invalid JSON, and Claude Code then **silently drops the whole server** — it won't appear in `claude mcp list` at all, with only this in the output:

```
[Failed to parse] Project config (shared via .mcp.json)
  └ [Error] MCP config is not a valid JSON
```

OAuth (browser login) — server URL only:

```json
{
  "mcpServers": {
    "workbench": {
      "url": "https://your-workbench.example.com/mcp"
    }
  }
}
```

API key — note the header and **no trailing comma** after it:

```json
{
  "mcpServers": {
    "workbench": {
      "url": "https://your-workbench.example.com/mcp",
      "headers": { "x-workbench-api-key": "YOUR_API_KEY" }
    }
  }
}
```

Validate before continuing:

```bash
python3 -m json.tool .mcp.json   # prints the file if valid, errors with a line number if not
```

### 3. Load the config

Claude Code does **not** auto-reload `.mcp.json`. After any edit, run `/reload-plugins` (or restart the session). Then confirm the server is parsed and listed:

```bash
claude mcp list
# workbench: https://your-workbench.example.com/mcp (HTTP) - ✓ Connected
```

If `workbench` is missing here, stop — it's a config problem (step 2), not an auth problem.

### 4. Authorize (OAuth path)

Once the server loads, the `mcp__workbench__authenticate` tool is available. Trigger it (e.g. ask Claude to connect workbench). It returns an `authorize` URL — open it, sign in with Google SSO, done. Tokens refresh automatically afterward; you won't repeat this.

If the redirect page shows a connection error (common on a remote/SSH session where `localhost:<port>/callback` can't reach your machine), copy the **full** `localhost:.../callback?code=...` URL from the browser address bar and pass it to `mcp__workbench__complete_authentication`.

### 5. Verify

```
You: list my integrations
Claude: list_integrations()  → real integration list with connection status
```

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `MCP config is not a valid JSON`; server absent from `claude mcp list` | trailing comma / syntax error in `.mcp.json` | validate with `python3 -m json.tool`, remove the offending comma |
| Server loads but `mcp__workbench__*` tools missing | config edited but not reloaded | run `/reload-plugins` or restart |
| `401` / `WWW-Authenticate: Bearer …` on `/mcp` | no/invalid credential | OAuth: complete step 4. API key: confirm the `x-workbench-api-key` header is present and not pasted as `Bearer` |
| Authorized but tools still 401 | API key sent in `Authorization: Bearer` | move it to the `x-workbench-api-key` header |
| Connected to the wrong workbench | two similar servers (e.g. a hosted aggregator vs your self-hosted staging) both named similarly | check the exact `url` in `claude mcp list`; each server is independent and authorized separately |

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
| `OAUTH_ACCESS_TOKEN_TTL_SECONDS` | `3600` | Lifetime (seconds) of an issued OAuth access token |
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
