# The audit log was already a product feature, unread

Every tool execution has written an `audit_log` row since the audit logger
landed: `packages/server/src/mcp/meta-tools.ts` logs at six points in one
execution — tool-not-found, not-connected, invalid-args, safeparse-error,
success, and thrown error — with `integration`, `tool`, `success`, `error`
and `duration_ms`, indexed on `(user_id, created_at)`.

Nothing read it. There was no endpoint, so the portal could not show a human
what their agents had actually been doing, and the only way to see a failure
was to have been watching the server's stdout when it happened. Adding the
read side was two queries and a route; the data had been accumulating the
whole time.

Two details are worth carrying forward.

**An empty table is ambiguous.** `AUDIT_LOG_DEST` may be `sqlite`, `stdout`
or `kafka`. Under the latter two the table stays empty forever, which looks
identical to "you have not run any tools yet" and would have sent someone
hunting for a bug in the logger. Both endpoints return an explicit
`stored: false` instead, and the UI says which situation it is in.

**Keyset paging has to spell out the tiebreak.** Rows share a `created_at`
routinely — a batch of tool calls lands inside the same second — so paging on
the timestamp alone silently drops or repeats rows at a page boundary. The
predicate needs the id as a tiebreak, and it has to be written longhand as
`created_at < ? OR (created_at = ? AND id < ?)`: the row-value form
`(created_at, id) < (?, ?)` is not portable across the two SQL backends this
project supports. See
[postgres dialect gotchas](2026-08-06-postgres-dialect-gotchas.md).
