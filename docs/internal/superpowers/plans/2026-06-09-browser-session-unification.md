# Browser Session Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one Chromium per user serve both browser-use driving and cookie capture, so connecting a cookie integration after logging in via the live view captures the live cookies instead of failing with `BROWSER_SESSION_BUSY`.

**Architecture:** `auth/browser-session.ts` becomes the sole session owner. `auth/cookie.ts` is reduced to cookie persistence + a pure `filterCookies` + proxy-auth helpers. All cookie-session callers (portal routes, magic-link routes, MCP `startConnect`, the CDP proxy, the connections reaper) migrate to the per-user session keyed by `userId` and identified by its `cdpToken`. Capture is a read that never tears the session down; the existing idle reaper owns lifecycle.

**Tech Stack:** TypeScript, Fastify, ws (CDP WebSocket), vitest. Tests mock `spawnProfileChromium`, `cdpCall`, and `ws`.

---

## File Structure

- `packages/server/src/auth/cookie.ts` — **shrinks.** Keeps storage (`storeCookies`/`getCookies`/`deleteCookies`/`isCookieExpired`/`hasValidCookies`), the `CookieData` type, proxy-auth (`createProxyAuthHandler`/`startProxyAuth`), and a **new pure** `filterCookies`. Loses `startCookieSession`/`captureCookies`/`closeCookieSession`/`getSessionOwner`/`getSessionCdpEndpoint`/the `sessions` Map/the `Session` interface.
- `packages/server/src/auth/browser-session.ts` — **grows.** Wires proxy-auth into `ensureSession`; adds `captureLiveCookies`. Sole session owner.
- `packages/server/src/api/routes.ts` — migrates the cookie auth-start, capture, cancel, and `/api/connect/*` routes.
- `packages/server/src/mcp/meta-tools.ts` — migrates `startConnect` cookie branch.
- `packages/server/src/index.ts` — cookie CDP proxy validates via `getWarmCdpEndpoint`.
- `packages/server/src/auth/connections.ts` — reaper no longer closes cookie sessions; `cookieSessionId` removed.

**Naming note:** the spec mentioned renaming `WarmSession` → `BrowserSession`. That rename is cosmetic and touches many call sites (`getWarmSession`, `getWarmCdpEndpoint`) for no functional gain. **Skip it** — keep the existing `WarmSession`/`getWarmSession`/`getWarmCdpEndpoint` names. (YAGNI.)

---

## Task 1: Pure `filterCookies` in cookie.ts

Extract the domain-scoping + expired-drop logic from `captureCookies` into a pure, process-free function. Then make `captureCookies` delegate to it (no behavior change yet — `captureCookies` is removed in Task 4).

