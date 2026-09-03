# Portal Design Token Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the portal (`packages/portal`) onto the same design-token language as the docs site (`docs/site`) — light default with a dark theme, a real component layer, and TDD coverage for every new component.

**Architecture:** Extract the docs site's existing token block into a shared CSS file both packages consume. Build a small `ui/` component library in the portal (Button, Badge, Card, Input, Toggle, SelectableCard, Modal, BottomSheet, NavigationHeader) against those tokens, each one TDD'd with a fresh `vitest` + `@testing-library/react` harness. Migrate every portal page/component onto the new components, deleting decorative console-only markup that has no equivalent in the new visual language.

**Tech Stack:** React 19, TypeScript, Vite 6, vitest, @testing-library/react, jsdom. No new runtime dependencies beyond test tooling.

**Spec:** `docs/superpowers/specs/2026-09-03-portal-design-token-revamp-design.md`

## Global Constraints

- Public-repo hygiene: no company/product names, no external URLs, no attribution comments referencing the source design system — token *values* only (per spec's "Notes" section and `CLAUDE.md`'s Public Repo Hygiene rule).
- No AI co-authorship trailers in any commit (per `CLAUDE.md`).
- Token values themselves are frozen — this plan consumes `docs/site/assets/docs.css`'s existing `:root`/dark blocks verbatim, it does not redesign them.
- `NavigationBar` (bottom tab bar) is explicitly out of scope — no task builds it.
- Every new `ui/` component is TDD'd: failing test → minimal implementation → passing test → commit, per task.
- `Toggle`, `SelectableCard`, `BottomSheet` currently have no call site in the portal; they are still built and tested per the spec's approved component set (Q3/(c) "full component layer").

---

## Task 1: Extract shared design tokens

**Files:**
- Create: `packages/shared/styles/tokens.css`
- Modify: `docs/site/assets/docs.css:6-169` (delete the `:root`, media-query, and `[data-theme='dark']` blocks)
- Modify: `docs/site/build.mjs` (copy `tokens.css` into the site build, link it before `docs.css`)

**Interfaces:**
- Produces: a CSS custom-property file at `packages/shared/styles/tokens.css` defining `--bg`, `--bg-sunk`, `--surface`, `--surface-2`, `--border`, `--border-strong`, `--text`, `--text-2`, `--text-3`, `--text-4`, `--accent`, `--accent-hover`, `--accent-soft`, `--accent-line`, `--ok`/`--warn`/`--danger`/`--info` (each with `-soft`/`-line`), `--overlay`, `--code-bg`, `--code-text`, `--code-bar`, `--radius-sm`/`--radius`/`--radius-lg`/`--radius-full`, `--sans`, `--mono`, `--s-2`…`--s-48`, `--page-pad-x`, `--card-pad`, `--section-gap`, `--card-gap`, `--topbar-h`, `--topnav-h`, `--sidebar-w`, `--toc-w`, `--content-max`, `--shadow-sm`/`--shadow-md`/`--shadow-lg`. Light values on bare `:root`, dark values under `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { ... } }` and `:root[data-theme='dark'] { ... }`.
- Consumes: nothing (this is the foundation task).

This task has no unit test — it's a pure file move verified by the docs build succeeding and rendering unchanged. That's the "test."

- [ ] **Step 1: Create the shared tokens file**

```bash
mkdir -p packages/shared/styles
```

Move the token blocks verbatim (values unchanged) into `packages/shared/styles/tokens.css`:

```css
/* Shared design tokens — consumed by both docs/site and packages/portal. */

:root {
  --bg: #f9faf8;
  --bg-sunk: #f1f3f0;
  --surface: #ffffff;
  --surface-2: #f9faf8;
  --border: #e5e7eb;
  --border-strong: #c6cad0;

  --text: #111928;
  --text-2: #525c6a;
  --text-3: #6b7280;
  --text-4: #8e95a3;

  --accent: #853291;
  --accent-hover: #732c7c;
  --accent-soft: #fef3ff;
  --accent-line: #e5b8ef;

  /* The 600/700 steps, not 500: the 500-on-50-tint pairing the palette
     suggests lands between 2.1:1 and 4.4:1, under the 4.5:1 text minimum. */
  --ok: #007d55;
  --ok-soft: #e4fcef;
  --ok-line: #a8e6c9;
  --warn: #ad540a;
  --warn-soft: #fdf4e9;
  --warn-line: #f6d9ac;
  --danger: #ac2b26;
  --danger-soft: #fff4f3;
  --danger-line: #f5c0bd;
  --info: #056dce;
  --info-soft: #edf7ff;
  --info-line: #b9dcfa;

  --overlay: rgba(17, 25, 40, .8);

  /* Code keeps one dark surface in both themes, drawn from the darkest neutral
     so it reads as part of the same family rather than a pasted-in terminal. */
  --code-bg: #111928;
  --code-text: #e5e7eb;
  --code-bar: #1b2432;

  /* 6 chips · 8 inputs and default interactive · 12 cards and modals ·
     full for buttons and badges. */
  --radius-sm: 6px;
  --radius: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;

  --sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  --mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace;

  /* 4px base. Steps: 2 4 8 12 16 20 24 32 40 48 — nothing between them. */
  --s-2: 2px;
  --s-4: 4px;
  --s-8: 8px;
  --s-12: 12px;
  --s-16: 16px;
  --s-20: 20px;
  --s-24: 24px;
  --s-32: 32px;
  --s-40: 40px;
  --s-48: 48px;

  --page-pad-x: 16px;
  --card-pad: 12px;
  --section-gap: 12px;
  --card-gap: 8px;

  --topbar-h: 48px;
  --topnav-h: 44px;
  --sidebar-w: 268px;
  --toc-w: 232px;
  --content-max: 748px;

  --shadow-sm: 0 1px 2px rgba(17, 25, 40, .05);
  --shadow-md: 0 4px 16px -4px rgba(17, 25, 40, .12), 0 1px 3px rgba(17, 25, 40, .06);
  --shadow-lg: 0 24px 60px -12px rgba(17, 25, 40, .28), 0 2px 8px rgba(17, 25, 40, .08);
}

/* The palette above defines one light theme. The dark values below are derived
   from it: hues held, the brand lifted out of the 500/600 band (which fails
   contrast on a dark ground) into the 200/300 band, and the neutrals rotated
   around the darkest neutral rather than pure grey so both themes read as one
   family. Kept in sync between the media query and the explicit toggle. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --bg: #0b1018;
    --bg-sunk: #070b11;
    --surface: #111928;
    --surface-2: #1a2433;
    --border: #2a3444;
    --border-strong: #3d4859;

    --text: #f9faf8;
    --text-2: #c6cad0;
    --text-3: #8e95a3;
    --text-4: #6b7280;

    --accent: #d68ee4;
    --accent-hover: #e5b8ef;
    --accent-soft: #2a122e;
    --accent-line: #4a2050;

    --ok: #4fd3a0;
    --ok-soft: #08251a;
    --ok-line: #17513a;
    --warn: #f7b75c;
    --warn-soft: #2a1d0a;
    --warn-line: #543a16;
    --danger: #f2726c;
    --danger-soft: #2c1211;
    --danger-line: #5a2523;
    --info: #5ca8f0;
    --info-soft: #0a1c2e;
    --info-line: #1b3e60;

    --code-bg: #0b1018;
    --code-text: #e5e7eb;
    --code-bar: #111928;

    --shadow-sm: 0 1px 2px rgba(0, 0, 0, .4);
    --shadow-md: 0 4px 16px -4px rgba(0, 0, 0, .5), 0 1px 3px rgba(0, 0, 0, .4);
    --shadow-lg: 0 24px 60px -12px rgba(0, 0, 0, .7), 0 2px 8px rgba(0, 0, 0, .5);
  }
}

:root[data-theme='dark'] {
  --bg: #0b1018;
  --bg-sunk: #070b11;
  --surface: #111928;
  --surface-2: #1a2433;
  --border: #2a3444;
  --border-strong: #3d4859;

  --text: #f9faf8;
  --text-2: #c6cad0;
  --text-3: #8e95a3;
  --text-4: #6b7280;

  --accent: #d68ee4;
  --accent-hover: #e5b8ef;
  --accent-soft: #2a122e;
  --accent-line: #4a2050;

  --ok: #4fd3a0;
  --ok-soft: #08251a;
  --ok-line: #17513a;
  --warn: #f7b75c;
  --warn-soft: #2a1d0a;
  --warn-line: #543a16;
  --danger: #f2726c;
  --danger-soft: #2c1211;
  --danger-line: #5a2523;
  --info: #5ca8f0;
  --info-soft: #0a1c2e;
  --info-line: #1b3e60;

  --code-bg: #0b1018;
  --code-text: #e5e7eb;
  --code-bar: #111928;

  --shadow-sm: 0 1px 2px rgba(0, 0, 0, .4);
  --shadow-md: 0 4px 16px -4px rgba(0, 0, 0, .5), 0 1px 3px rgba(0, 0, 0, .4);
  --shadow-lg: 0 24px 60px -12px rgba(0, 0, 0, .7), 0 2px 8px rgba(0, 0, 0, .5);
}
```

- [ ] **Step 2: Delete the moved blocks from `docs.css`**

In `docs/site/assets/docs.css`, delete lines 6 through 169 (the `:root { ... }` block, the derivation comment, the `@media (prefers-color-scheme: dark) { ... }` block, and the `:root[data-theme='dark'] { ... }` block) — everything between the file header comment and the `/* --------------------------------------------------------------- reset -- */` section marker. `docs.css` keeps using the same custom-property names throughout the rest of the file; only their *definitions* move out.

- [ ] **Step 3: Wire `tokens.css` into the docs build**

In `docs/site/build.mjs`, find where `docs.css` is linked (around line 356: ``<link rel="stylesheet" href="${A}${assetTag('docs.css')}">``) and add a `tokens.css` link immediately before it:

```js
<link rel="stylesheet" href="${A}${assetTag('tokens.css')}">
<link rel="stylesheet" href="${A}${assetTag('docs.css')}">
```

Find where the build copies `assets/` into the output (around line 443: `cpSync(join(ROOT, 'assets'), join(OUT, 'assets'), { recursive: true });`) and add, just before it, a copy of the shared tokens file into that same assets directory so `assetTag('tokens.css')` resolves:

