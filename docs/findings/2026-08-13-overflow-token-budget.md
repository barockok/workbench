# 2026-08-13 — Overflow cap is a token budget, not a chunk count

**Where:** `packages/server/src/mcp/result-overflow.ts`, `config.MAX_OVERFLOW_TOKENS`,
`config.MAX_RESULT_CHARS`
**Status:** current
**Supersedes:** the `MAX_OVERFLOW_PARTS` cap in
[2026-08-07 MCP result overflow continuation](2026-08-07-mcp-result-overflow-continuation.md)

## Problem

`MAX_OVERFLOW_PARTS` (default 5) stored `N * CHUNK_CHARS` characters. `CHUNK_CHARS`
is `MAX_RESULT_CHARS - 2000`, so the real budget silently scaled with the per-block
wire size. Changing `MAX_RESULT_CHARS` from 60k to 30k would keep ~140k chars
instead of ~290k with no operator change — or explode if the block size grew.

## Fix

Replace the chunk-count knob with a **character budget** in the same units as the
wire cap. Part count is the quotient:

```ts
maxParts = floor(MAX_OVERFLOW_TOKENS / MAX_RESULT_CHARS)  // 300000 / 60000 = 5
maxStored = maxParts * CHUNK_CHARS
```

`MAX_RESULT_CHARS` is now an env var (default `60000`), not a code constant. If
it later drops to 30k with the budget still 300k → 10 parts. Operators do not
retune `MAX_OVERFLOW_TOKENS`.

## Caps

| Env | Default | Meaning |
|-----|---------|---------|
| `MAX_RESULT_CHARS` | `60000` | Max chars per MCP `content[]` text block |
| `MAX_OVERFLOW_TOKENS` | `300000` | Total character budget per overflowed payload |
| `MAX_OVERFLOW_ITEMS` | `2` | Unchanged — eager oversized `execute_tools` items per `tools/call` |

`MAX_OVERFLOW_TOKENS` must be `>= MAX_RESULT_CHARS` so `maxParts` is at least 1.
Incomplete last-part instructions cite `MAX_OVERFLOW_TOKENS`, not
`MAX_OVERFLOW_PARTS`.

Mapping from the old knob: `MAX_OVERFLOW_TOKENS = MAX_OVERFLOW_PARTS * MAX_RESULT_CHARS`.

## Notes

- Not an LLM tokenizer. "Tokens" here is the budget unit, same as `MAX_RESULT_CHARS`.
- `continue_tool_result` and concat-by-`continuationId` are unchanged.
- Breaking env rename: unset `MAX_OVERFLOW_PARTS` in Vault/K8s after deploy.
