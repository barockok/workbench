# Portal IA Redesign — Design

**Status:** approved for planning
**Branch:** `worktree-portal-design-tokens` (continues the open design-token PR; not merged first)

## Goal

Turn the portal from one long scrolling page into a routed application with a
persistent sidebar, and replace its decorative "operator console" styling with a
restrained, line-based visual language. Surface the tool-call history the server
already records but has never exposed.

## Non-goals

- No change to the token *values* in `packages/shared/styles/tokens.css`. The
  portal overrides geometry locally; the docs site keeps the shared ramp.
- No multi-tenancy surfaces (members, billing, workspace switching). Workbench
  is single-tenant and self-hosted.
- No global command palette.
- No change to any auth flow, MCP surface, or plugin contract.

## Current state

`packages/portal/src/pages/Dashboard.tsx` is the whole authenticated app. It
stacks `ApiKeyPanel`, `AgentsPanel`, a section header, a filter row and a card
grid, with `IntegrationDetail` opening as a modal over it. `App.tsx` routes
`/*` to it. Three real pages exist beside it: `Login`, `Connect/:integration`,
`BrowserView`.

The design-token work on this branch already landed: `tokens.css` is shared with
the docs site, a `ui/` component layer exists (Button, Badge, Card, Input,
Modal, BottomSheet, Toggle, SelectableCard, NavigationHeader, ThemeToggle), and
a vitest + Testing Library harness runs against it. That substrate stays.

What has not changed is the structure or the ornament: eyebrow strings like
`// registry ── integrations`, `№ 01` card indices, LED status dots, a
`system nominal` ticker footer, a blinking-cursor boot screen, `<em>/</em>`
punctuation inside headlines, and a staggered `animationDelay` on every card.
Native `window.confirm` and `window.prompt` still stand in for dialogs.

### Activity data already exists

`packages/server/src/mcp/meta-tools.ts` writes an `audit_log` row at six points
in every tool execution — tool-not-found, not-connected, invalid-args,
safeparse-error, success, and thrown error. The table
(`packages/server/src/db.ts`) holds `id, user_id, integration, tool, action,
success, error, duration_ms, created_at`, indexed on `(user_id, created_at)`
and `(integration, created_at)`.

No API endpoint reads it. That is the one genuinely new server capability this
design adds.

`AUDIT_LOG_DEST` (`config.ts`) may be `sqlite` (default), `stdout`, or `kafka`.
Only `sqlite` populates the table, so every activity surface must distinguish
"no activity yet" from "this deployment does not store activity."

## Design language

### Geometry

Separation is done with lines. Not with elevation, not with roundness, not with
tinted panels floating on tinted panels.

- **One radius: 6px.** Every surface — box, card, modal, button, input, chip,
  select — uses it. The portal overrides `--radius-sm`, `--radius`, and
  `--radius-lg` to `6px` in a single scoped block in `styles.css`, with a
  comment stating the rule. The shared token file is not edited.
- **`--radius-full` survives in exactly one place:** the `Toggle` switch track,
  which is a capsule by definition. Buttons and badges move off it onto
  `--radius`.
- **1px hairlines** in `--border` do all structural work.
- **No shadows** outside `Modal` and `BottomSheet`, which are genuinely above
  the page. `--shadow-sm` and `--shadow-md` stop being used on static content.
- Controls are **28px (small) / 32px (default)** tall. List and table rows are
  **32-40px**.
- Type: **14px** for labels and primary rows, **12px** for meta and captions,
  **20px** for section headings, **24px** for page titles. Mono only for values
  that are literally identifiers — tool names, client ids, URLs, keys.

### The Box primitive

The single structural component the whole UI is built from:

```
┌──────────────────────────────────────────┐
│ Header strip  --bg-sunk, 1px bottom rule │  ← title left, action link right
├──────────────────────────────────────────┤
│ Row                                      │
├──────────────────────────────────────────┤  ← 1px rules, no gaps
│ Row                                      │
└──────────────────────────────────────────┘
```

Rows sit flush against each other divided by hairlines — never as separate
bordered cards with gaps between them. This replaces the current `.grid` of
free-floating `.card` elements everywhere except the apps grid, where cells stay
discrete because they are navigational targets.

### Palette

Colors come from the shared token file unchanged. `--accent` (`#853291`) and its
hover/soft/line ramp carry primary actions, active navigation, focus rings and
links. Status ramps (`--ok`, `--warn`, `--danger`, `--info`) carry connection
and execution state. No new color values are introduced anywhere.

### Voice

Labels say what a thing is. "Apps", "Connected agents", "Recent activity",
"Tool calls". No invented technical decoration, no ASCII ornament, no status
theatre.

## Information architecture

A fixed sidebar plus a content column. Six authenticated routes.