```js
cpSync(join(ROOT, '..', '..', 'packages', 'shared', 'styles', 'tokens.css'), join(ROOT, 'assets', 'tokens.css'));
cpSync(join(ROOT, 'assets'), join(OUT, 'assets'), { recursive: true });
```

(`ROOT` in `build.mjs` is `docs/site`; adjust the relative path if the script defines `ROOT` differently — check the existing `join(ROOT, ...)` calls near the top of the file for the actual base and match it.)

- [ ] **Step 4: Build docs and verify visually unchanged**

Run: `node docs/site/build.mjs`
Expected: build succeeds with no errors, `docs/site/_site/assets/tokens.css` exists and contains the `:root` block from Step 1, `docs/site/_site/assets/docs.css` no longer contains a `:root {` block (only property *usages* like `var(--text)`).

Verify no visual regression: open `docs/site/_site/index.html` (or the relevant landing page) in a browser and confirm colors/spacing look identical to before this task — the values didn't change, only their location.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/styles/tokens.css docs/site/assets/docs.css docs/site/build.mjs
git commit -m "refactor(docs): extract design tokens into a shared stylesheet"
```

---

## Task 2: Wire tokens and theme toggle into the portal

**Files:**
- Modify: `packages/portal/src/styles.css` (add `@import` at top, remove portal's own `:root` block)
- Modify: `packages/portal/index.html` (add pre-paint theme script)
- Create: `packages/portal/src/components/ui/ThemeToggle.tsx`
- Test: `packages/portal/src/components/ui/ThemeToggle.test.tsx`
- Modify: `packages/portal/package.json` (add `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `test` script)
- Create: `packages/portal/vitest.config.ts`
- Create: `packages/portal/src/test-setup.ts`

**Interfaces:**
- Consumes: `packages/shared/styles/tokens.css` (Task 1) — custom properties `--bg`, `--surface`, `--text`, `--accent`, etc.
- Produces: `ThemeToggle` component — `export function ThemeToggle(): JSX.Element` — a button that reads/writes `localStorage['wb-theme']` and toggles `document.documentElement.dataset.theme` between `"light"` and `"dark"`. No props. Later tasks (`NavigationHeader` in Task 10, `Dashboard` in Task 21) import and render it.

This is the task that stands up the portal's test harness — do it carefully, later tasks depend on `vitest.config.ts` and `test-setup.ts` existing and working.

- [ ] **Step 1: Install portal test dependencies**

```bash
npm install -D vitest@^1.6 @testing-library/react@^16.0 @testing-library/jest-dom@^6.0 jsdom@^25.0 -w @a-workbench/portal
```

- [ ] **Step 2: Add the vitest config**

Create `packages/portal/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
```

Create `packages/portal/src/test-setup.ts`:

```typescript
import "@testing-library/jest-dom/vitest";
```

Add the test script to `packages/portal/package.json` `scripts`:

```json
"test": "vitest run"
```

- [ ] **Step 3: Write the failing test for `ThemeToggle`**

