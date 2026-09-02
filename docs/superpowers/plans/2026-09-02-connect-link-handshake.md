# Connect-Link Handshake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a connect link a claim that must match a proven portal session, so a credential can never be attached to a workbench account by someone who does not own it.

**Architecture:** The link stops carrying capabilities. `connect` returns a workbench URL naming only the integration and the workbench user it was minted for. A new `POST /api/connect/redeem` requires the portal session bearer plus the link token, compares the two user ids, and only on a match performs the side effects (warm browser session, build provider auth URL). The portal `/connect` and `/browser` routes move behind `RequireAuth`. The CDP websocket authenticates by portal session only.

**Tech Stack:** TypeScript, Fastify, vitest (`npm run test -w @a-workbench/server`), React + react-router (portal), jose (JWT).

**Spec:** `docs/superpowers/specs/2026-09-02-connect-link-handshake-design.md`

## Global Constraints

- This repo is **public**. Never commit personal PII, company or internal
  project names, internal hostnames, or secrets. Test fixtures use synthetic
  values only: `user-1`, `u1`, `test@example.com`, `acme`, `demo-repo`.
- **No AI co-authorship.** Never add a `Co-Authored-By:` or "Generated with …"
  trailer naming Claude/Anthropic, and never commit under an AI author identity.
- Run the server suite with `npm run test -w @a-workbench/server`. A single file:
  `npx vitest run tests/<file>.test.ts` from `packages/server`.
- Type-check the test suite with `npm run typecheck:tests -w @a-workbench/server`
  before the final commit of any task that touches `packages/server/tests`.
- Recording which *provider* identity was connected is **out of scope**. Do not
  add columns, `whoami` calls, or provider-identity UI.
- The portal is temporarily inconsistent with the server between Task 3 and
  Task 5. Do not merge the branch before Task 8 is complete.

---

### Task 1: Mark a pending connection as redeemed

The pending-connection store is an in-memory `Map` of `PendingConnection`. A link
must be spendable exactly once, so the record needs to remember that a handshake
already succeeded. `status` cannot carry this: `markConnected` flips the newest
`PENDING` record to `CONNECTED`, and a redeemed-but-not-yet-completed connection
must stay `PENDING` so `wait_for_connection` keeps waiting.

**Files:**
- Modify: `packages/server/src/auth/connections.ts:6-38` (interface + `createPending`)
- Test: `packages/server/tests/connections.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PendingConnection.redeemedAt?: number` — unix seconds.
  - `redeemPending(connectionId: string): PendingConnection | null` — returns the
    record and stamps `redeemedAt` on the first call; returns `null` if the id is
    unknown, the record has expired, or it was already redeemed.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/tests/connections.test.ts`, inside the existing
`describe("pending-connection store", …)` block. Add `redeemPending` to the
import list at the top of the file.

```typescript
  it("redeems a pending record once and stamps redeemedAt", () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: 600 });
    const first = redeemPending(rec.connectionId);
    expect(first).not.toBeNull();
    expect(first!.connectionId).toBe(rec.connectionId);
    expect(first!.redeemedAt).toBeGreaterThan(0);
    // Still PENDING: wait_for_connection must keep waiting until the flow completes.
    expect(first!.status).toBe("PENDING");
  });

  it("refuses a second redemption of the same record", () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: 600 });
    expect(redeemPending(rec.connectionId)).not.toBeNull();
    expect(redeemPending(rec.connectionId)).toBeNull();
  });

  it("refuses an unknown connectionId", () => {
    expect(redeemPending("no-such-id")).toBeNull();
  });

  it("refuses an expired record", () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: -1 });
    expect(redeemPending(rec.connectionId)).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/server`: `npx vitest run tests/connections.test.ts`
Expected: FAIL — `redeemPending is not a function` / import error.

- [ ] **Step 3: Implement**

In `packages/server/src/auth/connections.ts`, add the field to the interface
(after `expiresAt`):

```typescript
  expiresAt: number; // unix seconds
  /**
   * Set when a human proved ownership of `userId` and redeemed the link. A
   * record carrying this cannot be redeemed again, so a leaked link URL is
   * inert once used. Distinct from `status`, which stays PENDING until the
   * connection actually completes.
   */
  redeemedAt?: number;
```

Add the function below `getPending`:

```typescript
/**
 * Spend a connect link. Returns the record on the first call and stamps
 * `redeemedAt`; returns null for an unknown, expired, or already-redeemed
 * connectionId. Callers must treat null as "link consumed" and do no work.
 */
