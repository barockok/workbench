# Portal design token revamp

## Problem

The portal (`packages/portal`) is a dark "operator console" — `#0b0a10`
ground, JetBrains Mono body copy at 13px, an animated background grid,
a pulsing status dot — styled entirely with hand-written classes in one
998-line `styles.css` (`packages/portal/src/styles.css`). The docs site
(`docs/site/`) already runs a different, lighter visual language: a
named token set (`docs/site/assets/docs.css:6-89`) with a light default
and a derived dark theme, Inter for body copy, and a purple accent. The
two surfaces of the same product look like different products.

The docs site's token set was itself adapted from an external reference
design system. That reference names the company and its internal
products; none of that traveled into `docs.css` — only color, spacing,
radius, and type-scale values did, matching this repo's public-repo
hygiene rule (no company/product names, no attribution). This revamp
follows the same rule: values only, sourced from the already-scrubbed
`docs.css`, no new external reference cited anywhere in code, comments,
commits, or docs.

Beyond the palette gap, the portal has no component layer — every
screen hand-rolls markup against global classes, and four different
files (`ApiKeyAuthModal.tsx`, `CookieAuthPopup.tsx`,
`ConnectLinkProblem.tsx`, `IntegrationDetail.tsx`) each reimplement the
same `modal-backdrop` / `modal` / `modal-head` / `modal-foot` structure
independently. The portal also has no test runner at all — `server` and
`shared` both run `vitest`, `portal` has never had a `test` script.

## Scope

**In scope:**

- A shared design-token stylesheet, adopted by both `docs/site` and
  `packages/portal`, light-default with a dark theme (matching docs'
  existing toggle mechanism).
- A component layer for the portal: `Button`, `Badge`, `Card`, `Input`,
  `Toggle`, `SelectableCard`, `Modal`, `BottomSheet`,
  `NavigationHeader`.
- Rewriting every portal page/component onto that component layer,
  dropping decorative console-only markup that has no equivalent in the
  new visual language.
- Standing up `vitest` + `@testing-library/react` for `packages/portal`
  and TDD-ing every new `ui/` component.

**Out of scope:**

- `NavigationBar` (bottom mobile tab bar) — nothing in the portal maps
  to it; not built.
- Visual mockups (Figma/Pencil) — components are built directly from
  the token spec's documented component contracts (padding, states,
  token map) below.
- `CdpScreencast.tsx` internals (canvas/WS plumbing) — only its
  surrounding chrome (the modal it sits in) is restyled.
- The connect-link auth flow, server, or any non-portal package.
- Cross-origin theme-preference sharing between docs and portal — each
  keeps its own `localStorage` key; a preference set on one site does
  not carry to the other. Cosmetic, not addressed here.

## Design

### 1. Shared token file

New file: `packages/shared/styles/tokens.css`. Contains only the
`:root` custom-property block, the `@media (prefers-color-scheme:
dark)` override, and the `[data-theme='dark']` / `[data-theme='light']`
overrides — the same three blocks already in `docs/site/assets/docs.css`
(lines 6–132), moved verbatim, with no changes to values. `docs.css`
loses those blocks and keeps only layout/prose/component rules; it
still uses the same custom-property names, now defined in the imported
file.

Portal build: Vite (`packages/portal`, using `@vitejs/plugin-react`)
inlines a plain CSS `@import` at the top of `packages/portal/src/styles.css`:

```css
@import "@a-workbench/shared/styles/tokens.css";
```

