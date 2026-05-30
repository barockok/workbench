# MCP-Initiated Connect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent connect any integration directly from MCP — `connect()` returns an openable URL (OAuth consent for oauth2, a CDP login magic-link for cookie), `wait_for_connection()` blocks until connected — and auto-reap abandoned cookie sessions.

**Architecture:** A new in-memory pending-connection store unifies both auth types. `connect` creates a PENDING record (and for cookie, starts the headless-chromium session + mints a single-use JWT magic-link). Capture (cookie) and OAuth callback (oauth2) flip the record to CONNECTED. `wait_for_connection` polls the store. A 60s reaper kills cookie sessions past a 10-minute TTL. A public portal `/connect` page drives the CDP canvas using the JWT, with no prior portal login.

**Tech Stack:** TypeScript, Fastify, MCP JSON-RPC, `jose` (JWT, already used in `auth/session.ts`), Vitest, React + react-router-dom + Vite (portal).

---

## File Structure

**Server — new files**
- `packages/server/src/auth/connections.ts` — pending-connection store + reaper. One responsibility: track in-flight connects and clean up expired cookie sessions.
- `packages/server/src/auth/connect-token.ts` — sign/verify the single-use connect JWT. Mirrors `auth/session.ts`.

**Server — modified files**
- `packages/server/src/mcp/meta-tools.ts` — becomes the single source of truth: add `connect` + `wait_for_connection`, rewrite `get_auth_url` as an alias, export a `metaToolSchemas` map.
- `packages/server/src/mcp/server.ts` — delete the inline `metaTools` + inline `schemas` map; import both from `meta-tools.ts`.
- `packages/server/src/api/routes.ts` — add `GET /api/connect/session` + `POST /api/connect/capture` (connect-JWT authed); mark pending CONNECTED in the existing cookie capture + oauth callback handlers; start the reaper on boot.

**Portal — new files**
- `packages/portal/src/pages/Connect.tsx` — the public magic-link page.

**Portal — modified files**
- `packages/portal/src/App.tsx` — add `/connect/:integration` route outside `RequireAuth`.
- `packages/portal/src/api.ts` — add `connectSession(jwt)` + `connectCapture(jwt)` helpers.

**Tests — new files**
- `packages/server/tests/connections.test.ts`
- `packages/server/tests/connect-token.test.ts`

**Tests — modified files**
- `packages/server/tests/meta-tools.test.ts` — add `connect` / `wait_for_connection` cases; update `get_auth_url` alias expectations.

---

## Task 1: Consolidate the duplicated `metaTools` to a single source

`mcp/server.ts` has its own inline `metaTools` array (the one actually wired to JSON-RPC) plus a hardcoded `schemas` map. `mcp/meta-tools.ts` exports a near-identical array that is only unit-tested. We make `meta-tools.ts` the single source and have `server.ts` import it, so later tasks add tools in exactly one place.

**Files:**
- Modify: `packages/server/src/mcp/meta-tools.ts`
- Modify: `packages/server/src/mcp/server.ts:8-204`
- Test: `packages/server/tests/meta-tools.test.ts`, `packages/server/tests/mcp-server.test.ts`

- [ ] **Step 1: Add the JSON-schema map to `meta-tools.ts`**

At the end of `packages/server/src/mcp/meta-tools.ts`, after the `metaTools` array, export the same schema map that currently lives inline in `server.ts` (copy it verbatim from `server.ts` lines ~170-192, which include `search_tools`, `get_tool_schema`, `execute_tool`, `list_integrations`, `get_auth_url`):

```ts
// JSON Schemas advertised via MCP tools/list. Kept here next to the tools so
// the two never drift. server.ts imports this map.
export const metaToolSchemas: Record<string, object> = {
  search_tools: {
    type: "object",
    properties: { query: { type: "string", description: "Search query" } },
    required: ["query"],
  },
  get_tool_schema: {
    type: "object",
    properties: { tool: { type: "string", description: "Tool name" } },
    required: ["tool"],
  },
  execute_tool: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Tool name" },
      args: { type: "object", description: "Tool arguments" },
    },
    required: ["tool", "args"],
  },
  list_integrations: { type: "object", properties: {} },
  get_auth_url: {
    type: "object",
    properties: { integration: { type: "string", description: "Integration name" } },
    required: ["integration"],
  },
};
```

> Before writing, open `server.ts` and copy the EXACT contents of its inline `schemas` object so the property descriptions match what is shipping today.

- [ ] **Step 2: Run the existing meta-tools test to confirm nothing broke**

Run: `cd packages/server && npx vitest run tests/meta-tools.test.ts`
Expected: PASS (the new export does not change existing handlers).