export function redeemPending(connectionId: string): PendingConnection | null {
  const rec = store.get(connectionId);
  if (!rec) return null;
  if (rec.redeemedAt !== undefined) return null;
  if (rec.expiresAt <= nowSec()) return null;
  rec.redeemedAt = nowSec();
  return rec;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `packages/server`: `npx vitest run tests/connections.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/connections.ts packages/server/tests/connections.test.ts
git commit -m "feat(connect): make a pending connection redeemable once"
```

---

### Task 2: The redeem endpoint

This is the gate. It is the only place that turns a link into work.

**Files:**
- Modify: `packages/server/src/api/routes.ts` (add the route next to the existing connect-JWT endpoints, around line 576)
- Test: `packages/server/tests/routes.test.ts`

**Interfaces:**
- Consumes: `redeemPending` (Task 1); existing `authenticate(request)`
  (`routes.ts:64`), `verifyConnectToken` (`auth/connect-token.ts`),
  `ensureSession` / `navigate` (`auth/browser-session.ts`),
  `buildPluginAuthUrl` (`auth/plugin-oauth.ts`), `registry.getIntegration`.
- Produces: `POST /api/connect/redeem`.
  - Request: `Authorization: Bearer <portal session JWT>`, body `{ token: string }`.
  - `200` cookie: `{ type: "cookie", integration, loginUrl, cdpProxyUrl, sessionId, cdpToken }`
  - `200` oauth2: `{ type: "oauth2", url }`
  - `200` browser: `{ type: "browser", cdpProxyUrl, sessionId, cdpToken }`

  The `cdpToken` comes from the warm session, never from the link.
  `getWarmCdpEndpoint` (`auth/browser-session.ts:180`) gates attachment on it, so
  the live view still needs it — but it now reaches only a caller who has
  already proved they own the account.
  - `401 { error: "AUTH_REQUIRED" }` — no or invalid portal session
  - `401 { error: "LINK_INVALID" }` — link token fails verification
  - `410 { error: "LINK_CONSUMED" }` — record unknown, expired, or already redeemed
  - `403 { error: "ACCOUNT_MISMATCH", integration }` — session user ≠ link user

Note the ordering: the session check runs **before** the link is spent, so an
unauthenticated hit does not burn a valid link.

- [ ] **Step 1: Write the failing tests**

Add a new `describe` block to `packages/server/tests/routes.test.ts`. Add
`createPending`, `redeemPending` and `_clearAll` to the existing import from
`../src/auth/connections` as needed — the file already imports `stopReaper` from
there and `signConnectToken` from `../src/auth/connect-token`.

The file's `verifySession` mock (`routes.test.ts:38-43`) already resolves
`"valid-jwt"` to `user-1`. Extend it so a second session is available: change the
mock body to

```typescript
  verifySession: vi.fn((token: string) => {
    if (token === "valid-jwt") return { userId: "user-1", email: "test@example.com" };
    if (token === "other-jwt") return { userId: "user-2", email: "other@example.com" };
    throw new Error("Invalid token");
  }),
```

Then add:

```typescript
describe("POST /api/connect/redeem", () => {
  const cookieInteg = {
    name: "legacy",
    version: "1.0.0",
    auth: {
      type: "cookie" as const,
      loginUrl: "https://legacy.example.com/login",
      targetDomain: "legacy.example.com",
      cookieDomains: [],
    },
  };

  async function mintLink(userId: string, integration: string, connectionId: string) {
    return signConnectToken({ connectionId, userId, integration, sessionId: userId }, 600);
  }

  beforeEach(() => {
    _clearAll();
  });

  it("returns cookie login details when the session owns the link", async () => {
    const { ensureSession, navigate } = await import("../src/auth/browser-session");
    vi.mocked(ensureSession).mockResolvedValue({ cdpToken: "cdp-1" } as never);
    vi.spyOn(registry, "getIntegration").mockReturnValue(cookieInteg as never);
    const rec = createPending({ userId: "user-1", integration: "legacy", type: "cookie", ttlSeconds: 600 });
    const token = await mintLink("user-1", "legacy", rec.connectionId);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/connect/redeem",
      headers: { authorization: "Bearer valid-jwt" },
      payload: { token },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.type).toBe("cookie");
    expect(body.integration).toBe("legacy");
    expect(body.loginUrl).toBe("https://legacy.example.com/login");
    expect(body.cdpProxyUrl).toBe("/api/auth/cookie/legacy/cdp");
    expect(body.sessionId).toBe("user-1");
    // The cdpToken comes from the warm session, not from the link.
    expect(body.cdpToken).toBe("cdp-1");
    expect(navigate).toHaveBeenCalled();
  });

  it("403s ACCOUNT_MISMATCH and does no work when a different user redeems", async () => {
    const { ensureSession } = await import("../src/auth/browser-session");
    vi.mocked(ensureSession).mockResolvedValue({ cdpToken: "cdp-1" } as never);
    vi.spyOn(registry, "getIntegration").mockReturnValue(cookieInteg as never);
    const rec = createPending({ userId: "user-1", integration: "legacy", type: "cookie", ttlSeconds: 600 });
    const token = await mintLink("user-1", "legacy", rec.connectionId);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/connect/redeem",
      headers: { authorization: "Bearer other-jwt" },
      payload: { token },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("ACCOUNT_MISMATCH");
    expect(res.json().integration).toBe("legacy");
    // No side effects: no browser session warmed, and the link is not spent.
    expect(ensureSession).not.toHaveBeenCalled();
    expect(getPending(rec.connectionId)!.redeemedAt).toBeUndefined();
  });

  it("401s AUTH_REQUIRED with no session, without spending the link", async () => {
    const rec = createPending({ userId: "user-1", integration: "legacy", type: "cookie", ttlSeconds: 600 });
    const token = await mintLink("user-1", "legacy", rec.connectionId);

    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/api/connect/redeem", payload: { token } });

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("AUTH_REQUIRED");
    expect(getPending(rec.connectionId)!.redeemedAt).toBeUndefined();
  });

  it("401s LINK_INVALID on a garbage link token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/connect/redeem",
      headers: { authorization: "Bearer valid-jwt" },
      payload: { token: "not-a-jwt" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("LINK_INVALID");
  });

  it("410s LINK_CONSUMED on a second redemption", async () => {
    const { ensureSession } = await import("../src/auth/browser-session");
    vi.mocked(ensureSession).mockResolvedValue({ cdpToken: "cdp-1" } as never);
    vi.spyOn(registry, "getIntegration").mockReturnValue(cookieInteg as never);
    const rec = createPending({ userId: "user-1", integration: "legacy", type: "cookie", ttlSeconds: 600 });
    const token = await mintLink("user-1", "legacy", rec.connectionId);

    const app = await buildApp();
    const headers = { authorization: "Bearer valid-jwt" };
    const first = await app.inject({ method: "POST", url: "/api/connect/redeem", headers, payload: { token } });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: "POST", url: "/api/connect/redeem", headers, payload: { token } });
    expect(second.statusCode).toBe(410);
    expect(second.json().error).toBe("LINK_CONSUMED");
  });

  it("returns the provider URL for an oauth2 link, built only after the match", async () => {
    const { buildPluginAuthUrl } = await import("../src/auth/plugin-oauth");
    vi.spyOn(registry, "getIntegration").mockReturnValue({
      name: "github",
      version: "1.0.0",
      auth: { type: "oauth2" as const, scopes: ["repo"] },
    } as never);
    const rec = createPending({ userId: "user-1", integration: "github", type: "oauth2", ttlSeconds: 600 });
    const token = await mintLink("user-1", "github", rec.connectionId);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/connect/redeem",
      headers: { authorization: "Bearer valid-jwt" },
      payload: { token },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().type).toBe("oauth2");
    expect(res.json().url).toBe("https://example.com/oauth?plugin=1");
    expect(buildPluginAuthUrl).toHaveBeenCalledWith("user-1", "github");
  });

  it("does not build a provider URL when the redeemer is the wrong user", async () => {
    const { buildPluginAuthUrl } = await import("../src/auth/plugin-oauth");
    vi.spyOn(registry, "getIntegration").mockReturnValue({
      name: "github",
      version: "1.0.0",
      auth: { type: "oauth2" as const, scopes: ["repo"] },
    } as never);
    const rec = createPending({ userId: "user-1", integration: "github", type: "oauth2", ttlSeconds: 600 });
    const token = await mintLink("user-1", "github", rec.connectionId);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/connect/redeem",
      headers: { authorization: "Bearer other-jwt" },
      payload: { token },
    });

    expect(res.statusCode).toBe(403);
    expect(buildPluginAuthUrl).not.toHaveBeenCalled();
  });

  it("returns browser-session details for a __browser__ link", async () => {
    const { ensureSession } = await import("../src/auth/browser-session");
    vi.mocked(ensureSession).mockResolvedValue({ cdpToken: "cdp-1" } as never);
    const rec = createPending({ userId: "user-1", integration: "__browser__", type: "cookie", ttlSeconds: 600 });
    const token = await mintLink("user-1", "__browser__", rec.connectionId);

    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/api/connect/redeem",
      headers: { authorization: "Bearer valid-jwt" },
      payload: { token },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      type: "browser",
      cdpProxyUrl: "/api/browser-session/cdp",
      sessionId: "user-1",
      cdpToken: "cdp-1",
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/server`: `npx vitest run tests/routes.test.ts -t "connect/redeem"`
Expected: FAIL — the route does not exist, so Fastify answers 404.

- [ ] **Step 3: Implement**

In `packages/server/src/api/routes.ts`, add `redeemPending` and `getPending` to
the existing import from `../auth/connections`. Insert the route immediately
above the `// Connect-JWT endpoints` comment block (around line 576):

```typescript
  // Connect-link handshake. A connect link names an integration and the
  // workbench user it was minted for; it is a claim, not a capability. The
  // human redeeming it must prove they own that same workbench account. Only
  // after the match does any side effect run — warming a browser session or
  // writing a pending_auth row before that point is what let a link minted for
  // account A capture a credential belonging to whoever opened it.
  app.post<{ Body: { token?: string } }>("/api/connect/redeem", async (request, reply) => {
    // Session first, so an unauthenticated hit never spends a valid link.
    const user = await authenticate(request);
    if (!user) return reply.status(401).send({ error: "AUTH_REQUIRED" });

    const token = request.body?.token;
    if (!token) return reply.status(401).send({ error: "LINK_INVALID" });

    let payload;
    try {
      payload = await verifyConnectToken(token);
    } catch {
      return reply.status(401).send({ error: "LINK_INVALID" });
    }

    // The mismatch check runs before redeemPending, so a wrong-account attempt
    // leaves the link usable by its rightful owner.
    if (payload.userId !== user.userId) {
      return reply.status(403).send({ error: "ACCOUNT_MISMATCH", integration: payload.integration });
    }

    const rec = getPending(payload.connectionId);
    if (!rec || rec.userId !== payload.userId) {
      return reply.status(410).send({ error: "LINK_CONSUMED" });
    }
    if (!redeemPending(payload.connectionId)) {
      return reply.status(410).send({ error: "LINK_CONSUMED" });
    }

    if (payload.integration === "__browser__") {
      try {
        const session = await ensureSession(user.userId);
        return {
          type: "browser",
          cdpProxyUrl: "/api/browser-session/cdp",
          sessionId: user.userId,
          cdpToken: session.cdpToken,
        };
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    const integ = registry.getIntegration(payload.integration);
    if (!integ) return reply.status(404).send({ error: "Integration not found" });

    if (integ.auth.type === "cookie") {
      try {
        const session = await ensureSession(user.userId);
        await navigate(session, integ.auth.loginUrl);
        return {
          type: "cookie",
          integration: payload.integration,
          loginUrl: integ.auth.loginUrl,
          cdpProxyUrl: `/api/auth/cookie/${payload.integration}/cdp`,
          sessionId: user.userId,
          // From the warm session, not the link.
          cdpToken: session.cdpToken,
        };
      } catch (err) {
        return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (integ.auth.type === "oauth2") {
      try {
        const url = await buildPluginAuthUrl(user.userId, payload.integration);
        return { type: "oauth2", url };
      } catch (err) {
        return reply.status(503).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }

    return reply.status(400).send({ error: "Integration is not connectable by link" });
  });
```

Check the existing imports at the top of `routes.ts` — `ensureSession`,
`navigate`, `buildPluginAuthUrl` and `registry` are already imported for other
routes. Add only what is missing.

- [ ] **Step 4: Run the tests to verify they pass**

Run from `packages/server`: `npx vitest run tests/routes.test.ts`
Expected: PASS, including the pre-existing route tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/tests/routes.test.ts
git commit -m "feat(connect): add the session-matched redeem endpoint"
```

---

### Task 3: Gate capture, delete the two magic-link endpoints

`redeem` is only a gate if the endpoints beside it cannot be called instead.
`/api/connect/session` and `/api/connect/browser-session` each handed out
live-view details and a `cdpToken` on the strength of the link token alone —
those endpoints are the defect, and `redeem` answers the same questions behind
the session check, so both go.

`/api/connect/capture` stays, because capture is a separate act from redemption:
it happens after the human has finished logging in, and the page calls it later
with the same link. It gains the session-plus-match check, and changes shape —
the link token moves out of `Authorization` (which now carries the portal
session) and into the body.

**Files:**
- Modify: `packages/server/src/api/routes.ts:576-640` (delete `/api/connect/session` and `/api/connect/browser-session`, rework `/api/connect/capture`)
- Test: `packages/server/tests/routes.test.ts:825-…` (replace the three `/api/connect/session` cases, rework the capture cases)

**Interfaces:**
- Consumes: `authenticate`, `verifyConnectToken`.
- Produces:
  - `POST /api/connect/capture` — `Authorization: Bearer <session>`, body `{ token }`. Same 200 body as today (`{ success, cookieCount }`). `401 AUTH_REQUIRED`, `401 LINK_INVALID`, `403 ACCOUNT_MISMATCH`.
  - `GET /api/connect/session` — **removed**.
  - `GET /api/connect/browser-session` — **removed**; `POST /api/connect/redeem` replaces it.

- [ ] **Step 1: Write the failing tests**

In `packages/server/tests/routes.test.ts`, delete the three
`GET /api/connect/session` cases (`routes.test.ts:825-868`) and replace them with
one case asserting the route is gone. Rework the capture cases to send both
credentials.

```typescript
    it("GET /api/connect/session no longer exists", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/connect/session",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("POST /api/connect/capture captures when session and link agree", async () => {
      const { captureLiveCookies } = await import("../src/auth/browser-session");
      const { storeCookies } = await import("../src/auth/cookie");
      const { markConnected } = await import("../src/auth/connections");
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegForConnect);
      vi.mocked(captureLiveCookies).mockResolvedValue({
        domain: "legacy.com",
        cookies: [{ name: "x", value: "y" }],
        capturedAt: Math.floor(Date.now() / 1000),
      });
      const token = await signConnectToken(
        { connectionId: "c1", userId: "user-1", integration: "legacy", sessionId: "user-1" },
        600
      );
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/connect/capture",
        headers: { authorization: "Bearer valid-jwt" },
        payload: { token },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().cookieCount).toBe(1);
      expect(storeCookies).toHaveBeenCalledWith("user-1", "legacy", expect.objectContaining({ cookies: [{ name: "x", value: "y" }] }));
      expect(markConnected).toHaveBeenCalledWith("user-1", "legacy");
    });

    it("POST /api/connect/capture 403s when the session is a different user", async () => {
      const { captureLiveCookies } = await import("../src/auth/browser-session");
      const { storeCookies } = await import("../src/auth/cookie");
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegForConnect);
      const token = await signConnectToken(
        { connectionId: "c1", userId: "user-1", integration: "legacy", sessionId: "user-1" },
        600
      );
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/connect/capture",
        headers: { authorization: "Bearer other-jwt" },
        payload: { token },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("ACCOUNT_MISMATCH");
      // The gate must not depend on redeem having run first.
      expect(captureLiveCookies).not.toHaveBeenCalled();
      expect(storeCookies).not.toHaveBeenCalled();
    });

    it("POST /api/connect/capture 401s with a valid link but no session", async () => {
      const token = await signConnectToken(
        { connectionId: "c1", userId: "user-1", integration: "legacy", sessionId: "user-1" },
        600
      );
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/api/connect/capture", payload: { token } });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("AUTH_REQUIRED");
    });

    it("GET /api/connect/browser-session no longer exists", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/connect/browser-session?t=anything",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(404);
    });
