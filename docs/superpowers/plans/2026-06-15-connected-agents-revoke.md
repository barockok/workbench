# Connected Agents — list & revoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user see which AI agents/MCP clients are connected to their workbench account via OAuth and revoke any one of them.

**Architecture:** A new backend module (`oauth-server/agents.ts`) reads/aggregates `oauth_refresh_tokens` joined with `oauth_clients`, grouped per `client_id`, and deletes a user's tokens for one client. Two session-authenticated routes (`GET`/`DELETE /api/agents`) expose it. The portal Dashboard gets a "Connected Agents" panel. Soft revoke only — stateless access JWTs lapse at their TTL; revoke deletes refresh tokens so the agent can't renew. A `created_at` column on `oauth_refresh_tokens` (preserved across rotation) gives "connected since".

**Tech Stack:** TypeScript, better-sqlite3 (parameterized SQL), Fastify, React + TanStack Query, Vitest.

Spec: `docs/superpowers/specs/2026-06-15-connected-agents-revoke-design.md`

---

## File Structure

- `packages/server/src/db.ts` — modify: add `created_at` migration on `oauth_refresh_tokens`.
- `packages/server/src/auth/oauth-server/refresh.ts` — modify: stamp + carry `created_at`.
- `packages/server/src/auth/oauth-server/agents.ts` — create: `listAgents` / `revokeAgent`.
- `packages/server/src/api/routes.ts` — modify: `GET`/`DELETE /api/agents`.
- `packages/server/tests/agents.test.ts` — create: unit tests for the module.
- `packages/portal/src/api.ts` — modify: `listAgents` / `revokeAgent` fetch helpers + types.
- `packages/portal/src/components/AgentsPanel.tsx` — create: list + revoke UI.
- `packages/portal/src/pages/Dashboard.tsx` — modify: mount `<AgentsPanel />`.

---

## Task 1: DB migration + `created_at` carried across rotation

**Files:**
- Modify: `packages/server/src/db.ts` (migrations block, end of file ~line 134)
- Modify: `packages/server/src/auth/oauth-server/refresh.ts`
- Test: `packages/server/tests/agents.test.ts` (create)

- [ ] **Step 1: Add the migration in `db.ts`**

Append after the last migration `try/catch` block (the `pending_auth ADD COLUMN config` one near line 134):

```ts
// "Connected since" for an agent's refresh token, surfaced in the portal's
// Connected Agents list. Carried across rotation (see refresh.ts) so it
// survives token refreshes. NOTE: SQLite forbids a non-constant DEFAULT
// (unixepoch()) in ALTER TABLE ADD COLUMN, so the column is added bare and
// issueRefreshToken stamps it explicitly; pre-migration rows stay NULL and
// age out within the 30-day refresh TTL.
try {
  db.exec(`ALTER TABLE oauth_refresh_tokens ADD COLUMN created_at INTEGER`);
} catch (e: any) {
  if (!e.message?.includes("duplicate column name")) throw e;
}
```

- [ ] **Step 2: Update `issueRefreshToken` to stamp `created_at`**

In `refresh.ts`, replace `issueRefreshToken`:

```ts
export function issueRefreshToken(input: {
  clientId: string;
  userId: string;
  scope: string;
  createdAt?: number;
}): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    "INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(hash(token), input.clientId, input.userId, input.scope, now + REFRESH_TTL_SECONDS, input.createdAt ?? now);
  db.prepare("DELETE FROM oauth_refresh_tokens WHERE expires_at < ?").run(now);
  return token;
}
```

- [ ] **Step 3: Update `rotateRefreshToken` to read + carry `created_at`**

Replace the `SELECT` and the re-issue line in `rotateRefreshToken`:

```ts
export function rotateRefreshToken(token: string, clientId: string): Rotated | null {
  const now = Math.floor(Date.now() / 1000);
  const h = hash(token);
  const row = db
    .prepare("SELECT client_id, user_id, scope, created_at FROM oauth_refresh_tokens WHERE token_hash = ? AND expires_at > ?")
    .get(h, now) as { client_id: string; user_id: string; scope: string; created_at: number | null } | undefined;
  if (!row) return null;
  // Always invalidate the presented token (rotation).
  db.prepare("DELETE FROM oauth_refresh_tokens WHERE token_hash = ?").run(h);
  if (row.client_id !== clientId) return null;
  const newToken = issueRefreshToken({
    clientId,
    userId: row.user_id,
    scope: row.scope,
    createdAt: row.created_at ?? now,
  });
  return { userId: row.user_id, scope: row.scope, newToken };
}
```

- [ ] **Step 4: Write the failing test for rotation preserving `created_at`**