**Files:**
- Modify: `packages/server/src/auth/cookie.ts`
- Test: `packages/server/tests/cookie.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `packages/server/tests/cookie.test.ts` (import `filterCookies` from `../src/auth/cookie` in the existing import block):

```ts
describe("filterCookies", () => {
  const now = Math.floor(Date.now() / 1000);
  const raw = [
    { name: "live", value: "1", domain: ".example.com", path: "/", expires: now + 86400 },
    { name: "dead", value: "2", domain: "example.com", path: "/", expires: now - 10 },
    { name: "session", value: "3", domain: "app.example.com", path: "/" },
    { name: "sibling", value: "4", domain: "other.com", path: "/", expires: now + 86400 },
  ];

  it("keeps cookies on the target domain and its subdomains", () => {
    const out = filterCookies(raw, ["example.com"], now);
    const names = out.map((c) => c.name).sort();
    expect(names).toEqual(["live", "session"]);
  });

  it("drops cookies already expired at capture time", () => {
    const out = filterCookies(raw, ["example.com"], now);
    expect(out.find((c) => c.name === "dead")).toBeUndefined();
  });

  it("excludes sibling/unrelated hosts", () => {
    const out = filterCookies(raw, ["example.com"], now);
    expect(out.find((c) => c.name === "sibling")).toBeUndefined();
  });

  it("normalizes expires: 0/absent becomes undefined", () => {
    const out = filterCookies(raw, ["example.com"], now);
    expect(out.find((c) => c.name === "session")?.expires).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run packages/server/tests/cookie.test.ts -t filterCookies`
Expected: FAIL — `filterCookies is not a function` / not exported.

- [ ] **Step 3: Implement `filterCookies`**

In `packages/server/src/auth/cookie.ts`, add above `captureCookies`. The raw cookie shape is what `Storage.getCookies` returns (`sameSite` is a loose string):

```ts
type RawCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

// Pure: scope raw CDP cookies to the allowed domains (host-or-subdomain match,
// browser-like), drop cookies already expired at `now`, and normalize into the
// stored CookieData cookie shape. No process, no session — unit-testable.
export function filterCookies(
  raw: RawCookie[],
  domains: string[],
  now: number = Math.floor(Date.now() / 1000)
): CookieData["cookies"] {
  const allowed = new Set(domains.map((d) => d.replace(/^\./, "").toLowerCase()));
  return raw
    .filter((c) => {
      if (c.expires && c.expires > 0 && c.expires < now) return false;
      const bare = c.domain.replace(/^\./, "").toLowerCase();
      return [...allowed].some((d) => bare === d || bare.endsWith("." + d));
    })
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires && c.expires > 0 ? Math.floor(c.expires) : undefined,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as "Strict" | "Lax" | "None" | undefined,
    }));
}
```

- [ ] **Step 4: Make `captureCookies` delegate**

Replace the body of `captureCookies` (the `allowedDomains`/`now`/`filtered`/`return` block, lines ~179-204) with:

```ts
  const cookies = filterCookies(result.cookies, session.cookieDomains);
  return {
    domain: session.targetDomain,
    cookies,
    capturedAt: Math.floor(Date.now() / 1000),
  };
```

- [ ] **Step 5: Run, verify pass**

Run: `npx vitest run packages/server/tests/cookie.test.ts`
Expected: PASS — new `filterCookies` tests plus all existing cookie tests.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/auth/cookie.ts packages/server/tests/cookie.test.ts
git commit -m "refactor(cookie): extract pure filterCookies from captureCookies"
```

---

## Task 2: Proxy-auth wiring in `ensureSession`

Open a proxy-auth CDP socket for the per-user session when an authenticated capture proxy is configured, and close it on teardown. Fixes the latent bug where browser-use through an authenticated proxy can't answer the auth challenge.

**Files:**
- Modify: `packages/server/src/auth/browser-session.ts`
- Test: `packages/server/tests/browser-session.test.ts`

- [ ] **Step 1: Write failing test**

Add to `packages/server/tests/browser-session.test.ts`. The file already mocks `spawnProfileChromium` and `ws`. Add a spy on `startProxyAuth` via a mock of `cookie.ts`:

```ts
// at top with the other vi.mock calls:
const { proxyAuthMock } = vi.hoisted(() => ({ proxyAuthMock: vi.fn(() => ({ close: vi.fn() })) }));
vi.mock("../src/auth/cookie", async () => {
  const real = await vi.importActual<typeof import("../src/auth/cookie")>("../src/auth/cookie");
  return { ...real, startProxyAuth: proxyAuthMock };
});
```

```ts
describe("ensureSession proxy-auth wiring", () => {
  beforeEach(() => { proxyAuthMock.mockClear(); });
  afterEach(() => {
    delete process.env.CAPTURE_PROXY;
    delete process.env.CAPTURE_PROXY_USERNAME;
    delete process.env.CAPTURE_PROXY_PASSWORD;
  });

  it("opens a proxy-auth socket when CAPTURE_PROXY + creds are set", async () => {
    process.env.CAPTURE_PROXY = "http://proxy:8080";
    process.env.CAPTURE_PROXY_USERNAME = "u";
    process.env.CAPTURE_PROXY_PASSWORD = "p";
    await ensureSession("user-proxy");
    expect(proxyAuthMock).toHaveBeenCalledWith("ws://127.0.0.1:9999/browser", "u", "p");
  });

  it("does not open a proxy-auth socket without proxy env", async () => {
    await ensureSession("user-noproxy");
    expect(proxyAuthMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run packages/server/tests/browser-session.test.ts -t "proxy-auth"`
Expected: FAIL — `proxyAuthMock` not called (wiring absent).

- [ ] **Step 3: Implement**

In `packages/server/src/auth/browser-session.ts`:

Add the import (top of file, after the existing imports):

```ts
import { startProxyAuth } from "./cookie";
import type WebSocket from "ws";
```

Add an `authWs` field to the `WarmSession` interface:

```ts
export interface WarmSession {
  proc: ChildProcess;
  remotePort: number;
  cdpPageWsUrl: string;
  cdpBrowserWsUrl: string;
  cdpToken: string;
  userId: string;
  lastActivity: number;
  lastShotHash?: string;
  cdp: CdpClient;
  authWs?: WebSocket;
}
```

In `ensureSession`, after `const cdp = new CdpClient(...)` and `await cdp.ready;`, before building `session`:

```ts
    const proxyUser = process.env.CAPTURE_PROXY_USERNAME;
    const proxyPass = process.env.CAPTURE_PROXY_PASSWORD;
    const authWs =
      process.env.CAPTURE_PROXY && proxyUser && proxyPass
        ? startProxyAuth(spawned.cdpBrowserWsUrl, proxyUser, proxyPass)
        : undefined;
```

Add `authWs` to the `session` object literal. In the `proc.on("exit", ...)` handler and in `closeBrowserSession`, close it alongside `cdp`:

```ts
      try { session.authWs?.close(); } catch { /* noop */ }
```
(in `closeBrowserSession`, use `s.authWs?.close()`.)

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run packages/server/tests/browser-session.test.ts`
Expected: PASS — proxy-auth tests + all existing browser-session tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/browser-session.ts packages/server/tests/browser-session.test.ts
git commit -m "feat(browser-session): wire proxy-auth into ensureSession (fixes warm-session proxy auth)"
```

---

## Task 3: `captureLiveCookies` in browser-session.ts

A read-only capture against the user's live session. No store, no kill.

**Files:**
- Modify: `packages/server/src/auth/browser-session.ts`
- Test: `packages/server/tests/browser-session.test.ts`

- [ ] **Step 1: Write failing test**

Add a `cdpCall` mock to the `profile-chromium` mock in `browser-session.test.ts`. Update the existing `vi.mock("../src/auth/profile-chromium", ...)` to also return a mock `cdpCall`:

```ts
const { spawnMock, cdpCallMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  cdpCallMock: vi.fn(),
}));
// inside the profile-chromium mock's returned object, add:
//   cdpCall: cdpCallMock,
```

```ts
import { captureLiveCookies } from "../src/auth/browser-session";

describe("captureLiveCookies", () => {
  const now = Math.floor(Date.now() / 1000);
  beforeEach(() => { cdpCallMock.mockReset(); });

  it("filters live CDP cookies to the integration's domains", async () => {
    await ensureSession("user-cap");
    cdpCallMock.mockResolvedValue({
      cookies: [
        { name: "live", value: "1", domain: ".jira.com", path: "/", expires: now + 86400 },
        { name: "other", value: "2", domain: "evil.com", path: "/", expires: now + 86400 },
      ],
    });
    const data = await captureLiveCookies("user-cap", "jira.com", []);
    expect(data.domain).toBe("jira.com");
    expect(data.cookies.map((c) => c.name)).toEqual(["live"]);
    // browser-level Storage.getCookies, on the session's browser ws
    expect(cdpCallMock).toHaveBeenCalledWith("ws://127.0.0.1:9999/browser", "Storage.getCookies", {});
  });

  it("throws when no session exists for the user", async () => {
    await expect(captureLiveCookies("nobody", "jira.com", [])).rejects.toThrow(/no browser session/i);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run packages/server/tests/browser-session.test.ts -t captureLiveCookies`
Expected: FAIL — `captureLiveCookies is not a function`.

- [ ] **Step 3: Implement**

In `packages/server/src/auth/browser-session.ts`:

Add to the imports from `./profile-chromium` (it currently imports `activeProfiles, spawnProfileChromium`):

```ts
import { activeProfiles, spawnProfileChromium, cdpCall } from "./profile-chromium";
```

Add the import from `./cookie` (extend Task 2's import line):

```ts
import { startProxyAuth, filterCookies, CookieData } from "./cookie";
```

Add after `getWarmSession`:

```ts
// Read the user's live browser cookies, scoped to an integration's domains.
// A pure read over the existing session's browser-level CDP endpoint — does not
// store and does not tear the session down. Throws if the user has no session.
export async function captureLiveCookies(
  userId: string,
  targetDomain: string,
  cookieDomains: string[] = []
): Promise<CookieData> {
  const session = warmSessions.get(userId);
  if (!session) throw new Error("No browser session for user");
  const result = (await cdpCall(session.cdpBrowserWsUrl, "Storage.getCookies", {})) as {
    cookies: Parameters<typeof filterCookies>[0];
  };
  return {
    domain: targetDomain,
    cookies: filterCookies(result.cookies, [targetDomain, ...cookieDomains]),
    capturedAt: Math.floor(Date.now() / 1000),
  };
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run packages/server/tests/browser-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/browser-session.ts packages/server/tests/browser-session.test.ts
git commit -m "feat(browser-session): captureLiveCookies — read-only cookie capture on the shared session"
```

---

## Task 4: Migrate portal cookie routes (start + capture + cancel)

Rewire `GET /api/auth/:integration` (cookie branch), `POST /api/auth/cookie/:integration/capture`, and `POST /api/auth/cookie/:integration/cancel` to the unified session. Then delete the dead exports from `cookie.ts`.

**Files:**
- Modify: `packages/server/src/api/routes.ts`
- Modify: `packages/server/src/auth/cookie.ts` (delete dead session code)
- Test: `packages/server/tests/routes.test.ts`

- [ ] **Step 1: Write failing tests**

In `packages/server/tests/routes.test.ts`, locate how the app + auth are set up (existing cookie route tests use a mocked `ensureSession`/`captureLiveCookies` or a registered test integration). Add tests mirroring the existing harness. Mock `browser-session` so no real Chromium spawns:

```ts
// with the file's other vi.mock calls:
vi.mock("../src/auth/browser-session", async () => {
  const real = await vi.importActual<typeof import("../src/auth/browser-session")>("../src/auth/browser-session");
  return {
    ...real,
    ensureSession: vi.fn(async () => ({ cdpToken: "tok-123", userId: "u1" })),
    captureLiveCookies: vi.fn(),
    navigate: vi.fn(async () => ({ url: "x", title: "y" })),
  };
});
```

```ts
import { captureLiveCookies } from "../src/auth/browser-session";

describe("GET /api/auth/:integration (cookie) — smart capture", () => {
  it("returns connected immediately when the live session already has cookies", async () => {
    (captureLiveCookies as any).mockResolvedValueOnce({
      domain: "jira.com",
      cookies: [{ name: "s", value: "1", domain: "jira.com", path: "/", expires: 9999999999 }],
      capturedAt: 1,
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/test-cookie-integration",
      headers: authHeader, // existing test's authenticated header/cookie
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ type: "cookie", status: "connected" });
  });

  it("returns login_required with a live-view link when no live cookies", async () => {
    (captureLiveCookies as any).mockResolvedValueOnce({ domain: "jira.com", cookies: [], capturedAt: 1 });
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/test-cookie-integration",
      headers: authHeader,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      type: "cookie",
      status: "login_required",
      cdpToken: "tok-123",
      cdpProxyUrl: "/api/auth/cookie/test-cookie-integration/cdp",
    });
  });
});

describe("POST /api/auth/cookie/:integration/capture", () => {
  it("stores cookies and marks connected when capture is non-empty", async () => {
    (captureLiveCookies as any).mockResolvedValueOnce({
      domain: "jira.com",
      cookies: [{ name: "s", value: "1", domain: "jira.com", path: "/", expires: 9999999999 }],
      capturedAt: 1,
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/cookie/test-cookie-integration/capture",
      headers: authHeader,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, cookieCount: 1 });
  });

  it("400s on empty capture without killing the session", async () => {
    (captureLiveCookies as any).mockResolvedValueOnce({ domain: "jira.com", cookies: [], capturedAt: 1 });
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/cookie/test-cookie-integration/capture",
      headers: authHeader,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
```

> If `routes.test.ts` has no existing cookie-integration test fixture, register a minimal test integration in the test setup with `auth: { type: "cookie", loginUrl: "https://jira.com/login", targetDomain: "jira.com", cookieDomains: [] }`. Follow whatever registry-stubbing pattern the file already uses for other integrations.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run packages/server/tests/routes.test.ts -t "smart capture"`
Expected: FAIL — route still returns the old `{ sessionId, cdpToken, cdpProxyUrl, loginUrl }` shape / `status` absent.

- [ ] **Step 3: Rewrite the cookie auth-start branch**

In `packages/server/src/api/routes.ts`, replace the cookie branch of `GET /api/auth/:integration` (currently the `if (integ.auth.type === "cookie") { const { sessionId, cdpToken } = await startCookieSession(...) ... }` block, ~lines 288-306) with:

```ts
    if (integ.auth.type === "cookie") {
      const session = await ensureSession(user.userId);
      const live = await captureLiveCookies(
        user.userId,
        integ.auth.targetDomain,
        integ.auth.cookieDomains
      );
      if (!isCookieExpired(live)) {
        storeCookies(user.userId, integration, live);
        markConnected(user.userId, integration);
        return { type: "cookie", status: "connected" };
      }
      await navigate(session, integ.auth.loginUrl);
      return {
        type: "cookie",
        status: "login_required",
        cdpToken: session.cdpToken,
        cdpProxyUrl: `/api/auth/cookie/${integration}/cdp`,
        loginUrl: integ.auth.loginUrl,
      };
    }
```

- [ ] **Step 4: Rewrite the capture route**

Replace `POST /api/auth/cookie/:integration/capture` (~lines 350-377) with:

```ts
  app.post("/api/auth/cookie/:integration/capture", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.status(401).send({ error: "Unauthorized" });

    const { integration } = request.params as { integration: string };
    const integ = registry.getIntegration(integration);
    if (!integ || integ.auth.type !== "cookie") {
      return reply.status(404).send({ error: "Cookie integration not found" });
    }

    try {
      const data = await captureLiveCookies(user.userId, integ.auth.targetDomain, integ.auth.cookieDomains);
      if (data.cookies.length === 0) {
        return reply.status(400).send({ error: "No cookies captured. Complete login before capturing." });
      }
      storeCookies(user.userId, integration, data);
      markConnected(user.userId, integration);
      return { success: true, cookieCount: data.cookies.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });
```

- [ ] **Step 5: Soften the cancel route**

Replace `POST /api/auth/cookie/:integration/cancel` (~lines 489-504) with a soft dismiss — no teardown (idle reaper reclaims the shared session):

```ts
  app.post("/api/auth/cookie/:integration/cancel", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.status(401).send({ error: "Unauthorized" });
    // Capture shares the per-user browser session, which browser-use may also be
    // driving — do not kill it here. The idle reaper reclaims it on its own.
    return { success: true };
  });
```

- [ ] **Step 6: Delete dead session code from `cookie.ts`**

In `packages/server/src/auth/cookie.ts`, delete: the `Session` interface, the `sessions` Map, `startCookieSession`, `captureCookies`, `getSessionOwner`, `getSessionCdpEndpoint`, `closeCookieSession`. Keep `createProxyAuthHandler`, `startProxyAuth`, `CookieData`, `filterCookies`, and all storage helpers. Remove now-unused imports (`spawn`, `ChildProcess`, `userProfileDir`, `cdpCall`, `spawnProfileChromium`, `activeProfiles` if no longer referenced — `resetBrowserProfile` still uses `activeProfiles`, `userProfileDir`, and `rm`, so keep those).

Update `routes.ts` imports — remove `startCookieSession`, `captureCookies`, `closeCookieSession`, `getSessionOwner` from the `../auth/cookie` import; ensure `isCookieExpired`, `storeCookies`, `getCookies`, `hasValidCookies`, `deleteCookies`, `resetBrowserProfile`, `CookieData` remain; ensure `ensureSession`, `navigate`, `captureLiveCookies` are imported from `../auth/browser-session`.

- [ ] **Step 7: Run, verify pass**

Run: `npx vitest run packages/server/tests/routes.test.ts packages/server/tests/cookie.test.ts`
Expected: PASS. (Existing cookie tests that referenced `captureCookies`/`startCookieSession` directly must be updated/removed in this step — they now live behind `browser-session`.)

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/src/auth/cookie.ts packages/server/tests/routes.test.ts packages/server/tests/cookie.test.ts
git commit -m "feat(auth): unify portal cookie routes onto the shared browser session"
```

---

## Task 5: Migrate magic-link routes (`/api/connect/session` + `/api/connect/capture`)

**Files:**
- Modify: `packages/server/src/api/routes.ts`
- Test: `packages/server/tests/routes.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe("POST /api/connect/capture", () => {
  it("captures live cookies for the token's user and marks connected", async () => {
    (captureLiveCookies as any).mockResolvedValueOnce({
      domain: "jira.com",
      cookies: [{ name: "s", value: "1", domain: "jira.com", path: "/", expires: 9999999999 }],
      capturedAt: 1,
    });
    const token = await signConnectToken(
      { connectionId: "c1", userId: "u1", integration: "test-cookie-integration", sessionId: "u1", cdpToken: "tok-123" },
      300
    );
    const res = await app.inject({
      method: "POST",
      url: "/api/connect/capture",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, cookieCount: 1 });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run packages/server/tests/routes.test.ts -t "/api/connect/capture"`
Expected: FAIL — route still calls `getSessionOwner`/`captureCookies` (now deleted → compile or runtime error).

- [ ] **Step 3: Implement**

Replace `GET /api/connect/session` body's `sessionId` return field to use `payload.userId`:

```ts
    return {
      integration: payload.integration,
      loginUrl: integ.auth.loginUrl,
      cdpProxyUrl: `/api/auth/cookie/${payload.integration}/cdp`,
      sessionId: payload.userId,
      cdpToken: payload.cdpToken,
    };
```

Replace `POST /api/connect/capture` body with:

```ts
  app.post("/api/connect/capture", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    let payload;
    try { payload = await verifyConnectToken(auth.slice(7)); }
    catch { return reply.status(401).send({ error: "Invalid or expired link" }); }
    const integ = registry.getIntegration(payload.integration);
    if (!integ || integ.auth.type !== "cookie") {
      return reply.status(404).send({ error: "Cookie integration not found" });
    }
    try {
      const data = await captureLiveCookies(payload.userId, integ.auth.targetDomain, integ.auth.cookieDomains);
      if (data.cookies.length === 0) {
        return reply.status(400).send({ error: "No cookies captured. Complete login before capturing." });
      }
      storeCookies(payload.userId, payload.integration, data);
      markConnected(payload.userId, payload.integration);
      return { success: true, cookieCount: data.cookies.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });
```

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run packages/server/tests/routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/tests/routes.test.ts
git commit -m "feat(auth): magic-link capture uses the shared browser session"
```

---

## Task 6: Migrate MCP `startConnect` cookie branch

**Files:**
- Modify: `packages/server/src/mcp/meta-tools.ts`
- Test: `packages/server/tests/meta-tools.test.ts`

- [ ] **Step 1: Write failing test**

In `packages/server/tests/meta-tools.test.ts` (mock `browser-session` as in Task 4). Add:

```ts
import { captureLiveCookies } from "../src/auth/browser-session";

describe("startConnect (cookie) — smart capture", () => {
  it("connects immediately when live cookies already exist (no URL)", async () => {
    (captureLiveCookies as any).mockResolvedValueOnce({
      domain: "jira.com",
      cookies: [{ name: "s", value: "1", domain: "jira.com", path: "/", expires: 9999999999 }],
      capturedAt: 1,
    });
    // call the connect_integration meta-tool handler for a cookie integration
    const result = await callConnectTool("test-cookie-integration", "u1"); // use the file's existing tool-invocation helper
    expect(result).toMatchObject({ type: "cookie", connected: true });
    expect(result).not.toHaveProperty("url");
  });

  it("returns a /connect URL when not yet logged in", async () => {
    (captureLiveCookies as any).mockResolvedValueOnce({ domain: "jira.com", cookies: [], capturedAt: 1 });
    const result = await callConnectTool("test-cookie-integration", "u1");
    expect(result).toMatchObject({ type: "cookie" });
    expect((result as any).url).toContain("/connect/test-cookie-integration?t=");
  });
});
```

> Use whatever invocation helper `meta-tools.test.ts` already uses to call a meta-tool handler; if it tests `startConnect` indirectly via `connect_integration`, follow that.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run packages/server/tests/meta-tools.test.ts -t "smart capture"`
Expected: FAIL — old branch still calls `startCookieSession` (deleted) and never returns `connected`.

- [ ] **Step 3: Implement**

In `packages/server/src/mcp/meta-tools.ts`:

Update imports: remove `startCookieSession, closeCookieSession` from `../auth/cookie` (keep `hasValidCookies`); add `ensureSession, captureLiveCookies` from `../auth/browser-session`; ensure `storeCookies` is importable (from `../auth/cookie`) and `markConnected` from `../auth/connections`.

Replace the cookie branch of `startConnect` (~lines 50-66) with the following. Keep the session handle returned by `ensureSession` so the connect JWT carries the live session's real `cdpToken`:

```ts
  if (integ.auth.type === "cookie") {
    try {
      const session = await ensureSession(userId);
      const live = await captureLiveCookies(userId, integ.auth.targetDomain, integ.auth.cookieDomains);
      const rec = createPending({ userId, integration, type: "cookie", ttlSeconds: ttl });
      if (live.cookies.length > 0) {
        storeCookies(userId, integration, live);
        markConnected(userId, integration);
        return { connectionId: rec.connectionId, type: "cookie", connected: true };
      }
      const jwt = await signConnectToken(
        { connectionId: rec.connectionId, userId, integration, sessionId: userId, cdpToken: session.cdpToken },
        ttl
      );
      return { connectionId: rec.connectionId, type: "cookie", url: `${config.PORTAL_URL}/connect/${integration}?t=${jwt}` };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
```

Update `startConnect`'s return type union to include the instant-connect variant: `{ connectionId: string; type: "cookie"; connected: true }`.

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run packages/server/tests/meta-tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/mcp/meta-tools.ts packages/server/tests/meta-tools.test.ts
git commit -m "feat(mcp): startConnect cookie path uses shared session + smart capture"
```

---

## Task 7: Cookie CDP proxy validates via the warm session

**Files:**
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/tests/routes.test.ts` (or wherever CDP-proxy auth is exercised; if none, add a focused test)

- [ ] **Step 1: Write failing test**

The proxy is a WS route; mirror the existing browser-CDP-proxy test in the suite. If the suite already tests `/api/browser-session/cdp` auth-frame validation, clone it for `/api/auth/cookie/:integration/cdp`. The assertion: a connect JWT with `sessionId === userId` + matching `cdpToken` for a live session reaches `ready`; a mismatched `sessionId` closes with 4401.

> If no WS-proxy test harness exists, add a unit test around the extracted validation helper (Step 3 extracts the shared check). Prefer that — it avoids flaky socket tests.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run packages/server/tests/index-cdp.test.ts` (the file you add) or the cloned test.
Expected: FAIL — cookie proxy still uses `getSessionOwner`/`getSessionCdpEndpoint` (deleted).

- [ ] **Step 3: Implement**

In `packages/server/src/index.ts`:

Remove `import { getSessionCdpEndpoint } from "./auth/cookie";` (line 14). Remove the `require("./auth/cookie").getSessionOwner` block inside the cookie CDP proxy handler (~lines 195-206). Replace the cookie-proxy auth-frame validation with the same logic the browser proxy uses (~lines 290-302):

```ts
          // The warm session is keyed by userId; the link's sessionId IS the
          // userId. Require they match so a token can't target another user.
          if (!authedUserId || authedUserId !== msg.sessionId) {
            try { browserWs.close(4401, "Unauthorized"); } catch { /* noop */ }
            return;
          }
          const target = getWarmCdpEndpoint(authedUserId, msg.cdpToken);
          if (!target) {
            try { browserWs.close(4401, "Unauthorized"); } catch { /* noop */ }
            return;
          }
          clearTimeout(authTimeout);
          startProxy(target);
          try { browserWs.send(JSON.stringify({ type: "ready" })); } catch { /* noop */ }
          return;
```

`getWarmCdpEndpoint` is already imported (line 15). Confirm `authedUserId` is set the same way as the browser proxy (from the verified connect JWT's `sub`/`userId`).

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run packages/server/tests/` (whole server suite — this touches shared boot)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/index.ts packages/server/tests/
git commit -m "refactor(cdp-proxy): cookie proxy authorizes via the warm session"
```

---

## Task 8: Connections reaper stops killing cookie sessions

**Files:**
- Modify: `packages/server/src/auth/connections.ts`
- Test: `packages/server/tests/connections.test.ts`

- [ ] **Step 1: Write failing test**

```ts
it("expires a pending cookie connection without tearing down any browser session", async () => {
  // createPending with a tiny TTL, advance time, reap; assert status EXPIRED
  // and that no session-close was attempted (no cookieSessionId field exists).
  const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: 0 });
  await reapExpired();
  expect(getPending(rec.connectionId)?.status).toBe("EXPIRED");
});
```

> If `connections.test.ts` currently asserts `closeCookieSession` is called on expiry, delete/replace that assertion — the behavior is intentionally removed.

- [ ] **Step 2: Run, verify fail**

Run: `npx vitest run packages/server/tests/connections.test.ts`
Expected: FAIL to compile — `closeCookieSession` import is gone from `cookie.ts`.

- [ ] **Step 3: Implement**

In `packages/server/src/auth/connections.ts`:
- Remove `import { closeCookieSession } from "./cookie";` (line 2).
- Remove the `cookieSessionId?: string;` field from `PendingConnection` (line 15) and from the `createPending` args + assignment (lines 29, 40).
- In `reapExpired` (lines 87-91) remove the `if (rec.cookieSessionId) { await closeCookieSession(...) }` block — just set `rec.status = "EXPIRED"`.
- In `reapOne` (lines 109-111) remove the same block.
- `reapExpired`/`reapOne` may no longer need to be `async` — keep them `async` to avoid touching every caller's `await` (low-risk).

Also remove `cookieSessionId` from the `createPending` call in `meta-tools.ts` (already done in Task 6 — verify it's gone).

- [ ] **Step 4: Run, verify pass**

Run: `npx vitest run packages/server/tests/connections.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/connections.ts packages/server/tests/connections.test.ts
git commit -m "refactor(connections): pending expiry no longer tears down browser sessions"
```

---

## Task 9: Portal UX — instant-connect vs login-required

Update the portal connect flow to honor the new `status` field: `connected` flips the card immediately; `login_required` opens the live view with a Capture button.

**Files:**
- Modify: `packages/portal/src/api.ts` (the connect call's response type + handler)
- Modify: the portal component that initiates cookie connect (search: `cdpProxyUrl` / `loginUrl` usage in `packages/portal/src`)
- Test: portal has lighter test coverage; if a test harness exists for `api.ts`, add a type/branch test. Otherwise verify by build + manual smoke.

- [ ] **Step 1: Locate the connect flow**

Run: `grep -rn "cdpProxyUrl\|loginUrl\|/api/auth/\|type.*cookie" packages/portal/src`
Identify the function that calls `GET /api/auth/:integration` and branches on the response.

- [ ] **Step 2: Update the response type + branch**

Where the cookie response is typed, change it to a discriminated union:

```ts
type CookieAuthStart =
  | { type: "cookie"; status: "connected" }
  | { type: "cookie"; status: "login_required"; cdpToken: string; cdpProxyUrl: string; loginUrl: string };
