# 2026-08-07 — MCP tool result overflow continuation

**Where:** `packages/server/src/mcp/{server.ts,result-overflow.ts,meta-tools.ts}`,
`config.MAX_OVERFLOW_PARTS`
**Status:** current

## Problem

Upstream plugin handlers (e.g. Confluence `get_page`) often pass through large
payloads. A single `tools/call` used to hard-truncate at 60k chars mid-string,
so the agent got invalid JSON and lost the rest of the document.

## Fix

1. **`packageResultText(userId, text)`** — if the JSON string fits in
   `MAX_RESULT_CHARS` (60k), return it unchanged. Otherwise store a prefix and
   return a structured continuation envelope (part 1) with an explicit
   instruction to call `continue_tool_result`.
2. **`continue_tool_result`** meta-tool — fetch part N by `continuationId`
   (bound to `userId`, 10‑minute TTL, reaped periodically).
3. **Agent contract** — keep calling until `hasMore` is false, then concatenate
   every `chunk` field in order to reconstruct the available JSON.

## Cap: `MAX_OVERFLOW_PARTS`

Env var (Vault / K8s Secret injectable, same as other server knobs; default
**5**). Bounds how many ~58k-char chunks are stored and fetchable:

- Store only the first `MAX_OVERFLOW_PARTS * CHUNK_CHARS` characters.
- Envelope includes `complete: true|false`. When `false`, the last part’s
  instruction cites `MAX_OVERFLOW_PARTS` and tells the agent the remainder was
  omitted.

## Notes

- No Vault SDK — operators inject `MAX_OVERFLOW_PARTS` as a container env var.
- Continuations are in-memory only (lost on process restart).
