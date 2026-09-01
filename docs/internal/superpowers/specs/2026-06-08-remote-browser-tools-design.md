# Remote Browser Tools (computer-use over the per-user session) — Design

**Date:** 2026-06-08
**Status:** Approved (brainstorm)
**Builds on:** v0.5.0 per-user persistent browser profile (`docs/superpowers/specs/2026-06-08-per-user-browser-profile-design.md`)

## Goal

Give the MCP client a set of **computer-use** browser tools — screenshot, click, type, key, scroll, navigate — that drive a **warm, per-user Chromium session** running on the workbench. The client's own LLM is the brain (workbench runs no LLM). A live URL lets the human watch and take over the same browser. This is "remote Playwright": workbench hosts the browser, exposes primitives, the client orchestrates.

Inspired by Composio's `BROWSER_TOOL` (create-task → watch-task autonomous agent), but inverted to fit workbench's aggregator model: **no server-side agent loop**, the client drives step-by-step.

## Non-goals (v1, YAGNI)

- No server-side LLM / autonomous task agent (no `create_task`/`watch_task`).
- No double-click, drag, file upload, multi-tab, `browser_wait` tools.
- No accessibility-tree snapshot (we chose screenshot + coordinates).
- No concurrent browser + cookie-capture per user (mutually exclusive, see below).

## Architecture

```
MCP client LLM ──tools/call──▶ meta-tools (browser_*)
                                   │
                                   ▼
                          browser-session.ts  ── warm CDP page client (1 per user)
                                   │                    │
                                   │              Input.* / Page.* / Page.captureScreenshot
                                   ▼                    ▼
                          profile-chromium.ts  ──▶ headless Chromium (--user-data-dir = per-user profile)
                                   ▲
human ──live URL──▶ portal /browser canvas ──WS──▶ /api/browser-session/cdp  (CDP screencast proxy)
```

Two drivers share one Chromium: the LLM (via `browser_*` tools issuing CDP) and the human (via the live-view CDP proxy). Both target the same page; this is collaborative, like screen-sharing.

### Components

**1. `packages/server/src/auth/profile-chromium.ts` (NEW, extracted)**
Shared low-level launcher. Pulled out of the current `cookie.ts` so both cookie-capture and the warm browser session use one code path and **one single-writer guard**.

Exports:
- `activeProfiles: Set<string>` — the per-user single-writer lock (moved from cookie.ts).
- `profilesBaseDir()`, `userProfileDir(userId)` — moved from cookie.ts verbatim.
- `spawnProfileChromium(userId, opts: { startUrl?: string }): Promise<{ proc, remotePort, cdpBrowserWsUrl, cdpPageWsUrl }>` — the chromium spawn + devtools-endpoint poll + page-target discovery currently inline in `startCookieSession` (lines 199–253). Same flags (`--headless=new`, `--no-sandbox`, `--disable-dev-shm-usage`, `CAPTURE_PROXY`, etc.). Does **not** touch `activeProfiles` — caller owns the lock so it can compose (capture vs. warm-session both acquire before calling).
- `cdpCall(wsUrl, method, params)` — moved from cookie.ts (one-shot CDP request).

`cookie.ts` is refactored to import these; its public API (`startCookieSession`, `captureCookies`, `closeCookieSession`, `resetBrowserProfile`, `getSessionOwner`, `getSessionCdpEndpoint`, etc.) is unchanged, so existing routes/tests keep working.

**2. `packages/server/src/auth/browser-session.ts` (NEW)**
Owns the warm session lifecycle and a persistent CDP page client.

Internal `WarmSession`:
```
{ proc, remotePort, cdpPageWsUrl, cdpBrowserWsUrl, cdpToken, userId, lastActivity, cdp: CdpClient }
```
Module map `warmSessions: Map<userId, WarmSession>` (keyed by userId — one per user).

`CdpClient` (small class in this file): opens one long-lived `ws` to `cdpPageWsUrl`, auto-increments command `id`, resolves per-`id` promises, `Page.enable`/`Runtime.enable` on connect. Method `send(method, params): Promise<result>`. Closed on session teardown.