Create `packages/server/tests/agents.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import { issueRefreshToken, rotateRefreshToken } from "../src/auth/oauth-server/refresh";

function rowFor(token: string) {
  const crypto = require("crypto");
  const h = crypto.createHash("sha256").update(token).digest("hex");
  return db
    .prepare("SELECT user_id, client_id, created_at FROM oauth_refresh_tokens WHERE token_hash = ?")
    .get(h) as { user_id: string; client_id: string; created_at: number } | undefined;
}

describe("refresh token created_at", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM oauth_refresh_tokens").run();
    db.prepare("DELETE FROM oauth_clients").run();
  });

  it("preserves created_at across rotation", () => {
    const past = Math.floor(Date.now() / 1000) - 10_000;
    const token = issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp", createdAt: past });
    const rotated = rotateRefreshToken(token, "c1");
    expect(rotated).not.toBeNull();
    const newRow = rowFor(rotated!.newToken);
    expect(newRow?.created_at).toBe(past);
  });
});
```

- [ ] **Step 5: Run the test — verify it passes**

Run: `cd packages/server && npx vitest run tests/agents.test.ts -t "preserves created_at"`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/db.ts packages/server/src/auth/oauth-server/refresh.ts packages/server/tests/agents.test.ts
git commit -m "feat(agents): track created_at on refresh tokens, carry across rotation"
```

---

## Task 2: `agents.ts` module — listAgents / revokeAgent

**Files:**
- Create: `packages/server/src/auth/oauth-server/agents.ts`
- Test: `packages/server/tests/agents.test.ts` (extend)

- [ ] **Step 1: Write the module**

Create `packages/server/src/auth/oauth-server/agents.ts`:

```ts
import { db } from "../../db";

export interface ConnectedAgent {
  client_id: string;
  client_name?: string;
  scopes: string[];
  connected_since: number; // unix seconds, MIN(created_at)
  expires_at: number;      // unix seconds, MAX(expires_at)
}

// List the user's connected agents — one row per client_id, aggregated from
// their non-expired refresh tokens. `scopes` is the union of the space-
// delimited scope strings across the grouped rows. Newest agents first.
export function listAgents(userId: string): ConnectedAgent[] {
  const now = Math.floor(Date.now() / 1000);
  const rows = db
    .prepare(
      `SELECT rt.client_id            AS client_id,
              c.client_name           AS client_name,
              GROUP_CONCAT(rt.scope, ' ') AS scopes,
              MIN(rt.created_at)      AS connected_since,
              MAX(rt.expires_at)      AS expires_at
         FROM oauth_refresh_tokens rt
         LEFT JOIN oauth_clients c ON c.client_id = rt.client_id
        WHERE rt.user_id = ? AND rt.expires_at > ?
        GROUP BY rt.client_id
        ORDER BY connected_since DESC`
    )
    .all(userId, now) as {
    client_id: string;
    client_name: string | null;
    scopes: string | null;
    connected_since: number | null;
    expires_at: number;
  }[];

  return rows.map((r) => ({
    client_id: r.client_id,
    client_name: r.client_name ?? undefined,
    scopes: Array.from(
      new Set((r.scopes ?? "").split(/\s+/).filter(Boolean))
    ).sort(),
    connected_since: r.connected_since ?? 0,
    expires_at: r.expires_at,
  }));
}

// Revoke an agent: delete this user's refresh tokens for that client and any
// in-flight authorization codes. Soft revoke — already-issued access JWTs lapse
// at their own TTL. Never touches the shared oauth_clients row or other users'
// rows. Returns the number of refresh-token rows deleted (0 if none — idempotent).
export function revokeAgent(userId: string, clientId: string): number {
  const tx = db.transaction(() => {
    const info = db
      .prepare("DELETE FROM oauth_refresh_tokens WHERE user_id = ? AND client_id = ?")
      .run(userId, clientId);
    db.prepare("DELETE FROM oauth_auth_codes WHERE user_id = ? AND client_id = ?").run(userId, clientId);
    return info.changes;
  });
  return tx();
}
```

- [ ] **Step 2: Write the failing tests**

Append to `packages/server/tests/agents.test.ts`:

```ts
import { listAgents, revokeAgent } from "../src/auth/oauth-server/agents";

function seedClient(clientId: string, name: string) {
  db.prepare(
    "INSERT OR REPLACE INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)"
  ).run(clientId, name, JSON.stringify(["https://x/cb"]));
}