```

Also update the remaining capture cases in that block (the zero-cookie case and
any others) to the new request shape: `authorization: "Bearer valid-jwt"` plus
`payload: { token }`, and `userId: "user-1"` in the minted link so it matches the
session mock.

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/server`: `npx vitest run tests/routes.test.ts`
Expected: FAIL — `/api/connect/session` still returns 200, and capture still
reads the link from `Authorization`, so the 403 cases pass a session JWT into
`verifyConnectToken` and get 401 instead of 403.

- [ ] **Step 3: Implement**

Delete the whole `app.get("/api/connect/session", …)` handler and the whole
`app.get("/api/connect/browser-session", …)` handler from
`packages/server/src/api/routes.ts`. Replace the capture handler:

```typescript
  // Capture the cookies now present in the user's warm browser session. The
  // portal session proves who is asking; the link token says which pending
  // connection they are completing. Both must name the same user — checking
  // only the link is what let a third party's login be stored under someone
  // else's account.
  app.post<{ Body: { token?: string } }>("/api/connect/capture", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.status(401).send({ error: "AUTH_REQUIRED" });

    const linkToken = request.body?.token;
    if (!linkToken) return reply.status(401).send({ error: "LINK_INVALID" });

    let payload;
    try { payload = await verifyConnectToken(linkToken); }
    catch { return reply.status(401).send({ error: "LINK_INVALID" }); }

    if (payload.userId !== user.userId) {
      return reply.status(403).send({ error: "ACCOUNT_MISMATCH", integration: payload.integration });
    }

    const integ = registry.getIntegration(payload.integration);
    if (!integ || integ.auth.type !== "cookie") {
      return reply.status(404).send({ error: "Cookie integration not found" });
    }
    try {
      const data = await captureLiveCookies(user.userId, integ.auth.targetDomain, integ.auth.cookieDomains);
      if (data.cookies.length === 0) {
        return reply.status(400).send({ error: "No cookies captured. Complete login before capturing." });
      }
      await storeCookies(user.userId, payload.integration, data);
      markConnected(user.userId, payload.integration);
      return { success: true, cookieCount: data.cookies.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `packages/server`: `npx vitest run tests/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/tests/routes.test.ts