Exports:
- `ensureSession(userId): Promise<WarmSession>` — returns the warm session, launching it if cold. Launch: acquire `activeProfiles` lock (throw `BROWSER_SESSION_BUSY` if held — same string cookie-capture uses), `spawnProfileChromium(userId, {})`, open `CdpClient`, mint `cdpToken = randomUUID()`, register in map, `proc.on("exit")` releases lock + deletes map entry + closes cdp. Bumps `lastActivity`.
- `touch(userId)` — updates `lastActivity` (called by every tool).
- `getWarmSession(userId)` / `getWarmCdpEndpoint(userId, cdpToken)` — for the live-view proxy auth (mirror of cookie.ts's `getSessionOwner`/`getSessionCdpEndpoint`).
- `closeBrowserSession(userId)` — kill proc, close cdp, release lock, delete entry.
- `startBrowserReaper()` — `setInterval` sweeping sessions whose `lastActivity` is older than `config.BROWSER_SESSION_TTL_SECONDS`; calls `closeBrowserSession`. Started from `index.ts` alongside the existing connection reaper.

**3. CDP action helpers** (in `browser-session.ts`, each takes the `WarmSession`)
- `navigate(s, url)` → `Page.navigate` + await `Page.loadEventFired` (or 15s timeout).
- `screenshot(s)` → `Page.captureScreenshot { format: "png" }` → returns base64 string.
- `click(s, x, y, button="left")` → `Input.dispatchMouseEvent` ×2 (mousePressed, mouseReleased) with `clickCount: 1`.
- `type(s, text)` → `Input.insertText { text }` (types into the focused element).
- `key(s, keys)` → parse `"Enter"`, `"Tab"`, `"ctrl+a"` → `Input.dispatchKeyEvent` (rawKeyDown + keyUp) with a small key→{windowsVirtualKeyCode, key} map and a modifier bitmask (alt=1, ctrl=2, meta=4, shift=8).
- `scroll(s, direction, amount=600)` → `Input.dispatchMouseEvent { type: "mouseWheel", x:640, y:400, deltaX/Y }`.

**4. `packages/server/src/mcp/meta-tools.ts` (MODIFY) — the `browser_*` tools**
New meta-tools, each `ctx: { userId }`, calling `ensureSession` + `touch`:

| Tool | Input | Returns |
|---|---|---|
| `browser_navigate` | `{ url: string }` | `{ url, title }` |
| `browser_screenshot` | `{}` | **image content** (see §MCP image content) |
| `browser_click` | `{ x: number, y: number, button?: "left"\|"right"\|"middle" }` | `{ ok: true }` |
| `browser_type` | `{ text: string }` | `{ ok: true }` |
| `browser_key` | `{ keys: string }` | `{ ok: true }` |
| `browser_scroll` | `{ direction: "up"\|"down"\|"left"\|"right", amount?: number }` | `{ ok: true }` |
| `browser_live_url` | `{}` | `{ url }` — magic-link to watch/drive |
| `browser_close` | `{}` | `{ ok: true }` |

Each is added to the `metaTools` array AND `metaToolSchemas` (the wire schema map — a missing entry is a compile error by design). They are real meta-tools, not plugin tools: no connection check, no `execute_tool` indirection. `browser_screenshot` after every action is the client's responsibility (we don't auto-return a shot from action tools — keeps payloads small; the LLM screenshots when it needs to look).

**5. MCP image content (`packages/server/src/mcp/server.ts` MODIFY)**
Currently every result is wrapped `content: [{ type: "text", text: JSON.stringify(result) }]` (line ~73). Extend: if a handler returns the sentinel shape `{ _mcpImage: { data: base64, mimeType: "image/png" } }`, emit
```
content: [{ type: "image", data, mimeType }]
```
instead. `browser_screenshot`'s handler returns that shape. All other tools unchanged (still text-wrapped). One narrow branch, no behavior change for existing tools.

**6. Live-view channel**
Reuse the cookie-capture pattern almost verbatim, generalized off the integration:
- `browser_live_url` handler: `ensureSession(userId)`, then mint a connect-style JWT (`signConnectToken`) binding `{ userId, sessionId: userId, cdpToken: session.cdpToken, integration: "__browser__" }`, TTL `config.CONNECT_TTL_SECONDS`. Return `{ url: `${PORTAL_URL}/browser?t=${jwt}` }`.
- Portal route `/browser` (NEW small page) — reuses the existing `/connect` CDP screencast canvas component; reads `?t=`, calls a `connectBrowser(jwt)` api helper that hits a new `GET /api/connect/browser-session` returning `{ cdpProxyUrl: "/api/browser-session/cdp", cdpToken, sessionId }`, then opens the WS with the auth frame (same `{type:"auth", sessionId, cdpToken, bearer}` handshake).
- `GET /api/browser-session/cdp` WS proxy (`index.ts` MODIFY) — a near-copy of the existing `/api/auth/cookie/:integration/cdp` handler, but resolves the target via `getWarmCdpEndpoint(userId, cdpToken)`. Same origin allowlist (add the `/api/browser-session/cdp` prefix to the `preValidation` origin hook), same auth-frame validation (portal Bearer OR bound connect-JWT).

