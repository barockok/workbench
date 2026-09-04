# Portal IA Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the portal's single scrolling dashboard with a routed six-page application behind a persistent sidebar, in a line-based visual language, and expose the tool-call history the server already records.

**Architecture:** A new `AppShell` (sidebar + content column) wraps six authenticated routes. Every surface is built from one `Box` primitive — a bordered container whose rows are divided by hairlines. Two new read-only server endpoints (`/api/activity`, `/api/stats`) read the existing `audit_log` table. Connect/disconnect logic, today duplicated inside `Dashboard`, is extracted into one `useConnectFlow` hook that owns its own dialogs.

**Tech Stack:** React 19, react-router-dom 7, TanStack Query 5, Vite 6, vitest 1.6 + Testing Library (portal); Fastify + vitest (server); plain CSS with custom properties from `@a-workbench/shared/styles/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-09-04-portal-ia-redesign-design.md`

## Global Constraints

Every task's requirements implicitly include these.

- **One radius: `6px`.** The portal overrides `--radius-sm`, `--radius`, `--radius-lg` to `6px`. `--radius-full` appears in exactly one place — the `.ui-toggle-track` — and nowhere else in `packages/portal/src/styles.css`.
- **No `box-shadow`** anywhere in `packages/portal/src/styles.css` except `.ui-modal` and `.ui-sheet`.
- **No literal color values.** Every color is a `var(--…)` custom property from `packages/shared/styles/tokens.css`. No hex, `rgb()`, or named color in portal CSS or in any component's inline style. The one permitted exception is `#fff` inside existing `.ui-button-primary`/`.ui-button-danger` rules, which already ship on this branch and are not in scope.
- **Spacing only from the `--s-*` scale**: `--s-2 --s-4 --s-8 --s-12 --s-16 --s-20 --s-24 --s-32 --s-40 --s-48`. Nothing between the steps, no bare `px` gaps or paddings.
- **Do not edit `packages/shared/styles/tokens.css`.** The docs site consumes it too. All portal-specific geometry lives in `packages/portal/src/styles.css`.
- **No external product or company names** anywhere — code, comments, CSS, docs, commit messages, PR text. Design decisions are stated as rules, never as attributions to another product. (`CLAUDE.md` → Public Repo Hygiene.)
- **No PII, secrets, internal hostnames or company references.** Test fixtures use `Test User`, `dev@example.com`, `acme`, `example.com`.
- **No AI co-authorship.** Never add a `Co-Authored-By:` or "Generated with …" trailer naming an AI, and never commit under an AI author identity.
- **Server changes are test-first**: write the failing test, watch it fail, then implement. Portal components ship with tests.
- **Every interactive element is a real `<button>` or `<a>`** — never a `<div>` with `onClick` and `tabIndex`.
- Run server tests with `npm run test -w @a-workbench/server`, portal tests with `npm run test -w @a-workbench/portal`.

---

## File Structure

**Created — server**

| File | Responsibility |
|---|---|
| `packages/server/src/audit/query.ts` | Read side of `audit_log`: cursor encode/decode, `listAuditEvents`, `summarizeAudit`, `auditStored`. All SQL lives here; the routes do no querying. |
| `packages/server/tests/audit-query.test.ts` | Unit tests for the module above, against the real database. |
| `packages/server/tests/activity-routes.test.ts` | Route tests for `/api/activity` and `/api/stats`. |

**Created — portal**

| File | Responsibility |
|---|---|
| `src/components/ui/Box.tsx` | `Box` (bordered container, optional header strip) and `BoxRow` (one hairline-divided row). |
| `src/components/ui/Tabs.tsx` | `role="tablist"` text tabs with underline active state, counts, arrow-key navigation. |
| `src/components/ui/StatStrip.tsx` | Row of label/value cells divided by vertical hairlines. |
| `src/components/ui/EmptyState.tsx` | Message + optional action, used by every list. |
| `src/components/ui/DataTable.tsx` | Semantic `<table>` with a visually-hidden `<caption>`. |
| `src/components/shell/Sidebar.tsx` | Navigation: brand, four nav links, pinned Settings/Help/user footer. |
| `src/components/shell/AppShell.tsx` | Sidebar + content column frame. |
| `src/components/dialogs/ConfirmDialog.tsx` | Modal replacement for `window.confirm`. |
| `src/components/dialogs/InstanceUrlDialog.tsx` | Modal replacement for `window.prompt` on self-hosted integrations. |
| `src/hooks/useConnectFlow.tsx` | The whole connect/disconnect state machine plus the dialogs it needs, shared by every page that offers those actions. |
| `src/mcp-config.ts` | `MCP_URL` and `mcpConfigFor(key)` — the MCP client config JSON, currently private to `ApiKeyPanel`. |
| `src/pages/Home.tsx` | Stats, connected apps, agent-connection pointer, recent activity. |
| `src/pages/Apps.tsx` | The integration registry. |
| `src/pages/AppDetail.tsx` | One integration: status, tools, session transfer, browser controls. |
| `src/pages/Agents.tsx` | Connect an agent; connected OAuth clients. |
| `src/pages/Activity.tsx` | Full tool-call history. |
| `src/pages/Settings.tsx` | API key, appearance, account. |

Each page also gets a sibling `*.test.tsx`; each new `ui/` and `shell/` component gets a sibling `*.test.tsx`.

**Modified**

| File | Change |
|---|---|
| `packages/portal/src/styles.css` | Geometry override block; shell, box, table, tabs, stat, empty-state rules; removal of every dead ornament rule. |
| `packages/portal/src/App.tsx` | Layout route wrapping the six pages in `AppShell`. |
| `packages/portal/src/api.ts` | `fetchActivity`, `fetchStats` and their types. |
| `packages/portal/src/pages/AuthorizeChoose.tsx` | Arrives with the `main` merge written against deleted CSS; rebuilt on `ui/` components (Task 1). |
| `packages/portal/src/pages/Login.tsx` | Decorative panel simplified (Task 17). |
| `packages/portal/src/components/ApiKeyPanel.tsx` | Becomes a `Box`-based section, imports the shared `mcp-config` module, loses its eyebrow. |
| `packages/portal/src/components/AgentsPanel.tsx` | Becomes a `Box`-based table section on `/agents`, loses its eyebrow and `window.confirm`. |
| `packages/server/src/api/routes.ts` | Two new authenticated GET routes. |

**Deleted**

`packages/portal/src/pages/Dashboard.tsx`, `packages/portal/src/components/IntegrationDetail.tsx` (its `BrowserControls` and `SessionTransfer` move to `AppDetail.tsx` — they are real features, not decoration).

---

## Task 1: Merge `main` and rebuild the authorize choice page

The branch is 9 commits behind `origin/main`. Those commits add `packages/portal/src/pages/AuthorizeChoose.tsx`, written against console-era CSS classes (`.btn-google`, `.card-meta`) that this branch already deleted. Merge first, then repair, so every later task is written against the merged tree.

**Files:**
- Modify: `packages/portal/src/App.tsx` (merge conflict resolution)
- Modify: `packages/portal/src/pages/AuthorizeChoose.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a merged tree containing the route `/authorize/choose`, `packages/portal/src/api.ts` exporting `SERVER_URL`, `fetchAuthUrl(ticket?: string)` and `fetchKeycloakAuthUrl(ticket?: string)`.

- [ ] **Step 1: Merge**

```bash
git merge origin/main
```

Expect a conflict in `packages/portal/src/App.tsx`. Resolve it by keeping **both** sides: this branch's `Boot`/`RequireAuth` bodies and `main`'s new public route. The resolved `AppRoutes` is:

```tsx
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Public: handles both the signed-out (show a picker) and signed-in
          (silently resume) cases itself — RequireAuth's unconditional
          redirect-to-/login doesn't fit either branch. */}
      <Route path="/authorize/choose" element={<AuthorizeChoose />} />
      <Route path="/connect/:integration" element={<RequireAuth><Connect /></RequireAuth>} />
      <Route path="/browser" element={<RequireAuth><BrowserView /></RequireAuth>} />
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

with `import AuthorizeChoose from "./pages/AuthorizeChoose";` added to the imports.

- [ ] **Step 2: Verify the build fails on the unmigrated page**

Run: `npm run build -w @a-workbench/portal`

It should compile (the dead class names are strings, not types), so instead confirm the problem by grep:

Run: `grep -n 'btn-google\|btn-keycloak\|card-meta\|login-error' packages/portal/src/pages/AuthorizeChoose.tsx`
Expected: several matches. Then confirm none of those classes exist any more:

Run: `grep -c 'btn-google\|btn-keycloak\|\.card-meta\|\.login-error' packages/portal/src/styles.css`
Expected: `0` — the page would render unstyled buttons.

- [ ] **Step 3: Rebuild the page on `ui/` components**

Replace the whole body of `packages/portal/src/pages/AuthorizeChoose.tsx` with the version below. It keeps every security property of the original — the resume target still comes only from build-time `SERVER_URL`, never from the URL — and only changes presentation. `.login-shell`, `.login-form`, `.login-card`, `.login-eyebrow`, `.login-title`, `.login-sub` and `.ui-form-error` all exist on this branch (used by `Login.tsx`).

```tsx
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { fetchProviders, fetchAuthUrl, fetchKeycloakAuthUrl, SERVER_URL } from "../api";
import { Button } from "../components/ui/Button";

// Lands here from the server's GET /authorize — an MCP agent is asking a
// human to authenticate to workbench itself (not connect one integration).
// If the human is already signed in to the portal, the hidden form below
// auto-submits and no picker is ever shown. Otherwise this is the same
// provider choice /login offers, carrying the agent's ticket through.
export default function AuthorizeChoose() {
  const [search] = useSearchParams();
  const ticket = search.get("ticket") ?? "";
  // Deliberately NOT read from the URL: this form posts a live session
  // token, so its target must come only from our own build-time config
  // (SERVER_URL), never from a query param a crafted link could set to an
  // attacker's origin.
  const resumeUrl = `${SERVER_URL}/authorize/resume`;
  const resumeError = search.get("error");
  const { user, token, isLoading } = useAuth();
  const [providers, setProviders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const attemptedResume = useRef(false);

  useEffect(() => {
    fetchProviders().then((r) => setProviders(r.providers)).catch(() => {});
  }, []);

  // Auto-resume for an already-signed-in human: a real top-level form POST
  // (not a fetch) so the browser attaches the server's awb_oauth_binding
  // cookie itself — a cross-origin fetch could never do that, which is what
  // makes this safe against login CSRF instead of just convenient. Skipped
  // if resumeError is set (a prior attempt already failed once) so it can't loop.
  useEffect(() => {
    if (isLoading || !user || !token || resumeError || attemptedResume.current) return;
    attemptedResume.current = true;
    formRef.current?.submit();
  }, [isLoading, user, token, resumeError]);

  async function handleProvider(name: "google" | "keycloak") {
    setError(null);
    try {
      const { url } =
        name === "google" ? await fetchAuthUrl(ticket) : await fetchKeycloakAuthUrl(ticket);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sign in");
    }
  }

  if (!ticket) {
    return (
      <div className="login-shell">
        <section className="login-form">
          <div className="login-card">
            <div className="ui-form-error">Missing or invalid link. Ask your agent to try again.</div>
          </div>
        </section>
      </div>
    );
  }

  // Show the picker once loading has settled and we're NOT about to silently
  // auto-submit (no session, or a session that already failed to resume once).
  const showChoice = !isLoading && (!user || !token || !!resumeError);

  return (
    <div className="login-shell">
      <form ref={formRef} method="POST" action={resumeUrl} hidden>
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="token" value={token ?? ""} />
      </form>

      <section className="login-form">
        <div className="login-card">
          <div className="login-eyebrow">Authorize agent</div>
          <h1 className="login-title">Approve agent access</h1>
          <p className="login-sub">
            An agent is requesting access to your workbench. Sign in to continue.
          </p>

          {!showChoice ? (
            <p className="login-sub">Signing in…</p>
          ) : (
            <>
              {(error || resumeError) && (
                <div className="ui-form-error">
                  {error ?? "Your session couldn't be resumed automatically. Sign in again."}
                </div>
              )}

              {providers.includes("google") && (
                <Button onClick={() => handleProvider("google")} variant="outline" size="lg" type="button">
                  Continue with Google
                </Button>
              )}

              {providers.includes("keycloak") && (
                <Button onClick={() => handleProvider("keycloak")} variant="outline" size="lg" type="button">
                  Continue with Keycloak
                </Button>
              )}

              {providers.length === 0 && (
                <div className="ui-form-error">No auth provider configured</div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
```

Note the `login-shell` grid expects two columns; with only `.login-form` present the card sits in the left half. That is acceptable and matches how the page renders today. Task 17 revisits `.login-shell`.

- [ ] **Step 4: Verify**

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

Run: `npm run test -w @a-workbench/portal`
Expected: 34/34 passing (unchanged — this page has no test yet).

Run: `npm run test -w @a-workbench/server`
Expected: all passing, including the `/authorize` suites that arrived with the merge.

Run: `grep -c 'btn-google\|btn-keycloak\|card-meta' packages/portal/src/pages/AuthorizeChoose.tsx`
Expected: `0`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "merge main; rebuild the authorize choice page on shared components"
```

---

## Task 2: Geometry override and the Box primitive

**Files:**
- Modify: `packages/portal/src/styles.css`
- Create: `packages/portal/src/components/ui/Box.tsx`
- Test: `packages/portal/src/components/ui/Box.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Box({ title?: ReactNode, action?: ReactNode, className?: string, children: ReactNode })` → `<section class="ui-box">` with an optional `<header class="ui-box-head">` containing `<h2 class="ui-box-title">` and `<div class="ui-box-action">`.
  - `BoxRow({ className?: string, children: ReactNode })` → `<div class="ui-box-row">`.
  - CSS classes `ui-box`, `ui-box-head`, `ui-box-title`, `ui-box-action`, `ui-box-row`, `ui-sr-only`.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/components/ui/Box.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Box, BoxRow } from "./Box";

describe("Box", () => {
  it("renders children without a header when no title or action is given", () => {
    render(<Box><BoxRow>only row</BoxRow></Box>);
    expect(screen.getByText("only row")).toHaveClass("ui-box-row");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders the title as a heading and the action beside it", () => {
    render(
      <Box title="Recent activity" action={<a href="/activity">View all</a>}>
        <BoxRow>a row</BoxRow>
      </Box>
    );
    expect(screen.getByRole("heading", { name: "Recent activity" })).toHaveClass("ui-box-title");
    expect(screen.getByRole("link", { name: "View all" })).toBeInTheDocument();
  });

  it("appends a caller className to the box element", () => {
    const { container } = render(<Box className="extra">body</Box>);
    expect(container.querySelector(".ui-box")).toHaveClass("extra");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Box`
Expected: FAIL — `Failed to resolve import "./Box"`.

- [ ] **Step 3: Write the component**

Create `packages/portal/src/components/ui/Box.tsx`:

```tsx
import type { ReactNode } from "react";

export interface BoxProps {
  title?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

// The one structural container this UI is built from: a bordered surface with
// an optional header strip, holding rows that are divided by hairlines rather
// than separated by gaps. Nothing here casts a shadow — depth is not how this
// interface communicates hierarchy.
export function Box({ title, action, className, children }: BoxProps) {
  return (
    <section className={["ui-box", className].filter(Boolean).join(" ")}>
      {(title || action) && (
        <header className="ui-box-head">
          {title && <h2 className="ui-box-title">{title}</h2>}
          {action && <div className="ui-box-action">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function BoxRow({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={["ui-box-row", className].filter(Boolean).join(" ")}>{children}</div>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Box`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the geometry override and Box styles**

In `packages/portal/src/styles.css`, replace the first line comment and add the override block immediately after the `@import`:

```css
/* workbench portal */

@import "@a-workbench/shared/styles/tokens.css";

/* Geometry. This interface separates with lines, not with elevation or
   roundness, so the shared token file's 6/8/12 radius ramp collapses to a
   single value here. The shared file is left alone — the docs site still
   wants the softer ramp. The one survivor of --radius-full is the toggle
   track, which is a capsule by definition. */
:root {
  --radius-sm: 6px;
  --radius: 6px;
  --radius-lg: 6px;
}
```

Then append the Box rules at the end of the file:

```css
/* --- Box: the structural primitive --- */
.ui-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
}

.ui-box + .ui-box { margin-top: var(--s-16); }

.ui-box-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-12);
  padding: var(--s-8) var(--s-12);
  background: var(--bg-sunk);
  border-bottom: 1px solid var(--border);
}

.ui-box-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}

.ui-box-action {
  font-size: 12px;
  color: var(--text-3);
  display: flex;
  align-items: center;
  gap: var(--s-8);
}

.ui-box-row {
  display: flex;
  align-items: center;
  gap: var(--s-12);
  padding: var(--s-8) var(--s-12);
  min-height: 40px;
  font-size: 14px;
}

.ui-box-row + .ui-box-row { border-top: 1px solid var(--border); }

/* Visually hidden but read by assistive technology. */
.ui-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 6: Verify the whole suite and the build**

Run: `npm run test -w @a-workbench/portal`
Expected: 37/37 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/portal/src/components/ui/Box.tsx packages/portal/src/components/ui/Box.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): add the Box primitive and collapse the radius ramp to 6px"
```

---

## Task 3: Tabs, StatStrip, EmptyState and DataTable

Four small presentational primitives, batched because each is a handful of lines and none can be meaningfully rejected without the others.

**Files:**
- Create: `packages/portal/src/components/ui/Tabs.tsx`
- Create: `packages/portal/src/components/ui/StatStrip.tsx`
- Create: `packages/portal/src/components/ui/EmptyState.tsx`
- Create: `packages/portal/src/components/ui/DataTable.tsx`
- Test: `packages/portal/src/components/ui/Tabs.test.tsx`
- Test: `packages/portal/src/components/ui/StatStrip.test.tsx`
- Test: `packages/portal/src/components/ui/EmptyState.test.tsx`
- Test: `packages/portal/src/components/ui/DataTable.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: `ui-sr-only` from Task 2.
- Produces:
  - `Tabs({ items: TabItem[], value: string, onChange: (id: string) => void, label: string })`, `TabItem = { id: string; label: string; count?: number }`.
  - `StatStrip({ stats: Stat[], note?: ReactNode })`, `Stat = { label: string; value: ReactNode }`.
  - `EmptyState({ message: ReactNode, action?: ReactNode })`.
  - `DataTable({ caption: string, head: ReactNode, children: ReactNode })`.

- [ ] **Step 1: Write the failing tests**

Create `packages/portal/src/components/ui/Tabs.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";

const ITEMS = [
  { id: "all", label: "All", count: 12 },
  { id: "connected", label: "Connected", count: 3 },
  { id: "available", label: "Available", count: 9 },
];

describe("Tabs", () => {
  it("marks only the selected tab as selected", () => {
    render(<Tabs items={ITEMS} value="connected" onChange={() => {}} label="Filter apps" />);
    expect(screen.getByRole("tab", { name: /Connected/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "false");
  });

  it("renders each count beside its label", () => {
    render(<Tabs items={ITEMS} value="all" onChange={() => {}} label="Filter apps" />);
    expect(screen.getByRole("tab", { name: /All/ })).toHaveTextContent("12");
  });

  it("reports the clicked tab", () => {
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} value="all" onChange={onChange} label="Filter apps" />);
    fireEvent.click(screen.getByRole("tab", { name: /Available/ }));
    expect(onChange).toHaveBeenCalledWith("available");
  });

  it("moves selection with the arrow keys, wrapping at the ends", () => {
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} value="available" onChange={onChange} label="Filter apps" />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("keeps only the selected tab in the tab order", () => {
    render(<Tabs items={ITEMS} value="all" onChange={() => {}} label="Filter apps" />);
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /Connected/ })).toHaveAttribute("tabindex", "-1");
  });
});
```

Create `packages/portal/src/components/ui/StatStrip.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatStrip } from "./StatStrip";