describe("listAgents", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM oauth_refresh_tokens").run();
    db.prepare("DELETE FROM oauth_clients").run();
    db.prepare("DELETE FROM oauth_auth_codes").run();
  });

  it("groups multiple tokens of one client into one agent with union scopes", () => {
    seedClient("c1", "Claude");
    issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp read", createdAt: 100 });
    issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp write", createdAt: 200 });
    const agents = listAgents("u1");
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({ client_id: "c1", client_name: "Claude", connected_since: 100 });
    expect(agents[0].scopes).toEqual(["mcp", "read", "write"]);
  });

  it("excludes expired tokens", () => {
    seedClient("c1", "Claude");
    const past = Math.floor(Date.now() / 1000) - 1;
    db.prepare(
      "INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run("deadhash", "c1", "u1", "mcp", past, past);
    expect(listAgents("u1")).toHaveLength(0);
  });

  it("scopes the list to the requesting user", () => {
    seedClient("c1", "Claude");
    issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    issueRefreshToken({ clientId: "c1", userId: "u2", scope: "mcp" });
    expect(listAgents("u1")).toHaveLength(1);
    expect(listAgents("u2")).toHaveLength(1);
    expect(listAgents("u3")).toHaveLength(0);
  });
});

describe("revokeAgent", () => {
  beforeEach(() => {
    db.prepare("DELETE FROM oauth_refresh_tokens").run();
    db.prepare("DELETE FROM oauth_clients").run();
    db.prepare("DELETE FROM oauth_auth_codes").run();
  });

  it("deletes only the caller's tokens for the target client", () => {
    seedClient("c1", "Claude");
    seedClient("c2", "Cursor");
    issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    issueRefreshToken({ clientId: "c2", userId: "u1", scope: "mcp" }); // other client, same user
    issueRefreshToken({ clientId: "c1", userId: "u2", scope: "mcp" }); // same client, other user
    const deleted = revokeAgent("u1", "c1");
    expect(deleted).toBe(1);
    expect(listAgents("u1").map((a) => a.client_id)).toEqual(["c2"]); // c1 gone, c2 kept
    expect(listAgents("u2").map((a) => a.client_id)).toEqual(["c1"]); // other user untouched
    // shared client row survives
    expect(db.prepare("SELECT client_id FROM oauth_clients WHERE client_id = ?").get("c1")).toBeTruthy();
  });

  it("also deletes in-flight auth codes for that user+client", () => {
    seedClient("c1", "Claude");
    issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    db.prepare(
      "INSERT INTO oauth_auth_codes (code, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("code1", "c1", "u1", "https://x/cb", "chal", "mcp", "res", Math.floor(Date.now() / 1000) + 600);
    revokeAgent("u1", "c1");
    expect(db.prepare("SELECT code FROM oauth_auth_codes WHERE code = ?").get("code1")).toBeUndefined();
  });

  it("returns 0 for a client the user has no tokens for (idempotent)", () => {
    expect(revokeAgent("u1", "nope")).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests — verify they pass**

Run: `cd packages/server && npx vitest run tests/agents.test.ts`
Expected: PASS (8 tests total).

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/auth/oauth-server/agents.ts packages/server/tests/agents.test.ts
git commit -m "feat(agents): listAgents + revokeAgent module"
```

---

## Task 3: API routes — GET/DELETE /api/agents

**Files:**
- Modify: `packages/server/src/api/routes.ts` (after the `DELETE /api/connections/:integration` handler, before the closing `}` of the route registration function ~line 600)

- [ ] **Step 1: Add the import**

At the top of `routes.ts`, add alongside the other auth imports:

```ts
import { listAgents, revokeAgent } from "../auth/oauth-server/agents";
```

- [ ] **Step 2: Add the routes**

Insert immediately after the `DELETE /api/connections/:integration` handler closes (just before the final `}` of the route-registration function):

```ts
  // Connected agents: MCP/OAuth clients the user has authorized to reach their
  // workbench. Distinct from /api/connections (workbench → SaaS). One row per
  // client_id.
  app.get("/api/agents", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    return { agents: listAgents(user.userId) };
  });

  // Revoke an agent: delete the user's refresh tokens for that client (soft
  // revoke — live access tokens lapse at their TTL). Idempotent: returns
  // { revoked: 0 } when there was nothing to remove.
  app.delete<{ Params: { clientId: string } }>(
    "/api/agents/:clientId",
    async (request, reply) => {
      const user = await authenticate(request);
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const revoked = revokeAgent(user.userId, request.params.clientId);
      return { revoked };
    }
  );
```

- [ ] **Step 3: Verify it typechecks and the suite still passes**

Run: `cd packages/server && npx vitest run`
Expected: PASS (full suite, including the 8 agents tests). No TypeScript errors at import.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/api/routes.ts
git commit -m "feat(agents): GET/DELETE /api/agents routes"
```

---

## Task 4: Portal API helpers

**Files:**
- Modify: `packages/portal/src/api.ts` (after `disconnectIntegration`)

- [ ] **Step 1: Add the type + fetch helpers**

Append after `disconnectIntegration` in `api.ts`:

```ts
export interface ConnectedAgent {
  client_id: string;
  client_name?: string;
  scopes: string[];
  connected_since: number;
  expires_at: number;
}

export async function fetchAgents(): Promise<{ agents: ConnectedAgent[] }> {
  const res = await fetch(`${API_URL}/api/agents`, { headers: getHeaders() });
  if (res.status === 401) {
    localStorage.removeItem("awb_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

export async function revokeAgent(clientId: string): Promise<{ revoked: number }> {
  const res = await fetch(`${API_URL}/api/agents/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || "Failed to revoke agent");
  }
  return res.json();
}
```

- [ ] **Step 2: Verify the portal typechecks/builds**

Run: `cd packages/portal && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/portal/src/api.ts
git commit -m "feat(agents): portal api helpers (fetchAgents, revokeAgent)"
```

---

## Task 5: Portal AgentsPanel + Dashboard mount

**Files:**
- Create: `packages/portal/src/components/AgentsPanel.tsx`
- Modify: `packages/portal/src/pages/Dashboard.tsx`

- [ ] **Step 1: Create the component**

Create `packages/portal/src/components/AgentsPanel.tsx`:

```tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAgents, revokeAgent, ConnectedAgent } from "../api";