| Route | Page | Purpose |
|---|---|---|
| `/` | Home | At-a-glance state: stats, connected apps, agent connection, recent activity |
| `/apps` | Apps | The integration registry — browse, filter, search, connect |
| `/apps/:name` | App detail | One integration: status, auth, tools, connect/disconnect |
| `/agents` | Agents | Connect a new agent (endpoint + config snippet); manage connected OAuth clients |
| `/activity` | Activity | Full tool-call history with filters and paging |
| `/settings` | Settings | API key, appearance, account |

Unchanged and outside the shell: `/login`, `/authorize/choose`,
`/connect/:integration`, `/browser`.

### Sidebar

220px, full height, `--surface` background, 1px right rule.

- Brand row, 48px: mark + `workbench`.
- Nav: Home, Apps, Agents, Activity. Icon + label, 32px rows. Active row gets
  an `--accent-soft` fill, `--accent` text, 500 weight, and `aria-current="page"`.
- Pinned to the bottom: Settings, Help, then a user row showing the signed-in
  email. Help is the one external link in the shell and points at
  `https://github.com/barockok/workbench` — the repo already named throughout
  `README.md`. The generated docs site has no pinned published URL anywhere in
  this repo, so linking it would be a guess.

Below 900px the sidebar becomes a 48px top bar: brand left, nav as a
horizontally scrollable row, user menu right. Content padding drops to 16px.

### Content column

`--bg` background, `max-width: 1080px`, `padding: var(--s-24)`. Every page opens
with a 24px page title and, where it needs one, a single toolbar row beneath it.

## Pages

### Home `/`

1. **Stat strip** — one Box, four cells divided by vertical hairlines. Each cell
   is a 12px `--text-3` caption over a 24px `--text` value.
   - Tool calls (last 30 days)
   - Success rate (last 30 days)
   - Most used app
   - Connected apps

   When activity is not stored, the first three read `—` and the Box carries a
   one-line note; the connected count still renders (it comes from
   `/api/connections`, not the audit log).
2. **Your apps** — Box, header "Your apps" with a "Browse all →" link to
   `/apps`. One row per connected integration: logo, display name, `{n} tools`,
   and a `Connected` badge. Capped at eight rows with a `+{n} more` final row.
   Empty state: "No apps connected yet" and a link to `/apps`.
3. **Connect your agent** — Box holding the MCP endpoint URL in a mono strip
   with a copy button, and a link to `/agents` for full setup.
4. **Recent activity** — Box, header "Recent activity" with a "View all →" link
   to `/activity`. The ten most recent rows, same row shape as the Activity
   page. Empty and not-stored states as above.

### Apps `/apps`

Page title `Apps`. One toolbar row beneath it: filter tabs on the left, search
input and category select on the right, with a hairline under the whole row.

- Tabs: `All` / `Connected` / `Available`, each with its count. Rendered as
  `role="tablist"` text tabs with a 2px `--accent` underline on the active one —
  not the current pill chips.
- Search filters on display name and description, client-side.
- Category select keeps its current behavior.

Below: a grid of app cells. Three columns at ≥1100px, two at ≥760px, one below.
Each cell is a bordered 6px box about 64px tall containing a 24px logo, the
display name, `v{version} · {n} tools`, and a right-aligned action — a
`Connect` button, a `Connected` badge, or muted `Not configured` text.

Descriptions and category chips move off the grid onto the detail page. That is
the density change: the grid answers "what is here and is it wired up", the
detail page answers everything else.

Clicking a configured cell navigates to `/apps/:name`. Unconfigured cells render
but are not interactive, and say why.

Sort order is unchanged: connected, then configured, then unconfigured.

### App detail `/apps/:name`

Replaces the `IntegrationDetail` modal, which is deleted.

- A `← Apps` back link.
- Header: 40px logo, display name, version, category chips, and the primary
  action on the right — `Connect`, or `Refresh` + `Disconnect` when connected.
- **Status** Box: connection state, auth type, and the instance URL when the
  integration declares one.
- **Tools** Box: header `Tools ({n})`, one row per tool — mono tool name, then
  its description.
- **Session transfer** Box, for cookie-auth integrations only: export a captured
  session bundle, or paste one in. This is a real feature of the modal being
  retired, not decoration — it is what lets a capture made on a trusted machine
  be moved into a deployment whose egress IP the provider blocks.
- **Browser controls** Box, on the built-in `browser` integration only: open a
  live view (optionally navigating somewhere first) and clear the persistent
  profile. Also inherited from the retired modal.
- Unknown `:name` renders a not-found state with a link back to `/apps`.

Integrations that declare an `instance` block currently prompt through
`window.prompt`. That becomes a small modal on this page with a prefilled input
defaulting to the integration's cloud origin.

### Agents `/agents`