- [ ] **Step 3: Rewrite `server.ts` to import from `meta-tools.ts`**

In `packages/server/src/mcp/server.ts`:
- Delete the entire inline `const metaTools = [ ... ]` declaration (lines ~8-167).
- Delete the inline `const schemas = { ... }` object inside the `tools/list` handler (lines ~170-192).
- Add at the top, after the existing imports:

```ts
import { metaTools, metaToolSchemas } from "./meta-tools";
```

- In the `tools/list` handler, replace the `schemas` reference so it uses the import:

```ts
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: metaTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: metaToolSchemas[t.name] ?? { type: "object", properties: {} },
        })),
      },
    };
```

Leave the `tools/call` handler unchanged — it already does `metaTools.find(...)`, now resolving to the imported array.

- [ ] **Step 4: Remove now-unused imports from `server.ts`**

After deleting the inline array, `server.ts` no longer uses `z`, `registry`, `createContext`, `getToken`, `hasValidCookies`, `withSpan` directly (they moved with the tools). Delete any import that the TypeScript compiler now flags as unused.

Run: `cd packages/server && npx tsc --noEmit`
Expected: PASS, no unused-symbol or missing-symbol errors.

- [ ] **Step 5: Run the MCP server test**

Run: `cd packages/server && npx vitest run tests/mcp-server.test.ts`
Expected: PASS — `tools/list` and `tools/call` still resolve the same five tools.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/mcp/meta-tools.ts packages/server/src/mcp/server.ts
git commit -m "refactor: single source of truth for MCP meta-tools + schemas"
```

---

## Task 2: Connect-token sign/verify helpers

A single-use JWT that authorizes the public `/connect` page. Signed with the existing `SESSION_SECRET` but a distinct audience so it can never be replayed as a session token.

**Files:**
- Create: `packages/server/src/auth/connect-token.ts`
- Test: `packages/server/tests/connect-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/connect-token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { signConnectToken, verifyConnectToken } from "../src/auth/connect-token";

const payload = {
  connectionId: "conn-1",
  userId: "user-1",
  integration: "jira",
  sessionId: "sess-1",
  cdpToken: "cdp-1",
};