```

In the handler: if `status === "connected"`, skip opening the live view — refetch connections / flip the card to connected and show a success toast. If `status === "login_required"`, open the live view as today (using `cdpToken` + `cdpProxyUrl`) and show the existing "Capture / Connect" button that POSTs `/api/auth/cookie/:integration/capture`.

- [ ] **Step 3: Build the portal**

Run: `npm run build`
Expected: BUILD OK (no type errors from the new union).

- [ ] **Step 4: Commit**

```bash
git add packages/portal/src
git commit -m "feat(portal): honor connected vs login_required on cookie connect"
```

---

## Task 10: Full suite + docs

**Files:**
- Modify: `docs/architecture.md`, `docs/how-to-use.md`
- Test: whole repo

- [ ] **Step 1: Run the full suite + build**

Run: `npm run build && npm run test`
Expected: BUILD OK, all tests pass. Fix any cross-file fallout (stale imports, type unions).

- [ ] **Step 2: Update docs**

In `docs/how-to-use.md` (cookie-connect section): note that if you've already logged into the site in the browser session, clicking Connect captures cookies instantly — no second login. In `docs/architecture.md`: update any text describing two separate browser processes to reflect the single per-user session shared by browser-use and cookie capture.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md docs/how-to-use.md
git commit -m "docs: single shared browser session for browser-use + cookie capture"
```

---

## Notes for the implementer

- **Keep tests green between tasks.** Tasks 1-3 add new code without removing old paths; Task 4 is where deletions land, so the `cookie.ts` test edits and `routes.ts` migration must happen together in Task 4.
- **No real Chromium in tests** — always mock `spawnProfileChromium`, `cdpCall`, and `ws`. Follow the existing `browser-session.test.ts` hoisted-mock pattern.
- **`isCookieExpired`** is the canonical "≥1 live cookie" predicate — reuse it for the smart-capture branch (`!isCookieExpired(live)`); don't reimplement the liveness check.
- **Circular-import guard:** `browser-session.ts` imports from `cookie.ts` (type + `filterCookies` + `startProxyAuth`); `cookie.ts` must NOT import from `browser-session.ts`. Verify after Task 4.