Two sections.

1. **Connect an agent** — a Box holding the MCP endpoint URL and a copy-ready
   MCP server configuration block, generated from that endpoint and shown as
   mono text with a copy button. It reports whether an API key exists and links
   to `/settings` to manage one; key creation, reveal and deletion live on
   `/settings` only, and are not duplicated here.
2. **Connected agents** — Box table over `/api/agents`. Per row: client name (or
   client id when unnamed), the client id in mono, relative connected time,
   scope chips, and a `Revoke` button on the right. Revoke opens a confirmation
   modal — not `window.confirm` — that states plainly that an active session may
   persist until its access token expires. Empty state: "No agents connected."

### Activity `/activity`

Page title `Activity`. Toolbar: integration select and a status tab pair
(`All` / `Errors`).

A Box table grouped by day, each group introduced by a sticky sub-header row
reading `Today`, `Yesterday`, or the ISO date. Columns:

| Time | App | Tool | Duration | Status |
|---|---|---|---|---|
| `HH:MM` | logo + display name | mono tool name | right-aligned `{n}ms` | ✓ or ✕ |

A failed row renders its `error` on a second line in `--danger`, truncated to
one line with the full text as a `title`. A `Load more` button at the foot pages
with the cursor from the previous response; it disappears when the response
carries no next cursor.

Not-stored state: a Box explaining that this deployment routes audit events
elsewhere and naming the `AUDIT_LOG_DEST` setting. Empty state: "No tool calls
recorded yet."

### Settings `/settings`

Three Boxes: **API key** (the `ApiKeyPanel` behavior — it lives here, and
`/agents` links to it rather than duplicating it), **Appearance** (the theme
toggle), **Account** (signed-in email and a `Sign out` button).

## Server API

Two new authenticated routes in `packages/server/src/api/routes.ts`, both scoped
to the caller's `user_id` via the existing `authenticate(request)` helper. A
request for another user's rows is not expressible: the user id comes from the
session, never from input.

### `GET /api/activity`

Query: `limit` (1-100, default 50), `cursor` (opaque), `integration` (exact
name), `status` (`success` | `error`).

```json
{
  "stored": true,
  "events": [
    { "id": 8814, "integration": "jira", "tool": "jira_search",
      "action": "EXECUTE", "success": true, "error": null,
      "duration_ms": 412, "created_at": 1757001600 }
  ],
  "next_cursor": "MTc1NzAwMTYwMDo4ODE0"
}
```

Ordered by `created_at DESC, id DESC`. The cursor is base64 of
`{created_at}:{id}`. The keyset predicate is written as
`created_at < ? OR (created_at = ? AND id < ?)` rather than a row-value
comparison, because the two SQL backends do not agree on row-value support —
see `docs/findings/2026-08-06-postgres-dialect-gotchas.md`.

A malformed cursor is a 400, not a silent full-table scan.

### `GET /api/stats`

```json
{
  "stored": true,
  "window_days": 30,
  "tool_calls": 1284,
  "success_rate": 0.97,
  "most_used_integration": "jira"
}
```

`success_rate` is `null` when `tool_calls` is 0. `most_used_integration` is
`null` when no row in the window carries one.

This endpoint deliberately reports **no connected-integration count**. Home
already fetches `/api/connections` for its "Your apps" section and derives the
count from it; computing it a second time server-side would mean refactoring
the connections route for nothing.

### When `AUDIT_LOG_DEST !== "sqlite"`

Both routes return `stored: false` with empty/null payloads and HTTP 200. This
is a deployment configuration, not an error, and the UI renders an explanation
rather than a failure.

## Component inventory

**New — `packages/portal/src/components/ui/`**

| Component | Responsibility |
|---|---|
| `Box` | Bordered container with an optional header strip (title + right slot) and hairline-divided rows |
| `BoxRow` | One flush row inside a Box |
| `DataTable` | Semantic `<table>` inside a Box, with a visually-hidden `<caption>` |
| `StatStrip` | Row of label/value cells divided by vertical hairlines |
| `EmptyState` | Centered message with an optional action, used by every list |
| `Tabs` | `role="tablist"` text tabs with an underline active state and optional counts |
| `PageHeader` | Page title, optional actions, optional single toolbar row |

**New — supporting modules**

| File | Responsibility |
|---|---|
| `src/components/dialogs/ConfirmDialog.tsx` | Modal standing in for `window.confirm` |
| `src/components/dialogs/InstanceUrlDialog.tsx` | Modal standing in for `window.prompt` on self-hosted integrations |
| `src/hooks/useConnectFlow.tsx` | The connect/disconnect state machine and its dialogs, shared by every page offering those actions |
| `src/components/ActivityTable.tsx` | Day-grouped activity table, shared by `/activity` and Home |
| `src/format.ts` | Timestamp and duration presentation helpers |
| `src/mcp-config.ts` | `MCP_URL` and the MCP client config JSON, currently private to `ApiKeyPanel` |

