# MCP — connected tool end-to-end (real OAuth login + cookie auth)

**Date:** 2026-05-28
**Branch:** `uat/mcp-claude-sdk` (built on `2114e44` main + telemetry fix from `1bbb6bc`)
**Tester (SSO):** <tester>@<workspace> (Chrome already authenticated → Google account chooser one-click)
**Backend model:** `deepseek-v4-pro` via `~/.claude-profiles/deepseek.env`
**Verdict:** **PASS** — Claude SDK invokes a connected workbench tool end-to-end and receives the real cookie payload that was captured during the browser-driven connect flow.

---

## End-to-end happy path (what got proven)

1. **Portal login (browser, real SSO).** Playwright-cli attached to user's running Chrome. Hit `http://localhost:3000/login` → "Continue with Google" → account chooser shows `<tester>@<workspace>` (already signed in) → consent → server callback redirects to `http://localhost:3000/#token=<jwt>` → AuthProvider captures the hash on mount, persists token, dashboard renders.
2. **Connect httpbin-cookie via cookie auth.** Click "Connect →" on `httpbin-cookie` card. Modal opens. Server `startCookieSession` spawns headless-disabled Playwright Chromium, navigates to `https://httpbin.org/cookies/set?session=test123`. Cookie set in that browser context. Click "Capture session" → `captureCookies` reads the context's cookie jar (filtered to declared `cookieDomains`), encrypts with AES-256-GCM, persists to SQLite. Card flips to **Live / Session active**.
3. **API key minted for the SSO user.** Bypassing `createUser` (which inserts a new row) and updating the existing maria row directly:
   ```ts
   db.prepare('UPDATE users SET api_key_hash=? WHERE id=?').run(bcryptHash, mariaId);
   ```
4. **MCP server config (gitignored).** `uat-dir/.mcp.json` declares one HTTP MCP server:
   ```jsonc
   { "mcpServers": { "a-workbench": {
     "type": "http",
     "url": "http://localhost:3001/mcp",
     "headers": { "Authorization": "Bearer <maria-api-key>" }
   } } }
   ```
5. **Claude SDK call.** `claude -p "...execute_tool tool=httpbin_get_cookies args={}..." --mcp-config ./.mcp.json --strict-mcp-config --permission-mode=bypassPermissions`. Stream-json transcript captured.
6. **Result.** Init handshake reports `mcp_servers: [{name: "a-workbench", status: "connected"}]`. Assistant message contains:
   ```json
   {"type":"tool_use","name":"mcp__a-workbench__execute_tool","input":{"tool":"httpbin_get_cookies","args":{}}}
   ```
   Tool result text: `{"result":{"cookies":{"session":"test123"}}}` — exact value of the cookie captured server-side during step 2. Final claude reply: `{"cookies":{"session":"test123"}}`.

Transcript: `mcp-connected.transcript.jsonl` (gitignored). Screenshot: `dashboard-httpbin-connected.png`.

---

## Bug found + fixed: MCP `initialize` handshake missing

Without the fix, `claude --mcp-config ./.mcp.json` reported the server as `status: "failed"` and the model fell back to filesystem/Bash tools (or hallucinated an answer) instead of invoking any `mcp__a-workbench__*` tool. The transcript from the failing run literally said:

> "No a-workbench MCP server connected in this session."

### Root cause

`packages/server/src/mcp/server.ts::handleMcpRequest` only handled `tools/list` + `tools/call`. The MCP spec requires the client to perform a lifecycle handshake first:

1. Client → `initialize` (with `protocolVersion`, `capabilities`, `clientInfo`)
2. Server → `result: { protocolVersion, capabilities, serverInfo }`
3. Client → `notifications/initialized` (no response)
4. Then `tools/list`, `tools/call`, etc.

The server returned `Method not found: initialize` to the very first request, so Claude Code marked the connection as failed before it ever asked for the tool list.

Verified via curl:
```
$ curl … -d '{"jsonrpc":"2.0","id":1,"method":"initialize", … }'
{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"Method not found: initialize"}}
```

### Fix (in `packages/server/src/mcp/server.ts` + `index.ts`)