`packages/shared/package.json` gains no build step for this — it's a
static file resolved by Vite's existing `@a-workbench/shared` workspace
alias (same mechanism already used for the package's TS exports).

Docs build: `docs/site/build.mjs` currently copies the whole `assets/`
directory verbatim (`build.mjs:443`, `cpSync(join(ROOT, 'assets'),
join(OUT, 'assets'), { recursive: true })`) and links `docs.css` with a
cache-busting hash (`build.mjs:279-282`, `assetTag()`). Add one line
before the build's `cpSync`/asset step: copy
`packages/shared/styles/tokens.css` into `docs/site/assets/tokens.css`.
Add one `<link rel="stylesheet" href="${A}${assetTag('tokens.css')}">`
before the existing `docs.css` link (`build.mjs:356`), so it loads
first and `docs.css`'s custom-property *usages* resolve against it.

### 2. Theme toggle

Docs already implements: `data-theme` attribute on `<html>`, backed by
`localStorage['wb-theme']`, with an inline pre-paint script
(`build.mjs:357`) so there's no flash of the wrong theme, and system
preference (`prefers-color-scheme`) as the fallback when no explicit
choice is stored. Portal adopts the identical mechanism:

- `packages/portal/index.html` gets the same inline script (copied
  verbatim, same `localStorage` key `wb-theme` — sharing the key name,
  even though the two apps don't share an origin, keeps the mechanism
  identical rather than inventing a second convention).
- A toggle control (sun/moon icon button, matching docs'
  `.i-sun`/`.i-moon` pattern at `docs.css:273-277`) is added as a new
  `ThemeToggle` component in the portal's top bar, replacing the
  now-removed `brand-mark` pulse dot.

### 3. Token consumption in portal CSS

`packages/portal/src/styles.css` is rewritten from scratch against the
imported custom properties (`--bg`, `--surface`, `--text`, `--accent`,
`--radius`, `--s-*`, etc. — the exact names already defined in
`docs.css:6-89`). The rewrite:

- Drops the portal's own `:root` block (`styles.css:3-19`) entirely —
  tokens now come only from the shared import.
- Drops `--mono`/`--mono-alt` as the *body* font — Inter (`--sans`)
  becomes body copy, matching docs. `--mono` (`JetBrains Mono`) is kept
  and scoped to genuinely code-shaped content only: the `<code>`/`<pre>`
  blocks in `ApiKeyPanel`'s config snippet, `IntegrationDetail`'s tool
  names, and the MCP tool list — not page chrome.
- Drops the background grid (`body::before`, `styles.css:40-52`) and
  the radial-gradient body background — flat `var(--bg)` per docs.

### 4. Component inventory (`packages/portal/src/components/ui/`)

Each component follows the token map already recorded in `docs.css`'s
existing usage (buttons, badges, cards, inputs already have rendered
equivalents in docs' own site chrome) and the spacing/radius scale from
the shared tokens. One file per component, named exports, no default
export (consistent with existing portal convention of default-exporting
page-level components only).

- **`Button`** — variants `primary | secondary | outline | ghost |
  danger`, sizes `xs | sm | md | lg | xl`. Pill shape (`--radius-full`).
  Replaces `.btn-connect` (→ `primary`), `.btn-ghost` (→ `ghost`),
  `.btn-disconnect` (→ `danger`), `.btn-google`/`.btn-keycloak` (→
  `outline`, with the existing inline SVG icons passed as `icon` prop).
- **`Badge`** — variants `primary | blue | green | orange | red |
  yellow | neutral`. Replaces `.card-status`/`.led` dot pairing
  (Dashboard card status, ApiKeyPanel key-active indicator) and
  `.integ-tag`.
- **`Card`** — replaces `.card` (Dashboard integration tiles). No
  nesting (per token spec's "never nest cards" guardrail) — the
  Dashboard grid is a flat list of `Card`s; `IntegrationDetail`'s modal
  body is *not* wrapped in a second `Card`.
- **`Input`** — states `default | focus | valid | error | disabled`.
  Replaces every `.session-transfer-paste`/plain `<input>`/`<select>`
  currently styled ad hoc across `ApiKeyAuthModal`, `IntegrationDetail`
  (`BrowserControls`, `SessionTransfer`), and the category `<select>`
  in `Dashboard`.
- **`Toggle`** — not currently used anywhere in the portal, but
  included per the approved component set for future use (e.g. a
  settings screen). TDD covers its checked/unchecked/disabled states
  even with no current call site.
- **`SelectableCard`** — not currently used; included for parity with
  the token spec, same rationale as `Toggle`.
- **`Modal`** — props: `open`, `onClose`, `title`, `size ("sm"|"md"|"lg")`,
  `variant ("default"|"dialog")`, `intent?`, `children` (body),
  `footer?` (actions slot). Replaces the four independent
  `modal-backdrop`/`modal`/`modal-head`/`modal-foot` implementations in
  `ApiKeyAuthModal.tsx:40-96`, `CookieAuthPopup.tsx:137-169`,
  `ConnectLinkProblem.tsx:199-221`, `IntegrationDetail.tsx:392-447`, and
  the equivalent inline markup in `Connect.tsx:853-874` and
  `BrowserView.tsx:918-933`. Each of those six call sites becomes
  `<Modal>` usage with their existing body/footer content unchanged.
- **`BottomSheet`** — not currently used; included for parity, same
  rationale as `Toggle`/`SelectableCard`.
- **`NavigationHeader`** — replaces the portal's `.topbar`
  (`Dashboard.tsx:156-177`): brand mark, title, and a trailing-icons
  slot holding the new `ThemeToggle` and the existing sign-out button.

`NavigationBar` (bottom mobile tab bar) is not built — out of scope,
no call site.

### 5. Page-by-page migration

Every file under `packages/portal/src/{pages,components}/*.tsx` is
rewritten to consume the `ui/` components in place of raw markup +
global classes, preserving all existing behavior (data fetching,
mutations, error handling) unchanged:

- `App.tsx` — `Boot` component's `.boot`/`.blinker` markup replaced by
  a simple centered `Card`-less loading state (spinner or text, no
  console-style blinking cursor).
- `pages/Dashboard.tsx` — topbar → `NavigationHeader`; filter chips
  stay plain toggle buttons styled with `Button` `ghost`/`outline`
  variants keyed by `aria-pressed`; category `<select>` → `Input`
  (select mode); integration tiles → `Card` + `Badge` (status) +
  `Button` (connect/disconnect/refresh); footer `.ticker` dropped
  (console-only status strip, no docs equivalent — a plain "last
  synced" text line replaces it, no blinking `●`).
- `pages/Login.tsx` — `.login-shell` two-pane layout kept structurally
  (art panel + form panel reads fine in the light system), `.glyph`
  ASCII-art title replaced with a plain heading, provider buttons →
  `Button` `outline` with existing icons, `.specs` stat row → three
  `Badge`s or plain labeled stats (kept as plain text, not
  console-styled).
- `pages/Connect.tsx`, `pages/BrowserView.tsx` — inline modal markup →
  `Modal`; `.boot` loading/error/done states → plain centered text (no
  blinker).
- `components/ApiKeyAuthModal.tsx`, `CookieAuthPopup.tsx`,
  `ConnectLinkProblem.tsx`, `IntegrationDetail.tsx` — modal wrapper →
  `Modal`; internal form fields → `Input`; action buttons → `Button`.
- `components/ApiKeyPanel.tsx`, `AgentsPanel.tsx` — status pill → `Badge`;
  actions → `Button`; the JSON config `<pre>` block keeps `--mono`.
- `components/IntegrationLogo.tsx` — unchanged (already a clean, small,
  self-contained component; only the fallback `CogMark`'s currentColor
  now resolves against the new token palette automatically).

Decorative classes removed entirely, with no replacement, because they
have no analog in the token spec's component set: `.blinker`, `.led`
(superseded by `Badge`'s own dot-in-badge rendering where a status dot
is still wanted), `.pip`, `.ticker`, `.boot`'s scanline/cursor styling,
`body::before` grid overlay, `.brand-mark` pulse animation (the mark
itself stays as a static logo glyph in `NavigationHeader`).

### 6. Testing

`packages/portal/package.json` gains:

```json
"scripts": { "test": "vitest run" },
"devDependencies": {
  "vitest": "^1.6",
  "@testing-library/react": "^16.0",
  "@testing-library/jest-dom": "^6.0",
  "jsdom": "^25.0"
}
```

New `packages/portal/vitest.config.ts`: `environment: "jsdom"`, React
plugin reused from `vite.config.ts`. No `fileParallelism: false` needed
— unlike `server`'s tests, portal component tests touch no shared
database.

TDD, per the repo's standing `test-driven-development` skill, for every
new `ui/` component:

- `Button` — renders each variant/size class, respects `disabled`.
- `Badge` — renders each variant.
- `Card` — renders children, no nested-card guard needed (structural,
  not enforced at runtime).
- `Input` — renders each state, forwards `onChange`.
- `Toggle` — checked/unchecked/disabled, `onChange` fires with the new
  boolean.
- `SelectableCard` — `active`/`disabled` states, click/keyboard select.
- `Modal` — open/closed render, Escape key closes, backdrop click
  closes, click inside content does not close, focus moves into the
  modal on open and returns to the trigger on close.
- `BottomSheet` — same open/close/Escape/backdrop contract as `Modal`.
- `NavigationHeader` — renders title, back button fires `onBack`,
  trailing icons slot renders.

Page-level components (`Dashboard`, `Login`, etc.) are not given
blanket new test coverage — they already have none, and this revamp is
a restyle, not a rewrite of their data/mutation logic. A page test is
added only where the migration itself introduces new conditional logic
(none currently identified — the migration is markup-for-markup).

## Testing (verification for this change)

- `npm run test -w @a-workbench/portal` — new component suite, all
  green.
- `npm run test -w @a-workbench/server` / `-w @a-workbench/shared` —
  unaffected packages stay green (no server/shared logic touched).
- `node docs/site/build.mjs` — docs build succeeds, internal links
  still resolve (CI's existing check), `tokens.css` present in
  `docs/site/_site/assets/`.
- `npm run build -w @a-workbench/portal` — portal builds clean under
  the new token import.
- Manual: portal loads in both light and dark (`prefers-color-scheme`
  and explicit toggle), every modal flow (connect apikey, connect
  cookie, account-mismatch problem page, integration detail) opens and
  closes correctly, Dashboard filter/category controls still filter.

## Notes

- Public-repo hygiene: the external reference used to derive the
  original docs tokens is not named anywhere in this change — not in
  code, comments, commit messages, or this spec's own history beyond
  this document, which itself carries no company/product name or
  source URL, only the (already-shipped, already-scrubbed) values.
- This spec assumes the token *values* in `docs.css:6-89` are final
  (unchanged from the current docs site) — this is a consumption change
  for the portal, not a token redesign.