function rel(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  const d = Date.now() / 1000 - unixSeconds;
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export default function AgentsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });
  const [error, setError] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: revokeAgent,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agents"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Revoke failed"),
  });

  const agents: ConnectedAgent[] = data?.agents ?? [];

  function handleRevoke(a: ConnectedAgent) {
    const label = a.client_name || a.client_id;
    if (!window.confirm(`Revoke ${label}? It will stop being able to renew access (an active session may persist up to the access-token lifetime).`)) return;
    setError(null);
    revoke.mutate(a.client_id);
  }

  return (
    <section className="agents-panel">
      <div className="eyebrow"><span className="dot" /> // connected agents ── oauth clients</div>
      {error && <div className="login-error" style={{ margin: "8px 0" }}>ERR — {error}</div>}
      {isLoading ? (
        <p className="card-meta">Loading agents…</p>
      ) : agents.length === 0 ? (
        <p className="card-meta">No agents connected.</p>
      ) : (
        <ul className="agents-list">
          {agents.map((a) => (
            <li key={a.client_id} className="agent-row">
              <div className="agent-id">
                <strong>{a.client_name || a.client_id}</strong>
                <span className="card-meta"> · connected {rel(a.connected_since)}</span>
                {a.scopes.length > 0 && (
                  <div className="integ-tags">
                    {a.scopes.map((s) => <span key={s} className="integ-tag">{s}</span>)}
                  </div>
                )}
              </div>
              <button
                className="btn-disconnect"
                onClick={() => handleRevoke(a)}
                disabled={revoke.isPending}
                title="Revoke this agent"
              >
                {revoke.isPending ? "…" : "Revoke"}
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="card-meta" style={{ marginTop: 8 }}>
        Revoking stops the agent from renewing access; an in-flight session may keep working until its current token expires.
      </p>
    </section>
  );
}
```

- [ ] **Step 2: Mount it on the Dashboard**

In `Dashboard.tsx`, add the import next to the other component imports:

```tsx
import AgentsPanel from "../components/AgentsPanel";
```

Then mount it directly under `<ApiKeyPanel />` inside `<main className="main">`:

```tsx
        <ApiKeyPanel />

        <AgentsPanel />
```

- [ ] **Step 3: Verify the portal typechecks/builds**

Run: `cd packages/portal && npx tsc --noEmit`
Expected: no errors. (Styling reuses existing classes — `eyebrow`, `card-meta`, `integ-tag`, `btn-disconnect`, `login-error`; new class names `agents-panel`/`agents-list`/`agent-row`/`agent-id` render unstyled but functional, acceptable for this pass.)

- [ ] **Step 4: Commit**

```bash
git add packages/portal/src/components/AgentsPanel.tsx packages/portal/src/pages/Dashboard.tsx
git commit -m "feat(agents): Connected Agents panel on the dashboard"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run the whole server suite**

Run: `cd packages/server && npx vitest run`
Expected: all green, including 8 new agents tests.

- [ ] **Step 2: Build everything**

Run: `npm run build`
Expected: server + portal + shared build clean.

- [ ] **Step 3: Commit any incidental fixes, then stop for review.**

---

## Notes for the implementer

- `authenticate(request)` already exists in `routes.ts` and returns `{ userId }` (or null → 401). Follow the exact 401 pattern used by `/api/connections`.
- `db.transaction(fn)` from better-sqlite3 runs synchronously and returns the callback's value.
- Tests share one SQLite file; each `describe` clears the tables it touches in `beforeEach`. Don't assume an empty DB at import.
- Soft revoke is intentional — do NOT add a `verifyAccessToken` denylist/grant check; that was explicitly out of scope.