describe("StatStrip", () => {
  it("renders a label and value per stat", () => {
    render(<StatStrip stats={[{ label: "Tool calls", value: "1,284" }, { label: "Success rate", value: "97%" }]} />);
    expect(screen.getByText("Tool calls")).toHaveClass("ui-stat-label");
    expect(screen.getByText("1,284")).toHaveClass("ui-stat-value");
    expect(screen.getByText("97%")).toBeInTheDocument();
  });

  it("renders a note only when one is given", () => {
    const { rerender, container } = render(<StatStrip stats={[{ label: "A", value: "1" }]} />);
    expect(container.querySelector(".ui-stat-note")).toBeNull();
    rerender(<StatStrip stats={[{ label: "A", value: "1" }]} note="Activity is not stored." />);
    expect(screen.getByText("Activity is not stored.")).toHaveClass("ui-stat-note");
  });
});
```

Create `packages/portal/src/components/ui/EmptyState.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the message", () => {
    render(<EmptyState message="No apps connected yet" />);
    expect(screen.getByText("No apps connected yet")).toHaveClass("ui-empty-msg");
  });

  it("renders an action when given one", () => {
    render(<EmptyState message="Nothing here" action={<a href="/apps">Browse apps</a>} />);
    expect(screen.getByRole("link", { name: "Browse apps" })).toBeInTheDocument();
  });
});
```

Create `packages/portal/src/components/ui/DataTable.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable } from "./DataTable";