git commit -m "feat(connect): require a matching session on cookie capture"
```

---

### Task 4: Mint claim-only links

Every mint site currently front-loads the side effects: `startConnect` warms a
browser session and embeds a live `cdpToken` before any human is identified, and
the oauth2 branch hands the agent a provider consent URL that anyone can
complete. After this task, a mint allocates a pending record and returns a
workbench URL. Nothing else.

**Files:**
- Modify: `packages/server/src/mcp/meta-tools.ts:28-63` (`startConnect`)
- Modify: `packages/server/src/plugins/internal/browser.ts:134-147` (`browser_live_url`)
- Modify: `packages/server/src/api/routes.ts:535-565` (`POST /api/browser-session/live-url`)
- Test: `packages/server/tests/meta-tools.test.ts`, `packages/server/tests/browser-live-url.test.ts`

**Interfaces:**
- Consumes: `createPending` (existing), `signConnectToken` with the payload shape from Task 5 minus `cdpToken` — until Task 5 lands, pass `cdpToken: ""`.
- Produces: `connect(integration)` returns `{ connectionId, type, url }` where
  `url` is always `${PORTAL_URL}/connect/${integration}?t=<jwt>`, for both
  `cookie` and `oauth2`. `browser_live_url` returns
  `${PORTAL_URL}/browser?t=<jwt>` with no warm session created at mint time.

- [ ] **Step 1: Write the failing tests**

In `packages/server/tests/meta-tools.test.ts`, add cases asserting the oauth2
mint no longer reaches the provider and no session is warmed. Match the file's
existing mocking style for `registry`, `ensureSession` and `buildPluginAuthUrl`.

```typescript
  it("connect returns a workbench link for an oauth2 integration", async () => {
    const { buildPluginAuthUrl } = await import("../src/auth/plugin-oauth");
    vi.spyOn(registry, "getIntegration").mockReturnValue({
      name: "github",
      version: "1.0.0",
      auth: { type: "oauth2" as const, scopes: ["repo"] },
    } as never);

    const res = await callMetaTool("connect", "user-1", { integration: "github" });

    expect(res.type).toBe("oauth2");
    expect(res.url).toMatch(/\/connect\/github\?t=/);
    expect(res.url).not.toContain("example.com/oauth");
    // The provider URL is built at redeem time, by a proven owner.
    expect(buildPluginAuthUrl).not.toHaveBeenCalled();
  });

  it("connect does not warm a browser session for a cookie integration", async () => {
    const { ensureSession } = await import("../src/auth/browser-session");
    vi.spyOn(registry, "getIntegration").mockReturnValue({
      name: "legacy",
      version: "1.0.0",
      auth: {
        type: "cookie" as const,
        loginUrl: "https://legacy.example.com/login",
        targetDomain: "legacy.example.com",
        cookieDomains: [],
      },
    } as never);

    const res = await callMetaTool("connect", "user-1", { integration: "legacy" });

    expect(res.type).toBe("cookie");
    expect(res.url).toMatch(/\/connect\/legacy\?t=/);
    expect(ensureSession).not.toHaveBeenCalled();
  });