describe("connect-token", () => {
  it("round-trips a valid token", async () => {
    const token = await signConnectToken(payload, 600);
    const decoded = await verifyConnectToken(token);
    expect(decoded.connectionId).toBe("conn-1");
    expect(decoded.userId).toBe("user-1");
    expect(decoded.integration).toBe("jira");
    expect(decoded.sessionId).toBe("sess-1");
    expect(decoded.cdpToken).toBe("cdp-1");
  });

  it("rejects a tampered/garbage token", async () => {
    await expect(verifyConnectToken("not-a-jwt")).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const token = await signConnectToken(payload, -1); // already expired
    await expect(verifyConnectToken(token)).rejects.toThrow();
  });

  it("rejects a session token (wrong audience)", async () => {
    const { signSession } = await import("../src/auth/session");
    const sessionToken = await signSession({ userId: "user-1", email: "a@b.c" });
    await expect(verifyConnectToken(sessionToken)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/server && npx vitest run tests/connect-token.test.ts`
Expected: FAIL — module `../src/auth/connect-token` not found.

- [ ] **Step 3: Implement `connect-token.ts`**

Create `packages/server/src/auth/connect-token.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";

const secret = new TextEncoder().encode(config.SESSION_SECRET);
const AUDIENCE = "a-workbench-connect";
const ISSUER = "a-workbench";

export interface ConnectTokenPayload {
  connectionId: string;
  userId: string;
  integration: string;
  sessionId: string;
  cdpToken: string;
}

export async function signConnectToken(
  payload: ConnectTokenPayload,
  expiresInSeconds: number
): Promise<string> {
  return new SignJWT({
    connectionId: payload.connectionId,
    sub: payload.userId,
    integration: payload.integration,
    sessionId: payload.sessionId,
    cdpToken: payload.cdpToken,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .setAudience(AUDIENCE)
    .setIssuer(ISSUER)
    .sign(secret);
}

export async function verifyConnectToken(token: string): Promise<ConnectTokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    clockTolerance: 0,
    audience: AUDIENCE,
    issuer: ISSUER,
  });
  if (
    typeof payload.connectionId !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.integration !== "string" ||
    typeof payload.sessionId !== "string" ||
    typeof payload.cdpToken !== "string"
  ) {
    throw new Error("Invalid connect token payload");
  }
  return {
    connectionId: payload.connectionId,
    userId: payload.sub,
    integration: payload.integration,
    sessionId: payload.sessionId,
    cdpToken: payload.cdpToken,
  };
}
```

Note: `setExpirationTime("-1s")` produces an already-expired token, which `jwtVerify` rejects with `clockTolerance: 0` — that drives the expiry test.

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/server && npx vitest run tests/connect-token.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/connect-token.ts packages/server/tests/connect-token.test.ts
git commit -m "feat: single-use connect-token sign/verify"
```

---

## Task 3: Pending-connection store + reaper

In-memory store unifying oauth2 + cookie connects, with a TTL reaper that kills abandoned cookie sessions.

**Files:**
- Create: `packages/server/src/auth/connections.ts`
- Test: `packages/server/tests/connections.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/connections.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const closeCookieSession = vi.fn(async () => undefined);
vi.mock("../src/auth/cookie", () => ({ closeCookieSession }));

import {
  createPending,
  getPending,
  markConnected,
  reapExpired,
  _clearAll,
} from "../src/auth/connections";

describe("pending-connection store", () => {
  beforeEach(() => {
    _clearAll();
    closeCookieSession.mockClear();
  });

  it("creates a PENDING record and reads it back", () => {
    const rec = createPending({
      userId: "u1",
      integration: "jira",
      type: "cookie",
      ttlSeconds: 600,
      cookieSessionId: "sess-1",
    });
    expect(rec.status).toBe("PENDING");
    expect(rec.connectionId).toBeDefined();
    expect(getPending(rec.connectionId)?.cookieSessionId).toBe("sess-1");
  });

  it("marks a record CONNECTED by (userId, integration)", () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "oauth2", ttlSeconds: 600 });
    markConnected("u1", "jira");
    expect(getPending(rec.connectionId)?.status).toBe("CONNECTED");
  });

  it("reaps an expired cookie record: closes session + marks EXPIRED", async () => {
    const rec = createPending({
      userId: "u1",
      integration: "jira",
      type: "cookie",
      ttlSeconds: -1, // already expired
      cookieSessionId: "sess-1",
    });
    await reapExpired();
    expect(closeCookieSession).toHaveBeenCalledWith("sess-1");
    expect(getPending(rec.connectionId)?.status).toBe("EXPIRED");
  });

  it("does not reap a still-valid record", async () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: 600, cookieSessionId: "s" });
    await reapExpired();
    expect(closeCookieSession).not.toHaveBeenCalled();
    expect(getPending(rec.connectionId)?.status).toBe("PENDING");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd packages/server && npx vitest run tests/connections.test.ts`
Expected: FAIL — module `../src/auth/connections` not found.

- [ ] **Step 3: Implement `connections.ts`**

Create `packages/server/src/auth/connections.ts`:

```ts
import { randomUUID } from "node:crypto";
import { closeCookieSession } from "./cookie";

export type ConnectionType = "oauth2" | "cookie";
export type ConnectionStatus = "PENDING" | "CONNECTED" | "EXPIRED";

export interface PendingConnection {
  connectionId: string;
  userId: string;
  integration: string;
  type: ConnectionType;
  status: ConnectionStatus;
  createdAt: number; // unix seconds
  expiresAt: number; // unix seconds
  cookieSessionId?: string;
}

const store = new Map<string, PendingConnection>();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function createPending(args: {
  userId: string;
  integration: string;
  type: ConnectionType;
  ttlSeconds: number;
  cookieSessionId?: string;
}): PendingConnection {
  const createdAt = nowSec();
  const rec: PendingConnection = {
    connectionId: randomUUID(),
    userId: args.userId,
    integration: args.integration,
    type: args.type,
    status: "PENDING",
    createdAt,
    expiresAt: createdAt + args.ttlSeconds,
    cookieSessionId: args.cookieSessionId,
  };
  store.set(rec.connectionId, rec);
  return rec;
}

export function getPending(connectionId: string): PendingConnection | undefined {
  return store.get(connectionId);
}

/**
 * Flip the newest PENDING record for (userId, integration) to CONNECTED.
 * Called from the cookie capture handler and the oauth callback handler.
 */
export function markConnected(userId: string, integration: string): void {
  let newest: PendingConnection | undefined;
  for (const rec of store.values()) {
    if (rec.userId === userId && rec.integration === integration && rec.status === "PENDING") {
      if (!newest || rec.createdAt >= newest.createdAt) newest = rec;
    }
  }
  if (newest) newest.status = "CONNECTED";
}

/** Sweep: any PENDING record past expiry → close its cookie session + mark EXPIRED. */
export async function reapExpired(): Promise<void> {
  const t = nowSec();
  for (const rec of store.values()) {
    if (rec.status === "PENDING" && rec.expiresAt <= t) {
      if (rec.cookieSessionId) {
        await closeCookieSession(rec.cookieSessionId).catch(() => undefined);
      }
      rec.status = "EXPIRED";
    }
  }
}

/** Immediately reap one connection (used by wait_for_connection timeout). */
export async function reapOne(connectionId: string): Promise<void> {
  const rec = store.get(connectionId);
  if (!rec || rec.status !== "PENDING") return;
  if (rec.cookieSessionId) {
    await closeCookieSession(rec.cookieSessionId).catch(() => undefined);
  }
  rec.status = "EXPIRED";
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startReaper(intervalMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    void reapExpired();
  }, intervalMs);
  timer.unref?.();
}

export function stopReaper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Test-only: wipe the store. */
export function _clearAll(): void {
  store.clear();
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `cd packages/server && npx vitest run tests/connections.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/connections.ts packages/server/tests/connections.test.ts
git commit -m "feat: pending-connection store + cookie-session reaper"
```

---

## Task 4: `connect` + `wait_for_connection` meta-tools (+ `get_auth_url` alias)

Add the two new tools to the single source (`meta-tools.ts`) and rewire `get_auth_url`. Cookie `connect` starts the chromium session, creates a PENDING record, mints the JWT, and returns the magic-link.

**Files:**
- Modify: `packages/server/src/mcp/meta-tools.ts`
- Test: `packages/server/tests/meta-tools.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/server/tests/meta-tools.test.ts`, extend the existing mocks and add cases. First, add these mocks alongside the current `vi.mock` calls near the top:

```ts
vi.mock("../src/auth/connections", () => ({
  createPending: vi.fn(() => ({ connectionId: "conn-1", status: "PENDING" })),
  getPending: vi.fn(),
  reapOne: vi.fn(async () => undefined),
}));

vi.mock("../src/auth/connect-token", () => ({
  signConnectToken: vi.fn(async () => "jwt-123"),
}));

vi.mock("../src/auth/cookie", () => ({
  hasValidCookies: vi.fn(() => false),
  startCookieSession: vi.fn(async () => ({ sessionId: "sess-1", cdpUrl: "ws://x", cdpToken: "cdp-1" })),
}));

vi.mock("../src/auth/plugin-oauth", () => ({
  buildPluginAuthUrl: vi.fn(() => "https://provider.example/oauth?x=1"),
}));

vi.mock("../src/config", () => ({
  config: { PORTAL_URL: "http://portal.test", CONNECT_TTL_SECONDS: 600 },
}));
```

> If a `vi.mock("../src/auth/cookie", ...)` already exists in the file, MERGE the new exports into it rather than declaring it twice.

Then add a `describe` block:

```ts
describe("connect", () => {
  it("returns provider URL + connectionId for oauth2", async () => {
    vi.spyOn(registry, "getIntegration").mockReturnValue(mockOauthInteg as any);
    const tool = findTool("connect");
    const result = await tool.handler({ userId: "user-1" }, { integration: "test-integ" });
    expect(result.connectionId).toBe("conn-1");
    expect(result.type).toBe("oauth2");
    expect(result.url).toContain("provider.example");
  });

  it("returns a portal magic-link + connectionId for cookie", async () => {
    vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieInteg as any);
    const tool = findTool("connect");
    const result = await tool.handler({ userId: "user-1" }, { integration: "legacy" });
    expect(result.connectionId).toBe("conn-1");
    expect(result.type).toBe("cookie");
    expect(result.url).toBe("http://portal.test/connect/legacy?t=jwt-123");
  });

  it("returns error for unknown integration", async () => {
    vi.spyOn(registry, "getIntegration").mockReturnValue(undefined);
    const tool = findTool("connect");
    const result = await tool.handler({ userId: "user-1" }, { integration: "missing" });
    expect(result.error).toBe("Integration not found");
  });
});

describe("wait_for_connection", () => {
  it("returns CONNECTED when the record is connected", async () => {
    const { getPending } = await import("../src/auth/connections");
    vi.mocked(getPending).mockReturnValue({ status: "CONNECTED" } as any);
    const tool = findTool("wait_for_connection");
    const result = await tool.handler({ userId: "user-1" }, { connectionId: "conn-1", timeoutSec: 1 });
    expect(result.status).toBe("CONNECTED");
  });

  it("returns TIMEOUT and reaps when never connected", async () => {
    const { getPending, reapOne } = await import("../src/auth/connections");
    vi.mocked(getPending).mockReturnValue({ status: "PENDING" } as any);
    const tool = findTool("wait_for_connection");
    const result = await tool.handler({ userId: "user-1" }, { connectionId: "conn-1", timeoutSec: 1 });
    expect(result.status).toBe("TIMEOUT");
    expect(reapOne).toHaveBeenCalledWith("conn-1");
  });

  it("returns error for unknown connectionId", async () => {
    const { getPending } = await import("../src/auth/connections");
    vi.mocked(getPending).mockReturnValue(undefined);
    const tool = findTool("wait_for_connection");
    const result = await tool.handler({ userId: "user-1" }, { connectionId: "nope", timeoutSec: 1 });
    expect(result.error).toBe("Unknown connectionId");
  });
});
```

Also UPDATE the existing `get_auth_url` cases — the alias now returns the `connect` shape. Replace the two passing assertions:

```ts
  describe("get_auth_url", () => {
    it("returns url for oauth2 integration (alias of connect)", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockOauthInteg as any);
      const tool = findTool("get_auth_url");
      const result = await tool.handler({ userId: "user-1" }, { integration: "test-integ" });
      expect(result.url).toContain("provider.example");
      expect(result.connectionId).toBe("conn-1");
    });

    it("returns cookie magic-link (alias of connect)", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieInteg as any);
      const tool = findTool("get_auth_url");
      const result = await tool.handler({ userId: "user-1" }, { integration: "legacy" });
      expect(result.type).toBe("cookie");
      expect(result.url).toContain("/connect/legacy");
    });

    it("returns error for unknown integration", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(undefined);
      const tool = findTool("get_auth_url");
      const result = await tool.handler({ userId: "user-1" }, { integration: "missing" });
      expect(result.error).toBe("Integration not found");
    });
  });