describe("DataTable", () => {
  it("renders a table whose accessible name comes from a hidden caption", () => {
    render(
      <DataTable caption="Tool calls" head={<tr><th scope="col">Tool</th></tr>}>
        <tr><td>jira_search</td></tr>
      </DataTable>
    );
    expect(screen.getByRole("table", { name: "Tool calls" })).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toHaveClass("ui-sr-only");
    expect(screen.getByRole("cell", { name: "jira_search" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -w @a-workbench/portal -- Tabs StatStrip EmptyState DataTable`
Expected: FAIL — four unresolved imports.

- [ ] **Step 3: Write the components**

Create `packages/portal/src/components/ui/Tabs.tsx`:

```tsx
export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the tablist — say what is being filtered. */
  label: string;
}

export function Tabs({ items, value, onChange, label }: TabsProps) {
  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = items.findIndex((t) => t.id === value);
    if (i === -1) return;
    const step = e.key === "ArrowRight" ? 1 : -1;
    const next = items[(i + step + items.length) % items.length];
    onChange(next.id);
  }

  return (
    <div className="ui-tabs" role="tablist" aria-label={label} onKeyDown={handleKeyDown}>
      {items.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`ui-tab${selected ? " ui-tab-active" : ""}`}
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {t.count !== undefined && <span className="ui-tab-count">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
```

Create `packages/portal/src/components/ui/StatStrip.tsx`:

```tsx
import type { ReactNode } from "react";

export interface Stat {
  label: string;
  value: ReactNode;
}

export function StatStrip({ stats, note }: { stats: Stat[]; note?: ReactNode }) {
  return (
    <section className="ui-box ui-stat-strip">
      <div className="ui-stat-cells">
        {stats.map((s) => (
          <div key={s.label} className="ui-stat">
            <div className="ui-stat-label">{s.label}</div>
            <div className="ui-stat-value">{s.value}</div>
          </div>
        ))}
      </div>
      {note && <div className="ui-stat-note">{note}</div>}
    </section>
  );
}
```

Create `packages/portal/src/components/ui/EmptyState.tsx`:

```tsx
import type { ReactNode } from "react";

export function EmptyState({ message, action }: { message: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-empty">
      <p className="ui-empty-msg">{message}</p>
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}
```

Create `packages/portal/src/components/ui/DataTable.tsx`:

```tsx
import type { ReactNode } from "react";

// A real table, not a stack of divs: screen readers announce row and column
// position, and the caption gives the table an accessible name without
// duplicating the Box header visually.
export function DataTable({
  caption,
  head,
  children,
}: {
  caption: string;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="ui-table">
      <caption className="ui-sr-only">{caption}</caption>
      <thead>{head}</thead>
      <tbody>{children}</tbody>
    </table>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -w @a-workbench/portal -- Tabs StatStrip EmptyState DataTable`
Expected: PASS, 11 tests.

- [ ] **Step 5: Add the styles**

Append to `packages/portal/src/styles.css`:

```css
/* --- Tabs --- */
.ui-tabs {
  display: flex;
  align-items: center;
  gap: var(--s-16);
}

.ui-tab {
  background: none;
  border: 0;
  border-bottom: 2px solid transparent;
  padding: var(--s-8) var(--s-2);
  font: inherit;
  font-size: 14px;
  color: var(--text-3);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: var(--s-8);
}

.ui-tab:hover { color: var(--text); }

.ui-tab-active {
  color: var(--text);
  font-weight: 500;
  border-bottom-color: var(--accent);
}

.ui-tab-count {
  font-size: 12px;
  color: var(--text-3);
  background: var(--bg-sunk);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 var(--s-4);
}

/* --- StatStrip --- */
.ui-stat-cells {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.ui-stat {
  padding: var(--s-12);
  display: grid;
  gap: var(--s-4);
}

.ui-stat + .ui-stat { border-left: 1px solid var(--border); }

.ui-stat-label {
  font-size: 12px;
  color: var(--text-3);
}

.ui-stat-value {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}

.ui-stat-note {
  border-top: 1px solid var(--border);
  padding: var(--s-8) var(--s-12);
  font-size: 12px;
  color: var(--text-3);
}

/* --- EmptyState --- */
.ui-empty {
  padding: var(--s-32) var(--s-12);
  display: grid;
  gap: var(--s-12);
  justify-items: center;
  text-align: center;
}

.ui-empty-msg {
  font-size: 14px;
  color: var(--text-3);
}

/* --- DataTable --- */
.ui-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.ui-table th {
  text-align: left;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-3);
  padding: var(--s-8) var(--s-12);
  background: var(--bg-sunk);
  border-bottom: 1px solid var(--border);
}

.ui-table td {
  padding: var(--s-8) var(--s-12);
  vertical-align: middle;
}

.ui-table tbody tr + tr td { border-top: 1px solid var(--border); }

.ui-table .ui-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-3);
}
```

- [ ] **Step 6: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 48/48 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/portal/src/components/ui packages/portal/src/styles.css
git commit -m "feat(portal): add Tabs, StatStrip, EmptyState and DataTable primitives"
```

---

## Task 4: The audit read module

All SQL against `audit_log` lives in one module so the routes stay thin and the
dialect care is in one reviewable place. The two backends do not agree on
row-value comparison (`(a, b) < (?, ?)`), so the keyset predicate is spelled out
longhand — see `docs/findings/2026-08-06-postgres-dialect-gotchas.md`.

**Files:**
- Create: `packages/server/src/audit/query.ts`
- Test: `packages/server/tests/audit-query.test.ts`

**Interfaces:**
- Consumes: `db` from `packages/server/src/db.ts` (`DbAdapter`: `run(sql, params)`, `get<T>(sql, params)`, `all<T>(sql, params)`, `exec(sql)`); `config.AUDIT_LOG_DEST` from `packages/server/src/config.ts`.
- Produces:
  - `auditStored(): boolean`
  - `encodeCursor(createdAt: number, id: number): string`
  - `decodeCursor(cursor: string): { createdAt: number; id: number } | null`
  - `listAuditEvents(opts: ListAuditOptions): Promise<AuditEventRow[]>` where
    `ListAuditOptions = { userId: string; limit: number; cursor?: { createdAt: number; id: number }; integration?: string; status?: "success" | "error" }`
  - `summarizeAudit(userId: string, windowDays: number): Promise<AuditSummary>` where
    `AuditSummary = { toolCalls: number; successRate: number | null; mostUsedIntegration: string | null }`
  - `AuditEventRow = { id: number; integration: string | null; tool: string | null; action: string; success: boolean; error: string | null; duration_ms: number | null; created_at: number }`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/audit-query.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../src/db";
import {
  encodeCursor,
  decodeCursor,
  listAuditEvents,
  summarizeAudit,
} from "../src/audit/query";

const NOW = Math.floor(Date.now() / 1000);

// Insert one audit row. `success` is a real boolean: the column is BOOLEAN and
// PostgreSQL rejects 1/0 for it; the SQLite adapter converts on the way in.
async function seed(o: {
  userId: string;
  integration?: string | null;
  tool?: string;
  success?: boolean;
  error?: string | null;
  durationMs?: number | null;
  createdAt?: number;
}) {
  await db.run(
    `INSERT INTO audit_log (user_id, integration, tool, action, success, error, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      o.userId,
      o.integration === undefined ? "acme" : o.integration,
      o.tool ?? "acme_search",
      "EXECUTE",
      o.success ?? true,
      o.error ?? null,
      o.durationMs ?? 100,
      o.createdAt ?? NOW,
    ]
  );
}

beforeEach(async () => {
  await db.exec("DELETE FROM audit_log");
});

describe("cursor encoding", () => {
  it("round-trips a position", () => {
    const c = encodeCursor(1757001600, 8814);
    expect(decodeCursor(c)).toEqual({ createdAt: 1757001600, id: 8814 });
  });

  it("rejects a cursor that is not the expected shape", () => {
    expect(decodeCursor("not-base64-of-anything-useful")).toBeNull();
    expect(decodeCursor(Buffer.from("nope").toString("base64url"))).toBeNull();
    expect(decodeCursor("")).toBeNull();
  });
});

describe("listAuditEvents", () => {
  it("returns only the requested user's rows, newest first", async () => {
    await seed({ userId: "user-1", tool: "older", createdAt: NOW - 60 });
    await seed({ userId: "user-1", tool: "newer", createdAt: NOW });
    await seed({ userId: "user-2", tool: "other-user" });

    const rows = await listAuditEvents({ userId: "user-1", limit: 10 });
    expect(rows.map((r) => r.tool)).toEqual(["newer", "older"]);
  });

  it("normalizes success into a real boolean", async () => {
    await seed({ userId: "user-1", success: false, error: "boom" });
    const [row] = await listAuditEvents({ userId: "user-1", limit: 10 });
    expect(row.success).toBe(false);
    expect(row.error).toBe("boom");
  });

  it("filters by integration", async () => {
    await seed({ userId: "user-1", integration: "acme" });
    await seed({ userId: "user-1", integration: "demo-repo" });
    const rows = await listAuditEvents({ userId: "user-1", limit: 10, integration: "demo-repo" });
    expect(rows).toHaveLength(1);
    expect(rows[0].integration).toBe("demo-repo");
  });

  it("filters by status", async () => {
    await seed({ userId: "user-1", tool: "ok_tool", success: true });
    await seed({ userId: "user-1", tool: "bad_tool", success: false });

    const failures = await listAuditEvents({ userId: "user-1", limit: 10, status: "error" });
    expect(failures.map((r) => r.tool)).toEqual(["bad_tool"]);

    const wins = await listAuditEvents({ userId: "user-1", limit: 10, status: "success" });
    expect(wins.map((r) => r.tool)).toEqual(["ok_tool"]);
  });

  it("pages past rows that share a created_at, without repeating or skipping", async () => {
    // Three rows on the same second: only the id tiebreak keeps paging correct.
    await seed({ userId: "user-1", tool: "a", createdAt: NOW });
    await seed({ userId: "user-1", tool: "b", createdAt: NOW });
    await seed({ userId: "user-1", tool: "c", createdAt: NOW });

    const first = await listAuditEvents({ userId: "user-1", limit: 2 });
    expect(first).toHaveLength(2);

    const last = first[first.length - 1];
    const second = await listAuditEvents({
      userId: "user-1",
      limit: 2,
      cursor: { createdAt: last.created_at, id: last.id },
    });

    const seen = [...first, ...second].map((r) => r.tool);
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });
});

describe("summarizeAudit", () => {
  it("reports zero calls and a null rate on an empty window", async () => {
    const s = await summarizeAudit("user-1", 30);
    expect(s).toEqual({ toolCalls: 0, successRate: null, mostUsedIntegration: null });
  });

  it("counts calls and computes the success rate", async () => {
    await seed({ userId: "user-1", success: true });
    await seed({ userId: "user-1", success: true });
    await seed({ userId: "user-1", success: true });
    await seed({ userId: "user-1", success: false });

    const s = await summarizeAudit("user-1", 30);
    expect(s.toolCalls).toBe(4);
    expect(s.successRate).toBe(0.75);
  });

  it("ignores rows outside the window and rows belonging to other users", async () => {
    await seed({ userId: "user-1", createdAt: NOW });
    await seed({ userId: "user-1", createdAt: NOW - 40 * 86400 });
    await seed({ userId: "user-2", createdAt: NOW });

    const s = await summarizeAudit("user-1", 30);
    expect(s.toolCalls).toBe(1);
  });

  it("names the most-used integration, ignoring rows that have none", async () => {
    await seed({ userId: "user-1", integration: "acme" });
    await seed({ userId: "user-1", integration: "acme" });
    await seed({ userId: "user-1", integration: "demo-repo" });
    await seed({ userId: "user-1", integration: null });

    const s = await summarizeAudit("user-1", 30);
    expect(s.mostUsedIntegration).toBe("acme");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @a-workbench/server -- audit-query`
Expected: FAIL — `Cannot find module '../src/audit/query'`.

- [ ] **Step 3: Write the module**

Create `packages/server/src/audit/query.ts`:

```ts
import { config } from "../config";
import { db } from "../db";
import type { SqlParam } from "../db-adapter";

export interface AuditEventRow {
  id: number;
  integration: string | null;
  tool: string | null;
  action: string;
  success: boolean;
  error: string | null;
  duration_ms: number | null;
  created_at: number;
}

export interface AuditSummary {
  toolCalls: number;
  successRate: number | null;
  mostUsedIntegration: string | null;
}

export interface ListAuditOptions {
  userId: string;
  limit: number;
  cursor?: { createdAt: number; id: number };
  integration?: string;
  status?: "success" | "error";
}

/**
 * Whether audit events land in the database at all. `stdout` and `kafka`
 * destinations write nothing here, so an empty table means "configured
 * elsewhere", not "nothing has happened yet" — and the two must not look
 * the same to a reader.
 */
export function auditStored(): boolean {
  return config.AUDIT_LOG_DEST === "sqlite";
}

export function encodeCursor(createdAt: number, id: number): string {
  return Buffer.from(`${createdAt}:${id}`).toString("base64url");
}

/**
 * Decode a paging cursor, or null if it is not one we minted. Base64 decoding
 * never throws on junk — it just yields junk — so the shape check below is
 * what actually rejects a hand-edited cursor.
 */
export function decodeCursor(cursor: string): { createdAt: number; id: number } | null {
  const raw = Buffer.from(cursor, "base64url").toString("utf8");
  const m = raw.match(/^(\d{1,15}):(\d{1,15})$/);
  if (!m) return null;
  return { createdAt: Number(m[1]), id: Number(m[2]) };
}

function normalize(r: Record<string, unknown>): AuditEventRow {
  return {
    id: Number(r.id),
    integration: (r.integration as string | null) ?? null,
    tool: (r.tool as string | null) ?? null,
    action: String(r.action),
    // SQLite hands back 1/0, PostgreSQL a real boolean.
    success: !!r.success,
    error: (r.error as string | null) ?? null,
    duration_ms: r.duration_ms === null || r.duration_ms === undefined ? null : Number(r.duration_ms),
    created_at: Number(r.created_at),
  };
}

export async function listAuditEvents(o: ListAuditOptions): Promise<AuditEventRow[]> {
  const where: string[] = ["user_id = ?"];
  const params: SqlParam[] = [o.userId];

  if (o.integration) {
    where.push("integration = ?");
    params.push(o.integration);
  }
  if (o.status) {
    where.push("success = ?");
    params.push(o.status === "success");
  }
  if (o.cursor) {
    // Longhand rather than a row-value comparison: the two backends do not
    // agree on `(created_at, id) < (?, ?)`.
    where.push("(created_at < ? OR (created_at = ? AND id < ?))");
    params.push(o.cursor.createdAt, o.cursor.createdAt, o.cursor.id);
  }
  params.push(o.limit);

  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, integration, tool, action, success, error, duration_ms, created_at
       FROM audit_log
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC, id DESC
      LIMIT ?`,
    params
  );
  return rows.map(normalize);
}

export async function summarizeAudit(userId: string, windowDays: number): Promise<AuditSummary> {
  const since = Math.floor(Date.now() / 1000) - windowDays * 86400;

  const totals = await db.get<{ n: number | string; ok: number | string | null }>(
    `SELECT COUNT(*) AS n, SUM(CASE WHEN success THEN 1 ELSE 0 END) AS ok
       FROM audit_log
      WHERE user_id = ? AND action = 'EXECUTE' AND created_at >= ?`,
    [userId, since]
  );
  const toolCalls = Number(totals?.n ?? 0);
  const ok = Number(totals?.ok ?? 0);

  const top = await db.get<{ integration: string }>(
    `SELECT integration
       FROM audit_log
      WHERE user_id = ? AND action = 'EXECUTE' AND created_at >= ? AND integration IS NOT NULL
      GROUP BY integration
      ORDER BY COUNT(*) DESC, integration ASC
      LIMIT 1`,
    [userId, since]
  );

  return {
    toolCalls,
    // Three decimals is enough for a percentage rendered to the nearest point.
    successRate: toolCalls === 0 ? null : Math.round((ok / toolCalls) * 1000) / 1000,
    mostUsedIntegration: top?.integration ?? null,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @a-workbench/server -- audit-query`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole server suite**

Run: `npm run test -w @a-workbench/server`
Expected: every previously-passing test still passes.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/audit/query.ts packages/server/tests/audit-query.test.ts
git commit -m "feat(server): read side for the audit log — keyset paging and a window summary"
```

---

## Task 5: The `/api/activity` and `/api/stats` routes

**Files:**
- Modify: `packages/server/src/api/routes.ts`
- Test: `packages/server/tests/activity-routes.test.ts`

**Interfaces:**
- Consumes: `auditStored`, `encodeCursor`, `decodeCursor`, `listAuditEvents`, `summarizeAudit`, `AuditEventRow` from Task 4; the file-local `authenticate(request)` helper in `routes.ts`, which returns `{ userId: string } | null`.
- Produces:
  - `GET /api/activity` → `{ stored: boolean, events: AuditEventRow[], next_cursor: string | null }`
  - `GET /api/stats` → `{ stored: boolean, window_days: number, tool_calls: number, success_rate: number | null, most_used_integration: string | null }`

Note: `/api/stats` deliberately does **not** report a connected-integration count. Every page that wants one already fetches `/api/connections`, and duplicating that computation server-side would mean refactoring the connections route for no gain.

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/activity-routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";

vi.mock("../src/config", () => ({
  config: {
    GOOGLE_CLIENT_ID: "test-gid",
    GOOGLE_CLIENT_SECRET: "test-gsecret",
    PORTAL_URL: "http://localhost:5173",
    SERVER_PUBLIC_URL: "http://localhost:3000",
    SESSION_SECRET: "test-session-secret-32-chars-long!!",
    ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
    NODE_ENV: "test",
    DATABASE_URL: "./data/tokens.db",
    PLUGINS_DIR: "./plugins",
    CONNECT_TTL_SECONDS: 600,
    AUDIT_LOG_DEST: "sqlite",
    AUDIT_LOG_KAFKA_TOPIC: "audit-log",
  },
}));

vi.mock("../src/auth/session", () => ({
  signSession: vi.fn(() => "signed-jwt-token"),
  verifySession: vi.fn((token: string) => {
    if (token === "valid-jwt") return { userId: "user-1", email: "dev@example.com" };
    if (token === "other-jwt") return { userId: "user-2", email: "other@example.com" };
    throw new Error("Invalid token");
  }),
}));

vi.mock("../src/auth/users", () => ({
  verifyApiKey: vi.fn(() => null),
  getUserById: vi.fn(() => ({ id: "user-1", email: "dev@example.com" })),
  setApiKey: vi.fn(),
  getApiKey: vi.fn(),
  clearApiKey: vi.fn(),
  hasApiKey: vi.fn(() => false),
}));

import { registerApiRoutes } from "../src/api/routes";
import { stopReaper } from "../src/auth/connections";
import { config } from "../src/config";
import { db } from "../src/db";

const NOW = Math.floor(Date.now() / 1000);
const AUTH = { authorization: "Bearer valid-jwt" };

async function buildApp() {
  const app = Fastify();
  await registerApiRoutes(app);
  return app;
}

async function seed(o: {
  userId: string;
  integration?: string | null;
  tool?: string;
  success?: boolean;
  createdAt?: number;
}) {
  await db.run(
    `INSERT INTO audit_log (user_id, integration, tool, action, success, error, duration_ms, created_at)
     VALUES (?, ?, ?, 'EXECUTE', ?, NULL, 100, ?)`,
    [
      o.userId,
      o.integration === undefined ? "acme" : o.integration,
      o.tool ?? "acme_search",
      o.success ?? true,
      o.createdAt ?? NOW,
    ]
  );
}

beforeEach(async () => {
  await db.exec("DELETE FROM audit_log");
  config.AUDIT_LOG_DEST = "sqlite";
  vi.clearAllMocks();
});

afterAll(() => stopReaper());

describe("GET /api/activity", () => {
  it("401s without a session", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/activity" });
    expect(res.statusCode).toBe(401);
  });

  it("returns the caller's events, newest first", async () => {
    await seed({ userId: "user-1", tool: "older", createdAt: NOW - 60 });
    await seed({ userId: "user-1", tool: "newer", createdAt: NOW });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/activity", headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.stored).toBe(true);
    expect(body.events.map((e: { tool: string }) => e.tool)).toEqual(["newer", "older"]);
  });

  it("never leaks another user's events", async () => {
    await seed({ userId: "user-2", tool: "not-yours" });
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/activity", headers: AUTH });
    expect(JSON.parse(res.body).events).toEqual([]);
  });

  it("filters by integration and by status", async () => {
    await seed({ userId: "user-1", integration: "acme", tool: "ok_tool", success: true });
    await seed({ userId: "user-1", integration: "demo-repo", tool: "bad_tool", success: false });
    const app = await buildApp();

    const byInteg = await app.inject({
      method: "GET",
      url: "/api/activity?integration=demo-repo",
      headers: AUTH,
    });
    expect(JSON.parse(byInteg.body).events.map((e: { tool: string }) => e.tool)).toEqual(["bad_tool"]);

    const byStatus = await app.inject({ method: "GET", url: "/api/activity?status=error", headers: AUTH });
    expect(JSON.parse(byStatus.body).events.map((e: { tool: string }) => e.tool)).toEqual(["bad_tool"]);
  });

  it("returns a cursor only while more rows remain, and pages with it", async () => {
    await seed({ userId: "user-1", tool: "a", createdAt: NOW });
    await seed({ userId: "user-1", tool: "b", createdAt: NOW - 1 });
    await seed({ userId: "user-1", tool: "c", createdAt: NOW - 2 });
    const app = await buildApp();

    const first = await app.inject({ method: "GET", url: "/api/activity?limit=2", headers: AUTH });
    const page1 = JSON.parse(first.body);
    expect(page1.events).toHaveLength(2);
    expect(page1.next_cursor).toBeTruthy();

    const second = await app.inject({
      method: "GET",
      url: `/api/activity?limit=2&cursor=${encodeURIComponent(page1.next_cursor)}`,
      headers: AUTH,
    });
    const page2 = JSON.parse(second.body);
    expect(page2.events.map((e: { tool: string }) => e.tool)).toEqual(["c"]);
    expect(page2.next_cursor).toBeNull();
  });

  it("400s on a cursor it did not mint", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/activity?cursor=tampered", headers: AUTH });
    expect(res.statusCode).toBe(400);
  });

  it("clamps limit into 1..100", async () => {
    for (let i = 0; i < 3; i++) await seed({ userId: "user-1", tool: `t${i}` });
    const app = await buildApp();

    const zero = await app.inject({ method: "GET", url: "/api/activity?limit=0", headers: AUTH });
    expect(JSON.parse(zero.body).events).toHaveLength(1);

    const huge = await app.inject({ method: "GET", url: "/api/activity?limit=9999", headers: AUTH });
    expect(JSON.parse(huge.body).events).toHaveLength(3);
  });

  it("reports stored:false when audit events go somewhere other than the database", async () => {
    await seed({ userId: "user-1" });
    config.AUDIT_LOG_DEST = "stdout";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/activity", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ stored: false, events: [], next_cursor: null });
  });
});

describe("GET /api/stats", () => {
  it("401s without a session", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/stats" });
    expect(res.statusCode).toBe(401);
  });

  it("summarizes the caller's window", async () => {
    await seed({ userId: "user-1", integration: "acme", success: true });
    await seed({ userId: "user-1", integration: "acme", success: true });
    await seed({ userId: "user-1", integration: "demo-repo", success: false });
    await seed({ userId: "user-2", integration: "acme", success: true });
    const app = await buildApp();

    const res = await app.inject({ method: "GET", url: "/api/stats", headers: AUTH });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      stored: true,
      window_days: 30,
      tool_calls: 3,
      success_rate: 0.667,
      most_used_integration: "acme",
    });
  });

  it("returns a null rate when nothing happened in the window", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/stats", headers: AUTH });
    expect(JSON.parse(res.body)).toMatchObject({ tool_calls: 0, success_rate: null, most_used_integration: null });
  });

  it("reports stored:false when audit events go somewhere other than the database", async () => {
    config.AUDIT_LOG_DEST = "kafka";
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/api/stats", headers: AUTH });
    expect(JSON.parse(res.body)).toEqual({
      stored: false,
      window_days: 30,
      tool_calls: 0,
      success_rate: null,
      most_used_integration: null,
    });
  });
});
```

Add `afterAll` to the vitest import line at the top of the file:
`import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";`

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @a-workbench/server -- activity-routes`
Expected: FAIL — the activity requests 404 rather than 200.

- [ ] **Step 3: Add the routes**

In `packages/server/src/api/routes.ts`, add to the import block:

```ts
import {
  auditStored,
  encodeCursor,
  decodeCursor,
  listAuditEvents,
  summarizeAudit,
} from "../audit/query";
```

Then add both routes inside `registerApiRoutes`, immediately after the existing
`app.get("/api/agents", …)` handler:

```ts
  // How far back /api/stats looks. One value, not a query parameter: the
  // number is a product decision, and letting a caller widen it turns a
  // constant-cost summary into an unbounded scan.
  const STATS_WINDOW_DAYS = 30;

  // Tool-call history for the signed-in human. The user id comes from the
  // session and is never read from input, so asking for someone else's rows
  // is not expressible.
  app.get("/api/activity", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    if (!auditStored()) {
      return { stored: false, events: [], next_cursor: null };
    }

    const q = request.query as {
      limit?: string;
      cursor?: string;
      integration?: string;
      status?: string;
    };

    // Only an absent or unparseable limit takes the default. Anything a caller
    // actually sent — including 0 or a negative — is clamped into 1..100
    // rather than silently becoming 50.
    const requested = Number(q.limit);
    const limit =
      q.limit === undefined || !Number.isFinite(requested)
        ? 50
        : Math.min(100, Math.max(1, Math.floor(requested)));

    let cursor: { createdAt: number; id: number } | undefined;
    if (q.cursor) {
      const decoded = decodeCursor(q.cursor);
      if (!decoded) {
        return reply.status(400).send({ error: "invalid_cursor" });
      }
      cursor = decoded;
    }

    const status = q.status === "success" || q.status === "error" ? q.status : undefined;

    // Fetch one extra row: its presence is what tells us another page exists,
    // without a second COUNT query.
    const rows = await listAuditEvents({
      userId: user.userId,
      limit: limit + 1,
      cursor,
      integration: q.integration,
      status,
    });

    const events = rows.slice(0, limit);
    const last = events[events.length - 1];
    const next_cursor = rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null;

    return { stored: true, events, next_cursor };
  });

  app.get("/api/stats", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    if (!auditStored()) {
      return {
        stored: false,
        window_days: STATS_WINDOW_DAYS,
        tool_calls: 0,
        success_rate: null,
        most_used_integration: null,
      };
    }
    const s = await summarizeAudit(user.userId, STATS_WINDOW_DAYS);
    return {
      stored: true,
      window_days: STATS_WINDOW_DAYS,
      tool_calls: s.toolCalls,
      success_rate: s.successRate,
      most_used_integration: s.mostUsedIntegration,
    };
  });
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @a-workbench/server -- activity-routes`
Expected: PASS, 12 tests.

- [ ] **Step 5: Run the whole server suite and typecheck**

Run: `npm run test -w @a-workbench/server`
Expected: all passing.

Run: `npm run typecheck:tests -w @a-workbench/server`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/routes.ts packages/server/tests/activity-routes.test.ts
git commit -m "feat(server): expose tool-call activity and a 30-day summary to the portal"
```

---

## Task 6: Portal API client and the shared MCP config

**Files:**
- Modify: `packages/portal/src/api.ts`
- Create: `packages/portal/src/mcp-config.ts`
- Modify: `packages/portal/src/components/ApiKeyPanel.tsx`
- Test: `packages/portal/src/mcp-config.test.ts`

**Interfaces:**
- Consumes: the two routes from Task 5.
- Produces:
  - `ActivityEvent = { id: number; integration: string | null; tool: string | null; action: string; success: boolean; error: string | null; duration_ms: number | null; created_at: number }`
  - `ActivityPage = { stored: boolean; events: ActivityEvent[]; next_cursor: string | null }`
  - `Stats = { stored: boolean; window_days: number; tool_calls: number; success_rate: number | null; most_used_integration: string | null }`
  - `fetchActivity(opts?: { limit?: number; cursor?: string; integration?: string; status?: "success" | "error" }): Promise<ActivityPage>`
  - `fetchStats(): Promise<Stats>`
  - From `mcp-config.ts`: `MCP_URL: string`, `API_KEY_PLACEHOLDER = "YOUR_API_KEY"`, `mcpConfigFor(key: string): string`

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/mcp-config.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mcpConfigFor, MCP_URL, API_KEY_PLACEHOLDER } from "./mcp-config";

describe("mcpConfigFor", () => {
  it("produces client config JSON carrying the key in the workbench header", () => {
    const parsed = JSON.parse(mcpConfigFor("tok-abc"));
    expect(parsed.mcpServers.workbench.url).toBe(MCP_URL);
    expect(parsed.mcpServers.workbench.headers["x-workbench-api-key"]).toBe("tok-abc");
  });

  it("points at the /mcp path on the serving origin", () => {
    expect(MCP_URL).toBe(`${window.location.origin}/mcp`);
  });

  it("exposes a placeholder for the no-key-yet case", () => {
    expect(JSON.parse(mcpConfigFor(API_KEY_PLACEHOLDER)).mcpServers.workbench.headers["x-workbench-api-key"])
      .toBe("YOUR_API_KEY");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- mcp-config`
Expected: FAIL — `Failed to resolve import "./mcp-config"`.

- [ ] **Step 3: Extract the module**

Create `packages/portal/src/mcp-config.ts`:

```ts
// The server serves the portal, so its origin is also the /mcp origin.
export const MCP_URL = `${window.location.origin}/mcp`;

export const API_KEY_PLACEHOLDER = "YOUR_API_KEY";

// Generic MCP client config — works with any MCP-compatible client.
export function mcpConfigFor(key: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        workbench: {
          url: MCP_URL,
          headers: { "x-workbench-api-key": key },
        },
      },
    },
    null,
    2
  );
}
```

In `packages/portal/src/components/ApiKeyPanel.tsx`, delete the local
`MCP_URL`, `PLACEHOLDER` and `configFor` definitions and import them instead:

```tsx
import { MCP_URL, API_KEY_PLACEHOLDER, mcpConfigFor } from "../mcp-config";
```

Then replace every `configFor(` call with `mcpConfigFor(` and every
`PLACEHOLDER` reference with `API_KEY_PLACEHOLDER`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- mcp-config`
Expected: PASS, 3 tests.

- [ ] **Step 5: Add the API client functions**

Append to `packages/portal/src/api.ts`:

```ts
export interface ActivityEvent {
  id: number;
  integration: string | null;
  tool: string | null;
  action: string;
  success: boolean;
  error: string | null;
  duration_ms: number | null;
  /** Unix seconds. */
  created_at: number;
}

export interface ActivityPage {
  /** False when this deployment routes audit events somewhere other than the database. */
  stored: boolean;
  events: ActivityEvent[];
  next_cursor: string | null;
}

export interface Stats {
  stored: boolean;
  window_days: number;
  tool_calls: number;
  success_rate: number | null;
  most_used_integration: string | null;
}

export async function fetchActivity(opts: {
  limit?: number;
  cursor?: string;
  integration?: string;
  status?: "success" | "error";
} = {}): Promise<ActivityPage> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  if (opts.integration) qs.set("integration", opts.integration);
  if (opts.status) qs.set("status", opts.status);
  const suffix = qs.toString() ? `?${qs}` : "";

  const res = await fetch(`${API_URL}/api/activity${suffix}`, { headers: getHeaders() });
  if (res.status === 401) {
    localStorage.removeItem("awb_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error("Failed to fetch activity");
  return res.json();
}

export async function fetchStats(): Promise<Stats> {
  const res = await fetch(`${API_URL}/api/stats`, { headers: getHeaders() });
  if (res.status === 401) {
    localStorage.removeItem("awb_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}
```

- [ ] **Step 6: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 51/51 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/portal/src/api.ts packages/portal/src/mcp-config.ts packages/portal/src/mcp-config.test.ts packages/portal/src/components/ApiKeyPanel.tsx
git commit -m "feat(portal): activity and stats clients, shared MCP client config"
```

---

## Task 7: The shell — sidebar and content frame

**Files:**
- Create: `packages/portal/src/components/shell/Sidebar.tsx`
- Create: `packages/portal/src/components/shell/AppShell.tsx`
- Test: `packages/portal/src/components/shell/Sidebar.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: `useAuth()` from `../../context/AuthContext` (returns `{ user: { id, email } | null, token, login, logout, isLoading }`); `ThemeToggle` from `../ui/ThemeToggle`; `NavLink`, `Link` from `react-router-dom`.
- Produces: `Sidebar()` and `AppShell({ children: ReactNode })`.

`NavLink` sets `aria-current="page"` on the active link by itself — the test
asserts that rather than a class name, because the attribute is the part a
screen-reader user depends on.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/components/shell/Sidebar.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" }, token: "t", isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  it("is a labelled navigation landmark", () => {
    renderAt("/");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("lists every destination", () => {
    renderAt("/");
    for (const name of ["Home", "Apps", "Agents", "Activity", "Settings", "Help"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("marks only the current route as the current page", () => {
    renderAt("/apps");
    expect(screen.getByRole("link", { name: "Apps" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("does not mark Home as current on a nested route", () => {
    renderAt("/activity");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the signed-in email", () => {
    renderAt("/");
    expect(screen.getByText("dev@example.com")).toBeInTheDocument();
  });

  it("opens Help in a new tab without leaking the referrer", () => {
    renderAt("/");
    const help = screen.getByRole("link", { name: "Help" });
    expect(help).toHaveAttribute("target", "_blank");
    expect(help).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Sidebar`
Expected: FAIL — `Failed to resolve import "./Sidebar"`.

- [ ] **Step 3: Write the components**

Create `packages/portal/src/components/shell/Sidebar.tsx`:

```tsx
import { NavLink } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { ThemeToggle } from "../ui/ThemeToggle";

const HELP_URL = "https://github.com/barockok/workbench";

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="wb-nav-icon"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

const HomeIcon = () => <Icon><path d="M2 7l6-5 6 5v6.2a.8.8 0 0 1-.8.8H2.8a.8.8 0 0 1-.8-.8z" /></Icon>;
const AppsIcon = () => (
  <Icon>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </Icon>
);
const AgentsIcon = () => (
  <Icon>
    <path d="M5 1.5v3M11 1.5v3" />
    <rect x="3" y="4.5" width="10" height="5" rx="1" />
    <path d="M8 9.5v5" />
  </Icon>
);
const ActivityIcon = () => <Icon><path d="M1 8h3l2-5.5L10 13l2-5h3" /></Icon>;
const SettingsIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="2.4" />
    <path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1" />
  </Icon>
);
const HelpIcon = () => (
  <Icon>
    <circle cx="8" cy="8" r="6.3" />
    <path d="M6.2 6.2A1.8 1.8 0 1 1 8 8.3v.7" />
    <path d="M8 11.6h.01" />
  </Icon>
);

const NAV = [
  { to: "/", label: "Home", end: true, Glyph: HomeIcon },
  { to: "/apps", label: "Apps", end: false, Glyph: AppsIcon },
  { to: "/agents", label: "Agents", end: false, Glyph: AgentsIcon },
  { to: "/activity", label: "Activity", end: false, Glyph: ActivityIcon },
];

function itemClass({ isActive }: { isActive: boolean }) {
  return `wb-nav-item${isActive ? " wb-nav-item-active" : ""}`;
}

export function Sidebar() {
  const { user } = useAuth();

  return (
    <nav className="wb-sidebar" aria-label="Main">
      <div className="wb-brand">workbench</div>

      <ul className="wb-nav">
        {NAV.map(({ to, label, end, Glyph }) => (
          <li key={to}>
            <NavLink to={to} end={end} className={itemClass}>
              <Glyph />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="wb-sidebar-foot">
        <NavLink to="/settings" className={itemClass}>
          <SettingsIcon />
          Settings
        </NavLink>
        <a className="wb-nav-item" href={HELP_URL} target="_blank" rel="noreferrer noopener">
          <HelpIcon />
          Help
        </a>
        <div className="wb-user">
          <span className="wb-user-email" title={user?.email ?? undefined}>
            {user?.email ?? "Signed in"}
          </span>
          <ThemeToggle />
        </div>
      </div>
    </nav>
  );
}
```

Create `packages/portal/src/components/shell/AppShell.tsx`:

```tsx
import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="wb-shell">
      <Sidebar />
      <main className="wb-content">{children}</main>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Sidebar`
Expected: PASS, 6 tests.

- [ ] **Step 5: Add the shell styles**

Append to `packages/portal/src/styles.css`:

```css
/* --- Shell --- */
.wb-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: 220px 1fr;
}

.wb-sidebar {
  border-right: 1px solid var(--border);
  background: var(--surface);
  display: flex;
  flex-direction: column;
  gap: var(--s-8);
  padding: var(--s-8);
  position: sticky;
  top: 0;
  height: 100vh;
}

.wb-brand {
  height: var(--topbar-h);
  display: flex;
  align-items: center;
  padding: 0 var(--s-8);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--text);
}

.wb-nav {
  list-style: none;
  display: grid;
  gap: var(--s-2);
}

.wb-nav-item {
  display: flex;
  align-items: center;
  gap: var(--s-8);
  height: 32px;
  padding: 0 var(--s-8);
  border-radius: var(--radius);
  font-size: 14px;
  color: var(--text-2);
  text-decoration: none;
}

.wb-nav-item:hover { background: var(--bg-sunk); color: var(--text); }

.wb-nav-item-active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 500;
}

.wb-nav-icon { flex: none; }

.wb-sidebar-foot {
  margin-top: auto;
  display: grid;
  gap: var(--s-2);
  border-top: 1px solid var(--border);
  padding-top: var(--s-8);
}

.wb-user {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-8);
  padding: var(--s-8);
}

.wb-user-email {
  font-size: 12px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-content {
  padding: var(--s-24);
  max-width: 1080px;
  width: 100%;
}

/* Below this width the sidebar becomes a top bar and the nav scrolls sideways. */
@media (max-width: 900px) {
  .wb-shell { grid-template-columns: 1fr; }

  .wb-sidebar {
    position: static;
    height: auto;
    flex-direction: row;
    align-items: center;
    gap: var(--s-12);
    border-right: 0;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }

  .wb-brand { height: auto; }
  .wb-nav { grid-auto-flow: column; gap: var(--s-4); }

  .wb-sidebar-foot {
    margin-top: 0;
    margin-left: auto;
    grid-auto-flow: column;
    align-items: center;
    border-top: 0;
    padding-top: 0;
  }

  .wb-user { padding: 0; }
  .wb-user-email { display: none; }
  .wb-content { padding: var(--s-16); }
}
```

- [ ] **Step 6: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 57/57 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/portal/src/components/shell packages/portal/src/styles.css
git commit -m "feat(portal): add the application shell and sidebar navigation"
```

---

## Task 8: The connect flow hook and its dialogs

Connect and disconnect are needed by three pages. Today the logic lives inside
`Dashboard` and reaches for `window.confirm`/`window.prompt`. Extract it once,
with real dialogs, so no page owns a private copy.

**Files:**
- Create: `packages/portal/src/components/dialogs/ConfirmDialog.tsx`
- Create: `packages/portal/src/components/dialogs/InstanceUrlDialog.tsx`
- Create: `packages/portal/src/hooks/useConnectFlow.tsx`
- Test: `packages/portal/src/components/dialogs/ConfirmDialog.test.tsx`
- Test: `packages/portal/src/components/dialogs/InstanceUrlDialog.test.tsx`
- Test: `packages/portal/src/hooks/useConnectFlow.test.tsx`

**Interfaces:**
- Consumes: `Modal` from `../ui/Modal` (`{ open, onClose, title?, size?, dismissible?, children, footer? }`); `Button`, `Input`; `IntegrationSummary`, `InstanceConfig`, `ApiKeyField`, `startIntegrationAuth`, `disconnectIntegration` from `../api`; `useAuth`; `useQueryClient` from `@tanstack/react-query`; `CookieAuthPopup` and `ApiKeyAuthModal` from `../components`.
- Produces:
  - `ConfirmDialog({ open, title, body, confirmLabel, destructive?, onConfirm, onCancel })`
  - `InstanceUrlDialog({ open, config, onSubmit, onCancel })` where `config: InstanceConfig`
  - `useConnectFlow(): { connect(i: IntegrationSummary): void; disconnect(name: string): void; error: string | null; busy: string | null; dialogs: ReactElement }`

- [ ] **Step 1: Write the failing tests**

Create `packages/portal/src/components/dialogs/ConfirmDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";

describe("ConfirmDialog", () => {
  it("renders nothing when closed", () => {
    render(
      <ConfirmDialog open={false} title="Disconnect acme" body="Stored credentials will be removed."
        confirmLabel="Disconnect" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the title and body in a dialog", () => {
    render(
      <ConfirmDialog open title="Disconnect acme" body="Stored credentials will be removed."
        confirmLabel="Disconnect" onConfirm={() => {}} onCancel={() => {}} />
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Stored credentials will be removed.")).toBeInTheDocument();
  });

  it("reports confirm and cancel separately", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Disconnect acme" body="Gone for good." confirmLabel="Disconnect"
        onConfirm={onConfirm} onCancel={onCancel} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
```

Create `packages/portal/src/components/dialogs/InstanceUrlDialog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InstanceUrlDialog } from "./InstanceUrlDialog";

const CONFIG = { label: "Instance URL", default: "https://example.com", placeholder: "https://…" };

describe("InstanceUrlDialog", () => {
  it("prefills the field with the configured default", () => {
    render(<InstanceUrlDialog open config={CONFIG} onSubmit={() => {}} onCancel={() => {}} />);
    expect(screen.getByLabelText("Instance URL")).toHaveValue("https://example.com");
  });

  it("submits what the human typed", () => {
    const onSubmit = vi.fn();
    render(<InstanceUrlDialog open config={CONFIG} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Instance URL"), { target: { value: "https://acme.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith("https://acme.example.com");
  });

  it("falls back to the default when the field is emptied", () => {
    const onSubmit = vi.fn();
    render(<InstanceUrlDialog open config={CONFIG} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByLabelText("Instance URL"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(onSubmit).toHaveBeenCalledWith("https://example.com");
  });
});
```

Create `packages/portal/src/hooks/useConnectFlow.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnectFlow } from "./useConnectFlow";
import type { IntegrationSummary } from "../api";

vi.mock("../api", () => ({
  startIntegrationAuth: vi.fn(),
  disconnectIntegration: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" }, token: "t", isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

// The two auth popups mount heavyweight browser machinery; stand them in.
vi.mock("../components/CookieAuthPopup", () => ({ default: () => <div>cookie popup</div> }));
vi.mock("../components/ApiKeyAuthModal", () => ({ default: () => <div>api key modal</div> }));

import { startIntegrationAuth, disconnectIntegration } from "../api";

const OAUTH: IntegrationSummary = { name: "acme", version: "1.0.0", toolCount: 3, authType: "oauth2" };
const SELF_HOSTED: IntegrationSummary = {
  ...OAUTH,
  name: "demo-repo",
  instance: { label: "Instance URL", default: "https://example.com" },
};

function Harness({ integration }: { integration: IntegrationSummary }) {
  const { connect, disconnect, error, dialogs } = useConnectFlow();
  return (
    <div>
      <button onClick={() => connect(integration)}>do connect</button>
      <button onClick={() => disconnect(integration.name)}>do disconnect</button>
      {error && <p>err: {error}</p>}
      {dialogs}
    </div>
  );
}

function renderHarness(integration: IntegrationSummary) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness integration={integration} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useConnectFlow", () => {
  it("sends an oauth2 integration straight to its authorization URL", async () => {
    vi.mocked(startIntegrationAuth).mockResolvedValue({ type: "oauth2", url: "https://example.com/authorize" });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { href: "", assign }, writable: true });

    renderHarness(OAUTH);
    fireEvent.click(screen.getByText("do connect"));

    await waitFor(() => expect(startIntegrationAuth).toHaveBeenCalledWith("acme", undefined));
  });

  it("asks for an instance URL first when the integration declares one", async () => {
    renderHarness(SELF_HOSTED);
    fireEvent.click(screen.getByText("do connect"));

    expect(await screen.findByLabelText("Instance URL")).toHaveValue("https://example.com");
    expect(startIntegrationAuth).not.toHaveBeenCalled();

    vi.mocked(startIntegrationAuth).mockResolvedValue({ type: "oauth2", url: "https://example.com/authorize" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(startIntegrationAuth).toHaveBeenCalledWith("demo-repo", "https://example.com")
    );
  });

  it("confirms before disconnecting, and does nothing if the human cancels", async () => {
    renderHarness(OAUTH);
    fireEvent.click(screen.getByText("do disconnect"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(disconnectIntegration).not.toHaveBeenCalled();
  });

  it("disconnects once confirmed", async () => {
    vi.mocked(disconnectIntegration).mockResolvedValue({ success: true });
    renderHarness(OAUTH);
    fireEvent.click(screen.getByText("do disconnect"));

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(disconnectIntegration).toHaveBeenCalledWith("acme"));
  });

  it("surfaces a failure instead of swallowing it", async () => {
    vi.mocked(startIntegrationAuth).mockRejectedValue(new Error("Connect failed"));
    renderHarness(OAUTH);
    fireEvent.click(screen.getByText("do connect"));
    expect(await screen.findByText("err: Connect failed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test -w @a-workbench/portal -- ConfirmDialog InstanceUrlDialog useConnectFlow`
Expected: FAIL — three unresolved imports.

- [ ] **Step 3: Write the dialogs**

Create `packages/portal/src/components/dialogs/ConfirmDialog.tsx`:

```tsx
import type { ReactNode } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  body: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Replaces window.confirm: the native dialog cannot be styled, cannot say
// anything longer than a sentence, and blocks the whole tab while it is up.
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{body}</p>
    </Modal>
  );
}
```

Create `packages/portal/src/components/dialogs/InstanceUrlDialog.tsx`:

```tsx
import { useState } from "react";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import type { InstanceConfig } from "../../api";

// Self-hosted integrations declare an instance origin. Replaces window.prompt,
// which offered no label, no placeholder and no way to explain the field.
export function InstanceUrlDialog({
  open,
  config,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  config: InstanceConfig;
  onSubmit: (url: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(config.default);

  function submit() {
    onSubmit(value.trim() || config.default);
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title="Where does this run?"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit}>Continue</Button>
        </>
      }
    >
      <label className="ui-field">
        <span className="ui-field-label">{config.label}</span>
        <Input
          value={value}
          placeholder={config.placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
      </label>
    </Modal>
  );
}
```

`<label>` wrapping the `Input` is what makes `getByLabelText("Instance URL")`
resolve — no `htmlFor`/`id` pair is needed.

- [ ] **Step 4: Write the hook**

Create `packages/portal/src/hooks/useConnectFlow.tsx`:

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  startIntegrationAuth,
  disconnectIntegration,
  type IntegrationSummary,
  type ApiKeyField,
} from "../api";
import { useAuth } from "../context/AuthContext";
import CookieAuthPopup from "../components/CookieAuthPopup";
import ApiKeyAuthModal from "../components/ApiKeyAuthModal";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import { InstanceUrlDialog } from "../components/dialogs/InstanceUrlDialog";

interface CookieAuthState {
  integration: string;
  loginUrl: string;
  cdpProxyUrl: string;
  cdpToken: string;
  sessionId: string;
}

interface ApiKeyAuthState {
  integration: string;
  displayName?: string;
  fields: ApiKeyField[];
}

/**
 * The connect/disconnect state machine, owned in one place so that Home, Apps
 * and the app detail page all drive the same flow rather than each keeping a
 * private copy. Render `dialogs` somewhere in the consuming page — everything
 * the flow needs to put on screen lives in there.
 */
export function useConnectFlow() {
  const qc = useQueryClient();
  const { user } = useAuth();

  const [cookieAuth, setCookieAuth] = useState<CookieAuthState | null>(null);
  const [apiKeyAuth, setApiKeyAuth] = useState<ApiKeyAuthState | null>(null);
  const [pendingInstance, setPendingInstance] = useState<IntegrationSummary | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["connections"] });
    qc.invalidateQueries({ queryKey: ["integrations"] });
  }

  async function start(integ: IntegrationSummary, instanceUrl?: string) {
    setError(null);
    setBusy(integ.name);
    try {
      const result = await startIntegrationAuth(integ.name, instanceUrl);

      if (result.type === "cookie") {
        // Cookie connect always returns login_required: open the live view so
        // the human logs in and clicks Capture. The WS auth frame's sessionId
        // is the portal user's id — the server keys the warm session by userId
        // and requires sessionId === userId.
        setCookieAuth({
          integration: integ.name,
          loginUrl: result.loginUrl,
          cdpProxyUrl: result.cdpProxyUrl,
          cdpToken: result.cdpToken,
          sessionId: user?.id ?? "",
        });
        return;
      }
      if (result.type === "oauth2") {
        window.location.href = result.url;
        return;
      }
      if (result.type === "apikey") {
        setApiKeyAuth({ integration: integ.name, displayName: integ.displayName, fields: result.fields });
        return;
      }
      setError(`Manual auth required for ${integ.displayName || integ.name}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connect failed");
    } finally {
      setBusy(null);
    }
  }

  function connect(integ: IntegrationSummary) {
    setError(null);
    if (integ.instance) {
      setPendingInstance(integ);
      return;
    }
    void start(integ);
  }

  function disconnect(name: string) {
    setError(null);
    setPendingDisconnect(name);
  }

  async function confirmDisconnect() {
    const name = pendingDisconnect;
    setPendingDisconnect(null);
    if (!name) return;
    setBusy(name);
    try {
      await disconnectIntegration(name);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy(null);
    }
  }

  const dialogs = (
    <>
      {pendingInstance?.instance && (
        <InstanceUrlDialog
          open
          config={pendingInstance.instance}
          onCancel={() => setPendingInstance(null)}
          onSubmit={(url) => {
            const integ = pendingInstance;
            setPendingInstance(null);
            void start(integ, url);
          }}
        />
      )}

      <ConfirmDialog
        open={pendingDisconnect !== null}
        title={`Disconnect ${pendingDisconnect ?? ""}`}
        body="Stored credentials for this integration will be removed. Agents will lose access to its tools until you connect it again."
        confirmLabel="Disconnect"
        destructive
        onCancel={() => setPendingDisconnect(null)}
        onConfirm={confirmDisconnect}
      />

      {cookieAuth && (
        <CookieAuthPopup
          integration={cookieAuth.integration}
          loginUrl={cookieAuth.loginUrl}
          cdpProxyUrl={cookieAuth.cdpProxyUrl}
          cdpToken={cookieAuth.cdpToken}
          sessionId={cookieAuth.sessionId}
          onClose={() => setCookieAuth(null)}
          onSuccess={refresh}
        />
      )}

      {apiKeyAuth && (
        <ApiKeyAuthModal
          integration={apiKeyAuth.integration}
          displayName={apiKeyAuth.displayName}
          fields={apiKeyAuth.fields}
          onClose={() => setApiKeyAuth(null)}
          onSuccess={refresh}
        />
      )}
    </>
  );

  return { connect, disconnect, error, busy, dialogs };
}
```

- [ ] **Step 5: Add the field style**

Append to `packages/portal/src/styles.css`:

```css
.ui-field { display: grid; gap: var(--s-4); }

.ui-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-2);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm run test -w @a-workbench/portal -- ConfirmDialog InstanceUrlDialog useConnectFlow`
Expected: PASS, 11 tests.

- [ ] **Step 7: Verify the suite and build**

Run: `npm run test -w @a-workbench/portal`
Expected: 68/68 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/portal/src/components/dialogs packages/portal/src/hooks packages/portal/src/styles.css
git commit -m "feat(portal): extract the connect flow into a shared hook with real dialogs"
```

---

## Task 9: Routing

Mount the six routes under one `AppShell` layout route. Every page is a
placeholder in this task except `/`, which keeps rendering `Dashboard` so the
tree stays green while later tasks fill the pages in.

**Files:**
- Modify: `packages/portal/src/App.tsx`
- Create: `packages/portal/src/pages/Home.tsx`
- Create: `packages/portal/src/pages/Apps.tsx`
- Create: `packages/portal/src/pages/AppDetail.tsx`
- Create: `packages/portal/src/pages/Agents.tsx`
- Create: `packages/portal/src/pages/Activity.tsx`
- Create: `packages/portal/src/pages/Settings.tsx`
- Test: `packages/portal/src/App.routes.test.tsx`

**Interfaces:**
- Consumes: `AppShell` from Task 7.
- Produces: default exports `Home`, `Apps`, `AppDetail`, `Agents`, `Activity`, `Settings`; a `PageHeader` helper exported from `packages/portal/src/components/ui/PageHeader.tsx`.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/App.routes.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "./components/shell/AppShell";
import Apps from "./pages/Apps";
import Agents from "./pages/Agents";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";

vi.mock("./context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" }, token: "t", isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("./api", () => ({
  fetchIntegrations: vi.fn(async () => ({ integrations: [] })),
  fetchConnections: vi.fn(async () => ({ connections: [] })),
  fetchAgents: vi.fn(async () => ({ agents: [] })),
  fetchActivity: vi.fn(async () => ({ stored: true, events: [], next_cursor: null })),
  fetchStats: vi.fn(async () => ({ stored: true, window_days: 30, tool_calls: 0, success_rate: null, most_used_integration: null })),
  getApiKeyStatus: vi.fn(async () => ({ hasKey: false })),
  startIntegrationAuth: vi.fn(),
  disconnectIntegration: vi.fn(),
  revokeAgent: vi.fn(),
  mintApiKey: vi.fn(),
  revealApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

vi.mock("./components/CookieAuthPopup", () => ({ default: () => null }));
vi.mock("./components/ApiKeyAuthModal", () => ({ default: () => null }));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell><Outlet /></AppShell>}>
            <Route path="/apps" element={<Apps />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("shell routing", () => {
  it.each([
    ["/apps", "Apps"],
    ["/agents", "Agents"],
    ["/activity", "Activity"],
    ["/settings", "Settings"],
  ])("renders %s with its page title", async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  });

  it("keeps the sidebar mounted on every page", () => {
    renderAt("/apps");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });
});
```

Add `Outlet` to the router import: `import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";`

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- App.routes`
Expected: FAIL — unresolved page imports.

- [ ] **Step 3: Add the page-header helper**

Create `packages/portal/src/components/ui/PageHeader.tsx`:

```tsx
import type { ReactNode } from "react";

// Every page opens the same way: an h1 and, when the page needs one, a single
// row of controls beneath it separated by a hairline.
export function PageHeader({ title, actions, toolbar }: { title: string; actions?: ReactNode; toolbar?: ReactNode }) {
  return (
    <header className="wb-page-head">
      <div className="wb-page-title-row">
        <h1 className="wb-page-title">{title}</h1>
        {actions && <div className="wb-page-actions">{actions}</div>}
      </div>
      {toolbar && <div className="wb-page-toolbar">{toolbar}</div>}
    </header>
  );
}
```

Append to `packages/portal/src/styles.css`:

```css
/* --- Page header --- */
.wb-page-head { margin-bottom: var(--s-16); }

.wb-page-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-12);
  min-height: 32px;
}

.wb-page-title {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
}

.wb-page-actions { display: flex; align-items: center; gap: var(--s-8); }

.wb-page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-12);
  flex-wrap: wrap;
  margin-top: var(--s-12);
  border-bottom: 1px solid var(--border);
}

.wb-page-back {
  display: inline-flex;
  align-items: center;
  gap: var(--s-4);
  font-size: 12px;
  color: var(--text-3);
  text-decoration: none;
  margin-bottom: var(--s-8);
}

.wb-page-back:hover { color: var(--text); }

.wb-section-gap > * + * { margin-top: var(--s-16); }
```

- [ ] **Step 4: Create the six page placeholders**

Each is replaced in a later task. `Home` keeps rendering the existing dashboard
so nothing regresses in the meantime.

`packages/portal/src/pages/Home.tsx`:

```tsx
import Dashboard from "./Dashboard";

// Replaced in Task 15. Until then the existing dashboard stands in so the
// application keeps working through the intermediate commits.
export default function Home() {
  return <Dashboard />;
}
```

`packages/portal/src/pages/Apps.tsx`:

```tsx
import { PageHeader } from "../components/ui/PageHeader";

export default function Apps() {
  return <PageHeader title="Apps" />;
}
```

`packages/portal/src/pages/Agents.tsx`:

```tsx
import { PageHeader } from "../components/ui/PageHeader";

export default function Agents() {
  return <PageHeader title="Agents" />;
}
```

`packages/portal/src/pages/Activity.tsx`:

```tsx
import { PageHeader } from "../components/ui/PageHeader";

export default function Activity() {
  return <PageHeader title="Activity" />;
}
```

`packages/portal/src/pages/Settings.tsx`:

```tsx
import { PageHeader } from "../components/ui/PageHeader";

export default function Settings() {
  return <PageHeader title="Settings" />;
}
```

`packages/portal/src/pages/AppDetail.tsx`:

```tsx
import { useParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";

export default function AppDetail() {
  const { name = "" } = useParams();
  return <PageHeader title={name} />;
}
```

- [ ] **Step 5: Rewrite the router**

Replace `AppRoutes` in `packages/portal/src/App.tsx` and add the imports:

```tsx
import { Routes, Route, Navigate, useLocation, Outlet } from "react-router-dom";
import { AppShell } from "./components/shell/AppShell";
import Home from "./pages/Home";
import Apps from "./pages/Apps";
import AppDetail from "./pages/AppDetail";
import Agents from "./pages/Agents";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";
```

(`Dashboard` is no longer imported here — `Home` imports it.)

```tsx
function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Public: handles both the signed-out (show a picker) and signed-in
          (silently resume) cases itself — RequireAuth's unconditional
          redirect-to-/login doesn't fit either branch. */}
      <Route path="/authorize/choose" element={<AuthorizeChoose />} />
      {/* Full-bleed authenticated pages: a connect handoff and the remote
          browser view both want the whole viewport, so they stay outside the
          shell. */}
      <Route path="/connect/:integration" element={<RequireAuth><Connect /></RequireAuth>} />
      <Route path="/browser" element={<RequireAuth><BrowserView /></RequireAuth>} />

      <Route
        element={
          <RequireAuth>
            <AppShell>
              <Outlet />
            </AppShell>
          </RequireAuth>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/apps" element={<Apps />} />
        <Route path="/apps/:name" element={<AppDetail />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- App.routes`
Expected: PASS, 5 tests.

- [ ] **Step 7: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 73/73 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/portal/src/App.tsx packages/portal/src/pages packages/portal/src/components/ui/PageHeader.tsx packages/portal/src/App.routes.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): route six pages through the application shell"
```

---

## Task 10: The Apps page

**Files:**
- Modify: `packages/portal/src/pages/Apps.tsx`
- Test: `packages/portal/src/pages/Apps.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: `PageHeader`, `Tabs`, `EmptyState`, `Input`, `Select`, `Badge`, `Button`, `IntegrationLogo`, `useConnectFlow`, `fetchIntegrations`, `fetchConnections`, `IntegrationSummary`.
- Produces: the `/apps` page. `AppDetail` (Task 11) relies on the route shape `/apps/:name` where `:name` is `IntegrationSummary["name"]`.

Each cell is a `<div>` holding two siblings: a `<Link>` to the detail page over
the logo and text, and the action element beside it. The connect `<button>` is
NOT nested inside the anchor — a button inside an `<a>` is invalid HTML, and the
click-suppression it would need is a symptom, not a fix. For an unconfigured
integration the `<Link>` becomes a plain `<span>`, so the cell is not navigable
at all rather than looking navigable and refusing.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/pages/Apps.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Apps from "./Apps";

vi.mock("../api", () => ({
  fetchIntegrations: vi.fn(),
  fetchConnections: vi.fn(),
  startIntegrationAuth: vi.fn(),
  disconnectIntegration: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" }, token: "t", isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("../components/CookieAuthPopup", () => ({ default: () => null }));
vi.mock("../components/ApiKeyAuthModal", () => ({ default: () => null }));

import { fetchIntegrations, fetchConnections, startIntegrationAuth } from "../api";

const INTEGRATIONS = [
  { name: "acme", displayName: "Acme", version: "1.0.0", toolCount: 4, categories: ["issues"], configured: true, authType: "oauth2", description: "Track work" },
  { name: "demo-repo", displayName: "Demo Repo", version: "2.1.0", toolCount: 9, categories: ["code"], configured: true, authType: "oauth2", description: "Review code" },
  { name: "unwired", displayName: "Unwired", version: "0.1.0", toolCount: 2, categories: ["code"], configured: false, authType: "oauth2" },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Apps />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchIntegrations).mockResolvedValue({ integrations: INTEGRATIONS });
  vi.mocked(fetchConnections).mockResolvedValue({ connections: [{ name: "acme", connected: true }] });
});

describe("Apps", () => {
  it("shows a loading state before the registry arrives", () => {
    vi.mocked(fetchIntegrations).mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText("Loading apps…")).toBeInTheDocument();
  });

  it("lists every integration with its version and tool count", async () => {
    renderPage();
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0 · 4 tools")).toBeInTheDocument();
    expect(screen.getByText("Demo Repo")).toBeInTheDocument();
  });

  it("counts each tab", async () => {
    renderPage();
    expect(await screen.findByRole("tab", { name: /All/ })).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: /Connected/ })).toHaveTextContent("1");
    expect(screen.getByRole("tab", { name: /Available/ })).toHaveTextContent("2");
  });

  it("filters to connected integrations", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: /Connected/ }));
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByText("Demo Repo")).toBeNull();
  });

  it("filters by search across name and description", async () => {
    renderPage();
    await screen.findByText("Acme");
    fireEvent.change(screen.getByLabelText("Search apps"), { target: { value: "review" } });
    expect(screen.getByText("Demo Repo")).toBeInTheDocument();
    expect(screen.queryByText("Acme")).toBeNull();
  });

  it("filters by category", async () => {
    renderPage();
    await screen.findByText("Acme");
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "issues" } });
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.queryByText("Demo Repo")).toBeNull();
  });

  it("links a configured integration to its detail page", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: /Acme/ })).toHaveAttribute("href", "/apps/acme");
  });

  it("does not link an integration whose auth is not configured", async () => {
    renderPage();
    await screen.findByText("Acme");
    expect(screen.queryByRole("link", { name: /Unwired/ })).toBeNull();
    expect(screen.getByText("Not configured")).toBeInTheDocument();
  });

  it("starts a connect from the cell without following the link", async () => {
    vi.mocked(startIntegrationAuth).mockResolvedValue({ type: "oauth2", url: "https://example.com/authorize" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Connect Demo Repo" }));
    await waitFor(() => expect(startIntegrationAuth).toHaveBeenCalledWith("demo-repo", undefined));
  });

  it("explains an empty filter rather than showing a blank grid", async () => {
    renderPage();
    await screen.findByText("Acme");
    fireEvent.change(screen.getByLabelText("Search apps"), { target: { value: "nothing matches this" } });
    expect(screen.getByText("No apps match this filter.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Apps`
Expected: FAIL — the placeholder page renders only a heading.

- [ ] **Step 3: Write the page**

Replace `packages/portal/src/pages/Apps.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchIntegrations, fetchConnections, type IntegrationSummary } from "../api";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { EmptyState } from "../components/ui/EmptyState";
import { Input, Select } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import IntegrationLogo from "../components/IntegrationLogo";
import { useConnectFlow } from "../hooks/useConnectFlow";

type Filter = "all" | "connected" | "available";

export default function Apps() {
  const { data, isLoading } = useQuery({ queryKey: ["integrations"], queryFn: fetchIntegrations });
  const { data: connectionsData } = useQuery({ queryKey: ["connections"], queryFn: fetchConnections });
  const { connect, error, busy, dialogs } = useConnectFlow();

  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");

  const connectionMap = useMemo<Map<string, boolean>>(() => {
    const entries: [string, boolean][] =
      connectionsData?.connections?.map((c: { name: string; connected: boolean }) => [c.name, c.connected]) ?? [];
    return new Map(entries);
  }, [connectionsData]);

  const integrations: IntegrationSummary[] = data?.integrations ?? [];
  const connectedCount = integrations.filter((i) => connectionMap.get(i.name)).length;

  const categories = useMemo(() => {
    const set = new Set<string>();
    integrations.forEach((i) => i.categories?.forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [integrations]);

  // Connected first, then anything connectable, then integrations whose auth
  // this deployment has not configured.
  function rank(i: IntegrationSummary): number {
    if (connectionMap.get(i.name)) return 0;
    if (i.configured !== false) return 1;
    return 2;
  }

  const needle = search.trim().toLowerCase();
  const visible = integrations
    .filter((i) => {
      const connected = connectionMap.get(i.name) ?? false;
      if (filter === "connected" && !connected) return false;
      if (filter === "available" && connected) return false;
      if (category !== "all" && !i.categories?.includes(category)) return false;
      if (needle) {
        const hay = `${i.displayName ?? ""} ${i.name} ${i.description ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .sort((a, b) => rank(a) - rank(b));

  if (isLoading) {
    return (
      <>
        <PageHeader title="Apps" />
        <div className="ui-loading">Loading apps…</div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Apps"
        toolbar={
          <>
            <Tabs
              label="Filter apps"
              value={filter}
              onChange={(id) => setFilter(id as Filter)}
              items={[
                { id: "all", label: "All", count: integrations.length },
                { id: "connected", label: "Connected", count: connectedCount },
                { id: "available", label: "Available", count: integrations.length - connectedCount },
              ]}
            />
            <div className="wb-toolbar-controls">
              <label className="ui-sr-only" htmlFor="apps-search">Search apps</label>
              <Input
                id="apps-search"
                type="search"
                placeholder="Search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {categories.length > 0 && (
                <>
                  <label className="ui-sr-only" htmlFor="apps-category">Category</label>
                  <Select id="apps-category" value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="all">All categories</option>
                    {categories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </Select>
                </>
              )}
            </div>
          </>
        }
      />

      {error && <div className="ui-form-error">{error}</div>}

      {visible.length === 0 ? (
        <EmptyState message="No apps match this filter." />
      ) : (
        <div className="wb-app-grid">
          {visible.map((i) => (
            <AppCell
              key={i.name}
              integration={i}
              connected={connectionMap.get(i.name) ?? false}
              busy={busy === i.name}
              onConnect={() => connect(i)}
            />
          ))}
        </div>
      )}

      {dialogs}
    </>
  );
}

function AppCell({
  integration: i,
  connected,
  busy,
  onConnect,
}: {
  integration: IntegrationSummary;
  connected: boolean;
  busy: boolean;
  onConnect: () => void;
}) {
  const label = i.displayName || i.name;
  const configured = i.configured !== false;

  // The navigable half and the action half are siblings, never nested: a
  // <button> inside an <a> is invalid HTML, and every workaround for the
  // resulting click ambiguity is worse than not creating it.
  const lead = (
    <>
      <IntegrationLogo name={i.name} displayName={i.displayName} logo={i.logo} size={24} />
      <span className="wb-app-cell-text">
        <span className="wb-app-cell-name">{label}</span>
        <span className="wb-app-cell-meta">v{i.version} · {i.toolCount} tools</span>
      </span>
    </>
  );

  const action =
    i.authType === "none" ? (
      <Badge variant="neutral">Built-in</Badge>
    ) : connected ? (
      <Badge variant="green">Connected</Badge>
    ) : configured ? (
      <Button size="xs" variant="outline" disabled={busy} aria-label={`Connect ${label}`} onClick={onConnect}>
        {busy ? "…" : "Connect"}
      </Button>
    ) : (
      <span className="wb-app-cell-muted">Not configured</span>
    );

  return (
    <div className={`wb-app-cell${configured ? "" : " wb-app-cell-inert"}`}>
      {configured ? (
        <Link className="wb-app-cell-link" to={`/apps/${i.name}`}>
          {lead}
        </Link>
      ) : (
        <span className="wb-app-cell-link">{lead}</span>
      )}
      <span className="wb-app-cell-action">{action}</span>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Apps`
Expected: PASS, 10 tests.

- [ ] **Step 5: Add the grid styles**

Append to `packages/portal/src/styles.css`:

```css
/* --- Apps grid --- */
.wb-toolbar-controls {
  display: flex;
  align-items: center;
  gap: var(--s-8);
  padding-bottom: var(--s-8);
}

.wb-app-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--s-8);
}

@media (min-width: 760px) {
  .wb-app-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (min-width: 1100px) {
  .wb-app-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

.wb-app-cell {
  display: flex;
  align-items: center;
  gap: var(--s-8);
  min-height: 64px;
  padding: var(--s-12);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.wb-app-cell:has(a:hover) { border-color: var(--border-strong); }

.wb-app-cell-link {
  display: flex;
  align-items: center;
  gap: var(--s-8);
  min-width: 0;
  flex: 1;
  color: inherit;
  text-decoration: none;
}

.wb-app-cell-inert { opacity: .6; }

.wb-app-cell-text {
  display: grid;
  gap: var(--s-2);
  min-width: 0;
}

.wb-app-cell-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-app-cell-meta { font-size: 12px; color: var(--text-3); }

.wb-app-cell-action { margin-left: auto; flex: none; }

.wb-app-cell-muted { font-size: 12px; color: var(--text-4); }
```

- [ ] **Step 6: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 83/83 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/portal/src/pages/Apps.tsx packages/portal/src/pages/Apps.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): build the apps registry page"
```

---

## Task 11: The app detail page

Promotes the old `IntegrationDetail` modal to a page, carrying its two real
features across intact: **session transfer** (export/import a cookie bundle
between deployments) and **browser controls** (open a live view, clear the
profile). Neither is decoration; dropping either would be a feature regression.

**Files:**
- Modify: `packages/portal/src/pages/AppDetail.tsx`
- Test: `packages/portal/src/pages/AppDetail.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: `fetchIntegration(name): Promise<IntegrationDetail>` where `IntegrationDetail extends IntegrationSummary` and adds `authType: string` and `tools: { name: string; description: string }[]`; `fetchConnections`; `exportSession`, `importSession`, `openBrowserLiveUrl`, `resetBrowserSession`; `useConnectFlow`; `Box`, `BoxRow`, `DataTable`, `EmptyState`, `PageHeader`, `ConfirmDialog`.
- Produces: the `/apps/:name` page. Task 16 deletes `components/IntegrationDetail.tsx` once this exists.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/pages/AppDetail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppDetail from "./AppDetail";

vi.mock("../api", () => ({
  fetchIntegration: vi.fn(),
  fetchConnections: vi.fn(),
  exportSession: vi.fn(),
  importSession: vi.fn(),
  openBrowserLiveUrl: vi.fn(),
  resetBrowserSession: vi.fn(),
  startIntegrationAuth: vi.fn(),
  disconnectIntegration: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" }, token: "t", isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("../components/CookieAuthPopup", () => ({ default: () => null }));
vi.mock("../components/ApiKeyAuthModal", () => ({ default: () => null }));

import { fetchIntegration, fetchConnections, startIntegrationAuth, disconnectIntegration } from "../api";

const DETAIL = {
  name: "acme",
  displayName: "Acme",
  version: "1.0.0",
  description: "Track work",
  categories: ["issues"],
  toolCount: 2,
  authType: "oauth2",
  configured: true,
  tools: [
    { name: "acme_search", description: "Search issues" },
    { name: "acme_create", description: "Create an issue" },
  ],
};

function renderAt(name: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/apps/${name}`]}>
        <Routes>
          <Route path="/apps/:name" element={<AppDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchIntegration).mockResolvedValue(DETAIL);
  vi.mocked(fetchConnections).mockResolvedValue({ connections: [] });
});

describe("AppDetail", () => {
  it("titles the page with the display name and links back to the registry", async () => {
    renderAt("acme");
    expect(await screen.findByRole("heading", { level: 1, name: "Acme" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Apps/ })).toHaveAttribute("href", "/apps");
  });

  it("reports the connection state and auth type", async () => {
    renderAt("acme");
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("oauth2")).toBeInTheDocument();
  });

  it("lists every tool with its description", async () => {
    renderAt("acme");
    expect(await screen.findByText("acme_search")).toBeInTheDocument();
    expect(screen.getByText("Create an issue")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tools (2)" })).toBeInTheDocument();
  });

  it("offers Connect while disconnected", async () => {
    vi.mocked(startIntegrationAuth).mockResolvedValue({ type: "oauth2", url: "https://example.com/authorize" });
    renderAt("acme");
    fireEvent.click(await screen.findByRole("button", { name: "Connect" }));
    await waitFor(() => expect(startIntegrationAuth).toHaveBeenCalledWith("acme", undefined));
  });

  it("offers Reconnect and Disconnect once connected, and confirms the disconnect", async () => {
    vi.mocked(fetchConnections).mockResolvedValue({ connections: [{ name: "acme", connected: true }] });
    vi.mocked(disconnectIntegration).mockResolvedValue({ success: true });
    renderAt("acme");

    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reconnect" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    // The confirmation dialog's own Disconnect button, not the header's.
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(disconnectIntegration).toHaveBeenCalledWith("acme"));
  });

  it("shows session transfer only for cookie integrations", async () => {
    renderAt("acme");
    await screen.findByRole("heading", { level: 1, name: "Acme" });
    expect(screen.queryByRole("heading", { name: "Session transfer" })).toBeNull();

    vi.mocked(fetchIntegration).mockResolvedValue({ ...DETAIL, authType: "cookie" });
    renderAt("acme");
    expect(await screen.findByRole("heading", { name: "Session transfer" })).toBeInTheDocument();
  });

  it("shows browser controls only for the built-in browser", async () => {
    vi.mocked(fetchIntegration).mockResolvedValue({
      ...DETAIL,
      name: "browser",
      displayName: "Browser",
      authType: "none",
    });
    renderAt("browser");
    expect(await screen.findByRole("heading", { name: "Browser controls" })).toBeInTheDocument();
  });

  it("explains an unknown integration instead of rendering an empty page", async () => {
    vi.mocked(fetchIntegration).mockRejectedValue(new Error("Failed to fetch integration"));
    renderAt("nope");
    expect(await screen.findByText("That app isn't in this registry.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to apps" })).toHaveAttribute("href", "/apps");
  });
});
```

Add `within` to the Testing Library import:
`import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";`

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -w @a-workbench/portal -- AppDetail`
Expected: FAIL — the placeholder renders only the route param as a heading.

- [ ] **Step 3: Write the page**

Replace `packages/portal/src/pages/AppDetail.tsx`:

```tsx
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchIntegration,
  fetchConnections,
  exportSession,
  importSession,
  openBrowserLiveUrl,
  resetBrowserSession,
} from "../api";
import { PageHeader } from "../components/ui/PageHeader";
import { Box, BoxRow } from "../components/ui/Box";
import { DataTable } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";
import IntegrationLogo from "../components/IntegrationLogo";
import { useConnectFlow } from "../hooks/useConnectFlow";

export default function AppDetail() {
  const { name = "" } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["integration", name],
    queryFn: () => fetchIntegration(name),
    retry: false,
  });
  const { data: connectionsData } = useQuery({ queryKey: ["connections"], queryFn: fetchConnections });
  const flow = useConnectFlow();

  const connected = useMemo(() => {
    const rows: { name: string; connected: boolean }[] = connectionsData?.connections ?? [];
    return rows.some((c) => c.name === name && c.connected);
  }, [connectionsData, name]);

  if (isLoading) {
    return (
      <>
        <PageHeader title="App" />
        <div className="ui-loading">Loading app…</div>
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <Link className="wb-page-back" to="/apps">← Apps</Link>
        <PageHeader title="Not found" />
        <Box>
          <EmptyState
            message="That app isn't in this registry."
            action={<Link to="/apps">Back to apps</Link>}
          />
        </Box>
      </>
    );
  }

  const label = data.displayName || data.name;
  const alwaysOn = data.authType === "none";

  return (
    <>
      <Link className="wb-page-back" to="/apps">← Apps</Link>

      <PageHeader
        title={label}
        actions={
          alwaysOn ? undefined : (
            <>
              <Button variant="outline" onClick={() => flow.connect(data)}>
                {connected ? "Reconnect" : "Connect"}
              </Button>
              {connected && (
                <Button variant="danger" onClick={() => flow.disconnect(data.name)}>
                  Disconnect
                </Button>
              )}
            </>
          )
        }
      />

      {flow.error && <div className="ui-form-error">{flow.error}</div>}

      <div className="wb-section-gap">
        <Box title="Status">
          <BoxRow>
            <IntegrationLogo name={data.name} displayName={data.displayName} logo={data.logo} size={28} />
            <span className="wb-detail-desc">{data.description ?? "No description provided."}</span>
          </BoxRow>
          <BoxRow>
            <span className="wb-detail-key">Connection</span>
            <span className="wb-detail-val">
              {alwaysOn ? (
                <Badge variant="neutral">Built-in · always on</Badge>
              ) : connected ? (
                <Badge variant="green">Connected</Badge>
              ) : (
                <Badge variant="neutral">Not connected</Badge>
              )}
            </span>
          </BoxRow>
          <BoxRow>
            <span className="wb-detail-key">Auth</span>
            <span className="wb-detail-val">{data.authType}</span>
          </BoxRow>
          <BoxRow>
            <span className="wb-detail-key">Version</span>
            <span className="wb-detail-val">v{data.version}</span>
          </BoxRow>
          {data.categories && data.categories.length > 0 && (
            <BoxRow>
              <span className="wb-detail-key">Categories</span>
              <span className="wb-detail-val wb-chip-row">
                {data.categories.map((c) => <Badge key={c} variant="neutral">{c}</Badge>)}
              </span>
            </BoxRow>
          )}
          {data.instance && (
            <BoxRow>
              <span className="wb-detail-key">{data.instance.label}</span>
              <span className="wb-detail-val">{data.instance.default}</span>
            </BoxRow>
          )}
        </Box>

        {data.authType === "cookie" && <SessionTransfer name={data.name} />}
        {data.name === "browser" && <BrowserControls />}

        <Box title={`Tools (${data.tools.length})`}>
          {data.tools.length === 0 ? (
            <EmptyState message="This app exposes no tools." />
          ) : (
            <DataTable
              caption={`Tools exposed by ${label}`}
              head={
                <tr>
                  <th scope="col">Tool</th>
                  <th scope="col">Description</th>
                </tr>
              }
            >
              {data.tools.map((t) => (
                <tr key={t.name}>
                  <td><code className="wb-mono">{t.name}</code></td>
                  <td className="wb-detail-desc">{t.description}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Box>
      </div>

      {flow.dialogs}
    </>
  );
}

// Move a captured cookie session between workbenches. Capture on a machine the
// login provider trusts (e.g. a residential IP), export, then import into a
// headless/in-cluster workbench the provider would otherwise block.
function SessionTransfer({ name }: { name: string }) {
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function onExport() {
    setMsg(null);
    setBusy(true);
    try {
      const { session } = await exportSession(name);
      const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}-session.json`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: "Exported — bundle downloaded. Keep it secret; it's a live session." });
    } catch (e) {
      setMsg({ ok: false, text: `Export failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  async function onImport() {
    setMsg(null);
    setBusy(true);
    try {
      const session = JSON.parse(paste);
      const r = await importSession(name, session);
      setMsg({ ok: true, text: `Imported ${r.cookieCount} cookies — integration connected.` });
      setPaste("");
      qc.invalidateQueries({ queryKey: ["connections"] });
      qc.invalidateQueries({ queryKey: ["integrations"] });
    } catch (e) {
      const m = e instanceof SyntaxError ? "not valid JSON" : (e as Error).message;
      setMsg({ ok: false, text: `Import failed: ${m}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box title="Session transfer">
      <BoxRow className="wb-row-stack">
        <p className="wb-detail-desc">
          Capture on a machine the login provider accepts, <b>Export</b> the session, then <b>Import</b> it into a
          workbench whose IP the provider blocks (for example a headless or in-cluster instance).
        </p>
        <Button variant="outline" onClick={onExport} disabled={busy}>Export session</Button>
        <textarea
          className="ui-input"
          aria-label="Exported session bundle"
          placeholder="Paste an exported session bundle JSON here…"
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
        />
        <Button onClick={onImport} disabled={busy || !paste.trim()}>Import session</Button>
        {msg && <div className={msg.ok ? "wb-ok" : "ui-form-error"}>{msg.text}</div>}
      </BoxRow>
    </Box>
  );
}

// Built-in browser controls: open a live view (optionally at a URL) and clear
// the persistent profile.
function BrowserControls() {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const qc = useQueryClient();

  async function onOpen() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await openBrowserLiveUrl(url.trim() || undefined);
      window.open(r.url, "_blank", "noopener");
      setMsg({ ok: true, text: "Live view opened in a new tab." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    setConfirmClear(false);
    setBusy(true);
    setMsg(null);
    try {
      await resetBrowserSession();
      setMsg({ ok: true, text: "Browser session cleared." });
      qc.invalidateQueries({ queryKey: ["connections"] });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box title="Browser controls">
      <BoxRow className="wb-row-stack">
        <p className="wb-detail-desc">
          Open a live view to drive the browser by hand. Leave the URL blank to view the current page, or enter a URL to
          navigate there first.
        </p>
        <div className="wb-inline-row">
          <label className="ui-sr-only" htmlFor="browser-url">Navigate to</label>
          <Input
            id="browser-url"
            style={{ flex: 1 }}
            placeholder="https://example.com (optional)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button onClick={onOpen} disabled={busy}>Open live view</Button>
        </div>
        <Button variant="danger" onClick={() => setConfirmClear(true)} disabled={busy}>Clear session</Button>
        {msg && <div className={msg.ok ? "wb-ok" : "ui-form-error"}>{msg.text}</div>}
      </BoxRow>

      <ConfirmDialog
        open={confirmClear}
        title="Clear browser session"
        body="This signs the shared browser out of every site it is logged into. Cookie-auth integrations will need reconnecting."
        confirmLabel="Clear session"
        destructive
        onCancel={() => setConfirmClear(false)}
        onConfirm={onClear}
      />
    </Box>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- AppDetail`
Expected: PASS, 9 tests.

- [ ] **Step 5: Add the detail styles**

Append to `packages/portal/src/styles.css`:

```css
/* --- Detail rows --- */
.wb-detail-key {
  flex: none;
  width: 140px;
  font-size: 12px;
  color: var(--text-3);
}

.wb-detail-val { color: var(--text); }

.wb-detail-desc { color: var(--text-2); font-size: 13px; }

.wb-chip-row { display: flex; flex-wrap: wrap; gap: var(--s-4); }

.wb-mono { font-family: var(--mono); font-size: 12px; color: var(--accent); }

.wb-row-stack {
  display: grid;
  gap: var(--s-8);
  align-items: stretch;
  justify-items: start;
}

.wb-inline-row {
  display: flex;
  gap: var(--s-8);
  width: 100%;
  align-items: center;
}

.wb-ok { color: var(--ok); font-size: 12px; }
```

- [ ] **Step 6: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 92/92 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/portal/src/pages/AppDetail.tsx packages/portal/src/pages/AppDetail.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): promote the integration detail modal to a page"
```

---

## Task 12: The Activity page

**Files:**
- Create: `packages/portal/src/format.ts`
- Test: `packages/portal/src/format.test.ts`
- Create: `packages/portal/src/components/ActivityTable.tsx`
- Modify: `packages/portal/src/pages/Activity.tsx`
- Test: `packages/portal/src/pages/Activity.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: `fetchActivity`, `ActivityEvent`, `ActivityPage`, `fetchIntegrations` from `../api`; `Box`, `DataTable`, `EmptyState`, `Tabs`, `Select`, `Button`, `PageHeader`.
- Produces:
  - From `format.ts`: `dayLabel(unixSeconds: number, now?: Date): string`, `timeLabel(unixSeconds: number): string`, `durationLabel(ms: number | null): string`, `relativeTime(unixSeconds: number, now?: Date): string`.
  - `ActivityTable({ events, caption }: { events: ActivityEvent[]; caption: string })` — the day-grouped table body, reused by `Home` in Task 15.

- [ ] **Step 1: Write the failing format tests**

Create `packages/portal/src/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { dayLabel, timeLabel, durationLabel, relativeTime } from "./format";

// Fixed instants keep these deterministic regardless of when they run — but
// they must be built in LOCAL time, because dayLabel and timeLabel both work
// in local calendar days. A UTC literal like "2026-09-03T23:00:00Z" is the
// previous day only for viewers at or west of UTC; east of it that instant is
// already the next local day, and the test would flip on a developer's laptop.
const NOW = new Date(2026, 8, 4, 12, 0, 0); // local noon, 4 September 2026
const at = (y: number, m: number, d: number, hh = 0, mm = 0) =>
  Math.floor(new Date(y, m, d, hh, mm, 0).getTime() / 1000);

describe("dayLabel", () => {
  it("names today and yesterday", () => {
    expect(dayLabel(at(2026, 8, 4, 9, 30), NOW)).toBe("Today");
    expect(dayLabel(at(2026, 8, 3, 23, 0), NOW)).toBe("Yesterday");
  });

  it("falls back to an ISO date further back", () => {
    expect(dayLabel(at(2026, 7, 28, 10, 0), NOW)).toBe("2026-08-28");
  });
});

describe("timeLabel", () => {
  it("renders zero-padded hours and minutes", () => {
    expect(timeLabel(at(2026, 8, 4, 9, 5))).toBe("09:05");
  });
});

describe("durationLabel", () => {
  it("renders milliseconds under a second", () => {
    expect(durationLabel(412)).toBe("412ms");
  });

  it("switches to seconds at a second and above", () => {
    expect(durationLabel(1500)).toBe("1.5s");
    expect(durationLabel(12000)).toBe("12.0s");
  });

  it("renders an em dash when there is no duration", () => {
    expect(durationLabel(null)).toBe("—");
  });
});

describe("relativeTime", () => {
  it("counts minutes, hours and days back", () => {
    expect(relativeTime(at(2026, 8, 4, 11, 30), NOW)).toBe("30m ago");
    expect(relativeTime(at(2026, 8, 4, 9, 0), NOW)).toBe("3h ago");
    expect(relativeTime(at(2026, 8, 1, 12, 0), NOW)).toBe("3d ago");
  });

  it("never reports less than a minute", () => {
    expect(relativeTime(Math.floor(NOW.getTime() / 1000) - 10, NOW)).toBe("1m ago");
  });

  it("renders an em dash for a missing timestamp", () => {
    expect(relativeTime(0, NOW)).toBe("—");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @a-workbench/portal -- format`
Expected: FAIL — `Failed to resolve import "./format"`.

- [ ] **Step 3: Write the formatters**

Create `packages/portal/src/format.ts`:

```ts
// Presentation helpers for timestamps the API reports in Unix seconds. `now`
// is injectable so the tests do not depend on when they run.

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function isoDate(d: Date): string {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function dayLabel(unixSeconds: number, now: Date = new Date()): string {
  const then = new Date(unixSeconds * 1000);
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(then)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return isoDate(then);
}

export function timeLabel(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
}

export function durationLabel(ms: number | null): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function relativeTime(unixSeconds: number, now: Date = new Date()): string {
  if (!unixSeconds) return "—";
  const seconds = now.getTime() / 1000 - unixSeconds;
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @a-workbench/portal -- format`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write the failing page test**

Create `packages/portal/src/pages/Activity.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Activity from "./Activity";

vi.mock("../api", () => ({
  fetchActivity: vi.fn(),
  fetchIntegrations: vi.fn(async () => ({
    integrations: [
      { name: "acme", displayName: "Acme", version: "1.0.0", toolCount: 2 },
      { name: "demo-repo", displayName: "Demo Repo", version: "1.0.0", toolCount: 2 },
    ],
  })),
}));

import { fetchActivity } from "../api";

const now = new Date();
const NOW = Math.floor(now.getTime() / 1000);
// Yesterday's local noon, not "now minus 25 hours": subtracting a fixed span
// lands two calendar days back whenever the suite happens to run in the small
// hours, and the day-grouping assertion below would fail on the clock rather
// than on the code. Constructing from the local date rolls months and years
// correctly, and noon keeps it clear of daylight-saving shifts.
const YESTERDAY = Math.floor(
  new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0).getTime() / 1000
);

const EVENTS = [
  { id: 3, integration: "acme", tool: "acme_search", action: "EXECUTE", success: true, error: null, duration_ms: 412, created_at: NOW },
  { id: 2, integration: "demo-repo", tool: "repo_diff", action: "EXECUTE", success: false, error: "NOT_CONNECTED", duration_ms: 12, created_at: YESTERDAY },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Activity />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchActivity).mockResolvedValue({ stored: true, events: EVENTS, next_cursor: null });
});

describe("Activity", () => {
  it("lists each event with its tool and duration", async () => {
    renderPage();
    expect(await screen.findByText("acme_search")).toBeInTheDocument();
    expect(screen.getByText("412ms")).toBeInTheDocument();
  });

  it("groups events under a day heading", async () => {
    renderPage();
    expect(await screen.findByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
  });

  it("pairs the status icon with text so colour is not the only signal", async () => {
    renderPage();
    expect(await screen.findByText("Succeeded")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("shows the error message on a failed row", async () => {
    renderPage();
    expect(await screen.findByText("NOT_CONNECTED")).toBeInTheDocument();
  });

  it("requests only failures when the Errors tab is chosen", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Errors" }));
    await waitFor(() =>
      expect(fetchActivity).toHaveBeenCalledWith(expect.objectContaining({ status: "error" }))
    );
  });

  it("requests one integration when it is selected", async () => {
    renderPage();
    await screen.findByText("acme_search");
    fireEvent.change(screen.getByLabelText("Integration"), { target: { value: "demo-repo" } });
    await waitFor(() =>
      expect(fetchActivity).toHaveBeenCalledWith(expect.objectContaining({ integration: "demo-repo" }))
    );
  });

  it("offers Load more only while a cursor comes back, and pages with it", async () => {
    vi.mocked(fetchActivity).mockResolvedValueOnce({ stored: true, events: EVENTS, next_cursor: "cur-1" });
    renderPage();

    const more = await screen.findByRole("button", { name: "Load more" });
    vi.mocked(fetchActivity).mockResolvedValueOnce({ stored: true, events: [], next_cursor: null });
    fireEvent.click(more);

    await waitFor(() =>
      expect(fetchActivity).toHaveBeenCalledWith(expect.objectContaining({ cursor: "cur-1" }))
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).toBeNull());
  });

  it("says nothing has been recorded when the log is empty", async () => {
    vi.mocked(fetchActivity).mockResolvedValue({ stored: true, events: [], next_cursor: null });
    renderPage();
    expect(await screen.findByText("No tool calls recorded yet.")).toBeInTheDocument();
  });

  it("distinguishes an unstored log from an empty one", async () => {
    vi.mocked(fetchActivity).mockResolvedValue({ stored: false, events: [], next_cursor: null });
    renderPage();
    expect(
      await screen.findByText(/This deployment sends audit events somewhere other than its database/)
    ).toBeInTheDocument();
    expect(screen.getByText(/AUDIT_LOG_DEST/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Activity`
Expected: FAIL — the placeholder renders only a heading.

- [ ] **Step 7: Write the shared table**

Create `packages/portal/src/components/ActivityTable.tsx`:

```tsx
import type { ActivityEvent } from "../api";
import { DataTable } from "./ui/DataTable";
import { dayLabel, timeLabel, durationLabel } from "../format";

// Rows arrive newest-first; walk them in order and emit a group header row
// whenever the day changes. No sorting here — the server already ordered them.
function groupByDay(events: ActivityEvent[]): { day: string; events: ActivityEvent[] }[] {
  const groups: { day: string; events: ActivityEvent[] }[] = [];
  for (const e of events) {
    const day = dayLabel(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(e);
    else groups.push({ day, events: [e] });
  }
  return groups;
}

export function ActivityTable({
  events,
  caption,
  nameFor,
}: {
  events: ActivityEvent[];
  caption: string;
  /** Map an integration name to its display name; identity if unknown. */
  nameFor?: (name: string) => string;
}) {
  const label = nameFor ?? ((n: string) => n);

  return (
    <DataTable
      caption={caption}
      head={
        <tr>
          <th scope="col">Time</th>
          <th scope="col">App</th>
          <th scope="col">Tool</th>
          <th scope="col" className="ui-num">Duration</th>
          <th scope="col">Status</th>
        </tr>
      }
    >
      {groupByDay(events).map((g) => (
        <Fragment key={g.day}>
          <tr className="wb-day-row">
            <th scope="colgroup" colSpan={5}>{g.day}</th>
          </tr>
          {g.events.map((e) => (
            <tr key={e.id}>
              <td className="wb-cell-time">{timeLabel(e.created_at)}</td>
              <td>{e.integration ? label(e.integration) : "—"}</td>
              <td>
                <code className="wb-mono">{e.tool ?? "—"}</code>
                {!e.success && e.error && (
                  <div className="wb-cell-error" title={e.error}>{e.error}</div>
                )}
              </td>
              <td className="ui-num">{durationLabel(e.duration_ms)}</td>
              <td>
                <span className={e.success ? "wb-status-ok" : "wb-status-bad"}>
                  <span aria-hidden>{e.success ? "✓" : "✕"}</span> {e.success ? "Succeeded" : "Failed"}
                </span>
              </td>
            </tr>
          ))}
        </Fragment>
      ))}
    </DataTable>
  );
}
```

Add `import { Fragment } from "react";` at the top of that file.

- [ ] **Step 8: Write the page**

Replace `packages/portal/src/pages/Activity.tsx`:

```tsx
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchActivity, fetchIntegrations, type ActivityEvent, type IntegrationSummary } from "../api";
import { PageHeader } from "../components/ui/PageHeader";
import { Box } from "../components/ui/Box";
import { EmptyState } from "../components/ui/EmptyState";
import { Tabs } from "../components/ui/Tabs";
import { Select } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { ActivityTable } from "../components/ActivityTable";

const PAGE_SIZE = 50;

export const UNSTORED_MESSAGE =
  "This deployment sends audit events somewhere other than its database, so there is nothing to show here. Set AUDIT_LOG_DEST=sqlite to record them.";

export default function Activity() {
  const [status, setStatus] = useState<"all" | "error">("all");
  const [integration, setIntegration] = useState("all");
  // Pages already fetched, kept so "Load more" appends rather than replaces.
  const [older, setOlder] = useState<ActivityEvent[]>([]);
  // Three states, and the distinction matters: `undefined` means we have not
  // paged yet, so the cursor to use is whatever the first page returned; a
  // string means we paged and more remains; `null` means we paged and reached
  // the end. Collapsing "not yet paged" into "no rows paged in" would break the
  // ordinary end-of-list case, where the final page comes back empty.
  const [pagedCursor, setPagedCursor] = useState<string | null | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  const filters = useMemo(
    () => ({
      limit: PAGE_SIZE,
      ...(status === "error" ? { status: "error" as const } : {}),
      ...(integration !== "all" ? { integration } : {}),
    }),
    [status, integration]
  );

  // Changing a filter starts a fresh list. Reset the paged-in tail here, in the
  // event handler — not inside queryFn, which must stay a pure fetch: React
  // Query may call it on refetch, retry or remount, and a setState in there
  // fires on every one of those.
  function changeFilter(apply: () => void) {
    apply();
    setOlder([]);
    setPagedCursor(undefined);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["activity", filters],
    queryFn: () => fetchActivity(filters),
  });

  // Until "Load more" is pressed, the cursor to offer is the first page's.
  const nextCursor = pagedCursor === undefined ? (data?.next_cursor ?? null) : pagedCursor;

  const { data: registry } = useQuery({ queryKey: ["integrations"], queryFn: fetchIntegrations });

  const nameFor = useMemo(() => {
    const map = new Map<string, string>();
    ((registry?.integrations ?? []) as IntegrationSummary[]).forEach((i) =>
      map.set(i.name, i.displayName || i.name)
    );
    return (name: string) => map.get(name) ?? name;
  }, [registry]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchActivity({ ...filters, cursor: nextCursor });
      setOlder((prev) => [...prev, ...page.events]);
      setPagedCursor(page.next_cursor);
    } finally {
      setLoadingMore(false);
    }
  }

  const events = [...(data?.events ?? []), ...older];
  const integrations = (registry?.integrations ?? []) as IntegrationSummary[];

  return (
    <>
      <PageHeader
        title="Activity"
        toolbar={
          <>
            <Tabs
              label="Filter activity"
              value={status}
              onChange={(id) => changeFilter(() => setStatus(id as "all" | "error"))}
              items={[{ id: "all", label: "All" }, { id: "error", label: "Errors" }]}
            />
            <div className="wb-toolbar-controls">
              <label className="ui-sr-only" htmlFor="activity-integration">Integration</label>
              <Select
                id="activity-integration"
                value={integration}
                onChange={(e) => changeFilter(() => setIntegration(e.target.value))}
              >
                <option value="all">All apps</option>
                {integrations.map((i) => (
                  <option key={i.name} value={i.name}>{i.displayName || i.name}</option>
                ))}
              </Select>
            </div>
          </>
        }
      />

      <Box>
        {isLoading ? (
          <div className="ui-loading">Loading activity…</div>
        ) : data && !data.stored ? (
          <EmptyState message={UNSTORED_MESSAGE} />
        ) : events.length === 0 ? (
          <EmptyState message="No tool calls recorded yet." />
        ) : (
          <ActivityTable events={events} caption="Tool call history" nameFor={nameFor} />
        )}
      </Box>

      {nextCursor && (
        <div className="wb-load-more">
          <Button variant="outline" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Activity`
Expected: PASS, 9 tests.

- [ ] **Step 10: Add the styles**

Append to `packages/portal/src/styles.css`:

```css
/* --- Activity --- */
.wb-day-row th {
  position: sticky;
  top: 0;
  text-align: left;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-3);
  background: var(--bg-sunk);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  padding: var(--s-4) var(--s-12);
}

.wb-cell-time {
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.wb-cell-error {
  margin-top: var(--s-2);
  font-size: 12px;
  color: var(--danger);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 320px;
}

.wb-status-ok { color: var(--ok); white-space: nowrap; }
.wb-status-bad { color: var(--danger); white-space: nowrap; }

.wb-load-more {
  display: flex;
  justify-content: center;
  margin-top: var(--s-16);
}
```

- [ ] **Step 11: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 110/110 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 12: Commit**

```bash
git add packages/portal/src/format.ts packages/portal/src/format.test.ts packages/portal/src/components/ActivityTable.tsx packages/portal/src/pages/Activity.tsx packages/portal/src/pages/Activity.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): surface tool-call history on an activity page"
```

---

## Task 13: The Agents page

**Files:**
- Modify: `packages/portal/src/pages/Agents.tsx`
- Test: `packages/portal/src/pages/Agents.test.tsx`

`packages/portal/src/components/AgentsPanel.tsx` is superseded by this page but
is **not** deleted here — `Dashboard` still imports it, and `Dashboard` only
goes away in Task 16. Deleting it now breaks the build.

- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: `fetchAgents(): Promise<{ agents: ConnectedAgent[] }>` where `ConnectedAgent = { client_id: string; client_name?: string; scopes: string[]; connected_since: number; expires_at: number }`; `revokeAgent(clientId)`; `getApiKeyStatus(): Promise<{ hasKey: boolean }>`; `MCP_URL`, `API_KEY_PLACEHOLDER`, `mcpConfigFor` from `../mcp-config`; `relativeTime` from `../format`; `Box`, `BoxRow`, `DataTable`, `EmptyState`, `Badge`, `Button`, `ConfirmDialog`, `PageHeader`.
- Produces: the `/agents` page. Task 16 removes the last `AgentsPanel` import along with `Dashboard`.

Key management is **not** duplicated here: this page reports whether a key
exists and links to `/settings`, which owns create/reveal/revoke.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/pages/Agents.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Agents from "./Agents";

vi.mock("../api", () => ({
  fetchAgents: vi.fn(),
  revokeAgent: vi.fn(),
  getApiKeyStatus: vi.fn(),
}));

import { fetchAgents, revokeAgent, getApiKeyStatus } from "../api";

const NOW = Math.floor(Date.now() / 1000);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Agents />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiKeyStatus).mockResolvedValue({ hasKey: true });
  vi.mocked(fetchAgents).mockResolvedValue({
    agents: [
      { client_id: "cli-1", client_name: "Test Agent", scopes: ["mcp"], connected_since: NOW - 7200, expires_at: NOW + 3600 },
      { client_id: "cli-2", scopes: [], connected_since: NOW - 60, expires_at: NOW + 3600 },
    ],
  });
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});

describe("Agents", () => {
  it("shows the MCP endpoint and a client config block", async () => {
    renderPage();
    expect(await screen.findByText(`${window.location.origin}/mcp`)).toBeInTheDocument();
    expect(screen.getByText(/"mcpServers"/)).toBeInTheDocument();
  });

  it("reports that a key exists and links to settings rather than managing it here", async () => {
    renderPage();
    expect(await screen.findByText("Key active")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage API key" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("button", { name: /Generate/ })).toBeNull();
  });

  it("says when no key exists yet", async () => {
    vi.mocked(getApiKeyStatus).mockResolvedValue({ hasKey: false });
    renderPage();
    expect(await screen.findByText("No key")).toBeInTheDocument();
  });

  it("lists connected agents with their id and connection age", async () => {
    renderPage();
    expect(await screen.findByText("Test Agent")).toBeInTheDocument();
    expect(screen.getByText("cli-1")).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
  });

  it("falls back to the client id when an agent has no name", async () => {
    renderPage();
    await screen.findByText("Test Agent");
    // cli-2 has no client_name: its id stands in for the name cell too.
    expect(screen.getAllByText("cli-2").length).toBeGreaterThanOrEqual(1);
  });

  it("confirms before revoking, explaining that a live session may outlast it", async () => {
    vi.mocked(revokeAgent).mockResolvedValue({ revoked: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Revoke Test Agent" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/access token/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(revokeAgent).toHaveBeenCalledWith("cli-1"));
  });

  it("says so when no agents are connected", async () => {
    vi.mocked(fetchAgents).mockResolvedValue({ agents: [] });
    renderPage();
    expect(await screen.findByText("No agents connected.")).toBeInTheDocument();
  });

  it("surfaces a revoke failure", async () => {
    vi.mocked(revokeAgent).mockRejectedValue(new Error("Revoke failed"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Test Agent" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("Revoke failed")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Agents`
Expected: FAIL — placeholder page.

- [ ] **Step 3: Write the page**

Replace `packages/portal/src/pages/Agents.tsx`:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAgents, revokeAgent, getApiKeyStatus, type ConnectedAgent } from "../api";
import { MCP_URL, API_KEY_PLACEHOLDER, mcpConfigFor } from "../mcp-config";
import { relativeTime } from "../format";
import { PageHeader } from "../components/ui/PageHeader";
import { Box, BoxRow } from "../components/ui/Box";
import { DataTable } from "../components/ui/DataTable";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/dialogs/ConfirmDialog";

export default function Agents() {
  const qc = useQueryClient();
  const { data: keyStatus } = useQuery({ queryKey: ["api-key-status"], queryFn: getApiKeyStatus });
  const { data, isLoading } = useQuery({ queryKey: ["agents"], queryFn: fetchAgents });

  const [pendingRevoke, setPendingRevoke] = useState<ConnectedAgent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const agents: ConnectedAgent[] = data?.agents ?? [];
  const hasKey = keyStatus?.hasKey ?? false;
  const config = mcpConfigFor(API_KEY_PLACEHOLDER);

  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function confirmRevoke() {
    const agent = pendingRevoke;
    setPendingRevoke(null);
    if (!agent) return;
    setError(null);
    try {
      await revokeAgent(agent.client_id);
      qc.invalidateQueries({ queryKey: ["agents"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revoke failed");
    }
  }

  return (
    <>
      <PageHeader title="Agents" />

      {error && <div className="ui-form-error">{error}</div>}

      <div className="wb-section-gap">
        <Box
          title="Connect an agent"
          action={<Badge variant={hasKey ? "green" : "neutral"}>{hasKey ? "Key active" : "No key"}</Badge>}
        >
          <BoxRow>
            <span className="wb-detail-key">Endpoint</span>
            <code className="wb-mono">{MCP_URL}</code>
          </BoxRow>
          <BoxRow className="wb-row-stack">
            <p className="wb-detail-desc">
              Point any MCP-compatible client at that endpoint and send your key in the{" "}
              <code className="wb-mono">x-workbench-api-key</code> header.
            </p>
            <pre className="wb-code"><code>{config}</code></pre>
            <div className="wb-inline-row">
              <Button variant="outline" onClick={() => copy(config)}>
                {copied ? "Copied" : "Copy config"}
              </Button>
              <Link to="/settings">Manage API key</Link>
            </div>
          </BoxRow>
        </Box>

        <Box title={`Connected agents (${agents.length})`}>
          {isLoading ? (
            <div className="ui-loading">Loading agents…</div>
          ) : agents.length === 0 ? (
            <EmptyState message="No agents connected." />
          ) : (
            <DataTable
              caption="Agents holding an active authorization"
              head={
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Client ID</th>
                  <th scope="col">Connected</th>
                  <th scope="col">Scopes</th>
                  <th scope="col"><span className="ui-sr-only">Actions</span></th>
                </tr>
              }
            >
              {agents.map((a) => {
                const label = a.client_name || a.client_id;
                return (
                  <tr key={a.client_id}>
                    <td>{label}</td>
                    <td><code className="wb-mono">{a.client_id}</code></td>
                    <td className="wb-cell-time">{relativeTime(a.connected_since)}</td>
                    <td className="wb-chip-row">
                      {a.scopes.length === 0 ? "—" : a.scopes.map((s) => <Badge key={s} variant="neutral">{s}</Badge>)}
                    </td>
                    <td className="ui-num">
                      <Button
                        size="xs"
                        variant="danger"
                        aria-label={`Revoke ${label}`}
                        onClick={() => setPendingRevoke(a)}
                      >
                        Revoke
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </DataTable>
          )}
        </Box>
      </div>

      <ConfirmDialog
        open={pendingRevoke !== null}
        title={`Revoke ${pendingRevoke?.client_name || pendingRevoke?.client_id || ""}`}
        body="This agent will stop being able to renew its access. A session already in flight may keep working until its access token expires."
        confirmLabel="Revoke"
        destructive
        onCancel={() => setPendingRevoke(null)}
        onConfirm={confirmRevoke}
      />
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Agents`
Expected: PASS, 8 tests.

- [ ] **Step 5: Add the code-block style**

Append to `packages/portal/src/styles.css`:

```css
.wb-code {
  width: 100%;
  background: var(--code-bg);
  color: var(--code-text);
  border-radius: var(--radius);
  padding: var(--s-12);
  font-family: var(--mono);
  font-size: 12px;
  line-height: 1.5;
  overflow-x: auto;
}
```

- [ ] **Step 6: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 118/118 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/portal/src/pages/Agents.tsx packages/portal/src/pages/Agents.test.tsx packages/portal/src/styles.css
git commit -m "feat(portal): build the agents page with real revoke confirmation"
```

---

## Task 14: The Settings page

**Files:**
- Modify: `packages/portal/src/pages/Settings.tsx`
- Modify: `packages/portal/src/components/ApiKeyPanel.tsx`
- Test: `packages/portal/src/pages/Settings.test.tsx`

**Interfaces:**
- Consumes: `ApiKeyPanel` (restyled here into a `Box` body, no page chrome of its own); `useAuth()` for the email and `logout`; `ThemeToggle`; `Box`, `BoxRow`, `Button`, `PageHeader`.
- Produces: the `/settings` page.

`ApiKeyPanel` keeps every behaviour it has today — mint, reveal/hide, copy,
regenerate, revoke, and the config snippet. Only its wrapper changes: the
`<section className="apikey-panel">` and the `.eyebrow`/`.apikey-head` header
go, because the enclosing `Box` now supplies the title.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/pages/Settings.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Settings from "./Settings";

const logout = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" }, token: "t", isLoading: false, login: vi.fn(), logout }),
}));

vi.mock("../api", () => ({
  getApiKeyStatus: vi.fn(async () => ({ hasKey: false })),
  mintApiKey: vi.fn(async () => ({ apiKey: "tok-abc" })),
  revealApiKey: vi.fn(async () => ({ apiKey: "tok-abc" })),
  revokeApiKey: vi.fn(async () => ({ success: true })),
}));

import { mintApiKey } from "../api";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Settings />
    </QueryClientProvider>
  );
}

// Block body, not an expression body: `vi.clearAllMocks()` returns a value that
// does not satisfy the hook's expected return type, and `tsc` rejects it. Every
// other test file in this package already writes it this way.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("Settings", () => {
  it("titles the page and names its three sections", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "API key" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
  });

  it("mints a key from here", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Generate key" }));
    await waitFor(() => expect(mintApiKey).toHaveBeenCalled());
  });

  it("shows the signed-in email and signs out", () => {
    renderPage();
    expect(screen.getByText("dev@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("offers a theme toggle", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Settings`
Expected: FAIL — placeholder page.

- [ ] **Step 3: Unwrap `ApiKeyPanel`**

In `packages/portal/src/components/ApiKeyPanel.tsx`:

- Change the outer element from `<section className="apikey-panel">…</section>` to `<div className="wb-row-stack apikey-body">…</div>`.
- Delete the whole `<div className="apikey-head">…</div>` block, including its `.eyebrow` line and the `Badge`. The status now belongs to the enclosing `Box`'s header (see the page below), so the `Badge` import becomes unused — remove it.
- Export the key status alongside the default export so the page can title its Box:

```tsx
// Above the component, add:
export function useApiKeyStatus() {
  return useQuery({ queryKey: ["api-key-status"], queryFn: getApiKeyStatus });
}
```

and change the component body's own query to `const { data } = useApiKeyStatus();`
— note `isLoading` is deliberately not destructured here: the header block that
used it is being deleted, and `noUnusedLocals` fails the build on an unused
binding. The Settings page below still takes `isLoading` for its Box title.

Everything else in the file — mint, reveal, show/hide, copy, revoke, the
snippet — stays exactly as it is.

- [ ] **Step 4: Write the page**

Replace `packages/portal/src/pages/Settings.tsx`:

```tsx
import { useAuth } from "../context/AuthContext";
import { PageHeader } from "../components/ui/PageHeader";
import { Box, BoxRow } from "../components/ui/Box";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { ThemeToggle } from "../components/ui/ThemeToggle";
import ApiKeyPanel, { useApiKeyStatus } from "../components/ApiKeyPanel";

export default function Settings() {
  const { user, logout } = useAuth();
  const { data, isLoading } = useApiKeyStatus();
  const hasKey = data?.hasKey ?? false;

  return (
    <>
      <PageHeader title="Settings" />

      <div className="wb-section-gap">
        <Box
          title="API key"
          action={<Badge variant={hasKey ? "green" : "neutral"}>{isLoading ? "…" : hasKey ? "Key active" : "No key"}</Badge>}
        >
          <BoxRow className="wb-row-stack">
            <ApiKeyPanel />
          </BoxRow>
        </Box>

        <Box title="Appearance">
          <BoxRow>
            <span className="wb-detail-key">Theme</span>
            <span className="wb-detail-val"><ThemeToggle /></span>
          </BoxRow>
        </Box>

        <Box title="Account">
          <BoxRow>
            <span className="wb-detail-key">Signed in as</span>
            <span className="wb-detail-val">{user?.email ?? "—"}</span>
          </BoxRow>
          <BoxRow>
            <Button variant="outline" onClick={logout}>Sign out</Button>
          </BoxRow>
        </Box>
      </div>
    </>
  );
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Settings`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 122/122 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/portal/src/pages/Settings.tsx packages/portal/src/pages/Settings.test.tsx packages/portal/src/components/ApiKeyPanel.tsx
git commit -m "feat(portal): build the settings page and unwrap the API key panel"
```

---

## Task 15: The Home page

Last of the pages, because it composes pieces every earlier one established.

**Files:**
- Modify: `packages/portal/src/pages/Home.tsx`
- Test: `packages/portal/src/pages/Home.test.tsx`
- Modify: `packages/portal/src/styles.css`

**Interfaces:**
- Consumes: `fetchStats`, `fetchActivity`, `fetchIntegrations`, `fetchConnections`; `StatStrip`, `Box`, `BoxRow`, `EmptyState`, `Badge`, `PageHeader`, `ActivityTable`, `IntegrationLogo`; `MCP_URL`; `UNSTORED_MESSAGE` exported from `./Activity`.
- Produces: the `/` page.

The connected count comes from `/api/connections`, which this page already
fetches for the "Your apps" section — `/api/stats` deliberately does not report
it.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/pages/Home.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Home from "./Home";

vi.mock("../api", () => ({
  fetchStats: vi.fn(),
  fetchActivity: vi.fn(),
  fetchIntegrations: vi.fn(),
  fetchConnections: vi.fn(),
}));

import { fetchStats, fetchActivity, fetchIntegrations, fetchConnections } from "../api";

const NOW = Math.floor(Date.now() / 1000);

const INTEGRATIONS = [
  { name: "acme", displayName: "Acme", version: "1.0.0", toolCount: 4 },
  { name: "demo-repo", displayName: "Demo Repo", version: "1.0.0", toolCount: 9 },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchIntegrations).mockResolvedValue({ integrations: INTEGRATIONS });
  vi.mocked(fetchConnections).mockResolvedValue({ connections: [{ name: "acme", connected: true }] });
  vi.mocked(fetchStats).mockResolvedValue({
    stored: true, window_days: 30, tool_calls: 1284, success_rate: 0.97, most_used_integration: "acme",
  });
  vi.mocked(fetchActivity).mockResolvedValue({
    stored: true,
    events: [{ id: 1, integration: "acme", tool: "acme_search", action: "EXECUTE", success: true, error: null, duration_ms: 412, created_at: NOW }],
    next_cursor: null,
  });
});

describe("Home", () => {
  // Read a stat by its label rather than by its value: "Acme" and "1" both
  // appear elsewhere on this page, so a bare getByText would be ambiguous or,
  // worse, pass against the wrong element.
  function statValue(label: string): string {
    const cell = screen.getByText(label).closest(".ui-stat");
    return cell?.querySelector(".ui-stat-value")?.textContent ?? "";
  }

  // Every `await` below targets content that cannot exist before the page's
  // four queries settle. Waiting on a stat LABEL instead would resolve against
  // the first paint, and the assertions would then read pre-fetch defaults —
  // which for several of these coincide with the values under test.
  it("shows the four headline numbers", async () => {
    renderPage();
    await screen.findByText("1,284");
    expect(statValue("Tool calls (30d)")).toBe("1,284");
    expect(statValue("Success rate (30d)")).toBe("97%");
    expect(statValue("Most used app")).toBe("Acme");
  });

  it("counts connected apps from the connections endpoint", async () => {
    renderPage();
    // The app's own link only appears once connections AND integrations resolve.
    await screen.findByRole("link", { name: "Acme" });
    expect(statValue("Connected apps")).toBe("1");
  });

  it("lists connected apps and links to the registry", async () => {
    renderPage();
    expect(await screen.findByText("4 tools")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse all" })).toHaveAttribute("href", "/apps");
    expect(screen.getByText("4 tools")).toBeInTheDocument();
  });

  it("invites the human to connect something when nothing is connected", async () => {
    vi.mocked(fetchConnections).mockResolvedValue({ connections: [] });
    renderPage();
    expect(await screen.findByText("No apps connected yet.")).toBeInTheDocument();
  });

  it("shows the MCP endpoint and points at the agents page", async () => {
    renderPage();
    expect(await screen.findByText(`${window.location.origin}/mcp`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up an agent" })).toHaveAttribute("href", "/agents");
  });

  it("shows recent activity with a link to the full log", async () => {
    renderPage();
    expect(await screen.findByText("acme_search")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/activity");
  });

  it("dashes out the activity-derived numbers when nothing is stored", async () => {
    vi.mocked(fetchStats).mockResolvedValue({
      stored: false, window_days: 30, tool_calls: 0, success_rate: null, most_used_integration: null,
    });
    vi.mocked(fetchActivity).mockResolvedValue({ stored: false, events: [], next_cursor: null });
    renderPage();

    // The unstored note only renders once the stats query says so. It appears
    // twice — the strip's note and the recent-activity empty state — hence
    // findAllByText.
    await screen.findAllByText(/somewhere other than its database/);
    // The three activity-derived cells go blank; the connected count does not,
    // because it comes from /api/connections rather than the audit log.
    expect(statValue("Tool calls (30d)")).toBe("—");
    expect(statValue("Success rate (30d)")).toBe("—");
    expect(statValue("Most used app")).toBe("—");
    expect(statValue("Connected apps")).toBe("1");
    expect(screen.getAllByText(/somewhere other than its database/).length).toBeGreaterThan(0);
  });

  it("reports a null success rate as a dash rather than 0%", async () => {
    // tool_calls is deliberately non-zero against a null rate. The live
    // endpoint only returns a null rate when the window is empty, but that
    // pairing is exactly what makes the zero-calls case untestable here: the
    // component's pre-fetch defaults render "—" and "0" too, so the assertions
    // would hold against a component that never fetched. A non-zero count
    // isolates the null-rate branch and gives the test something to wait on
    // that cannot exist before the query resolves.
    vi.mocked(fetchStats).mockResolvedValue({
      stored: true, window_days: 30, tool_calls: 12, success_rate: null, most_used_integration: null,
    });
    renderPage();
    await screen.findByText("12");
    expect(statValue("Success rate (30d)")).toBe("—");
    expect(statValue("Tool calls (30d)")).toBe("12");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Home`
Expected: FAIL — `Home` still renders the old dashboard.

- [ ] **Step 3: Write the page**

Replace `packages/portal/src/pages/Home.tsx`:

```tsx
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  fetchStats,
  fetchActivity,
  fetchIntegrations,
  fetchConnections,
  type IntegrationSummary,
} from "../api";
import { MCP_URL } from "../mcp-config";
import { PageHeader } from "../components/ui/PageHeader";
import { StatStrip } from "../components/ui/StatStrip";
import { Box, BoxRow } from "../components/ui/Box";
import { EmptyState } from "../components/ui/EmptyState";
import { Badge } from "../components/ui/Badge";
import IntegrationLogo from "../components/IntegrationLogo";
import { ActivityTable } from "../components/ActivityTable";
import { UNSTORED_MESSAGE } from "./Activity";

const RECENT_LIMIT = 10;
const APPS_SHOWN = 8;

export default function Home() {
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: fetchStats });
  const { data: recent } = useQuery({
    queryKey: ["activity", { limit: RECENT_LIMIT }],
    queryFn: () => fetchActivity({ limit: RECENT_LIMIT }),
  });
  const { data: registry } = useQuery({ queryKey: ["integrations"], queryFn: fetchIntegrations });
  const { data: connectionsData } = useQuery({ queryKey: ["connections"], queryFn: fetchConnections });

  const integrations: IntegrationSummary[] = registry?.integrations ?? [];

  const connectedNames = useMemo(() => {
    const rows: { name: string; connected: boolean }[] = connectionsData?.connections ?? [];
    return new Set(rows.filter((c) => c.connected).map((c) => c.name));
  }, [connectionsData]);

  const connectedApps = integrations.filter((i) => connectedNames.has(i.name));

  const nameFor = useMemo(() => {
    const map = new Map(integrations.map((i) => [i.name, i.displayName || i.name]));
    return (name: string) => map.get(name) ?? name;
  }, [integrations]);

  const stored = stats?.stored ?? true;
  const rate = stats?.success_rate;

  return (
    <>
      <PageHeader title="Home" />

      <div className="wb-section-gap">
        <StatStrip
          note={stored ? undefined : UNSTORED_MESSAGE}
          stats={[
            {
              label: "Tool calls (30d)",
              value: stored ? (stats?.tool_calls ?? 0).toLocaleString("en-US") : "—",
            },
            {
              // A null rate means nothing ran, which is not the same as 0%.
              label: "Success rate (30d)",
              value: stored && rate !== null && rate !== undefined ? `${Math.round(rate * 100)}%` : "—",
            },
            {
              label: "Most used app",
              value: stored && stats?.most_used_integration ? nameFor(stats.most_used_integration) : "—",
            },
            { label: "Connected apps", value: String(connectedApps.length) },
          ]}
        />

        <Box title="Your apps" action={<Link to="/apps">Browse all</Link>}>
          {connectedApps.length === 0 ? (
            <EmptyState message="No apps connected yet." action={<Link to="/apps">Browse apps</Link>} />
          ) : (
            <>
              {connectedApps.slice(0, APPS_SHOWN).map((i) => (
                <BoxRow key={i.name}>
                  <IntegrationLogo name={i.name} displayName={i.displayName} logo={i.logo} size={20} />
                  <Link to={`/apps/${i.name}`}>{i.displayName || i.name}</Link>
                  <span className="wb-app-cell-meta">{i.toolCount} tools</span>
                  <span className="wb-app-cell-action"><Badge variant="green">Connected</Badge></span>
                </BoxRow>
              ))}
              {connectedApps.length > APPS_SHOWN && (
                <BoxRow>
                  <Link to="/apps">+{connectedApps.length - APPS_SHOWN} more</Link>
                </BoxRow>
              )}
            </>
          )}
        </Box>

        <Box title="Connect your agent" action={<Link to="/agents">Set up an agent</Link>}>
          <BoxRow>
            <span className="wb-detail-key">Endpoint</span>
            <code className="wb-mono">{MCP_URL}</code>
          </BoxRow>
        </Box>

        <Box title="Recent activity" action={<Link to="/activity">View all</Link>}>
          {recent && !recent.stored ? (
            <EmptyState message={UNSTORED_MESSAGE} />
          ) : (recent?.events.length ?? 0) === 0 ? (
            <EmptyState message="No tool calls recorded yet." />
          ) : (
            <ActivityTable events={recent!.events} caption="Ten most recent tool calls" nameFor={nameFor} />
          )}
        </Box>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Home`
Expected: PASS, 8 tests.

- [ ] **Step 5: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 130/130 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/portal/src/pages/Home.tsx packages/portal/src/pages/Home.test.tsx
git commit -m "feat(portal): build the home page"
```

---

## Task 16: Remove the old dashboard and sweep the dead styles

`Home` no longer renders `Dashboard`, so both it and the modal it opened are
now unreachable. Everything the ornament rules styled goes with them.

**Files:**
- Delete: `packages/portal/src/pages/Dashboard.tsx`
- Delete: `packages/portal/src/components/IntegrationDetail.tsx`
- Delete: `packages/portal/src/components/AgentsPanel.tsx`
- Modify: `packages/portal/src/styles.css`
- Test: `packages/portal/src/styles.guard.test.ts`
- Test: `packages/portal/src/App.table.test.tsx`

**Interfaces:**
- Consumes: every page from Tasks 10-15.
- Produces: nothing new. This task only removes.

- [ ] **Step 1: Write the failing guard test**

Create `packages/portal/src/styles.guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "styles.css"), "utf8");

// Rules the geometry decision depends on. A future edit that reintroduces a
// pill button or a drop shadow on a static surface fails here rather than
// quietly drifting the whole interface back.
describe("portal stylesheet geometry", () => {
  it("uses a full radius only on the toggle, which is a capsule by definition", () => {
    const users = css
      .split("}")
      .filter((block) => block.includes("--radius-full"))
      .map((block) => block.split("{")[0].trim());
    expect(users.length).toBeGreaterThan(0);
    for (const selector of users) {
      expect(selector).toMatch(/ui-toggle/);
    }
  });

  it("casts a shadow only on genuinely overlaid surfaces", () => {
    const users = css
      .split("}")
      .filter((block) => /box-shadow\s*:/.test(block))
      .map((block) => block.split("{")[0].trim());
    expect(users.length).toBeGreaterThan(0);
    for (const selector of users) {
      // The modal and the bottom sheet are the only things that genuinely
      // float above the page. The sheet's class is `ui-sheet`, not
      // `ui-bottom-sheet` — the component is named BottomSheet but its CSS
      // is not.
      expect(selector).toMatch(/ui-modal|ui-sheet/);
    }
  });

  it("carries no leftover ornament rules", () => {
    for (const dead of [".eyebrow", ".headline", ".card-index", ".card-top", ".filter-chip", ".blinker", ".ticker"]) {
      expect(css).not.toContain(dead);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @a-workbench/portal -- styles.guard`
Expected: FAIL — `.eyebrow` and friends are still present, and buttons/badges still use `--radius-full`.

- [ ] **Step 3: Delete the dead components**

```bash
git rm packages/portal/src/pages/Dashboard.tsx
git rm packages/portal/src/components/IntegrationDetail.tsx
git rm packages/portal/src/components/AgentsPanel.tsx
```

Confirm nothing still imports them:

Run: `grep -rn "Dashboard\|IntegrationDetail\|AgentsPanel" packages/portal/src`
Expected: no matches.

- [ ] **Step 4: Sweep the stylesheet**

In `packages/portal/src/styles.css`, delete these rule blocks entirely:

`.app`, `.main`, `.ui-footer`, `.section-head`, `.eyebrow`, `.eyebrow .dot`,
`.headline`, `.headline em`, `.headline-meta`, `.headline-meta b`,
`.headline-meta em`, `.filter-row`, `.filter-row-cat`, `.grid`, `.card-top`,
`.card-index`, `.card-name`, `.card-ver`, `.card-bottom`, `.card-actions`,
`.card-meta`, `.card-head`, `.card-desc`, `.count`, `.cat-select-wrap`,
`.cat-select-label`, `.integ-tags`, `.integ-detail-title`, `.integ-detail-desc`,
`.integ-tools-head`, `.integ-tool-list`, `.integ-tool`, `.integ-tool-name`,
`.integ-tool-desc`, `.session-transfer`, `.session-transfer-row`,
`.session-transfer-ok`, `.apikey-panel`, `.apikey-head`, `.apikey-head .eyebrow`,
`.user-email` (the sidebar has its own `.wb-user-email`), and the
`/* animations */` block with its `@keyframes`.

Keep: `.apikey-blurb`, `.apikey-reveal`,
`.apikey-row`, `.apikey-value`, `.apikey-actions`, `.apikey-snippet-label`,
`.apikey-snippet`, `.apikey-form`, `.apikey-field`, `.apikey-field-label`,
`.apikey-req`, `.apikey-opt`, `.apikey-field-desc`, `.integ-logo`,
`.integ-logo-fallback`, `.ui-form-error`, `.ui-loading`, `.modal-instructions`,
and every `ui-*` component rule.

Then change the two pill radii to the shared one:

```css
/* in .ui-button */
  border-radius: var(--radius);

/* in .ui-badge */
  border-radius: var(--radius-sm);
```

And remove the `box-shadow` declaration from any rule that is not `.ui-modal`
or `.ui-sheet`. Run this to find them:

Run: `grep -n "box-shadow" packages/portal/src/styles.css`

One of those shadows is load-bearing: it is the focus ring on `.ui-input`, and
the rule beneath it sets `outline: none`. Removing the shadow without replacing
it leaves every text field in the portal with no keyboard-focus indicator
beyond a 1px border tint, which the spec forbids. Add a real ring — as an
`outline`, which is the right property for this and is not a shadow, so the
guard test stays honest:

```css
.ui-input:focus-visible {
  /* A ring, not a shadow: shadows are reserved for genuinely overlaid
     surfaces, and an outline is what a focus indicator should be anyway.
     Inset by a pixel so it reads as a ring on the field rather than a halo
     around it. */
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
```

Leave the existing `.ui-input:focus` border tint beneath it — it still serves
mouse users, and `:focus-visible` wins for keyboard focus. `.ui-input-valid`
and `.ui-input-error` stay border-colour-only; those states are carried by text
elsewhere. Also give `.ui-sheet-grip` `border-radius: var(--radius)` rather than
dropping its radius entirely — at roughly 4px tall it still reads as a rounded
handle, and it keeps `--radius-full` down to the toggle alone.

- [ ] **Step 5: Cover the real route table**

`App.routes.test.tsx` (Task 9) builds its own `<Routes>` tree rather than
rendering `App`, so it mirrors the route table instead of covering it — it
would not catch `/authorize/choose` being wrapped in `RequireAuth`, the layout
route losing its auth gate, or the catch-all shadowing a real route. Now that
`Home` is real and `Dashboard` is gone, `App` can be rendered directly.

Create `packages/portal/src/App.table.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

// No session: this is what proves which routes are gated and which are not.
vi.mock("./context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: null, token: null, isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("./api", () => ({
  fetchProviders: vi.fn(async () => ({ providers: [] })),
  fetchAuthUrl: vi.fn(),
  fetchKeycloakAuthUrl: vi.fn(),
  SERVER_URL: "",
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("the real route table", () => {
  it("leaves /authorize/choose ungated — an agent-initiated flow must not bounce to /login", async () => {
    renderAt("/authorize/choose?ticket=abc123");
    // The page renders its own signed-out picker rather than redirecting.
    expect(await screen.findByText(/Approve agent access/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("gates every shell route behind a session", async () => {
    for (const path of ["/", "/apps", "/apps/acme", "/agents", "/activity", "/settings"]) {
      const { unmount } = renderAt(path);
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
      unmount();
    }
  });

  it("gates the full-bleed routes too", async () => {
    for (const path of ["/connect/acme", "/browser"]) {
      const { unmount } = renderAt(path);
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
      unmount();
    }
  });

  it("remembers where an unauthenticated visitor was headed", async () => {
    renderAt("/apps/acme");
    await screen.findByRole("heading", { name: "Sign in" });
    expect(sessionStorage.getItem("awb_return_to")).toBe("/apps/acme");
  });

  it("sends an unknown path home rather than rendering nothing", async () => {
    renderAt("/no-such-page");
    // Unauthenticated, so the redirect lands on the login page — the point is
    // that it redirects at all instead of rendering a blank route.
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
```

This test depends on `Login.tsx` rendering an `<h1>Sign in</h1>`, which Task 17
establishes. If Task 17 has not landed yet when you run this, adjust the
assertion to the heading `Login.tsx` actually renders and say so in your report
— do not change `Login.tsx` here.

- [ ] **Step 6: Run the guards and the suite**

Run: `npm run test -w @a-workbench/portal -- styles.guard`
Expected: PASS, 3 tests.

Run: `npm run test -w @a-workbench/portal -- App.table`
Expected: PASS, 5 tests.

Run: `npm run test -w @a-workbench/portal`
Expected: 133/133 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean — a TypeScript error here means something still imports a
deleted file.

- [ ] **Step 7: Commit**

```bash
git add -A packages/portal/src
git commit -m "refactor(portal): delete the old dashboard and sweep every ornament rule"
```

---

## Task 17: Quiet the login and authorize pages

The two unauthenticated pages still carry costume: an invented tool count, a
`NODE online` readout, `// access ── 01`, and a headline broken across lines
with a coloured full stop. None of it is true and none of it survives the new
restraint.

**Files:**
- Modify: `packages/portal/src/pages/Login.tsx`
- Modify: `packages/portal/src/styles.css`
- Test: `packages/portal/src/pages/Login.test.tsx`

**Interfaces:**
- Consumes: `fetchProviders`, `fetchAuthUrl`, `fetchKeycloakAuthUrl`, `useAuth`, `safeReturnPath`, `Button`.
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `packages/portal/src/pages/Login.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Login from "./Login";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: null, token: null, isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("../api", () => ({
  fetchProviders: vi.fn(async () => ({ providers: ["google", "keycloak"] })),
  fetchAuthUrl: vi.fn(),
  fetchKeycloakAuthUrl: vi.fn(),
}));

// Block body, not an expression body — `tsc` rejects the value `vi.clearAllMocks()`
// returns as a hook callback's return type.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("Login", () => {
  it("offers each configured provider", async () => {
    render(<Login />);
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with Keycloak/ })).toBeInTheDocument();
  });

  it("states nothing it cannot know", async () => {
    const { container } = render(<Login />);
    await waitFor(() => screen.getByRole("button", { name: /Continue with Google/ }));
    const text = container.textContent ?? "";
    // The old panel asserted a tool count, a plugin count and a node status,
    // none of which this page has any way to know before sign-in.
    expect(text).not.toMatch(/TOOLS|PLUGINS|NODE|online/);
    expect(text).not.toContain("//");
  });

  it("explains when no provider is configured", async () => {
    const { fetchProviders } = await import("../api");
    vi.mocked(fetchProviders).mockResolvedValue({ providers: [] });
    render(<Login />);
    expect(await screen.findByText("No auth provider configured")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -w @a-workbench/portal -- Login`
Expected: FAIL on the second test — the page renders `TOOLS`, `NODE online` and `// access ── 01`.

- [ ] **Step 3: Simplify the page**

In `packages/portal/src/pages/Login.tsx`, replace the whole `<aside className="login-art">…</aside>` block with:

```tsx
      <aside className="login-art">
        <div className="login-art-brand">workbench</div>
        <h1 className="login-art-title">Connect your agent's toolbelt.</h1>
        <p className="login-art-sub">
          One sign-in pairs your agent sessions to the tools you already use. Credentials stay encrypted on
          your own instance.
        </p>
      </aside>
```

and replace the card's heading block:

```tsx
          <h1 className="login-title">Sign in</h1>
          <p className="login-sub">
            Choose how you want to identify yourself to this workbench.
          </p>
```

deleting the `<div className="login-eyebrow">// access ── 01</div>` line and the
`<div className="login-fine">…</div>` block entirely.

- [ ] **Step 4: Replace the panel styles**

In `packages/portal/src/styles.css`, delete `.login-art .meta`,
`.login-art .meta b`, `.login-art .meta .sep`, `.login-art .specs`,
`.login-art .specs > div`, `.login-art .specs label`, `.login-art .specs strong`,
`.login-eyebrow`, `.login-title em` and `.login-fine`. Add:

```css
.login-art-brand {
  font-size: 14px;
  font-weight: 700;
  color: var(--text);
}

.login-art-sub {
  font-size: 14px;
  line-height: 1.6;
  color: var(--text-2);
  max-width: 42ch;
}
```

and change `.login-title`'s `font-size` from `30px` to `24px`.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test -w @a-workbench/portal -- Login`
Expected: PASS, 3 tests.

- [ ] **Step 6: Verify**

Run: `npm run test -w @a-workbench/portal`
Expected: 136/136 passing.

Run: `npm run build -w @a-workbench/portal`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/portal/src/pages/Login.tsx packages/portal/src/pages/Login.test.tsx packages/portal/src/styles.css
git commit -m "refactor(portal): drop the invented readouts from the sign-in pages"
```

---

## Task 18: Whole-branch verification

No new behaviour. Prove the branch is shippable and record what changed.

**Files:**
- Modify: `CLAUDE.md` (Findings Index correction)
- Create: `docs/findings/2026-09-04-portal-activity-from-audit-log.md`

**Interfaces:**
- Consumes: everything.
- Produces: a verified branch.

- [ ] **Step 1: Run every suite**

```bash
npm run test -w @a-workbench/server
npm run test -w @a-workbench/portal
npm run test -w @a-workbench/shared
npm run typecheck:tests -w @a-workbench/server
```

Expected: all green. Any failure stops the task — do not proceed with a red suite.

- [ ] **Step 2: Build everything**

```bash
npm run build
node docs/site/build.mjs
```

Expected: all four packages build; the docs site builds with no broken links.
The shared token file was never edited, but the site build proves it.

- [ ] **Step 3: Public-repo hygiene sweep**

Run over every file the branch touched:

```bash
git diff --name-only origin/main...HEAD
```

Then run the repository's own pre-commit check over the whole diff — the
pattern lives in `CLAUDE.md` under **Public Repo Hygiene**, and is kept there
rather than repeated here so that this document does not itself become a place
those strings are written down:

```bash
git diff origin/main...HEAD | grep -inIE "$(sed -n 's/^git diff --cached | grep -inIE .\(.*\).$/\1/p' CLAUDE.md)"
```

If that extraction is fiddly, just open `CLAUDE.md`, copy the pattern from the
pre-commit check, and run it by hand. Expected: no matches. A match here is a
blocker, not a note.

Then confirm no credential, internal host or AI-authorship trailer slipped in:

```bash
git diff origin/main...HEAD | grep -inIE 'client_secret|BEGIN [A-Z ]*PRIVATE KEY|\.internal|10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|Co-Authored-By|Generated with'
```

Expected: no matches.

Finally, confirm this branch names no outside product as a design reference.
Read the diff of any prose it adds — the pull request body, the findings doc,
code comments — and check that each design decision is stated as a rule
("one 6px radius everywhere") rather than an attribution ("like <product>").

- [ ] **Step 4: Correct the stale findings-index entry**

The `2026-09-04 oauth-authorize cross-origin cookie` line in `CLAUDE.md`'s
Findings Index still ends "…so `/authorize` hands the choice page that origin
explicitly", which describes the mechanism that was replaced by the security
fix. Replace that entry's trailing clause with:

```
— resuming an agent-initiated `/authorize` for an already-signed-in human needs the login-CSRF binding cookie back; a portal fetch can't retrieve it (cookie is scoped to the server's own origin, invisible to Vite's dev proxy) — only a real top-level form POST to the server's own absolute origin does, and that origin must come from the portal's build-time config, never from the URL
```

- [ ] **Step 5: Record the finding**

Create `docs/findings/2026-09-04-portal-activity-from-audit-log.md`:

```markdown
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
```

Add its line to the Findings Index in `CLAUDE.md`:

```
- [2026-09-04 portal activity from the audit log](docs/findings/2026-09-04-portal-activity-from-audit-log.md) — every tool call has been writing an `audit_log` row all along with no endpoint reading it; exposing it needs an explicit `stored:false` for non-sqlite `AUDIT_LOG_DEST` (an empty table is otherwise indistinguishable from "nothing ran") and a longhand `created_at < ? OR (created_at = ? AND id < ?)` keyset predicate, because rows share a second and row-value comparison is not portable across both backends
```

- [ ] **Step 6: Rebuild the docs site with the new finding**

```bash
node docs/site/build.mjs
```

Expected: page count increases by one, no broken links.

- [ ] **Step 7: Commit**

```bash
git add CLAUDE.md docs/findings/2026-09-04-portal-activity-from-audit-log.md
git commit -m "docs: record the audit-log read-side finding, correct a stale index entry"
```

- [ ] **Step 8: Update the pull request**

The branch already has an open pull request from the design-token work. Update
its description to cover both halves: the token migration it originally
carried, and this restructure. State plainly what was verified by test and
build, and what was not — if no browser was available in the session, say that
the rendered result was never eyeballed, because that is exactly the gap the
previous round of this work left behind.

Do not add any AI co-authorship trailer, and do not name any external product
as a design reference.

---

## Self-review notes

Checked against the spec:

- **Every spec section maps to a task.** Geometry → 2; primitives → 2, 3;
  server API → 4, 5; API client → 6; shell → 7; routes → 9; the six pages →
  10-15; deletions and the slop list → 16; the sign-in pages → 17;
  accessibility is asserted inside the tests of 3, 7, 9-15; testing and the
  whole-branch checks → 18.
- **Two spec deviations, both deliberate.** `/api/stats` does not report a
  connected count (Task 5 explains why); the app detail page keeps the modal's
  session-transfer and browser-control features, which the spec's component
  inventory did not mention but which are real functionality (Task 11).
- **`Home` is a placeholder that renders `Dashboard` from Task 9 until Task
  15.** That is intentional: it keeps every intermediate commit working. Task
  16 is the one that may delete `Dashboard`, and it comes after.
- **`AgentsPanel` and `IntegrationDetail` are deleted in Task 16, not when
  their replacements land**, for the same reason.
- Test counts quoted in each task's verify step assume every prior task landed
  and that this branch starts from 34 passing portal tests. Treat a small
  divergence as a count drift, not a failure — what matters is that no test
  regresses.
