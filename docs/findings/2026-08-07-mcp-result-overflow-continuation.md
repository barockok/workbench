# 2026-08-07 — MCP tool result overflow continuation

**Where:** `packages/server/src/mcp/{server.ts,result-overflow.ts,meta-tools.ts}`,
`config.MAX_OVERFLOW_PARTS` (replaced), `config.MAX_OVERFLOW_ITEMS`
**Status:** current — part-count cap **superseded by**
[2026-08-13 overflow token budget](2026-08-13-overflow-token-budget.md)

## Problem

Upstream plugin handlers (e.g. Confluence `get_page`) often pass through large
payloads. A single `tools/call` used to hard-truncate at 60k chars mid-string,
so the agent got invalid JSON and lost the rest of the document. A follow-on
agent-looped `continue_tool_result` chain still required skill-like orchestration.
Whole-blob overflow of `execute_tools` `{results:[...]}` made it worse: one large
page truncated the entire batch (siblings lost / JSON cut mid-structure).

## Fix

1. **`packageResultContent(userId, text)`** — if the JSON string fits in
   `MAX_RESULT_CHARS` (60k), return `[text]`. Otherwise store a capped prefix and
   return one JSON continuation envelope string per stored part (eager
   multi-content).
2. **`packageBatchResultContent(userId, results)`** — used for `execute_tools`.
   Each `results[i]` is sized independently. Small items stay inline in
   `content[0]` as `{"results":[...]}`. Oversized items become a stub
   (`truncated`, `continuationId`, `resultIndex`, `totalParts`, `complete`,
   `partsIncluded`) in that header; when `partsIncluded` is true, their chunks
   follow as separate content blocks (envelopes carry the same `resultIndex`).
   Reconstruct per stub: concat that `continuationId`'s `chunk`s, then
   `JSON.parse` — never concat across items.
3. **MCP wire** — `handleMcpRequest` maps those strings to separate `content[]`
   text blocks. Non-batch tools still use whole-result `packageResultContent`.
4. **`continue_tool_result`** — optional re-fetch by `continuationId` (user-bound,
   10‑minute TTL). Omit `part` to get all stored parts as multi-content again;
   pass `part` for a single chunk. Required when `partsIncluded:false`, and for
   clients that only read `content[0]`.
5. **Agent contract (descriptions)** — `execute_tools` documents per-item stubs +
   concat-by-`continuationId` / deferred fetch.

## Caps

### `MAX_OVERFLOW_PARTS` (removed)

Replaced by `MAX_OVERFLOW_TOKENS`. See
[2026-08-13 overflow token budget](2026-08-13-overflow-token-budget.md).

### `MAX_OVERFLOW_ITEMS` (default **2**)

Bounds how many oversized `execute_tools` items get eager multi-content parts in
**one** `tools/call`. Further overflowed items are still stored and stubbed with
`partsIncluded: false`; the agent must call `continue_tool_result` (omit `part`)
for those. Prevents N parallel large pages from exploding a single response
(worst case ≈ `MAX_OVERFLOW_ITEMS × (MAX_OVERFLOW_TOKENS / MAX_RESULT_CHARS) × ~58k`
chars of eager chunks, plus a small header).

## Notes

- No Vault SDK — operators inject both knobs as container env vars.
- Continuations are in-memory only (lost on process restart / not shared across
  replicas).
- If every batch item is under the cap but the assembled `{results}` header still
  exceeds 60k (many medium items), the header is whole-blob packaged like any
  other oversized result.