Acceptable v1 duplication: the WS proxy handler is copied, not abstracted, to avoid destabilizing the shipped capture proxy. A follow-up can factor the shared frame-pump into a helper.

**7. `packages/server/src/config.ts` (MODIFY)**
Add `BROWSER_SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(300)`.

**8. Portal account-level affordance**
The existing v0.5.0 `BrowserSessionPanel` ("Reset browser session") is the natural home. Add (optional, low priority) a "browser session: active/idle" indicator. Not required for v1 — the tools work headless without any portal interaction; the live URL is on-demand via `browser_live_url`.

## Data flow (typical drive)

1. Client: `browser_navigate({url})` → `ensureSession` launches warm Chromium on the user's profile (logins from prior cookie connects already present) → `Page.navigate` → `{url, title}`.
2. Client: `browser_screenshot()` → PNG image content block → LLM "sees" the page.
3. Client: `browser_click({x,y})` / `browser_type({text})` / `browser_key({keys:"Enter"})` → CDP input.
4. Repeat 2–3. State persists across calls (same warm page).
5. Stuck? Client: `browser_live_url()` → human opens URL, drives the same browser, hands back.
6. Idle `BROWSER_SESSION_TTL_SECONDS` → reaper closes Chromium (profile kept). Or `browser_close()`.

## Concurrency & contention

- **One Chromium per user.** `activeProfiles` (shared, in `profile-chromium.ts`) is the single-writer lock. A warm browser session and a cookie-capture session cannot coexist for one user — the second `ensureSession`/`startCookieSession` throws `BROWSER_SESSION_BUSY`. The user closes one before the other.
- **LLM + human on one warm session** is fine — both speak CDP to the same page; no lock between them.
- `resetBrowserProfile` already refuses while `activeProfiles` holds the user → unchanged, now also guards against an active warm session.

## Error handling

- `ensureSession` launch failure → release lock, surface message (same as `startCookieSession`'s try/catch).
- CDP command timeout (10s) → tool returns `{ error }`; warm session left intact (transient).
- Navigation timeout → `{ url, title, warning: "load timeout" }` (still returns; page may be usable).
- `browser_*` called when chromium died out-of-band → `ensureSession` finds no live session (proc exit handler cleaned the map) and relaunches.
- Lock leak prevented by `proc.on("exit")` releasing `activeProfiles` (same guard as v0.5.0).

## Security

- Tools are per-user: `ctx.userId` comes from the authenticated `/mcp` request (api-key/OAuth/JWT). A user only ever drives their own profile (`warmSessions` keyed by `userId`).
- Live-view WS: origin-allowlisted + auth-framed exactly like the shipped capture proxy; connect-JWT bound to `(userId, cdpToken)` so it can't attach to another user's session.
- No URL secrets — JWT in `?t=` is short-lived and single-session-bound (matches existing `/connect` page).
- The warm browser can navigate anywhere the LLM asks — same trust model as the user's own browser. SSRF note: `browser_navigate` reaches arbitrary URLs from the workbench host, but that capability already exists via cookie-capture's `loginUrl` and the browser carries only the user's own profile. No new privilege boundary crossed.

## Testing

- `profile-chromium.ts`: unit test `userProfileDir` traversal-safety + `profilesBaseDir` default (move existing cookie tests).
- `browser-session.ts`: `ensureSession` launches once and reuses (second call same proc); `BROWSER_SESSION_BUSY` when `activeProfiles` held; `closeBrowserSession` releases lock; reaper closes an idle session (inject a tiny TTL). CDP calls mocked against a fake ws or a real headless chromium in CI (the cookie tests already spawn chromium — follow that pattern).
- `meta-tools`: `browser_screenshot` returns the `_mcpImage` sentinel; `browser_navigate` returns `{url,title}`; action tools return `{ok:true}`; `touch` bumps activity.
- `mcp/server.ts`: a handler returning `_mcpImage` emits an `image` content block; normal handlers still text-wrap.
- `index.ts` proxy: origin rejection (4403), auth-frame rejection (4401), happy path attaches via `getWarmCdpEndpoint`.

## Open follow-ups (not v1)

- Auto-screenshot option on action tools (`{ screenshot: true }`).
- Accessibility-snapshot tool as a cheaper alternative to screenshots.
- Factor the shared CDP WS frame-pump out of the two proxy handlers.
- Optional server-side `browser_task` autonomous loop (the Composio-style brain) layered on these primitives.