```

`callMetaTool` is a helper: if `meta-tools.test.ts` does not already have one,
follow whatever invocation pattern the file uses for other meta-tools rather than
inventing a new one.

In `packages/server/tests/browser-live-url.test.ts`, add:

```typescript
  it("mints a link without warming a session or embedding a cdpToken", async () => {
    const { ensureSession } = await import("../src/auth/browser-session");
    const { verifyConnectToken } = await import("../src/auth/connect-token");

    const res = await callBrowserLiveUrl("user-1");

    expect(res.url).toMatch(/\/browser\?t=/);
    expect(ensureSession).not.toHaveBeenCalled();
    const jwt = new URL(res.url).searchParams.get("t")!;
    const payload = await verifyConnectToken(jwt);
    expect(payload.userId).toBe("user-1");
    expect(payload.integration).toBe("__browser__");
  });
```

Again, reuse the file's existing invocation helper rather than adding one.

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/server`: `npx vitest run tests/meta-tools.test.ts tests/browser-live-url.test.ts`
Expected: FAIL — the oauth2 branch still returns the provider URL, and
`ensureSession` is called at mint time.

- [ ] **Step 3: Implement**

Replace the body of `startConnect` in `packages/server/src/mcp/meta-tools.ts`
after the `auth.type === "none"` guard:

```typescript
  const ttl = config.CONNECT_TTL_SECONDS;
  if (integ.auth.type !== "cookie" && integ.auth.type !== "oauth2") {
    return { error: `${integration} cannot be connected from the agent — connect it from the portal.` };
  }

  // The link is a claim, not a capability: it names the integration and the
  // workbench user it was minted for, and nothing else. Warming a browser
  // session or building a provider consent URL happens at /api/connect/redeem,
  // once a human has proved they own this account.
  const rec = createPending({ userId, integration, type: integ.auth.type, ttlSeconds: ttl });
  const jwt = await signConnectToken(
    { connectionId: rec.connectionId, userId, integration, sessionId: userId, cdpToken: "" },
    ttl
  );
  return {
    connectionId: rec.connectionId,
    type: integ.auth.type,
    url: `${config.PORTAL_URL}/connect/${integration}?t=${jwt}`,
  };
```

Update the `connect` and `get_auth_url` tool descriptions in the same file. The
current text promises a provider consent page for oauth2. Replace both with:

```
Begin connecting an integration. Returns a connectionId and a workbench URL for the user to open. The user must be signed in to workbench as the same account this agent is connected to; the link will not work for anyone else. Call wait_for_connection afterward.
```

In `packages/server/src/plugins/internal/browser.ts`, replace the
`browser_live_url` handler body:

```typescript
    handler: async (ctx: any) => {
      // No ensureSession here: the session is warmed at redeem time, after the
      // opener proves they own this account.
      const rec = createPending({
        userId: ctx.userId,
        integration: "__browser__",
        type: "cookie",
        ttlSeconds: config.CONNECT_TTL_SECONDS,
      });
      const jwt = await signConnectToken(
        { connectionId: rec.connectionId, userId: ctx.userId, integration: "__browser__", sessionId: ctx.userId, cdpToken: "" },
        config.CONNECT_TTL_SECONDS
      );
      return { url: `${config.PORTAL_URL}/browser?t=${jwt}` };
    },
```

Add `createPending` to that file's imports from `../../auth/connections`.

`POST /api/browser-session/live-url` (`packages/server/src/api/routes.ts:535`)
needs a smaller change. It already calls `authenticate(request)`, so the human
minting the link has proved who they are and the side effects are legitimate at
mint time. Keep `ensureSession`, `navigate`, the `url` parameter, and the
`BROWSER_SESSION_BUSY` branch exactly as they are. Change one thing: the minted
token must go through `createPending` and carry no `cdpToken`, so the link it
returns is redeemable exactly once and carries no capability:

```typescript
      const s = await ensureSession(user.userId);
      if (url) await navigate(s, url);
      const rec = createPending({
        userId: user.userId,
        integration: "__browser__",
        type: "cookie",
        ttlSeconds: config.CONNECT_TTL_SECONDS,
      });
      const token = await signConnectToken(
        { connectionId: rec.connectionId, userId: user.userId, integration: "__browser__", sessionId: user.userId, cdpToken: "" },
        config.CONNECT_TTL_SECONDS
      );
      return { url: `${config.PORTAL_URL}/browser?t=${token}` };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run from `packages/server`: `npm run test -w @a-workbench/server`
Expected: PASS. Fix any pre-existing test that asserted the old oauth2 response
shape — that assertion is now wrong, not the code.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mcp/meta-tools.ts packages/server/src/plugins/internal/browser.ts packages/server/src/api/routes.ts packages/server/tests
git commit -m "feat(connect): mint claim-only connect links"
```

---

### Task 5: Drop the CDP capability from the link token

With the portal page behind a session, the connect JWT never needs to authorize a
websocket. Removing `cdpToken` from the payload and deleting the connect-JWT
branch in `authorizeCdpFrame` is what actually closes the live-browser exposure —
gating the HTTP endpoints alone would leave a token that still authenticates CDP.

**Files:**
- Modify: `packages/server/src/auth/connect-token.ts:8-52`
- Modify: `packages/server/src/auth/cdp-authz.ts:4-43`
- Test: `packages/server/tests/connect-token.test.ts`, `packages/server/tests/cdp-authz.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ConnectTokenPayload = { connectionId, userId, integration, sessionId }`.
  `authorizeCdpFrame(frame, portalUserId, expectedIntegration)` keeps its
  signature; `CdpAuthFrame.bearer` is removed and a frame without a matching
  `portalUserId` is always rejected.

- [ ] **Step 1: Write the failing tests**

In `packages/server/tests/connect-token.test.ts`, remove `cdpToken` from the
`payload` fixture and the `expect(decoded.cdpToken)` assertion, then add:

```typescript
  it("does not carry a cdpToken", async () => {
    const token = await signConnectToken(payload, 600);
    const decoded = await verifyConnectToken(token);
    expect("cdpToken" in decoded).toBe(false);
  });
```

In `packages/server/tests/cdp-authz.test.ts`, replace the connect-JWT acceptance
cases with rejection cases:

```typescript
  it("rejects a frame whose only credential is a connect JWT", async () => {
    const result = await authorizeCdpFrame(
      { sessionId: "user-1", cdpToken: "tok-1", bearer: "jwt" } as never,
      null,
      "__browser__"
    );
    expect(result).toBeNull();
    expect(verifyConnectTokenMock).not.toHaveBeenCalled();
    expect(getWarmCdpEndpointMock).not.toHaveBeenCalled();
  });
```

Keep the two existing `portalUserId` cases unchanged — they are the supported
path now.

- [ ] **Step 2: Run the tests to verify they fail**

Run from `packages/server`: `npx vitest run tests/connect-token.test.ts tests/cdp-authz.test.ts`
Expected: FAIL — the JWT still round-trips `cdpToken`, and the connect-JWT branch
still authorizes the frame.

- [ ] **Step 3: Implement**

In `packages/server/src/auth/connect-token.ts`, delete `cdpToken` from
`ConnectTokenPayload`, from the `SignJWT` claims object, from the type guard in
`verifyConnectToken`, and from its return object.

Replace `packages/server/src/auth/cdp-authz.ts` with:

```typescript
import { getWarmCdpEndpoint } from "./browser-session";

export interface CdpAuthFrame {
  sessionId?: string;
  cdpToken?: string;
}

// Resolve the page-WS endpoint an authenticated CDP-proxy client may attach to,
// or null if the auth frame is not authorized. `portalUserId` is the userId
// proven by the portal session bearer (or null if none).
//
// A portal session is the only credential accepted here. Connect links used to
// authorize this socket, which made a leaked link a live handle on someone
// else's browser; the /connect and /browser pages now require a session, so
// nothing needs that path any more. `expectedIntegration` is retained for the
// caller's route pinning and is unused in the authorization decision.
export async function authorizeCdpFrame(
  frame: CdpAuthFrame,
  portalUserId: string | null,
  _expectedIntegration: string
): Promise<string | null> {
  if (!portalUserId || portalUserId !== frame.sessionId) return null;
  return getWarmCdpEndpoint(portalUserId, frame.cdpToken ?? "");
}
```

Fix every call site the compiler flags. Three mint sites from Task 4 pass
`cdpToken: ""` and must drop the field: `startConnect`
(`src/mcp/meta-tools.ts`), `browser_live_url`
(`src/plugins/internal/browser.ts`), and `POST /api/browser-session/live-url`
(`src/api/routes.ts`).

- [ ] **Step 4: Run the tests to verify they pass**

Run from `packages/server`: `npm run test -w @a-workbench/server`
Then: `npm run typecheck:tests -w @a-workbench/server`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/connect-token.ts packages/server/src/auth/cdp-authz.ts packages/server/src/mcp/meta-tools.ts packages/server/src/plugins/internal/browser.ts packages/server/tests
git commit -m "fix(connect): stop connect links from authorizing the CDP socket"
```

---

### Task 6: Put the connect pages behind a session

`/connect/:integration` and `/browser` sit outside `RequireAuth`, which is what
makes them magic links. Moving them inside is the portal half of the gate. The
existing `RequireAuth` sends an unauthenticated visitor to `/login` with
`<Navigate replace>`, which loses where they were going — and SSO always returns
to the portal root — so the intended path has to be remembered across the round
trip.

**Files:**
- Modify: `packages/portal/src/App.tsx:16-38`
- Modify: `packages/portal/src/pages/Login.tsx:10-12`

**Interfaces:**
- Consumes: nothing.
- Produces: `sessionStorage["awb_return_to"]` — a portal-relative path written by
  `RequireAuth` before redirecting to `/login`, read and cleared by `Login` once
  a token exists.

- [ ] **Step 1: Change the routes**

In `packages/portal/src/App.tsx`, wrap both routes and record the return path:

```tsx
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <Boot label="VERIFY SESSION" />;
  if (!user) {
    // SSO always returns to the portal root, so remember where the human was
    // headed. A connect link is useless if login drops them on the dashboard.
    sessionStorage.setItem("awb_return_to", location.pathname + location.search);
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}
```

Add `useLocation` to the `react-router-dom` import. Then:

```tsx
      <Route path="/connect/:integration" element={<RequireAuth><Connect /></RequireAuth>} />
      <Route path="/browser" element={<RequireAuth><BrowserView /></RequireAuth>} />