- Added `initialize` handler → returns `protocolVersion` (echoes client's, default `2025-06-18`), `capabilities.tools={}`, `serverInfo`.
- Added `notifications/initialized` / `initialized` → returns `null`; Fastify route now sends `202 Accepted` with empty body for notifications (no JSON-RPC `id`, so no response expected per spec).
- Added `resources/list` and `prompts/list` → return empty arrays so clients don't treat them as protocol violations.
- Filled `tools/list` `inputSchema` with the actual JSON Schema for each meta-tool (was previously `{type: "object", properties: {}}`, which gave the model no signal about required arguments — likely the secondary reason DeepSeek struggled to pick `execute_tool` correctly without the handshake fix).

After fix:
```
$ curl … -d '{"jsonrpc":"2.0","id":1,"method":"initialize", … }'
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"a-workbench","version":"0.1.0"}}}
```

---

## Other notes

- **Port swap for SSO.** The Google OAuth client in `~/Desktop/workbench-keys/google-client-workbench-sso.json` is registered with `redirect_uris: ["http://localhost:3000/api/auth/google/callback"]`. Local dev had portal at `:5173` and server at `:3000`, which made the callback land on the server but post-login portal redirect target `PORTAL_URL=http://localhost:5173` didn't match the registered URI. Resolved by swapping: portal on **3000** (was 5173), server on **3001** (was 3000). Vite proxies `/api` and `/callback` to `:3001`. `.env` accordingly:
  ```
  PORT=3001
  PORTAL_URL=http://localhost:3000
  SERVER_PUBLIC_URL=http://localhost:3000
  ```
- **Cookie payload sanity.** `execute_tool → httpbin_get_headers` returned:
  ```
  "headers": { "Cookie": "session=test123", "Host": "httpbin.org", "User-Agent": "node", … }
  ```
  Confirms the encrypted-at-rest cookies are decrypted and injected on outbound fetch via `ctx.http`. Plugin code itself doesn't touch the cookie store directly — it just calls `ctx.http("https://httpbin.org/cookies")` and the server does the injection in `createContext`.
- **DNS quirk observed.** Sandbox occasionally returned `fetch failed` on the first httpbin call (`Could not resolve host`); subsequent calls succeeded. Not reproducible reliably, didn't block the validation.

---

## Credential hygiene

| Artifact | Location | Status |
|----------|----------|--------|
| Root `.env` (encryption + session + Google SSO client/secret) | `./` | `.gitignore` line `.env` and `.env.*` ✅ |
| `uat-dir/.mcp.json` (Bearer = maria's API key) | `uat-dir/` | `uat-dir/.gitignore` line `.mcp.json` ✅ |
| Stream-json transcript (model output, no creds) | `uat-dir/mcp-connected.transcript.jsonl` | `*.transcript.jsonl` ignored ✅ |
| Source creds (Atlassian, Google, Bitbucket) | `~/Desktop/workbench-keys/` | outside repo ✅ |
| DeepSeek profile | `~/.claude-profiles/deepseek.env` | outside repo ✅ |
| API key minted for maria | only in `uat-dir/.mcp.json` + local memory | not committed |
| Screenshot of connected dashboard | `uat-dir/dashboard-httpbin-connected.png` | contains email `<tester>@<workspace>` in the user-block — this IS committed; flag if you want it redacted before any future push |

Pre-commit grep for raw tokens / keys / passwords in staged files: clean.

---

## Reproducer

```bash
# 1. Boot stack
cd /Users/barock/Second-Brain/workspace/a-workbench
npm run dev            # portal :3000, server :3001, sample-oauth :3002

# 2. Browser login (manual)
#   → http://localhost:3000/login
#   → Continue with Google → pick <tester>@<workspace> → consent
#   → dashboard at http://localhost:3000

# 3. Connect httpbin-cookie via portal modal (click "Connect →", then "Capture session")

# 4. Mint API key for the SSO user
cd packages/server
tsx --env-file=../../.env -e "
  const Database = require('better-sqlite3');
  const bcrypt = require('bcryptjs');
  const crypto = require('crypto');
  const db = new Database('./data/tokens.db');
  const u = db.prepare('SELECT id FROM users WHERE email=?').get('<tester>@<workspace>');
  const apiKey = crypto.randomBytes(32).toString('hex');
  db.prepare('UPDATE users SET api_key_hash=? WHERE id=?').run(bcrypt.hashSync(apiKey,10), u.id);
  console.log(JSON.stringify({userId:u.id, apiKey}));
"

# 5. Wire uat-dir/.mcp.json with that API key (gitignored).

# 6. Drive Claude SDK
cd ../../uat-dir
set -a; source ~/.claude-profiles/deepseek.env; set +a
claude -p "Call execute_tool tool='httpbin_get_cookies' args={}. Print raw result." \
  --mcp-config ./.mcp.json --strict-mcp-config \
  --permission-mode=bypassPermissions
```

Expected final answer: a JSON object containing `{"cookies":{"session":"test123"}}` — the cookie planted by the captureCookies flow.