**New — `packages/portal/src/components/shell/`**

`AppShell` (sidebar + content frame, responsive collapse) and `Sidebar`.

**New — `packages/portal/src/pages/`**

`Home`, `Apps`, `AppDetail`, `Agents`, `Activity`, `Settings`.

**Changed**

`App.tsx` (six routes under one `RequireAuth`-wrapped `AppShell`), `api.ts`
(`fetchActivity`, `fetchStats`, and their types), `ApiKeyPanel` and
`AgentsPanel` (become page sections built on `Box`, losing their eyebrows),
`Login.tsx` (decorative `.login-art` spec panel simplified to match the new
restraint), `AuthorizeChoose.tsx` (arrives with the `main` merge written against
deleted CSS — rebuilt on `ui/` components), `styles.css` (geometry override
block, Box/table/shell styles, dead-rule sweep).

**Deleted**

`Dashboard.tsx`, `IntegrationDetail.tsx`, and every rule backing the removed
ornament: `.eyebrow`, `.eyebrow .dot`, `.headline em`, `.headline-meta`,
`.card-index`, `.card-top`, the `.ui-footer` ticker, the boot blinker, the card
`animationDelay` stagger, and the `.filter-chip` pills.

Both `window.confirm` call sites (disconnect, revoke) and the one
`window.prompt` (instance URL) become `Modal`-based dialogs.

## Accessibility

- The sidebar is a `<nav>` landmark; the active item carries `aria-current="page"`.
- Filter tabs use `role="tablist"` / `role="tab"` / `aria-selected`, and are
  operable with arrow keys.
- Activity and agents render real `<table>` markup with a visually-hidden
  `<caption>`, not divs.
- Every interactive row is a real link or button — no `div` with an `onClick`
  and a `tabIndex`, which is what the current cards do.
- Focus-visible rings use `--accent` and are never removed.
- Status is never carried by color alone: the activity table pairs its ✓/✕ with
  text, and connection badges carry their word.

## Testing

**Server (TDD, red first).** For each endpoint: happy path; user scoping (user A
never sees user B's rows); each filter; pagination across a boundary including
rows sharing a `created_at`; malformed cursor → 400; `limit` clamping;
`stored: false` under a non-sqlite destination; 401 without a session. Stats:
empty window → `success_rate: null`; mixed success/failure arithmetic.

**Portal (vitest + Testing Library, harness already on this branch).** Each new
`ui/` primitive gets a component test. Each page gets loading, empty, error and
populated branches. `Sidebar` gets an active-route test asserting
`aria-current`. The geometry rule gets one guard test asserting no portal
stylesheet rule outside the Toggle uses `--radius-full`.

**Whole-branch.** `npm run build` clean across all four packages,
`node docs/site/build.mjs` still clean (the shared token file is untouched, but
prove it), and a public-repo hygiene grep over every touched file.

## Sequencing

0. Merge `origin/main` into the branch (9 commits, all of the `/authorize`
   choice-page work) and rebuild `AuthorizeChoose.tsx` on `ui/` components. This
   comes first — every later page is written against the merged tree.
1. Geometry override block and the `Box` / `BoxRow` / `DataTable` / `StatStrip` /
   `EmptyState` / `Tabs` primitives, with tests.
2. Server: `/api/activity` and `/api/stats`, with tests. Early, so the pages that
   consume them are never written against a guess.
3. `AppShell` + `Sidebar` + the six routes, with `Dashboard` still mounted at `/`
   so the tree stays green.
4. `Apps`, then `AppDetail` (which retires the modal).
5. `Activity`.
6. `Agents`.
7. `Settings`.
8. `Home` — last, because it composes pieces every earlier page establishes.
9. Delete `Dashboard.tsx`, `IntegrationDetail.tsx` and the dead CSS; sweep.
10. Full verification pass.

## Global constraints

These bind every task.

- One radius: `6px`. `--radius-full` appears only on the `Toggle` track.
- No `box-shadow` outside `Modal` and `BottomSheet`.
- Colors come only from `tokens.css` custom properties. No literal hex in
  `styles.css` or in any component.
- Spacing comes only from the `--s-*` scale. Nothing between the steps.
- No external product or company names anywhere — code, comments, CSS, docs,
  commit messages, PR text. Design references are described as rules, not
  attributions. (`CLAUDE.md`, Public Repo Hygiene.)
- No `Co-Authored-By:` or "Generated with" trailers naming an AI. No commits
  under an AI author identity.
- Server changes are test-first. Portal components ship with tests.
- Every interactive element is a real `<button>` or `<a>`.