```

In `packages/portal/src/pages/Login.tsx`, replace the redirect effect:

```tsx
  useEffect(() => {
    if (!token) return;
    const returnTo = sessionStorage.getItem("awb_return_to");
    sessionStorage.removeItem("awb_return_to");
    // Only ever an in-app path — never trust a stored value as a full URL.
    window.location.href = returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  }, [login, token]);
```

- [ ] **Step 2: Verify by hand**

Run `npm run dev`. In a private window, open
`http://localhost:5173/connect/github?t=anything`. Expected: redirected to the
login screen, not the connect UI. Sign in. Expected: returned to
`/connect/github?t=anything`, which then reports the link error from the server
(the token is garbage) rather than rendering a connect flow.

- [ ] **Step 3: Build the portal**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add packages/portal/src/App.tsx packages/portal/src/pages/Login.tsx
git commit -m "feat(portal): require a session on the connect and browser pages"
```

---

### Task 7: Redeem from the portal and show the mismatch

The pages now hold a session, so they call `redeem` first and switch on the
result. A mismatch is a dead end by design: it states which account the link
belongs to and offers sign-out, and gives no way to continue.

**Files:**
- Modify: `packages/portal/src/api.ts:220-241` (replace `connectSession`, rework `connectCapture`), `:293-297` (delete `connectBrowserSession`)
- Modify: `packages/portal/src/pages/Connect.tsx`
- Modify: `packages/portal/src/pages/BrowserView.tsx`
- Modify: `packages/portal/src/components/CdpScreencast.tsx:3-16,29` (drop the `bearer` prop; keep `cdpToken`)

**Interfaces:**
- Consumes: `POST /api/connect/redeem` and `POST /api/connect/capture`
  (Tasks 2 and 3). `GET /api/connect/browser-session` no longer exists.
- Produces:
  - `redeemConnectLink(token: string): Promise<RedeemResult>` where
    `type RedeemResult = { type: "cookie"; integration: string; loginUrl: string; cdpProxyUrl: string; sessionId: string; cdpToken: string } | { type: "oauth2"; url: string } | { type: "browser"; cdpProxyUrl: string; sessionId: string; cdpToken: string }`
  - `class ConnectLinkError extends Error { code: "AUTH_REQUIRED" | "LINK_INVALID" | "LINK_CONSUMED" | "ACCOUNT_MISMATCH" | "UNKNOWN"; integration?: string }`
  - `connectCapture(token: string)` — unchanged return type, new request shape.

- [ ] **Step 1: Rework the API client**

In `packages/portal/src/api.ts`, delete `connectSession` and add:

```typescript
export type RedeemResult =
  | { type: "cookie"; integration: string; loginUrl: string; cdpProxyUrl: string; sessionId: string; cdpToken: string }
  | { type: "oauth2"; url: string }
  | { type: "browser"; cdpProxyUrl: string; sessionId: string; cdpToken: string };

export type ConnectLinkCode =
  | "AUTH_REQUIRED" | "LINK_INVALID" | "LINK_CONSUMED" | "ACCOUNT_MISMATCH" | "UNKNOWN";

export class ConnectLinkError extends Error {
  code: ConnectLinkCode;
  integration?: string;
  constructor(code: ConnectLinkCode, integration?: string) {
    super(code);
    this.code = code;
    this.integration = integration;
  }
}

async function connectLinkError(res: Response): Promise<ConnectLinkError> {
  const body = await res.json().catch(() => ({}));
  const known: ConnectLinkCode[] = ["AUTH_REQUIRED", "LINK_INVALID", "LINK_CONSUMED", "ACCOUNT_MISMATCH"];
  const code = known.includes(body.error) ? (body.error as ConnectLinkCode) : "UNKNOWN";
  return new ConnectLinkError(code, body.integration);
}