Create `packages/portal/src/components/ui/ThemeToggle.test.tsx`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("toggles data-theme from light to dark on click", () => {
    document.documentElement.dataset.theme = "light";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists the choice to localStorage", () => {
    document.documentElement.dataset.theme = "light";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(localStorage.getItem("wb-theme")).toBe("dark");
  });

  it("toggles dark back to light", () => {
    document.documentElement.dataset.theme = "dark";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- ThemeToggle`
Expected: FAIL — `Failed to resolve import "./ThemeToggle"` (module doesn't exist yet).

- [ ] **Step 5: Implement `ThemeToggle`**

Create `packages/portal/src/components/ui/ThemeToggle.tsx`:

```typescript
function currentTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  function handleClick() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("wb-theme", next);
    } catch {
      // Storage may be unavailable (private mode); the DOM attribute still
      // switches for this page load.
    }
  }

  return (
    <button type="button" className="theme-toggle" onClick={handleClick} aria-label="Toggle theme">
      <span className="theme-toggle-sun" aria-hidden>☀</span>
      <span className="theme-toggle-moon" aria-hidden>☾</span>
    </button>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- ThemeToggle`
Expected: PASS, 3 tests.

- [ ] **Step 7: Wire the token import and pre-paint script**

At the very top of `packages/portal/src/styles.css`, before the existing `:root { ... }` block, add:

```css
@import "@a-workbench/shared/styles/tokens.css";
```

Delete the portal's own `:root { ... }` block (currently `styles.css:3-19` in the pre-revamp file) — all of its custom properties now come from the import. Leave the rest of `styles.css` as-is for this task; Task 11 rewrites the remainder.

In `packages/portal/index.html`, add the pre-paint theme script inside `<head>`, before any stylesheet link:

```html
<script>(function(){try{var t=localStorage.getItem('wb-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}})();</script>
```

- [ ] **Step 8: Confirm the portal still builds**

Run: `npm run build -w @a-workbench/portal`
Expected: build succeeds (styling will look broken/unstyled at this point since the rest of `styles.css` still references the old `--bg`/`--ink`/etc. names — that's expected and fixed in Task 11).

- [ ] **Step 9: Commit**

```bash
git add packages/portal/package.json packages/portal/vitest.config.ts packages/portal/src/test-setup.ts packages/portal/src/components/ui/ThemeToggle.tsx packages/portal/src/components/ui/ThemeToggle.test.tsx packages/portal/src/styles.css packages/portal/index.html
git commit -m "feat(portal): import shared design tokens, add theme toggle and test harness"
```

---

## Task 3: `Button` component

**Files:**
- Create: `packages/portal/src/components/ui/Button.tsx`
- Test: `packages/portal/src/components/ui/Button.test.tsx`
- Modify: `packages/portal/src/styles.css` (add `.ui-button*` rules)

**Interfaces:**
- Consumes: tokens from Task 1/2 (`--accent`, `--danger`, `--radius-full`, `--s-*`).
- Produces: `export function Button(props: ButtonProps): JSX.Element` where
  ```typescript
  interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
    size?: "xs" | "sm" | "md" | "lg" | "xl";
  }
  ```
  Default `variant="primary"`, `size="md"`. Forwards all other button props (`onClick`, `disabled`, `type`, `children`, etc.) to the underlying `<button>`. Later tasks (4 onward) import `{ Button }` from `./ui/Button`.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/components/ui/Button.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children and defaults to primary/md", () => {
    render(<Button>Connect</Button>);
    const btn = screen.getByRole("button", { name: "Connect" });
    expect(btn).toHaveClass("ui-button", "ui-button-primary", "ui-button-md");
  });

  it("applies the requested variant and size", () => {
    render(<Button variant="danger" size="lg">Disconnect</Button>);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).toHaveClass("ui-button-danger", "ui-button-lg");
  });

  it("forwards onClick and disabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} disabled>Go</Button>);
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Button`
Expected: FAIL — `Failed to resolve import "./Button"`.

- [ ] **Step 3: Implement `Button`**

Create `packages/portal/src/components/ui/Button.tsx`:

```typescript
import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger";
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

export function Button({ variant = "primary", size = "md", className, ...rest }: ButtonProps) {
  const classes = ["ui-button", `ui-button-${variant}`, `ui-button-${size}`, className]
    .filter(Boolean)
    .join(" ");
  return <button className={classes} {...rest} />;
}
```

Add to `packages/portal/src/styles.css`:

```css
/* ui/Button */
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-8);
  font-family: var(--sans);
  font-weight: 700;
  border-radius: var(--radius-full);
  border: 1px solid transparent;
  cursor: pointer;
  transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}
.ui-button:disabled { cursor: not-allowed; opacity: .6; }

.ui-button-xs { font-size: 12px; padding: var(--s-4) var(--s-12); }
.ui-button-sm { font-size: 13px; padding: var(--s-4) var(--s-16); }
.ui-button-md { font-size: 14px; padding: var(--s-8) var(--s-20); }
.ui-button-lg { font-size: 15px; padding: var(--s-12) var(--s-24); }
.ui-button-xl { font-size: 16px; padding: var(--s-12) var(--s-32); }

.ui-button-primary { background: var(--accent); color: #fff; }
.ui-button-primary:hover:not(:disabled) { background: var(--accent-hover); }

.ui-button-secondary { background: var(--surface); color: var(--accent); border-color: var(--accent); }
.ui-button-secondary:hover:not(:disabled) { background: var(--accent-soft); }

.ui-button-outline { background: var(--surface); color: var(--text); border-color: var(--border); }
.ui-button-outline:hover:not(:disabled) { border-color: var(--border-strong); }

.ui-button-ghost { background: transparent; color: var(--accent); }
.ui-button-ghost:hover:not(:disabled) { background: var(--accent-soft); }

.ui-button-danger { background: var(--danger); color: #fff; }
.ui-button-danger:hover:not(:disabled) { filter: brightness(0.9); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Button`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/components/ui/Button.tsx packages/portal/src/components/ui/Button.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): add ui/Button component"
```

---

## Task 4: `Badge` component

**Files:**
- Create: `packages/portal/src/components/ui/Badge.tsx`
- Test: `packages/portal/src/components/ui/Badge.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: tokens from Task 1/2.
- Produces: `export function Badge(props: BadgeProps): JSX.Element` where
  ```typescript
  interface BadgeProps {
    variant?: "primary" | "blue" | "green" | "orange" | "red" | "yellow" | "neutral";
    children: React.ReactNode;
  }
  ```
  Default `variant="neutral"`. Used by Task 18 (`IntegrationDetail`), Task 19 (`ApiKeyPanel`), Task 21 (`Dashboard`).

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/components/ui/Badge.test.tsx`:

```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders children with the default neutral variant", () => {
    render(<Badge>Live</Badge>);
    expect(screen.getByText("Live")).toHaveClass("ui-badge", "ui-badge-neutral");
  });

  it("applies the requested variant", () => {
    render(<Badge variant="green">Connected</Badge>);
    expect(screen.getByText("Connected")).toHaveClass("ui-badge-green");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Badge`
Expected: FAIL — `Failed to resolve import "./Badge"`.

- [ ] **Step 3: Implement `Badge`**

Create `packages/portal/src/components/ui/Badge.tsx`:

```typescript
import type { ReactNode } from "react";

export interface BadgeProps {
  variant?: "primary" | "blue" | "green" | "orange" | "red" | "yellow" | "neutral";
  children: ReactNode;
}

export function Badge({ variant = "neutral", children }: BadgeProps) {
  return <span className={`ui-badge ui-badge-${variant}`}>{children}</span>;
}
```

Add to `packages/portal/src/styles.css`:

```css
/* ui/Badge */
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--s-4);
  border-radius: var(--radius-full);
  padding: 3px var(--s-8);
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.ui-badge-primary { background: var(--accent-soft); color: var(--accent-hover); }
.ui-badge-blue { background: var(--info-soft); color: var(--info); }
.ui-badge-green { background: var(--ok-soft); color: var(--ok); }
.ui-badge-orange { background: var(--warn-soft); color: var(--warn); }
.ui-badge-red { background: var(--danger-soft); color: var(--danger); }
.ui-badge-yellow { background: var(--warn-soft); color: var(--warn); }
.ui-badge-neutral { background: var(--bg-sunk); color: var(--text-3); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Badge`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/components/ui/Badge.tsx packages/portal/src/components/ui/Badge.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): add ui/Badge component"
```

---

## Task 5: `Card` component

**Files:**
- Create: `packages/portal/src/components/ui/Card.tsx`
- Test: `packages/portal/src/components/ui/Card.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: tokens from Task 1/2.
- Produces: `export function Card(props: CardProps): JSX.Element` where
  ```typescript
  interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
    clickable?: boolean;
    disabled?: boolean;
  }
  ```
  Renders a `<div>` (or `<article>` semantics via caller-supplied `role`) with `.ui-card`, plus `.ui-card-clickable`/`.ui-card-disabled` when set. Forwards all other div props. Used by Task 21 (`Dashboard` integration tiles).

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/components/ui/Card.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders children with the base class", () => {
    render(<Card>Content</Card>);
    expect(screen.getByText("Content")).toHaveClass("ui-card");
  });

  it("adds ui-card-clickable and forwards onClick", () => {
    const onClick = vi.fn();
    render(<Card clickable onClick={onClick}>Click me</Card>);
    const el = screen.getByText("Click me");
    expect(el).toHaveClass("ui-card-clickable");
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("adds ui-card-disabled when disabled", () => {
    render(<Card disabled>Off</Card>);
    expect(screen.getByText("Off")).toHaveClass("ui-card-disabled");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Card`
Expected: FAIL — `Failed to resolve import "./Card"`.

- [ ] **Step 3: Implement `Card`**

Create `packages/portal/src/components/ui/Card.tsx`:

```typescript
import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  clickable?: boolean;
  disabled?: boolean;
}

export function Card({ clickable, disabled, className, ...rest }: CardProps) {
  const classes = ["ui-card", clickable && "ui-card-clickable", disabled && "ui-card-disabled", className]
    .filter(Boolean)
    .join(" ");
  return <div className={classes} {...rest} />;
}
```

Add to `packages/portal/src/styles.css`:

```css
/* ui/Card — never nest cards. */
.ui-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--card-pad);
  display: flex;
  flex-direction: column;
  gap: var(--card-gap);
}
.ui-card-clickable { cursor: pointer; transition: border-color .15s ease, box-shadow .15s ease; }
.ui-card-clickable:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
.ui-card-disabled { opacity: .55; cursor: not-allowed; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Card`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/components/ui/Card.tsx packages/portal/src/components/ui/Card.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): add ui/Card component"
```

---

## Task 6: `Input` component

**Files:**
- Create: `packages/portal/src/components/ui/Input.tsx`
- Test: `packages/portal/src/components/ui/Input.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: tokens from Task 1/2.
- Produces: `export function Input(props: InputProps): JSX.Element` where
  ```typescript
  interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    state?: "default" | "valid" | "error";
  }
  ```
  Renders a plain `<input>` with `.ui-input` + `.ui-input-{state}`; `:focus` styling is CSS-only (`:focus` pseudo-class), not a prop. Forwards all input props (`value`, `onChange`, `placeholder`, `type`, `disabled`, etc.). Used by Tasks 14, 18, 21.

  Also exports `export function Select(props: SelectProps): JSX.Element` (same `state` prop, wraps `<select>`) — Task 21's category filter and Task 14's `apikey` field dropdown both need a select, and the token spec's Input component covers both input and select shapes under one visual contract.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/components/ui/Input.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input, Select } from "./Input";

describe("Input", () => {
  it("renders with default state and forwards value/onChange", () => {
    const onChange = vi.fn();
    render(<Input placeholder="Amount" value="10" onChange={onChange} />);
    const el = screen.getByPlaceholderText("Amount");
    expect(el).toHaveClass("ui-input", "ui-input-default");
    fireEvent.change(el, { target: { value: "20" } });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("applies the error state class", () => {
    render(<Input placeholder="Email" state="error" />);
    expect(screen.getByPlaceholderText("Email")).toHaveClass("ui-input-error");
  });
});

describe("Select", () => {
  it("renders options and forwards onChange", () => {
    const onChange = vi.fn();
    render(
      <Select value="a" onChange={onChange} aria-label="Pick">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>
    );
    const el = screen.getByLabelText("Pick");
    expect(el).toHaveClass("ui-input", "ui-input-default");
    fireEvent.change(el, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Input`
Expected: FAIL — `Failed to resolve import "./Input"`.

- [ ] **Step 3: Implement `Input` and `Select`**

Create `packages/portal/src/components/ui/Input.tsx`:

```typescript
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  state?: "default" | "valid" | "error";
}

export function Input({ state = "default", className, ...rest }: InputProps) {
  const classes = ["ui-input", `ui-input-${state}`, className].filter(Boolean).join(" ");
  return <input className={classes} {...rest} />;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  state?: "default" | "valid" | "error";
}

export function Select({ state = "default", className, children, ...rest }: SelectProps) {
  const classes = ["ui-input", `ui-input-${state}`, className].filter(Boolean).join(" ");
  return (
    <select className={classes} {...rest}>
      {children}
    </select>
  );
}
```

Add to `packages/portal/src/styles.css`:

```css
/* ui/Input, ui/Select */
.ui-input {
  font-family: var(--sans);
  font-size: 14px;
  color: var(--text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--s-8) var(--s-12);
  width: 100%;
  transition: border-color .15s ease, box-shadow .15s ease;
}
.ui-input::placeholder { color: var(--text-4); }
.ui-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.ui-input-valid { border-color: var(--ok); }
.ui-input-error { border-color: var(--danger); box-shadow: 0 0 0 3px var(--danger-soft); }
.ui-input:disabled { opacity: .6; cursor: not-allowed; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Input`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/components/ui/Input.tsx packages/portal/src/components/ui/Input.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): add ui/Input and ui/Select components"
```

---

## Task 7: `Modal` component

**Files:**
- Create: `packages/portal/src/components/ui/Modal.tsx`
- Test: `packages/portal/src/components/ui/Modal.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: tokens from Task 1/2 (`--overlay`, `--surface`, `--radius-lg`, `--shadow-lg`).
- Produces:
  ```typescript
  interface ModalProps {
    open: boolean;
    onClose: () => void;
    title?: React.ReactNode;
    size?: "sm" | "md" | "lg";
    children: React.ReactNode;
    footer?: React.ReactNode;
  }
  export function Modal(props: ModalProps): JSX.Element | null;
  ```
  Renders `null` when `!open`. Escape key and backdrop click call `onClose`; a click inside the content panel does not propagate to the backdrop. On open, focus moves to the content panel (`tabIndex={-1}` + `.focus()` in an effect); no focus-return-to-trigger tracking is implemented (out of scope — see Note below step 3). Used by Tasks 14, 15, 16, 17, 18.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/components/ui/Modal.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={vi.fn()}>Body</Modal>);
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("renders title, body, and footer when open", () => {
    render(
      <Modal open onClose={vi.fn()} title="Connect" footer={<button>Go</button>}>
        Body text
      </Modal>
    );
    expect(screen.getByText("Connect")).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>Body</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on backdrop click but not on content click", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>Body text</Modal>);
    fireEvent.click(screen.getByText("Body text"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves focus into the content panel on open", () => {
    render(<Modal open onClose={vi.fn()}>Body</Modal>);
    expect(document.activeElement).toHaveClass("ui-modal");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Modal`
Expected: FAIL — `Failed to resolve import "./Modal"`.

- [ ] **Step 3: Implement `Modal`**

Create `packages/portal/src/components/ui/Modal.tsx`:

```typescript
import { useEffect, useRef, type ReactNode } from "react";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ open, onClose, title, size = "md", children, footer }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        className={`ui-modal ui-modal-${size}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{title}</h2>
            <button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
```

Note: focus does not return to the trigger element on close in this implementation — the spec's contract ("focus returns to the trigger on close") is deferred. Every current call site replaces a page that reloads or navigates away on close (or re-renders the whole panel), so there is no live trigger element to return focus to in practice. Flagging this as a known simplification, not a silent drop — revisit if a future call site needs it.

Add to `packages/portal/src/styles.css`:

```css
/* ui/Modal */
.ui-modal-backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-16);
  z-index: 50;
}
.ui-modal {
  background: var(--surface);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  padding: var(--s-16);
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  outline: none;
}
.ui-modal-sm { max-width: 320px; }
.ui-modal-md { max-width: 400px; }
.ui-modal-lg { max-width: 560px; }
.ui-modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--s-12);
}
.ui-modal-title { font-size: 16px; font-weight: 700; color: var(--text); }
.ui-modal-body { color: var(--text-2); font-size: 14px; }
.ui-modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--s-8);
  margin-top: var(--s-16);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Modal`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/components/ui/Modal.tsx packages/portal/src/components/ui/Modal.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): add ui/Modal component"
```

---

## Task 8: `BottomSheet` component

**Files:**
- Create: `packages/portal/src/components/ui/BottomSheet.tsx`
- Test: `packages/portal/src/components/ui/BottomSheet.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: tokens from Task 1/2.
- Produces: same prop contract as `Modal` (Task 7) — `{ open, onClose, title?, children, footer? }`, plus `size?: "sm" | "md" | "fullscreen"`. No current call site (spec's approved-but-unused set); included for parity.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/components/ui/BottomSheet.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BottomSheet } from "./BottomSheet";

describe("BottomSheet", () => {
  it("renders nothing when closed", () => {
    render(<BottomSheet open={false} onClose={vi.fn()}>Body</BottomSheet>);
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("renders content when open", () => {
    render(<BottomSheet open onClose={vi.fn()} title="Sheet">Body</BottomSheet>);
    expect(screen.getByText("Sheet")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<BottomSheet open onClose={onClose}>Body</BottomSheet>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on backdrop click but not content click", () => {
    const onClose = vi.fn();
    render(<BottomSheet open onClose={onClose}>Body text</BottomSheet>);
    fireEvent.click(screen.getByText("Body text"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- BottomSheet`
Expected: FAIL — `Failed to resolve import "./BottomSheet"`.

- [ ] **Step 3: Implement `BottomSheet`**

Create `packages/portal/src/components/ui/BottomSheet.tsx`:

```typescript
import { useEffect, useRef, type ReactNode } from "react";

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  size?: "sm" | "md" | "fullscreen";
  children: ReactNode;
  footer?: ReactNode;
}

export function BottomSheet({ open, onClose, title, size = "md", children, footer }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="ui-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={panelRef}
        className={`ui-sheet ui-sheet-${size}`}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="ui-sheet-grip" aria-hidden />
        {title && (
          <div className="ui-modal-head">
            <h2 className="ui-modal-title">{title}</h2>
            <button type="button" className="ui-button ui-button-ghost ui-button-sm" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
        )}
        <div className="ui-modal-body">{children}</div>
        {footer && <div className="ui-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
```

Add to `packages/portal/src/styles.css`:

```css
/* ui/BottomSheet */
.ui-sheet-backdrop {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  z-index: 50;
}
.ui-sheet {
  background: var(--surface);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  box-shadow: var(--shadow-lg);
  padding: var(--s-16);
  width: 100%;
  overflow-y: auto;
  outline: none;
}
.ui-sheet-sm { max-height: 420px; }
.ui-sheet-md { max-height: 560px; }
.ui-sheet-fullscreen { max-height: 100vh; height: 100vh; }
.ui-sheet-grip {
  width: 32px;
  height: 4px;
  border-radius: var(--radius-full);
  background: var(--border);
  margin: 0 auto var(--s-12);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- BottomSheet`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/components/ui/BottomSheet.tsx packages/portal/src/components/ui/BottomSheet.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): add ui/BottomSheet component"
```

---

## Task 9: `Toggle` and `SelectableCard` components

**Files:**
- Create: `packages/portal/src/components/ui/Toggle.tsx`
- Create: `packages/portal/src/components/ui/SelectableCard.tsx`
- Test: `packages/portal/src/components/ui/Toggle.test.tsx`
- Test: `packages/portal/src/components/ui/SelectableCard.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: tokens from Task 1/2.
- Produces:
  ```typescript
  interface ToggleProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label?: React.ReactNode;
    disabled?: boolean;
    size?: "sm" | "md";
  }
  export function Toggle(props: ToggleProps): JSX.Element;

  interface SelectableCardProps {
    title: React.ReactNode;
    description?: React.ReactNode;
    active?: boolean;
    disabled?: boolean;
    onSelect: () => void;
  }
  export function SelectableCard(props: SelectableCardProps): JSX.Element;
  ```
  Neither has a current call site — both are included per the spec's approved component set.

- [ ] **Step 1: Write the failing tests**

Create `packages/portal/src/components/ui/Toggle.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("renders unchecked and calls onChange(true) on click", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Remember me" />);
    const el = screen.getByRole("checkbox", { name: "Remember me" });
    expect(el).not.toBeChecked();
    fireEvent.click(el);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders checked and calls onChange(false) on click", () => {
    const onChange = vi.fn();
    render(<Toggle checked onChange={onChange} label="Remember me" />);
    const el = screen.getByRole("checkbox", { name: "Remember me" });
    expect(el).toBeChecked();
    fireEvent.click(el);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does not fire onChange when disabled", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Off" disabled />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Off" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

Create `packages/portal/src/components/ui/SelectableCard.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectableCard } from "./SelectableCard";

describe("SelectableCard", () => {
  it("renders title and description, calls onSelect on click", () => {
    const onSelect = vi.fn();
    render(<SelectableCard title="Plan A" description="Basic" onSelect={onSelect} />);
    expect(screen.getByText("Plan A")).toBeInTheDocument();
    expect(screen.getByText("Basic")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Plan A"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("applies the active class when active", () => {
    render(<SelectableCard title="Plan A" active onSelect={vi.fn()} />);
    expect(screen.getByText("Plan A").closest(".ui-selectable-card")).toHaveClass("ui-selectable-card-active");
  });

  it("does not fire onSelect when disabled", () => {
    const onSelect = vi.fn();
    render(<SelectableCard title="Plan A" disabled onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Plan A"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("fires onSelect on Enter key", () => {
    const onSelect = vi.fn();
    render(<SelectableCard title="Plan A" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByText("Plan A").closest(".ui-selectable-card")!, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @a-workbench/portal -- Toggle SelectableCard`
Expected: FAIL — both modules unresolved.

- [ ] **Step 3: Implement `Toggle` and `SelectableCard`**

Create `packages/portal/src/components/ui/Toggle.tsx`:

```typescript
import type { ReactNode } from "react";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
  size?: "sm" | "md";
}

export function Toggle({ checked, onChange, label, disabled, size = "md" }: ToggleProps) {
  return (
    <label className={`ui-toggle ui-toggle-${size} ${disabled ? "ui-toggle-disabled" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={typeof label === "string" ? label : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="ui-toggle-track" aria-hidden>
        <span className="ui-toggle-thumb" />
      </span>
      {label && <span className="ui-toggle-label">{label}</span>}
    </label>
  );
}
```

Create `packages/portal/src/components/ui/SelectableCard.tsx`:

```typescript
import type { ReactNode } from "react";

export interface SelectableCardProps {
  title: ReactNode;
  description?: ReactNode;
  active?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

export function SelectableCard({ title, description, active, disabled, onSelect }: SelectableCardProps) {
  const classes = [
    "ui-selectable-card",
    active && "ui-selectable-card-active",
    disabled && "ui-selectable-card-disabled",
  ]
    .filter(Boolean)
    .join(" ");

  function handleKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      className={classes}
      role="radio"
      aria-checked={!!active}
      aria-disabled={disabled}
      tabIndex={disabled ? -1 : 0}
      onClick={disabled ? undefined : onSelect}
      onKeyDown={handleKeyDown}
    >
      <div className="ui-selectable-card-title">{title}</div>
      {description && <div className="ui-selectable-card-desc">{description}</div>}
    </div>
  );
}
```

Add to `packages/portal/src/styles.css`:

```css
/* ui/Toggle */
.ui-toggle { display: inline-flex; align-items: center; gap: var(--s-8); cursor: pointer; }
.ui-toggle input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.ui-toggle-track {
  display: inline-block;
  border-radius: var(--radius-full);
  background: var(--border-strong);
  transition: background-color .15s ease;
  position: relative;
}
.ui-toggle-sm .ui-toggle-track { width: 32px; height: 20px; }
.ui-toggle-md .ui-toggle-track { width: 44px; height: 24px; }
.ui-toggle-thumb {
  display: block;
  border-radius: var(--radius-full);
  background: #fff;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform .15s ease;
}
.ui-toggle-sm .ui-toggle-thumb { width: 16px; height: 16px; }
.ui-toggle-md .ui-toggle-thumb { width: 20px; height: 20px; }
.ui-toggle input:checked + .ui-toggle-track { background: var(--accent); }
.ui-toggle-sm input:checked + .ui-toggle-track .ui-toggle-thumb { transform: translateX(12px); }
.ui-toggle-md input:checked + .ui-toggle-track .ui-toggle-thumb { transform: translateX(20px); }
.ui-toggle-disabled { opacity: .6; cursor: not-allowed; }
.ui-toggle-label { font-family: var(--sans); font-size: 14px; color: var(--text); }

/* ui/SelectableCard */
.ui-selectable-card {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: var(--s-12);
  cursor: pointer;
  transition: border-color .15s ease, background-color .15s ease;
}
.ui-selectable-card-active { border-color: var(--accent); background: var(--accent-soft); }
.ui-selectable-card-disabled { opacity: .55; cursor: not-allowed; }
.ui-selectable-card-title { font-family: var(--sans); font-size: 14px; font-weight: 700; color: var(--text); }
.ui-selectable-card-desc { font-family: var(--sans); font-size: 12px; font-weight: 500; color: var(--text-2); margin-top: var(--s-4); }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @a-workbench/portal -- Toggle SelectableCard`
Expected: PASS, 3 + 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/components/ui/Toggle.tsx packages/portal/src/components/ui/SelectableCard.tsx packages/portal/src/components/ui/Toggle.test.tsx packages/portal/src/components/ui/SelectableCard.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): add ui/Toggle and ui/SelectableCard components"
```

---

## Task 10: `NavigationHeader` component

**Files:**
- Create: `packages/portal/src/components/ui/NavigationHeader.tsx`
- Test: `packages/portal/src/components/ui/NavigationHeader.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: tokens from Task 1/2; `ThemeToggle` from Task 2.
- Produces:
  ```typescript
  interface NavigationHeaderProps {
    title: React.ReactNode;
    onBack?: () => void;
    trailing?: React.ReactNode;
  }
  export function NavigationHeader(props: NavigationHeaderProps): JSX.Element;
  ```
  Used by Task 21 (`Dashboard`) to replace `.topbar`.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/components/ui/NavigationHeader.test.tsx`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NavigationHeader } from "./NavigationHeader";

describe("NavigationHeader", () => {
  it("renders the title", () => {
    render(<NavigationHeader title="workbench" />);
    expect(screen.getByText("workbench")).toBeInTheDocument();
  });

  it("renders a back button and fires onBack when provided", () => {
    const onBack = vi.fn();
    render(<NavigationHeader title="Detail" onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("omits the back button when onBack is not provided", () => {
    render(<NavigationHeader title="Home" />);
    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
  });

  it("renders trailing content", () => {
    render(<NavigationHeader title="Home" trailing={<span>Sign out</span>} />);
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- NavigationHeader`
Expected: FAIL — `Failed to resolve import "./NavigationHeader"`.

- [ ] **Step 3: Implement `NavigationHeader`**

Create `packages/portal/src/components/ui/NavigationHeader.tsx`:

```typescript
import type { ReactNode } from "react";

export interface NavigationHeaderProps {
  title: ReactNode;
  onBack?: () => void;
  trailing?: ReactNode;
}

export function NavigationHeader({ title, onBack, trailing }: NavigationHeaderProps) {
  return (
    <header className="ui-nav-header">
      <div className="ui-nav-header-lead">
        {onBack && (
          <button type="button" className="ui-nav-header-back" onClick={onBack} aria-label="Back">
            ←
          </button>
        )}
        <span className="ui-nav-header-title">{title}</span>
      </div>
      {trailing && <div className="ui-nav-header-trailing">{trailing}</div>}
    </header>
  );
}
```

Add to `packages/portal/src/styles.css`:

```css
/* ui/NavigationHeader */
.ui-nav-header {
  height: var(--topbar-h);
  padding: 0 var(--page-pad-x);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 20;
}
.ui-nav-header-lead { display: flex; align-items: center; gap: var(--s-12); }
.ui-nav-header-back { background: none; border: none; color: var(--text); font-size: 18px; cursor: pointer; }
.ui-nav-header-title { font-family: var(--sans); font-size: 16px; font-weight: 700; color: var(--text); }
.ui-nav-header-trailing { display: flex; align-items: center; gap: var(--s-12); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- NavigationHeader`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/components/ui/NavigationHeader.tsx packages/portal/src/components/ui/NavigationHeader.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): add ui/NavigationHeader component"
```

---

## Task 11: Rewrite base `styles.css` layout against tokens

**Files:**
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: all tokens from Task 1/2, all `.ui-*` component classes from Tasks 3–10.
- Produces: nothing new consumed by later tasks — this is a cleanup pass on shared/global rules only (body, `.app`, `.main`, `.eyebrow`, `.dot`, `.sep`, scrollbar, animations). Component-specific classes (`.card`, `.btn-*`, `.modal-*`, etc.) are deleted here only once their last consumer is migrated in Tasks 12–21 — so this task runs the global cleanup first, and each page-migration task deletes its own now-dead classes as it goes (see each task's Step "Remove now-dead CSS").

- [ ] **Step 1: Replace the body/base rules**

In `packages/portal/src/styles.css`, replace the `body` rule and the `body::before` grid-overlay rule (the ones setting `font-family: var(--mono)`, the radial-gradient background, and the animated grid) with:

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body, #root { height: 100%; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
```

Delete the `body::before` rule entirely (the grid overlay) and the `@keyframes pulse` used only by `.brand-mark` (kept only if still referenced — it will be deleted in Task 21 when `.brand-mark`'s pulse is dropped; if Task 21 hasn't run yet, leave the keyframes in place and remove them there instead).

- [ ] **Step 2: Update `.app`, `.main` layout rules to use tokens**

Find `.app` and `.main` (or equivalent page-shell classes) and replace any hardcoded colors/spacing with the token equivalents (`var(--bg)`, `var(--page-pad-x)`, `var(--section-gap)`, etc.), keeping the existing `display: grid`/`flex` structure unchanged.

- [ ] **Step 3: Verify the build**

Run: `npm run build -w @a-workbench/portal`
Expected: succeeds.

Run: `npm run dev -w @a-workbench/portal` and open the portal in a browser.
Expected: page background is now light (`#f9faf8`), body text is Inter, no animated grid — but most page content still looks broken/unstyled where old classes (`.card`, `.btn-*`, `.modal-*`, `.boot`, etc.) reference now-undefined `--ink`/`--mono` custom properties. This is expected; Tasks 12–21 fix each page.

- [ ] **Step 4: Commit**

```bash
git add packages/portal/src/styles.css
git commit -m "refactor(portal): rewrite base styles against shared design tokens"
```

---

## Task 12: Migrate `App.tsx` (Boot / RequireAuth loading state)

**Files:**
- Modify: `packages/portal/src/App.tsx`
- Modify: `packages/portal/src/styles.css` (remove `.boot`/`.blinker`, add `.ui-loading`)

**Interfaces:**
- Consumes: nothing new (no `ui/` component needed — this is a two-line loading state).
- Produces: `Boot` component's rendered output changes from `.boot`/`.blinker` markup to `.ui-loading` — no exported interface changes (still an internal, unexported function in `App.tsx`).

- [ ] **Step 1: Replace the `Boot` component**

In `packages/portal/src/App.tsx`, replace:

```typescript
function Boot({ label = "INIT" }: { label?: string }) {
  return (
    <div className="boot">
      <span>{label}<span className="blinker" /></span>
    </div>
  );
}
```

with:

```typescript
function Boot({ label = "Loading" }: { label?: string }) {
  return (
    <div className="ui-loading">
      <span>{label}…</span>
    </div>
  );
}
```

The one call site, `<Boot label="VERIFY SESSION" />` in `RequireAuth`, keeps working unchanged (still passes a `label` string) — update its copy to sentence case: `<Boot label="Verifying session" />`.

- [ ] **Step 2: Remove now-dead CSS, add the replacement**

In `packages/portal/src/styles.css`, delete `.boot`, `.blinker`, and any `@keyframes blink`/similar used only by them. Add:

```css
/* Boot / loading state */
.ui-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  font-family: var(--sans);
  font-size: 14px;
  color: var(--text-3);
}
```

- [ ] **Step 3: Verify**

Run: `npm run build -w @a-workbench/portal`
Expected: succeeds, no references to `.boot`/`.blinker` remain (`grep -rn "\.boot\b\|blinker" packages/portal/src` returns nothing outside this task's own diff history).

- [ ] **Step 4: Commit**

```bash
git add packages/portal/src/App.tsx packages/portal/src/styles.css
git commit -m "refactor(portal): migrate App boot/loading state off console styling"
```

---

## Task 13: Migrate `Login.tsx`

**Files:**
- Modify: `packages/portal/src/pages/Login.tsx`
- Modify: `packages/portal/src/styles.css` (remove `.login-shell`/`.glyph`/`.specs`/`.pip` console styling, restyle `.login-*` against tokens, add `.ui-button-outline` icon-button usage)

**Interfaces:**
- Consumes: `Button` from Task 3.
- Produces: nothing new consumed by later tasks (leaf page).

- [ ] **Step 1: Replace the Google/Keycloak buttons with `Button`**

In `packages/portal/src/pages/Login.tsx`, import `{ Button } from "../components/ui/Button"`. Replace:

```typescript
<button onClick={handleGoogle} className="btn-google" type="button">
  <svg ...>...</svg>
  Continue with Google
</button>
```

with:

```typescript
<Button onClick={handleGoogle} variant="outline" size="lg" type="button">
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
    <path fill="#14111d" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
    <path fill="#14111d" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#14111d" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#14111d" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
  Continue with Google
</Button>
```

Same pattern for the Keycloak button, `variant="outline"`.

- [ ] **Step 2: Simplify the art panel copy**

Replace the ASCII-art `.glyph` block:

```typescript
<div className="glyph">
  ./connect <em>—</em><br />
  your agent's<br />
  <em>tool</em>belt<span className="arrow">_</span>
</div>
```

with a plain heading:

```typescript
<h1 className="login-art-title">Connect your agent's toolbelt.</h1>
```

Keep `.specs` (TOOLS/PLUGINS/NODE stat row) as plain labeled stats — no `<em>` italic-glyph styling, just the numbers.

Keep `.login-fine`'s content (`AES-256-GCM · encrypted at rest · self-hosted`) but drop the `.pip` blinking dot — plain text separated by `·`.

- [ ] **Step 3: Remove now-dead CSS, restyle the rest against tokens**

In `packages/portal/src/styles.css`: delete `.btn-google`, `.btn-keycloak`, `.glyph`, `.arrow`, `.pip` and any animation used only by them. Rewrite `.login-shell`, `.login-art`, `.login-form`, `.login-card`, `.login-title`, `.login-sub`, `.login-eyebrow`, `.login-fine`, `.specs` to use `var(--surface)`, `var(--text)`, `var(--text-2)`, `var(--border)`, `var(--sans)`, `var(--s-*)`, `var(--radius-lg)` in place of the old `--ink`/`--panel`/`--mono` names. Add `.login-art-title { font-family: var(--sans); font-size: 28px; font-weight: 700; color: var(--text); }`.

- [ ] **Step 4: Verify**

Run: `npm run build -w @a-workbench/portal`, then `npm run dev -w @a-workbench/portal` and view `/login` in a browser.
Expected: light background, Inter type, outline-style provider buttons, no ASCII glyph or blinking pip.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/pages/Login.tsx packages/portal/src/styles.css
git commit -m "refactor(portal): migrate Login page onto design tokens"
```

---

## Task 14: Migrate `ApiKeyAuthModal.tsx`

**Files:**
- Modify: `packages/portal/src/components/ApiKeyAuthModal.tsx`
- Modify: `packages/portal/src/styles.css` (restyle `.apikey-*` field classes against tokens)

**Interfaces:**
- Consumes: `Modal` from Task 7, `Button` from Task 3, `Input`/`Select` from Task 6.
- Produces: nothing new (leaf component).

- [ ] **Step 1: Replace the hand-rolled modal wrapper with `Modal`**

In `packages/portal/src/components/ApiKeyAuthModal.tsx`, import `{ Modal } from "./ui/Modal"`, `{ Button } from "./ui/Button"`, `{ Input, Select } from "./ui/Input"`. Replace the whole return statement:

```typescript
return (
  <Modal
    open
    onClose={onClose}
    title={<>Connect <span>{displayName || integration}</span></>}
    footer={
      <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={saving || !complete}>
          {saving ? "Connecting…" : "Connect account"}
        </Button>
      </>
    }
  >
    <div className="apikey-form">
      {fields.map((f) => (
        <div className="apikey-field" key={f.key}>
          <label className="apikey-field-label" htmlFor={`apikey-${f.key}`}>
            {f.label}{" "}
            {f.optional ? (
              <span className="apikey-opt">(optional)</span>
            ) : (
              <span className="apikey-req">*</span>
            )}
          </label>
          {f.description && <p className="apikey-field-desc">{f.description}</p>}
          {f.options ? (
            <Select
              id={`apikey-${f.key}`}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            >
              {f.options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </Select>
          ) : (
            <Input
              id={`apikey-${f.key}`}
              type={f.secret ? "password" : "text"}
              autoComplete="off"
              placeholder={f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          )}
        </div>
      ))}
    </div>

    {error && <div className="ui-form-error">ERR — {error}</div>}
  </Modal>
);
```

- [ ] **Step 2: Remove now-dead CSS**

In `packages/portal/src/styles.css`, delete `.modal-backdrop`, `.modal`, `.modal-head`, `.modal-title`, `.modal-foot`, `.modal-error`, `.session-transfer-paste` (the class this file was borrowing for its `<input>`/`<select>` styling — no longer needed once `Input`/`Select` own that styling) *only if* no other not-yet-migrated file still uses them (check with `grep -rn "modal-backdrop\|className=\"modal\"" packages/portal/src` — `CookieAuthPopup.tsx`, `ConnectLinkProblem.tsx`, `IntegrationDetail.tsx`, `Connect.tsx`, `BrowserView.tsx` still use them until Tasks 15–18 run, so **leave these classes in place** and only delete `.apikey-*`-prefixed rules that are now fully superseded — none are, since `.apikey-form`/`.apikey-field`/`.apikey-field-label`/`.apikey-opt`/`.apikey-req`/`.apikey-field-desc` are still used by this file, just restyled against tokens rather than removed). Add `.ui-form-error { font-family: var(--sans); font-size: 13px; color: var(--danger); background: var(--danger-soft); border-radius: var(--radius); padding: var(--s-8) var(--s-12); }` for reuse by every remaining modal migration (Tasks 15–18 reuse this same class instead of the old `.modal-error`).

Restyle `.apikey-form`, `.apikey-field`, `.apikey-field-label`, `.apikey-opt`, `.apikey-req`, `.apikey-field-desc` to use `var(--sans)`, `var(--text)`, `var(--text-3)`, `var(--danger)`, `var(--s-*)` in place of old `--ink`/`--mute` names.

- [ ] **Step 3: Verify**

Run: `npm run build -w @a-workbench/portal`
Expected: succeeds. Manually trigger an apikey connect flow (e.g. New Relic) in dev and confirm the modal renders correctly with the new `Modal`/`Input`/`Select`/`Button`.

- [ ] **Step 4: Commit**

```bash
git add packages/portal/src/components/ApiKeyAuthModal.tsx packages/portal/src/styles.css
git commit -m "refactor(portal): migrate ApiKeyAuthModal onto ui/Modal, ui/Input, ui/Button"
```

---

## Task 15: Migrate `CookieAuthPopup.tsx`

**Files:**
- Modify: `packages/portal/src/components/CookieAuthPopup.tsx`
- Modify: `packages/portal/src/styles.css` (restyle `.modal-instructions`)

**Interfaces:**
- Consumes: `Modal` from Task 7, `Button` from Task 3.

- [ ] **Step 1: Replace the hand-rolled modal wrapper with `Modal`**

In `packages/portal/src/components/CookieAuthPopup.tsx`, import `{ Modal } from "./ui/Modal"` and `{ Button } from "./ui/Button"`. Replace the return statement:

```typescript
return (
  <Modal
    open
    onClose={handleCancel}
    title={<>Pair <span>{integration}</span></>}
    footer={
      <>
        <Button variant="ghost" onClick={handleCancel}>Cancel</Button>
        <Button onClick={handleCapture} disabled={capturing}>
          {capturing ? "Capturing…" : "Capture session"}
        </Button>
      </>
    }
  >
    <div className="modal-instructions">
      <div><b>01</b> — Complete login in the remote browser below (mouse + keyboard streamed via CDP).</div>
      <div><b>02</b> — Click "Capture session" once authenticated.</div>
    </div>

    <div style={{ padding: 0, background: "#000", marginTop: "var(--s-12)" }}>
      <CdpScreencast cdpProxyUrl={cdpProxyUrl} sessionId={sessionId} cdpToken={cdpToken} width={1024} />
    </div>

    {error && <div className="ui-form-error" style={{ marginTop: "var(--s-12)" }}>ERR — {error}</div>}
  </Modal>
);
```

Note: `Modal`'s built-in close button (rendered when `title` is set, per Task 7) calls `onClose` directly, bypassing this component's `handleCancel` (which also calls `cancelCookieAuth`). Since `onClose={handleCancel}` is passed to `Modal` itself, both the built-in close button *and* backdrop/Escape all correctly route through `handleCancel` — no behavior change from the original (which only wired Escape/backdrop-click loosely; the explicit "Close" button in the original called `handleCancel` too).

- [ ] **Step 2: Remove now-dead CSS**

Leave `.modal-instructions` in place (still used here and by Tasks 16–18) but restyle it against tokens: `font-family: var(--sans)`, `color: var(--text-2)`, replacing old `--ink-dim`/`--mono` references.

- [ ] **Step 3: Verify**

Run: `npm run build -w @a-workbench/portal`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/portal/src/components/CookieAuthPopup.tsx packages/portal/src/styles.css
git commit -m "refactor(portal): migrate CookieAuthPopup onto ui/Modal, ui/Button"
```

---

## Task 16: Migrate `ConnectLinkProblem.tsx`

**Files:**
- Modify: `packages/portal/src/components/ConnectLinkProblem.tsx`

**Interfaces:**
- Consumes: `Modal` from Task 7, `Button` from Task 3.

- [ ] **Step 1: Replace both branches' markup with `Modal`**

In `packages/portal/src/components/ConnectLinkProblem.tsx`, import `{ Modal } from "./ui/Modal"` and `{ Button } from "./ui/Button"`. Replace the `ACCOUNT_MISMATCH` branch's return:

```typescript
if (error.code === "ACCOUNT_MISMATCH") {
  return (
    <Modal
      open
      onClose={() => {}}
      title="Wrong workbench account"
      footer={<Button variant="danger" onClick={logout}>Sign out</Button>}
    >
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
    </Modal>
  );
}
```

`onClose={() => {}}` is intentional: this is a dead-end screen with no way to dismiss it other than signing out (per the spec's original design — "no continue affordance"), so backdrop click and Escape are no-ops here rather than silently closing onto a broken state.

Leave the non-`ACCOUNT_MISMATCH` branch's `<div className="boot">` as-is for now — Task 21's global CSS cleanup replaces every remaining `.boot` usage at once (see Task 21 Step covering leaf `.boot` call sites); this task only touches the modal-shaped branch.

- [ ] **Step 2: Verify**

Run: `npm run build -w @a-workbench/portal`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/portal/src/components/ConnectLinkProblem.tsx
git commit -m "refactor(portal): migrate ConnectLinkProblem mismatch screen onto ui/Modal"
```

---

## Task 17: Migrate `Connect.tsx` and `BrowserView.tsx`

**Files:**
- Modify: `packages/portal/src/pages/Connect.tsx`
- Modify: `packages/portal/src/pages/BrowserView.tsx`

**Interfaces:**
- Consumes: `Modal` from Task 7, `Button` from Task 3.

- [ ] **Step 1: Replace `Connect.tsx`'s modal markup**

In `packages/portal/src/pages/Connect.tsx`, import `{ Modal } from "../components/ui/Modal"` and `{ Button } from "../components/ui/Button"`. Replace the final return statement:

```typescript
return (
  <Modal open onClose={() => {}} title={<>Connect <span>{info.integration}</span></>}
    footer={
      <Button onClick={handleCapture} disabled={capturing}>
        {capturing ? "Capturing…" : "Capture session"}
      </Button>
    }
  >
    <div className="modal-instructions">
      <div><b>01</b> — Log in to the remote browser below.</div>
      <div><b>02</b> — Click "Capture session" once authenticated.</div>
    </div>
    <div style={{ padding: 0, background: "#000", marginTop: "var(--s-12)" }}>
      <CdpScreencast cdpProxyUrl={info.cdpProxyUrl} sessionId={info.sessionId} cdpToken={info.cdpToken} width={1024} />
    </div>
    {error && <div className="ui-form-error" style={{ marginTop: "var(--s-12)" }}>ERR — {error}</div>}
  </Modal>
);
```

`onClose={() => {}}`: this page has no "cancel" concept — the link is single-use and the only way out is completing capture or closing the browser tab, same as the pre-migration markup (which had no close button either).

- [ ] **Step 2: Replace `BrowserView.tsx`'s modal markup**

In `packages/portal/src/pages/BrowserView.tsx`, same imports. Replace the final return statement:

```typescript
return (
  <Modal open onClose={() => {}} title="Browser session">
    <div className="modal-instructions">
      <div>You are driving the live browser. Close this tab to hand control back to your agent.</div>
    </div>
    <div style={{ padding: 0, background: "#000", marginTop: "var(--s-12)" }}>
      <CdpScreencast cdpProxyUrl={info.cdpProxyUrl} sessionId={info.sessionId} cdpToken={info.cdpToken} width={1024} />
    </div>
    {error && <div className="ui-form-error" style={{ marginTop: "var(--s-12)" }}>ERR — {error}</div>}
  </Modal>
);
```

- [ ] **Step 3: Update the remaining `.boot` states' copy (kept as `.boot` for now)**

Both files still render `<div className="boot">...</div>` for their loading/error/done states (e.g. `LOADING LOGIN`, `ERR — {error}`, `CONNECTED — {integration}...`). Leave the `.boot` class name in these two files for this task — Task 21 does the final sweep replacing every remaining `.boot`/`.blinker` reference across the codebase in one pass, once `Dashboard.tsx` (the last and largest consumer) is migrated too, so the CSS deletion happens exactly once instead of piecemeal.

- [ ] **Step 4: Verify**

Run: `npm run build -w @a-workbench/portal`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/pages/Connect.tsx packages/portal/src/pages/BrowserView.tsx
git commit -m "refactor(portal): migrate Connect and BrowserView modal markup onto ui/Modal"
```

---

## Task 18: Migrate `IntegrationDetail.tsx`

**Files:**
- Modify: `packages/portal/src/components/IntegrationDetail.tsx`
- Modify: `packages/portal/src/styles.css` (restyle `.session-transfer*`, `.integ-*` classes against tokens)

**Interfaces:**
- Consumes: `Modal` from Task 7, `Button` from Task 3, `Input` from Task 6, `Badge` from Task 4.

- [ ] **Step 1: Replace `BrowserControls`' and `SessionTransfer`'s raw inputs/buttons**

In `packages/portal/src/components/IntegrationDetail.tsx`, import `{ Button } from "./ui/Button"` and `{ Input } from "./ui/Input"`. In `BrowserControls`, replace the raw `<input>`/`<button>` pair:

```typescript
<div className="session-transfer-row">
  <Input
    style={{ flex: 1 }}
    placeholder="https://example.com (optional)"
    value={url}
    onChange={(e) => setUrl(e.target.value)}
  />
  <Button onClick={onOpen} disabled={busy}>Open live view →</Button>
</div>
<div className="session-transfer-row">
  <Button variant="danger" onClick={onClear} disabled={busy}>Clear session</Button>
</div>
```

In `SessionTransfer`, replace the export/import buttons with `Button` (`variant="ghost"` for Export, default `variant="primary"` for Import) and the `<textarea>` stays a plain `<textarea className="ui-input">` (reusing `Input`'s CSS class directly, since `Input`/`Select` don't cover multi-line — `Input`'s `.ui-input` class is generic enough to apply to a `<textarea>` too):

```typescript
<textarea
  className="ui-input"
  placeholder="Paste an exported session bundle JSON here…"
  value={paste}
  onChange={(e) => setPaste(e.target.value)}
  rows={4}
/>
```

- [ ] **Step 2: Replace the modal wrapper with `Modal`**

Replace the outer return statement in `IntegrationDetail`:

```typescript
return (
  <Modal
    open
    onClose={onClose}
    size="lg"
    title={
      <div className="integ-detail-title">
        <IntegrationLogo name={name} displayName={data?.displayName} logo={data?.logo} size={44} />
        <div>
          <div>{data?.displayName || name}</div>
          <div className="card-ver">v{data?.version ?? "—"} · {data?.authType ?? "…"}</div>
        </div>
      </div>
    }
    footer={
      data?.authType !== "none" ? (
        <>
          {connected && (
            <Button variant="danger" onClick={() => onDisconnect(name)}>
              Disconnect
            </Button>
          )}
          <Button variant={connected ? "ghost" : "primary"} onClick={() => onConnect(name)}>
            {connected ? "Re-authorize" : "Connect →"}
          </Button>
        </>
      ) : undefined
    }
  >
    {isLoading && <div className="ui-loading">Loading…</div>}
    {error && <div className="ui-form-error">ERR — failed to load</div>}
    {data && (
      <>
        {data.description && <p className="integ-detail-desc">{data.description}</p>}
        {data.categories && data.categories.length > 0 && (
          <div className="integ-tags">
            {data.categories.map((c) => <Badge key={c} variant="neutral">{c}</Badge>)}
          </div>
        )}
        {data.authType === "cookie" && <SessionTransfer name={name} />}
        {name === "browser" && <BrowserControls />}
        <div className="integ-tools-head">
          <span>Tools</span><Badge variant="neutral">{data.tools.length}</Badge>
        </div>
        <ul className="integ-tool-list">
          {data.tools.map((t) => (
            <li key={t.name} className="integ-tool">
              <code className="integ-tool-name">{t.name}</code>
              <span className="integ-tool-desc">{t.description}</span>
            </li>
          ))}
        </ul>
      </>
    )}
  </Modal>
);
```

Add the `Badge` import: `import { Badge } from "./ui/Badge";`.

Note: `Modal`'s `title` prop (Task 7) already renders its own "Close" button next to whatever is passed as `title` — passing the logo+name block as `title` gets that close button "for free," matching the original's `<button className="btn-ghost" onClick={onClose}>Close</button>` in `.modal-head`.

- [ ] **Step 3: Restyle remaining classes against tokens**

In `packages/portal/src/styles.css`, restyle `.session-transfer`, `.session-transfer-row`, `.session-transfer-ok`, `.integ-tools-head`, `.integ-detail-desc`, `.integ-tags`, `.integ-tag` (superseded by `Badge` usage above but still referenced if any other file uses it directly — check with `grep -rn "integ-tag\b" packages/portal/src`; if only `IntegrationDetail.tsx`/`AgentsPanel.tsx`/`Dashboard.tsx` reference it and all three migrate to `Badge` by end of Task 21, delete `.integ-tag`/`.integ-tags` now and note it in Task 19/21 if either still needs it — otherwise leave in place until confirmed dead), `.integ-tool-list`, `.integ-tool`, `.integ-tool-name`, `.integ-tool-desc`, `.card-ver` to use `var(--sans)`/`var(--mono)` (tool names stay mono, per spec Design §3), `var(--text)`, `var(--text-2)`, `var(--s-*)`.

- [ ] **Step 4: Verify**

Run: `npm run build -w @a-workbench/portal`
Expected: succeeds. In dev, open an integration's detail modal and confirm tools list, tags, session transfer, and browser controls all render correctly.

- [ ] **Step 5: Commit**

```bash
git add packages/portal/src/components/IntegrationDetail.tsx packages/portal/src/styles.css
git commit -m "refactor(portal): migrate IntegrationDetail onto ui/Modal, ui/Button, ui/Input, ui/Badge"
```

---

## Task 19: Migrate `ApiKeyPanel.tsx`

**Files:**
- Modify: `packages/portal/src/components/ApiKeyPanel.tsx`
- Modify: `packages/portal/src/styles.css` (restyle `.apikey-panel`, `.apikey-reveal`, `.apikey-snippet*`)

**Interfaces:**
- Consumes: `Badge` from Task 4, `Button` from Task 3.

- [ ] **Step 1: Replace the status pill and action buttons**

In `packages/portal/src/components/ApiKeyPanel.tsx`, import `{ Badge } from "./ui/Badge"` and `{ Button } from "./ui/Button"`. Replace:

```typescript
<span className={`card-status ${hasKey ? "live" : ""}`}>
  <span className="led" />
  {isLoading ? "…" : hasKey ? "Key active" : "No key"}
</span>
```

with:

```typescript
<Badge variant={hasKey ? "green" : "neutral"}>
  {isLoading ? "…" : hasKey ? "Key active" : "No key"}
</Badge>
```

Replace every `<button className="btn-ghost" ...>`/`<button className="btn-connect" ...>`/`<button className="btn-disconnect" ...>` in this file with `<Button variant="ghost" ...>`/`<Button ...>` (default primary)/`<Button variant="danger" ...>` respectively, keeping their existing `onClick`/`disabled`/children unchanged.

Replace `{error && <div className="login-error" ...>ERR — {error}</div>}` with `{error && <div className="ui-form-error" ...>ERR — {error}</div>}`.

- [ ] **Step 2: Restyle remaining classes**

In `packages/portal/src/styles.css`, restyle `.apikey-panel`, `.apikey-head`, `.apikey-blurb`, `.apikey-reveal`, `.apikey-row`, `.apikey-value`, `.apikey-snippet-label`, `.apikey-snippet`, `.apikey-actions` against tokens — `.apikey-value` and `.apikey-snippet` keep `var(--mono)` (they render the literal key/config, code-shaped content per spec Design §3); everything else moves to `var(--sans)`.

Delete `.card-status` and `.led` entirely once this is their last consumer — confirm with `grep -rn "card-status\|\"led\"\|className=\"led\"" packages/portal/src` (Task 21's Dashboard migration is the only other consumer; if this task runs before Task 21, leave `.card-status`/`.led` in place and let Task 21 delete them instead).

- [ ] **Step 3: Verify**

Run: `npm run build -w @a-workbench/portal`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/portal/src/components/ApiKeyPanel.tsx packages/portal/src/styles.css
git commit -m "refactor(portal): migrate ApiKeyPanel onto ui/Badge, ui/Button"
```

---

## Task 20: Migrate `AgentsPanel.tsx`

**Files:**
- Modify: `packages/portal/src/components/AgentsPanel.tsx`
- Modify: `packages/portal/src/styles.css` (restyle `.agents-list`, `.agent-row`, `.agent-id`, `.eyebrow`, `.dot`)

**Interfaces:**
- Consumes: `Badge` from Task 4, `Button` from Task 3.

- [ ] **Step 1: Replace scope tags and the revoke button**

In `packages/portal/src/components/AgentsPanel.tsx`, import `{ Badge } from "./ui/Badge"` and `{ Button } from "./ui/Button"`. Replace:

```typescript
{a.scopes.length > 0 && (
  <div className="integ-tags">
    {a.scopes.map((s) => <span key={s} className="integ-tag">{s}</span>)}
  </div>
)}
```

with:

```typescript
{a.scopes.length > 0 && (
  <div className="integ-tags">
    {a.scopes.map((s) => <Badge key={s} variant="neutral">{s}</Badge>)}
  </div>
)}
```

Replace the revoke `<button className="btn-disconnect" ...>` with `<Button variant="danger" ...>`, keeping `onClick`/`disabled`/`title`/children unchanged.

Replace `{error && <div className="login-error" ...>ERR — {error}</div>}` with `{error && <div className="ui-form-error" ...>ERR — {error}</div>}`.

- [ ] **Step 2: Restyle remaining classes**

In `packages/portal/src/styles.css`, restyle `.agents-panel`, `.agents-list`, `.agent-row`, `.agent-id`, `.card-meta` against tokens (`var(--sans)`, `var(--text)`, `var(--text-3)`, `var(--s-*)`). Restyle `.eyebrow` and `.dot` (the `// connected agents ── oauth clients` label style, reused across several files) against tokens — keep them as a small `var(--mono)`-styled section label since it reads as a structural/technical marker, not body prose (per spec's mono-scoping rule in Design §3, this is a borderline case; treat it as a section-eyebrow style and keep mono for continuity with `Dashboard`'s identical `.eyebrow` usage — do not restyle to `--sans` here only to have Task 21 restyle it back).

Confirm `.integ-tag`/`.integ-tags` is now dead if `IntegrationDetail.tsx` (Task 18) and `Dashboard.tsx` (Task 21) have also migrated off it — run `grep -rn "className=\"integ-tag\"" packages/portal/src` after Task 21 completes and delete then, not here (this task only removes its own now-unused reference, not the shared class definition, since Task 21 hasn't run yet).

- [ ] **Step 3: Verify**

Run: `npm run build -w @a-workbench/portal`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/portal/src/components/AgentsPanel.tsx packages/portal/src/styles.css
git commit -m "refactor(portal): migrate AgentsPanel onto ui/Badge, ui/Button"
```

---

## Task 21: Migrate `Dashboard.tsx` and final CSS sweep

**Files:**
- Modify: `packages/portal/src/pages/Dashboard.tsx`
- Modify: `packages/portal/src/pages/Connect.tsx` (swap remaining `.boot` states)
- Modify: `packages/portal/src/pages/BrowserView.tsx` (swap remaining `.boot` states)
- Modify: `packages/portal/src/components/ConnectLinkProblem.tsx` (swap remaining `.boot` state)
- Modify: `packages/portal/src/styles.css` (final dead-class sweep: `.boot`, `.blinker`, `.led`, `.pip`, `.ticker`, `.card-status`, `.btn-connect`, `.btn-ghost`, `.btn-disconnect`, `.card`, `.filter-chip`, `.brand-mark`/`@keyframes pulse`, and any other class with zero remaining references)

**Interfaces:**
- Consumes: `NavigationHeader` + `ThemeToggle` from Tasks 10/2, `Card` from Task 5, `Badge` from Task 4, `Button` from Task 3, `Select` from Task 6.

- [ ] **Step 1: Replace the topbar with `NavigationHeader`**

In `packages/portal/src/pages/Dashboard.tsx`, import `{ NavigationHeader } from "../components/ui/NavigationHeader"` and `{ ThemeToggle } from "../components/ui/ThemeToggle"`. Replace:

```typescript
<header className="topbar">
  <div className="brand">
    <span className="brand-mark" />
    <span className="brand-name">workbench</span>
    <span className="brand-slash">/</span>
    <span className="brand-tag">operator console</span>
  </div>

  <div className="status-strip">
    <span><b>{integrations.length}</b> integrations</span>
    <span className="sep">·</span>
    <span><b>{connectedCount}</b> live</span>
    <span className="sep">·</span>
    <span>node <b>online</b></span>
  </div>

  <div className="user-block">
    {user?.email && <span className="user-email">{user.email}</span>}
    <button onClick={logout} className="btn-ghost">Sign out</button>
  </div>
</header>
```

with:

```typescript
<NavigationHeader
  title="workbench"
  trailing={
    <>
      <span className="card-meta">{integrations.length} integrations · {connectedCount} live</span>
      {user?.email && <span className="user-email">{user.email}</span>}
      <ThemeToggle />
      <Button variant="ghost" onClick={logout}>Sign out</Button>
    </>
  }
/>
```

- [ ] **Step 2: Replace integration tiles with `Card`/`Badge`/`Button`**

Import `{ Card } from "../components/ui/Card"`, `{ Badge } from "../components/ui/Badge"`, `{ Button } from "../components/ui/Button"`, `{ Select } from "../components/ui/Input"`. Replace the `<article className={\`card ...\`}>` block's wrapper:

```typescript
<Card
  key={i.name}
  clickable={clickable}
  disabled={!clickable}
  style={{ animationDelay: undefined }}
  onClick={clickable ? () => setDetail(i.name) : undefined}
  role={clickable ? "button" : undefined}
  aria-disabled={clickable ? undefined : true}
  tabIndex={clickable ? 0 : -1}
  onKeyDown={clickable ? (e) => { if (e.key === "Enter") setDetail(i.name); } : undefined}
>
  <div className="card-top">
    <span className="card-index">№ {pad(idx + 1)}</span>
    <Badge variant={connected ? "green" : "neutral"}>
      {connected ? "Live" : configured ? "Standby" : "Not configured"}
    </Badge>
  </div>

  <div className="card-head">
    <IntegrationLogo name={i.name} displayName={i.displayName} logo={i.logo} size={28} />
    <div>
      <h3 className="card-name">{i.displayName || i.name}</h3>
      <div className="card-ver">v{i.version} · {i.toolCount} tools</div>
    </div>
  </div>

  {i.description && <p className="card-desc">{i.description}</p>}

  {i.categories && i.categories.length > 0 && (
    <div className="integ-tags">
      {i.categories.map((c) => <Badge key={c} variant="neutral">{c}</Badge>)}
    </div>
  )}

  <div className="card-bottom">
    {i.authType === "none" ? (
      <span className="card-meta">Built-in · always on</span>
    ) : connected ? (
      <>
        <span className="card-meta">Session active</span>
        <div className="card-actions">
          <Button variant="ghost" onClick={(e) => { e.stopPropagation(); handleConnect(i.name); }} title="Re-authorize">
            Refresh
          </Button>
          <Button variant="danger" onClick={(e) => { e.stopPropagation(); handleDisconnect(i.name); }} disabled={disconnecting === i.name} title="Disconnect">
            {disconnecting === i.name ? "…" : "Disconnect"}
          </Button>
        </div>
      </>
    ) : configured ? (
      <>
        <span className="card-meta">Not paired</span>
        <Button onClick={(e) => { e.stopPropagation(); handleConnect(i.name); }}>
          Connect →
        </Button>
      </>
    ) : (
      <span className="card-meta">Auth not configured</span>
    )}
  </div>
</Card>
```

The `visible.length === 0` empty-state `<div className="card" ...>` block becomes `<Card style={{ gridColumn: "1 / -1", textAlign: "center" }}><span className="card-meta">No integrations in this filter.</span></Card>`.

- [ ] **Step 3: Replace the category `<select>` and filter chips**

Replace the raw `<select id="cat-select" className="cat-select" ...>` with `<Select id="cat-select" ...>` (same props, same `<option>` children). Filter chip `<button className="filter-chip" ...>` elements become `<Button variant={filter === "all" ? "primary" : "outline"} size="sm" ...>` (three call sites, one per filter value, `variant` computed from whether that button's filter matches the active `filter` state).

- [ ] **Step 4: Drop the footer `.ticker` and replace remaining `.boot` usage**

Replace the `<footer className="ticker">...</footer>` block (system nominal / registry sync / build stable) with a plain text line: `<footer className="ui-footer">Registry synced {new Date().toISOString().slice(11, 19)} UTC</footer>`.

Replace the top-of-file loading guard:

```typescript
if (isLoading) {
  return (
    <div className="boot">
      <span>LOADING REGISTRY<span className="blinker" /></span>
    </div>
  );
}
```

with:

```typescript
if (isLoading) {
  return <div className="ui-loading">Loading registry…</div>;
}
```

- [ ] **Step 5: Sweep remaining `.boot` usages in other files**

In `packages/portal/src/pages/Connect.tsx`: replace `<div className="boot"><span>CONNECTED — {integration}...</span></div>` with `<div className="ui-loading">Connected — {integration}. You can close this tab and return to your agent.</div>`; replace `<div className="boot"><span>ERR — {error}</span></div>` with `<div className="ui-loading">Error — {error}</div>`; replace `<div className="boot"><span>LOADING LOGIN<span className="blinker" /></span></div>` with `<div className="ui-loading">Loading…</div>`.

In `packages/portal/src/pages/BrowserView.tsx`: same pattern for its two `.boot` usages (`ERR — {error}`, `LOADING BROWSER`).

In `packages/portal/src/components/ConnectLinkProblem.tsx`: replace the non-`ACCOUNT_MISMATCH` branch's `<div className="boot"><span>{copy.title} — {copy.detail}</span></div>` with `<div className="ui-loading">{copy.title} — {copy.detail}</div>`.

- [ ] **Step 6: Final dead-CSS sweep**

Run, from `packages/portal/src`:

```bash
grep -rn '"boot"\|"blinker"\|"btn-connect"\|"btn-ghost"\|"btn-disconnect"\|"card-status"\|"led"\|"filter-chip"\|className="card"\|"cat-select"\|"session-transfer-paste"\|"integ-tag"\|"pip"\|"ticker"\|"brand-mark"\|"login-error"' . --include='*.tsx'
```

Expected: no matches (every `.tsx` reference to these classes was migrated in Tasks 12–21). For each class name with zero remaining `.tsx` references, delete its rule (and any `@keyframes` used only by it) from `packages/portal/src/styles.css`. Run the same check for `"status-strip"`, `"user-block"`, `"topbar"`, `"brand"`, `"brand-name"`, `"brand-slash"`, `"brand-tag"` (all superseded by `NavigationHeader`) and delete their now-dead rules too.

- [ ] **Step 7: Verify**

Run: `npm run build -w @a-workbench/portal`
Expected: succeeds.

Run: `npm run test -w @a-workbench/portal`
Expected: all component tests still pass (this task touches no `ui/` component).

Run: `npm run dev -w @a-workbench/portal`, open the dashboard in a browser, and manually verify: integration cards render with light theme, filter chips and category select work, connect/disconnect/refresh buttons work, the theme toggle switches to dark and back, and no leftover console styling (grid background, mono body font, blinking elements) remains anywhere in the app.

- [ ] **Step 8: Commit**

```bash
git add packages/portal/src/pages/Dashboard.tsx packages/portal/src/pages/Connect.tsx packages/portal/src/pages/BrowserView.tsx packages/portal/src/components/ConnectLinkProblem.tsx packages/portal/src/styles.css
git commit -m "refactor(portal): migrate Dashboard onto design tokens, sweep dead console CSS"
```

---

## Task 22: Full verification pass

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Run the full portal test suite**

Run: `npm run test -w @a-workbench/portal`
Expected: PASS — every `ui/` component test from Tasks 2–10 (Button, Badge, Card, Input/Select, Modal, BottomSheet, Toggle, SelectableCard, NavigationHeader, ThemeToggle).

- [ ] **Step 2: Run the server and shared suites to confirm no regression**

Run: `npm run test -w @a-workbench/server`
Run: `npm run test -w @a-workbench/shared`
Expected: both PASS, unchanged — this plan touches neither package's source.

- [ ] **Step 3: Build every package**

Run: `npm run build`
Expected: `packages/shared`, `packages/server`, `packages/portal` all build clean.

- [ ] **Step 4: Build the docs site and check its internal-link CI gate**

Run: `node docs/site/build.mjs`
Expected: succeeds, no broken internal links (this is the same check CI runs on the docs workflow).

- [ ] **Step 5: Grep for any straggling reference to the old console-theme custom properties**

Run: `grep -rn -- "--ink\b\|--panel\b\|--mono-alt\|--accent-edge\|--accent-strong" packages/portal/src`
Expected: no matches — every old custom-property name from the pre-revamp `:root` block has been fully replaced by the shared token names.

- [ ] **Step 6: Confirm no attribution or external URL leaked in from the token source**

Run: `git log --oneline docs/superpowers/specs/2026-09-03-portal-design-token-revamp-design.md docs/superpowers/plans/2026-09-03-portal-design-token-revamp.md packages/shared/styles/tokens.css | head -1` then `grep -rniE "amartha|funds-lite|vercel\.app|A-Partner|NG-MIS" packages/shared/styles/tokens.css docs/site/assets/docs.css packages/portal/src` (across the whole tree touched by this plan).
Expected: no matches — confirms the public-repo hygiene constraint held throughout.

- [ ] **Step 7: Report**

No commit for this task — it's a read-only verification pass. If every step above passes, the feature is complete: report so to the user, noting the manual dev-server visual check from Task 21 Step 7 as the one piece of verification that was eyeballed rather than asserted by a test.
