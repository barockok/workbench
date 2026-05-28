# MCP Interface — Claude SDK end-to-end verification

**Date:** 2026-05-28
**Branch:** main (post-merge of `docs/staging-report` → `2114e44`)
**Environment:** local `tsx` dev (no Docker), Claude Code CLI 2.1.153, DeepSeek anthropic-compatible backend
**Verdict:** PASS — Claude Code SDK can discover and invoke a-workbench MCP tools over HTTP transport.

---

## Setup

1. `.env` minted with random `ENCRYPTION_KEY` + `SESSION_SECRET` (gitignored).
2. Server started directly: `tsx watch --env-file=../../.env src/index.ts` from `packages/server/`.
3. staging API key minted via:
   ```
   tsx --env-file=../../.env -e "const {createUser}=require('./src/auth/users.ts');console.log(JSON.stringify(createUser('staging-mcp-tester')))"
   ```
   Key stored in `staging-dir/.mcp.json` (gitignored, never committed).
4. MCP server config at `staging-dir/.mcp.json`:
   ```jsonc
   {
     "mcpServers": {
       "a-workbench": {
         "type": "http",
         "url": "http://localhost:3000/mcp",
         "headers": { "Authorization": "Bearer <redacted>" }
       }
     }
   }
   ```
5. DeepSeek backend loaded from `~/.claude-profiles/deepseek.env`:
   - `ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic`
   - `ANTHROPIC_MODEL=deepseek-v4-pro`
   - `ANTHROPIC_AUTH_TOKEN=<deepseek key>`

---

## Wire-level check (curl)

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <key>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Returned 5 meta-tools: `search_tools`, `get_tool_schema`, `execute_tool`, `list_integrations`, `get_auth_url`.

```bash
curl -s -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer <key>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_integrations","arguments":{}}}'
```

Returned 14 integrations, all with `"connected": false` (fresh staging user).

---

## SDK-level check (Claude Code + DeepSeek)

Invocation:
```bash
cd staging-dir
set -a; source ~/.claude-profiles/deepseek.env; set +a
claude -p "List the a-workbench MCP tools available, then call list_integrations and report how many integrations are returned and how many are connected. Reply concisely." \
  --permission-mode=bypassPermissions
```

Model auto-discovered the MCP server from `.mcp.json`, called `tools/list` then `list_integrations`, and produced the answer below.

### Claude SDK response (verbatim)

> ## a-workbench MCP Tools
>
> Server running at `localhost:3000/mcp`. 5 tools:
>
> | Tool | Description |
> |------|-------------|
> | `search_tools` | Search available tools by name or description |
> | `get_tool_schema` | Get input schema for a specific tool |
> | `execute_tool` | Execute a tool by name with arguments |
> | `list_integrations` | List all available integrations and connection status |
> | `get_auth_url` | Get OAuth URL to connect an integration |
>
> ## list_integrations Result
>
> **14 integrations total, 0 connected.**
>
> | Integration | Connected |
> |-------------|-----------|
> | google-gmail | false |
> | google-drive | false |
> | google-sheets | false |
> | google-calendar | false |
> | google-gemini | false |
> | google-docs | false |
> | google-slides | false |
> | atlassian-jira | false |
> | atlassian-confluence | false |
> | atlassian-bitbucket | false |
> | asana | false |
> | github | false |
> | slack | false |
> | httpbin-cookie | false |
>
> No integrations connected yet. Use `get_auth_url('<integration>')` + authenticate via the portal at `http://localhost:5173` to wire them up.

Full transcript stored at `claude-sdk.transcript.jsonl` (gitignored).

---

## Findings

### Pass
- a-workbench MCP `/mcp` endpoint speaks valid JSON-RPC 2.0 over plain HTTP.
- Claude Code's `type: "http"` MCP client successfully POSTs JSON-RPC and parses the response. No SSE / Streamable HTTP required.
- DeepSeek anthropic-compatible endpoint relays MCP tool-use blocks correctly — model emits `tools/call`, gets back tool result, integrates into final answer.

### Bug — telemetry import crashes local dev (fixed in this branch, not yet committed for review)
`packages/server/src/telemetry/tracing.ts` imported `resourceFromAttributes` from `@opentelemetry/resources` v2 API, but `packages/server/package.json` pins `^1.24`. Local hoist resolved to the v1 copy inside `packages/server/node_modules/`, where the export does not exist → `TypeError: resourceFromAttributes is not a function` at import time, killing the server before it can listen.

Wrapped telemetry init in try/catch + version sniff (v2 `resourceFromAttributes` vs v1 `new Resource(...)`). Server now boots regardless of which otel resources version wins the hoist; tracing degrades gracefully with a `[telemetry] disabled: ...` warning when the deps don't line up.

### Notes
- This staging only covers the MCP **protocol** path. End-to-end `execute_tool` against a real plugin (e.g. Gmail) still requires per-plugin OAuth creds in `.env` and a portal-driven Connect — that's covered by the earlier staging-REPORT.md, not re-run here.
- DeepSeek is being used as an Anthropic-compatible relay — token consumption is billed to the DeepSeek key, not Anthropic.

---

## Reproducer

```bash
# 1. boot server (root .env must have ENCRYPTION_KEY 64-hex + SESSION_SECRET ≥32 chars)
cd packages/server
tsx watch --env-file=../../.env src/index.ts &

# 2. mint staging user
tsx --env-file=../../.env -e "console.log(JSON.stringify(require('./src/auth/users.ts').createUser('staging-mcp-tester')))"

# 3. wire MCP config (staging-dir/.mcp.json — gitignored)
# (use bearer from step 2)

# 4. run claude with deepseek backend
cd ../../staging-dir
set -a; source ~/.claude-profiles/deepseek.env; set +a
claude -p "Call list_integrations and report the count." --permission-mode=bypassPermissions
```

## Credential hygiene

- `.env` (root): gitignored (`.env`, `.env.*`)
- `staging-dir/.mcp.json`: gitignored (added to `staging-dir/.gitignore` in this staging)
- `staging-dir/claude-sdk.transcript.jsonl`: gitignored (`*.transcript.jsonl`)
- DeepSeek key: lives in `~/.claude-profiles/deepseek.env` only, never copied into repo
- No secret values appear in this document.