```

- [ ] **Step 2: Run to confirm new tests fail**

Run: `cd packages/server && npx vitest run tests/meta-tools.test.ts`
Expected: FAIL — `findTool("connect")` returns undefined (`Cannot read properties of undefined`).

- [ ] **Step 3: Implement the tools in `meta-tools.ts`**

At the top of `packages/server/src/mcp/meta-tools.ts`, add imports:

```ts
import { config } from "../config";
import { startCookieSession } from "../auth/cookie";
import { buildPluginAuthUrl } from "../auth/plugin-oauth";
import { createPending, getPending, reapOne } from "../auth/connections";
import { signConnectToken } from "../auth/connect-token";
```

> `hasValidCookies` and `getToken` are already imported. Add `startCookieSession` to the existing `../auth/cookie` import line rather than duplicating it.

Add a shared helper above the `metaTools` array:

```ts
async function startConnect(
  userId: string,
  integration: string
): Promise<{ connectionId: string; type: "oauth2" | "cookie"; url: string } | { error: string }> {
  const integ = registry.getIntegration(integration);
  if (!integ) return { error: "Integration not found" };

  const ttl = config.CONNECT_TTL_SECONDS;

  if (integ.auth.type === "cookie") {
    const { sessionId, cdpToken } = await startCookieSession(
      userId,
      integration,
      integ.auth.loginUrl,
      integ.auth.targetDomain,
      integ.auth.cookieDomains
    );
    const rec = createPending({
      userId,
      integration,
      type: "cookie",
      ttlSeconds: ttl,
      cookieSessionId: sessionId,
    });
    const jwt = await signConnectToken(
      { connectionId: rec.connectionId, userId, integration, sessionId, cdpToken },
      ttl
    );
    return {
      connectionId: rec.connectionId,
      type: "cookie",
      url: `${config.PORTAL_URL}/connect/${integration}?t=${jwt}`,
    };
  }

  // oauth2
  const rec = createPending({ userId, integration, type: "oauth2", ttlSeconds: ttl });
  const url = buildPluginAuthUrl(userId, integration);
  return { connectionId: rec.connectionId, type: "oauth2", url };
}
```

Append two new tool objects to the `metaTools` array (before the closing `]`), and REPLACE the existing `get_auth_url` object with the alias:

```ts
  {
    name: "connect",
    description:
      "Begin connecting an integration. Returns an openable URL (OAuth consent for oauth2, a browser login link for cookie auth) and a connectionId. Then call wait_for_connection.",
    inputSchema: z.object({ integration: z.string() }),
    handler: async (ctx: { userId: string }, args: { integration: string }) => {
      return startConnect(ctx.userId, args.integration);
    },
  },
  {
    name: "wait_for_connection",
    description:
      "Block until a connection started by connect() completes. Returns status CONNECTED, TIMEOUT, or EXPIRED.",
    inputSchema: z.object({
      connectionId: z.string(),
      timeoutSec: z.number().int().positive().max(900).default(300),
    }),
    handler: async (_ctx: { userId: string }, args: { connectionId: string; timeoutSec: number }) => {
      const deadline = Date.now() + args.timeoutSec * 1000;
      for (;;) {
        const rec = getPending(args.connectionId);
        if (!rec) return { error: "Unknown connectionId" };
        if (rec.status === "CONNECTED") return { status: "CONNECTED" };
        if (rec.status === "EXPIRED") return { status: "EXPIRED" };
        if (Date.now() >= deadline) {
          await reapOne(args.connectionId);
          return { status: "TIMEOUT" };
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    },
  },
  {
    name: "get_auth_url",
    description: "Deprecated alias of connect(). Get a URL to connect an integration.",
    inputSchema: z.object({ integration: z.string() }),
    handler: async (ctx: { userId: string }, args: { integration: string }) => {
      return startConnect(ctx.userId, args.integration);
    },
  },
```

- [ ] **Step 4: Add JSON schemas for the new tools to `metaToolSchemas`**

In the `metaToolSchemas` map (added in Task 1), add entries:

```ts
  connect: {
    type: "object",
    properties: { integration: { type: "string", description: "Integration name" } },
    required: ["integration"],
  },
  wait_for_connection: {
    type: "object",
    properties: {
      connectionId: { type: "string", description: "ID returned by connect()" },
      timeoutSec: { type: "number", description: "Max seconds to wait (default 300)" },
    },
    required: ["connectionId"],
  },
```

- [ ] **Step 5: Add the config field**

In `packages/server/src/config.ts`, add to the schema (near `PORTAL_URL`):

```ts
  CONNECT_TTL_SECONDS: z.coerce.number().int().positive().default(600),
```

- [ ] **Step 6: Run the tests to confirm they pass**

Run: `cd packages/server && npx vitest run tests/meta-tools.test.ts`
Expected: PASS (connect: 3, wait_for_connection: 3, get_auth_url: 3, plus existing).

> The `wait_for_connection` TIMEOUT test uses `timeoutSec: 1`; it will take ~1s of real time. That is acceptable.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/mcp/meta-tools.ts packages/server/src/config.ts packages/server/tests/meta-tools.test.ts
git commit -m "feat: connect + wait_for_connection MCP tools, get_auth_url alias"
```

---

## Task 5: Mark CONNECTED on capture + oauth callback; add connect endpoints; start reaper

Wire the server side: the existing cookie capture and oauth callback flip the pending record; add the two connect-JWT-authed endpoints the `/connect` page uses; start the reaper on boot.

**Files:**
- Modify: `packages/server/src/api/routes.ts`
- Test: `packages/server/tests/routes.test.ts`

- [ ] **Step 1: Write failing tests for the connect endpoints**

In `packages/server/tests/routes.test.ts`, add a block. (Open the file first to match its existing app-build / request helper — reuse whatever `buildApp()`/`inject` helper the file already defines; the snippet below assumes a Fastify `app` with `.inject`.)

```ts
import { signConnectToken } from "../src/auth/connect-token";

describe("connect endpoints", () => {
  it("GET /api/connect/session returns session info for a valid token", async () => {
    const jwt = await signConnectToken(
      { connectionId: "c1", userId: "u1", integration: "legacy", sessionId: "s1", cdpToken: "t1" },
      600
    );
    const res = await app.inject({
      method: "GET",
      url: "/api/connect/session",
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.integration).toBe("legacy");
    expect(body.sessionId).toBe("s1");
    expect(body.cdpToken).toBe("t1");
    expect(body.cdpProxyUrl).toBe("/api/auth/cookie/legacy/cdp");
  });

  it("GET /api/connect/session 401s on a bad token", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/connect/session",
      headers: { authorization: "Bearer garbage" },
    });
    expect(res.statusCode).toBe(401);
  });
});
```

> If `routes.test.ts` mocks `../src/auth/cookie`, ensure `captureCookies`, `storeCookies`, `closeCookieSession`, `getSessionOwner` remain mocked so capture does not spawn chromium. Match the file's existing mock style.

- [ ] **Step 2: Run to confirm it fails**

Run: `cd packages/server && npx vitest run tests/routes.test.ts`
Expected: FAIL — 404 on `/api/connect/session` (route not registered).

- [ ] **Step 3: Implement the changes in `routes.ts`**

Add imports at the top of `packages/server/src/api/routes.ts`:

```ts
import { verifyConnectToken } from "../auth/connect-token";
import { markConnected, startReaper } from "../auth/connections";
```

Inside `registerApiRoutes`, at the very start of the function body, start the reaper once:

```ts
  startReaper();
```

In the existing cookie capture handler (`POST /api/auth/cookie/:integration/capture`), after `storeCookies(user.userId, integration, cookies);`, add:

```ts
      markConnected(user.userId, integration);
```

In the existing plugin oauth callback handler (`GET /api/auth/plugin/:integration/callback`), after `await handlePluginCallback(integration, code, state);`, add — but the callback has no `userId` in scope. `handlePluginCallback` resolves the user from `state`; extend it to return the userId. Check `auth/plugin-oauth.ts`:
- If `handlePluginCallback` already returns the userId (or an object containing it), use it: `const { userId } = await handlePluginCallback(...)` then `markConnected(userId, integration)`.
- If it returns `void`, add a return of the resolved `userId` to `handlePluginCallback` (it decodes `state`, which encodes the user), then call `markConnected(userId, integration)` here.

> Open `auth/plugin-oauth.ts` and `auth/oauth.ts` to see how `state` maps to a user before editing. Make the minimal change that surfaces `userId` to the callback handler.

Add the two new connect endpoints (place them after the cookie cancel route):

```ts
  // --- MCP-initiated connect (magic-link authed via connect JWT) ---
  app.get("/api/connect/session", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    let payload;
    try {
      payload = await verifyConnectToken(auth.slice(7));
    } catch {
      return reply.status(401).send({ error: "Invalid or expired link" });
    }
    const integ = registry.getIntegration(payload.integration);
    if (!integ || integ.auth.type !== "cookie") {
      return reply.status(404).send({ error: "Integration not found" });
    }
    return {
      integration: payload.integration,
      loginUrl: integ.auth.loginUrl,
      cdpProxyUrl: `/api/auth/cookie/${payload.integration}/cdp`,
      sessionId: payload.sessionId,
      cdpToken: payload.cdpToken,
    };
  });

  app.post("/api/connect/capture", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    let payload;
    try {
      payload = await verifyConnectToken(auth.slice(7));
    } catch {
      return reply.status(401).send({ error: "Invalid or expired link" });
    }

    const owner = getSessionOwner(payload.sessionId);
    if (!owner || owner.userId !== payload.userId || owner.integration !== payload.integration) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    try {
      const cookies = await captureCookies(payload.sessionId);
      storeCookies(payload.userId, payload.integration, cookies);
      await closeCookieSession(payload.sessionId);
      markConnected(payload.userId, payload.integration);
      return { success: true, cookieCount: cookies.cookies.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });
```

- [ ] **Step 4: Run the routes test to confirm it passes**

Run: `cd packages/server && npx vitest run tests/routes.test.ts`
Expected: PASS (both new cases + existing).

- [ ] **Step 5: Typecheck the server**

Run: `cd packages/server && npx tsc --noEmit`
Expected: PASS — including the `handlePluginCallback` return-type change.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/src/auth/plugin-oauth.ts
git commit -m "feat: connect capture/session endpoints, mark CONNECTED, start reaper"
```

---

## Task 6: Portal `/connect` magic-link page

A public page (no `RequireAuth`) that bootstraps from the JWT, renders the CDP canvas, and captures.

**Files:**
- Create: `packages/portal/src/pages/Connect.tsx`
- Modify: `packages/portal/src/api.ts`
- Modify: `packages/portal/src/App.tsx:21-35`

- [ ] **Step 1: Add API helpers**

In `packages/portal/src/api.ts`, add (match the file's existing fetch/base-URL convention — reuse its `API_BASE`/`apiFetch` if present):

```ts
export async function connectSession(jwt: string) {
  const res = await fetch(`${API_BASE}/api/connect/session`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Link invalid");
  return res.json() as Promise<{
    integration: string;
    loginUrl: string;
    cdpProxyUrl: string;
    sessionId: string;
    cdpToken: string;
  }>;
}

export async function connectCapture(jwt: string) {
  const res = await fetch(`${API_BASE}/api/connect/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Capture failed");
  return res.json() as Promise<{ success: boolean; cookieCount: number }>;
}
```

> Open `api.ts` first. If it defines `API_BASE` under a different name (e.g. `BASE_URL`), use that. If requests go through a shared `apiFetch` wrapper that injects the session token, do NOT use it here — these endpoints authenticate with the connect JWT, not the portal session.

- [ ] **Step 2: Create the page**

Create `packages/portal/src/pages/Connect.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { connectSession, connectCapture } from "../api";
import CdpScreencast from "../components/CdpScreencast";

type SessionInfo = Awaited<ReturnType<typeof connectSession>>;

export default function Connect() {
  const { integration } = useParams();
  const [search] = useSearchParams();
  const jwt = search.get("t") ?? "";

  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!jwt) {
      setError("Missing link token.");
      return;
    }
    connectSession(jwt).then(setInfo).catch((e) => setError(e.message));
  }, [jwt]);

  async function handleCapture() {
    setCapturing(true);
    setError(null);
    try {
      await connectCapture(jwt);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Capture failed");
    } finally {
      setCapturing(false);
    }
  }

  if (done) {
    return (
      <div className="boot">
        <span>CONNECTED — {integration}. You can close this tab and return to your agent.</span>
      </div>
    );
  }
  if (error && !info) {
    return <div className="boot"><span>ERR — {error}</span></div>;
  }
  if (!info) {
    return <div className="boot"><span>LOADING LOGIN<span className="blinker" /></span></div>;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modal-head">
          <h2 className="modal-title">Connect <span>{info.integration}</span></h2>
        </div>
        <div className="modal-instructions">
          <div><b>01</b> — Log in to the remote browser below.</div>
          <div><b>02</b> — Click "Capture session" once authenticated.</div>
        </div>
        <div className="modal-body" style={{ padding: 0, background: "#000" }}>
          <CdpScreencast
            cdpProxyUrl={info.cdpProxyUrl}
            sessionId={info.sessionId}
            cdpToken={info.cdpToken}
            width={1024}
          />
        </div>
        {error && <div className="modal-error">ERR — {error}</div>}
        <div className="modal-foot">
          <button onClick={handleCapture} disabled={capturing} className="btn-connect">
            {capturing ? "Capturing…" : "Capture session"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

> Confirm `CdpScreencast`'s prop names by opening `packages/portal/src/components/CdpScreencast.tsx`. The plan assumes `cdpProxyUrl`, `sessionId`, `cdpToken`, `width` (matching `CookieAuthPopup`'s usage). If they differ, adjust.

- [ ] **Step 3: Register the public route**

In `packages/portal/src/App.tsx`, import the page and add the route OUTSIDE `RequireAuth`:

```tsx
import Connect from "./pages/Connect";
```

```tsx
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/connect/:integration" element={<Connect />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
```

- [ ] **Step 4: Typecheck + build the portal**

Run: `cd packages/portal && npx tsc --noEmit && npm run build`
Expected: PASS — no type errors, Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/pages/Connect.tsx packages/portal/src/api.ts packages/portal/src/App.tsx
git commit -m "feat: public /connect magic-link page for cookie auth from MCP"
```

---

## Task 7: Full suite + docs + finding closure

- [ ] **Step 1: Run the entire test suite from the repo root**

Run: `npm run test`
Expected: PASS — all prior tests plus the new `connect-token`, `connections`, expanded `meta-tools`, and `routes` cases.

- [ ] **Step 2: Typecheck + build everything**

Run: `npm run build`
Expected: PASS for all packages.

- [ ] **Step 3: Document the new tools + env var**

In `docs/how-to-use.md`, add a short "Connecting from MCP" section: `connect(integration)` → open the returned `url` → `wait_for_connection(connectionId)`. Note the new env `CONNECT_TTL_SECONDS` (default 600) in `docs/how-to-use.md` (or wherever env vars are listed) and in `.env.example` if present.

```bash
grep -rl "PORTAL_URL\|SESSION_SECRET" .env.example docs 2>/dev/null
```

Add `CONNECT_TTL_SECONDS=600` next to the other env vars in `.env.example`.

- [ ] **Step 4: Mark the finding resolved**

The finding `docs/findings/2026-05-30-abandoned-cookie-session-leak.md` already references this plan. Append a one-line status at the top: `**Status:** Resolved (reaper shipped — see plan 2026-05-30-mcp-initiated-connect).`

- [ ] **Step 5: Commit**

```bash
git add docs/how-to-use.md docs/findings/2026-05-30-abandoned-cookie-session-leak.md .env.example
git commit -m "docs: MCP-initiated connect usage + CONNECT_TTL_SECONDS; close leak finding"
```

---

## Self-Review Notes

- **Spec coverage:** tool surface (T4), pending-store (T3), magic-link JWT (T2), `/connect` page + endpoints (T5, T6), reaper/TTL (T3 + T5 boot), config reuse (T4 adds `CONNECT_TTL_SECONDS`; `PORTAL_URL`/`SESSION_SECRET` reused), `get_auth_url` alias (T4), tests (every task). Dedup precondition (T1).
- **Type consistency:** `createPending`/`getPending`/`markConnected`/`reapOne`/`reapExpired`/`startReaper` names match between `connections.ts` (T3) and callers (T4, T5). `ConnectTokenPayload` fields (`connectionId,userId,integration,sessionId,cdpToken`) match between `connect-token.ts` (T2), `signConnectToken` call (T4), and endpoint usage (T5).
- **Known assumptions to verify during execution (flagged inline):** exact prop names of `CdpScreencast`; `api.ts` base-URL symbol; `routes.test.ts` app-build helper; whether `handlePluginCallback` already returns `userId`. Each step says to open the file and match.
