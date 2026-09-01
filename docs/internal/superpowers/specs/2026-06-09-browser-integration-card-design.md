# Browser-use as an integration card

**Date:** 2026-06-09
**Status:** Approved

## Problem

Browser-use is a built-in capability but is surfaced in the portal through a
dedicated `BrowserSessionPanel` (an account-level "Reset browser session"
control) sitting above the integration grid, plus a `browser_live_url`
meta-tool only the agent can trigger. It feels bolted-on rather than being a
first-class integration like Slack/Jira. We want it to:

1. Appear as a normal integration card in the registry grid.
2. Offer "Clear session" the way other integrations manage their session.
3. Let the **user** (not only the agent) open a live browser view, optionally
   navigated to a specific URL — reusing the existing `/browser` live page.

## Constraints

- Browser meta-tools (`browser_navigate`, `browser_screenshot`, …) are handled
  specially by the MCP server, NOT through the plugin registry. Tool routing
  must stay untouched — no registering browser into the registry.
- Reuse existing primitives: `ensureSession`, `navigate`, `signConnectToken`,
  the `/browser` page, `/api/connect/browser-session`, `resetBrowserProfile`.

## Approach — synthetic integration (UI-level), no registry change

Browser is presented as an integration via a synthetic descriptor injected into
the read endpoints. Tool execution is unaffected.

### Server

- **New** `packages/server/src/auth/browser-integration.ts`
  - `BROWSER_INTEGRATION_NAME = "browser"`.
  - `browserSummary()` → integration summary (`name`, `version`, `displayName`
    "Browser", `description`, `categories: ["browser"]`, `toolCount`,
    `configured: true`, no logo).
  - `browserDetail()` → summary + `authType: "none"` + `tools` derived from
    `metaTools` filtered to `name.startsWith("browser_")` (name + description),
    so the card mirrors the real browser tools.
- **Inject** in `packages/server/src/api/routes.ts`, short-circuiting before the
  registry lookup:
  - `GET /api/integrations` → append `browserSummary()`.
  - `GET /api/integrations/:integration` → return `browserDetail()` when
    `:integration === "browser"`.
  - `GET /api/connections` → append `{ name: "browser", connected: true }`
    (built-in, always usable).
- **New** `POST /api/browser-session/live-url` (session-authed), body `{ url? }`:
  1. `ensureSession(userId)` → warm session.
  2. if `url` provided → `navigate(s, url)`.
  3. `signConnectToken({ connectionId: userId, userId, integration: "__browser__",
     sessionId: userId, cdpToken: s.cdpToken }, CONNECT_TTL_SECONDS)`.
  4. return `{ url: "${PORTAL_URL}/browser?t=<jwt>" }`.
  - `BROWSER_SESSION_BUSY` → 409 (cookie capture in progress).
- `browser_live_url` meta-tool kept as-is (agent path).

### Portal

- `api.ts` — add `openBrowserLiveUrl(url?: string): Promise<{ url: string }>`.
- `IntegrationDetail.tsx` — when `name === "browser"`, render a **Browser
  controls** section instead of the cookie SessionTransfer / connect footer:
  - optional URL text input + "Open live view →" button → `window.open(res.url)`.
  - "Clear session" button → existing `resetBrowserSession()`.
  - hide the Connect/Re-authorize footer button for browser.
- `Dashboard.tsx` — remove `<BrowserSessionPanel/>` (import + render). Browser
  renders in the grid as a normal card; special-case card-bottom to
  "Built-in · always on" with no Connect button; clicking opens the detail
  modal.
- Delete `BrowserSessionPanel.tsx`.

## Naming note

Integration/card name is `"browser"`. The live-view connect token keeps the
existing sentinel `integration: "__browser__"` because
`/api/connect/browser-session` validates that value. The two are intentionally
distinct: `"browser"` is the UI identity, `"__browser__"` is the token scope.

## Decisions

- **Connection state:** browser is always `connected: true` (always usable),
  rather than reflecting whether a warm session is currently alive. Simpler and
  matches "built-in".
- **URL optional:** empty → open live view at current page; filled → navigate
  first.

## Out of scope

- A bundled browser logo (falls back to initials).
- Per-warm-session live status indicator.