export async function redeemConnectLink(token: string): Promise<RedeemResult> {
  const res = await fetch(`${API_URL}/api/connect/redeem`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw await connectLinkError(res);
  return res.json();
}
```

Rework the capture call to send the session header and the link in the payload:

```typescript
export async function connectCapture(token: string) {
  const res = await fetch(`${API_URL}/api/connect/capture`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw await connectLinkError(res);
  return res.json() as Promise<{ success: boolean; cookieCount: number }>;
}

```

Delete `connectBrowserSession` entirely — `redeemConnectLink` returns the
`browser` arm, so `BrowserView` uses the same call as `Connect`:

```typescript
// (nothing replaces connectBrowserSession; remove the export and its callers)
```

- [ ] **Step 2: Add the outcome view**

Create `packages/portal/src/components/ConnectLinkProblem.tsx`:

```tsx
import { useAuth } from "../context/AuthContext";
import type { ConnectLinkError } from "../api";

const COPY: Record<string, { title: string; detail: string }> = {
  LINK_INVALID: {
    title: "Link invalid or expired",
    detail: "Ask your agent to generate a new connect link.",
  },
  LINK_CONSUMED: {
    title: "Link already used",
    detail: "A connect link works once. Ask your agent for a new one.",
  },
  UNKNOWN: {
    title: "Could not open this link",
    detail: "Ask your agent to generate a new connect link.",
  },
};

export default function ConnectLinkProblem({ error }: { error: ConnectLinkError }) {
  const { user, logout } = useAuth();

  if (error.code === "ACCOUNT_MISMATCH") {
    return (
      <div className="modal-backdrop" role="dialog" aria-modal="true">
        <div className="modal">
          <div className="modal-head">
            <h2 className="modal-title">Wrong workbench account</h2>
          </div>
          <div className="modal-instructions">
            <div>
              This link connects <b>{error.integration}</b> to a different workbench
              account than the one you are signed in to{user?.email ? ` (${user.email})` : ""}.
            </div>
            <div>
              Connecting from here would attach your credentials to that other
              account. Sign in as the account the link was made for, or ask your
              agent for a link for this account.
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" onClick={logout}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  const copy = COPY[error.code] ?? COPY.UNKNOWN;
  return (
    <div className="boot">
      <span>{copy.title} — {copy.detail}</span>
    </div>
  );
}
```

`AUTH_REQUIRED` needs no case: `RequireAuth` has already sent an
unauthenticated visitor to login before the page renders.

- [ ] **Step 3: Rework the Connect page**

In `packages/portal/src/pages/Connect.tsx`, redeem on mount, redirect on oauth2,
and render the screencast on cookie. Replace the effect and the error branch:

```tsx
  const [problem, setProblem] = useState<ConnectLinkError | null>(null);

  useEffect(() => {
    if (!jwt) { setError("Missing link token."); return; }
    redeemConnectLink(jwt)
      .then((result) => {
        if (result.type === "oauth2") { window.location.href = result.url; return; }
        if (result.type === "cookie") { setInfo(result); return; }
        setError("Unexpected link type.");
      })
      .catch((e) => {
        if (e instanceof ConnectLinkError) setProblem(e);
        else setError(e instanceof Error ? e.message : "Link failed");
      });
  }, [jwt]);

  if (problem) return <ConnectLinkProblem error={problem} />;
```

`SessionInfo` becomes the cookie arm of `RedeemResult`. `CdpScreencast` no
longer receives `cdpToken` or `bearer`:

```tsx
          <CdpScreencast cdpProxyUrl={info.cdpProxyUrl} sessionId={info.sessionId} cdpToken={info.cdpToken} width={1024} />
```

Redeem is single-use, so React 18 StrictMode's double-mount in development would
spend the link on the first render and fail the second. Guard with a ref:

```tsx
  const redeemed = useRef(false);
  useEffect(() => {
    if (redeemed.current) return;
    redeemed.current = true;
    // …redeem as above
  }, [jwt]);
```

- [ ] **Step 4: Rework the BrowserView page**

Same shape in `packages/portal/src/pages/BrowserView.tsx`: call
`redeemConnectLink(jwt)` behind the same `redeemed` ref guard, accept the
`browser` arm, render `ConnectLinkProblem` on a `ConnectLinkError`, and pass
`cdpProxyUrl`, `sessionId` and `cdpToken` from the result. Drop the `bearer`
prop from `CdpScreencast`.

- [ ] **Step 5: Drop the bearer prop from CdpScreencast**

In `packages/portal/src/components/CdpScreencast.tsx`, remove `bearer` from
`Props` and from the destructure, and delete the comment describing the
connect-JWT fallback. Keep `cdpToken`: `getWarmCdpEndpoint`
(`auth/browser-session.ts:180`) still pins the socket to one warm session with
it, and it now arrives from the redeem response rather than from a URL. The
websocket auth frame sends the portal session token from `localStorage`, which
is what the component already does when `bearer` is absent.

- [ ] **Step 6: Build and check by hand**

Run: `npm run build`
Expected: no TypeScript errors.

Then `npm run dev`, and with two workbench accounts in two browser profiles:
mint a connect link from an agent on account A, open it while signed in as
account B. Expected: the "Wrong workbench account" view, naming the integration,
with no way to proceed. Open the same link as account A: the connect flow runs.

- [ ] **Step 7: Commit**

```bash
git add packages/portal/src
git commit -m "feat(portal): redeem connect links and refuse an account mismatch"
```

---

### Task 8: Correct the documentation

The site documents `connect` as returning a provider consent page for oauth2 and
a portal login link that "warms the user's browser session" for cookie. Both
sentences are now wrong, and they are the text an agent operator reads when
deciding what to tell a human.

**Files:**
- Modify: `docs/site/_content/reference/meta-tools.md:151-183` (the `connect` section)
- Modify: any provider page under `docs/site/_content/` that describes the OAuth connect flow as agent-to-provider
- Modify: `docs/findings/` — add a new finding file

- [ ] **Step 1: Update the meta-tools reference**

Replace the `connect` response table so both rows describe a workbench link, and
replace the description block with the new tool description text from Task 4. Add
a note:

```markdown
> [!NOTE] A connect link only works for the account it was minted for
> The link names the workbench user the agent is connected to. Whoever opens it
> must be signed in to workbench as that same user. A different signed-in user
> gets a mismatch page and cannot proceed, so a forwarded link cannot attach
> someone else's credential to this account.
```

- [ ] **Step 2: Find the other affected pages**

Run: `grep -rn "consent page\|magic link\|no portal session" docs/site/_content/`
Fix every hit that describes the old behaviour.

- [ ] **Step 3: Record the finding**

Create `docs/findings/2026-09-02-connect-link-account-mismatch.md` describing the
defect and the fix: the link was a bearer capability carrying the minting user's
id, every redemption path trusted it alone, so a human completing the flow while
signed in to the provider as themselves stored their own credential under the
agent's workbench account — and a forwarded link additionally handed over a live
CDP handle. Fix: the link became a claim, redemption requires a matching portal
session, and side effects moved behind the match.

Add the one-line entry to the Findings Index in `CLAUDE.md`.

- [ ] **Step 4: Build the docs site**

Run: `node docs/site/build.mjs`
Expected: builds, no broken internal links reported.

- [ ] **Step 5: Full check**

```bash
npm run lint
npm run build
npm run test -w @a-workbench/server
npm run typecheck:tests -w @a-workbench/server
```

Expected: all clean.

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: connect links now require a matching workbench session"
```
