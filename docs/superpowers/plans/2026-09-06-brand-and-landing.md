# Brand Mark, Swarm Hero, and Landing Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder letter-tile mark with the Node W, ship it from a shared `packages/brand` workspace, animate it as a canvas "swarm" on the login hero, and put a compact Netlify landing site in front of the docs.

**Architecture:** `packages/brand` owns the mark geometry, the palettes, an SVG renderer, a static-asset build, and a framework-free canvas engine. Portal, docs, and the new `site/` consume it. Five PRs, in order: brand package → swarm engine → login hero → site → docs/README sweep. Each PR is green on its own.

**Tech Stack:** TypeScript 5, npm workspaces + turbo, vitest 4 (jsdom for DOM tests), React 19 (portal only), Playwright 1.63 (already a server devDependency) for PNG rendering and screenshots, plain node build scripts, Netlify.

**Spec:** `docs/superpowers/specs/2026-09-06-brand-and-landing-design.md` — read it first. The approved hero behaviour is in `docs/superpowers/specs/2026-09-06-brand-hero-prototype.html`; Task 6–8 port that file's script and must preserve its numbers.

## Global Constraints

- Node `>=22`; CI matrix is Node 22 and 26. No new runtime dependencies in `packages/brand` (devDependencies only).
- Mark geometry, verbatim: viewBox 32; wire `M5 8 L10 24 L16 12 L22 24 L27 8` at stroke 4.2; nodes at stroke 1.8 — circle (5,8) r3 · square x24 y5 6×6 rx0.9 · triangle `10,20.4 13.3,26.8 6.7,26.8` · diamond `22,20.2 25.8,24 22,27.8 18.2,24`; hub circle (16,12) r3.7 filled; caps and joins `round`.
- Colours: accent `#853291` (light) / `#c98ad2` (dark). Hero palettes: dark `['#ffffff','#f3dcff','#e5b8ef','#c98ad2','#ff8de6','#a45bb0','#853291','#ffb340']`, accent `['#ffffff','#fbeaff','#f0c9f8','#e5b8ef','#ffa3ec','#d49be0','#c98ad2','#ffc36b']`. Index 0–1 rim, 2–6 body, 7 amber.
- Swarm timings: `ENTER_MS 4200`, `STAGGER_MS 900`, `LANES 12`, `FADE 70`, pose blend 1200 ms, push radius 100 / 24 px eased 0.14, gap 3.4 (rim 0.62×), rim test 2.5 px, slab thickness 16 % (rim ±THICK/2, body ±THICK/4), camera 1.7 × min(W,H), yaw ±0.6 rad, pitch ±0.4 rad, pointer ease 0.09, DPR cap 2.
- The repo is public. Fixtures use only synthetic values (`acme`, `Test User`, `dev@example.com`, `tok-abc`). Before every commit run: `git diff --cached | grep -inIE '@(icloud|gmail)\.com' ; git diff --cached | grep -iE 'co-authored-by|generated with'` — both must print nothing.
- No `Co-Authored-By` or "Generated with" trailers. Commits are authored by the human's git identity.
- Never use bare `git stash`; the stash stack is shared across worktrees.
- Copy rules: headline *One endpoint. Every tool your agent needs.*; login copy unchanged (*Connect your agent's toolbelt.*). Counts on the site come from the repo at build time, never typed in.

---

## File map

**Create**
- `packages/brand/package.json`, `tsconfig.json`, `vitest.config.ts`
- `packages/brand/src/mark.ts` — `MARK`, `markSvg()`
- `packages/brand/src/tokens.ts` — accent tokens, `SWARM_PALETTES`
- `packages/brand/src/wordmark.ts` — `LOCKUP`
- `packages/brand/src/swarm/sample.ts` — `sampleMask()`, `isRim()`
- `packages/brand/src/swarm/lanes.ts` — `laneState()`, `smootherstep()`, `settle()`
- `packages/brand/src/swarm/index.ts` — `createSwarm()`
- `packages/brand/src/index.ts` — barrel
- `packages/brand/build.mjs` — writes `dist/*.svg|png`
- `packages/brand/scripts/swarm-page.html`, `scripts/blip-check.mjs`
- `packages/brand/test/*.test.ts`
- `packages/portal/src/hooks/useSwarm.ts` (+ test)
- `packages/portal/scripts/copy-brand.mjs`
- `site/build.ts`, `site/lib/inventory.ts` (+ test), `site/lib/template.ts`, `site/data/replay.json`, `site/assets/site.css`, `site/assets/site.js`, `site/scripts/shots.mjs`, `site/scripts/fixtures/*.json`
- `netlify.toml`

**Modify**
- `packages/portal/src/components/BrandMark.tsx` (+ test), `packages/portal/src/pages/Login.tsx` (+ test), `packages/portal/src/styles.css`, `packages/portal/index.html`, `packages/portal/package.json`
- `docs/site/build.mjs`, `docs/site/nav.json`, `docs/site/assets/docs.css`
- `.github/workflows/ci.yml`, `.github/workflows/pages.yml`, `.gitignore`, `README.md`, `turbo.json`

---

# PR 1 — `packages/brand`: the mark

### Task 1: Scaffold the package and render the mark

**Files:**
- Create: `packages/brand/package.json`, `packages/brand/tsconfig.json`, `packages/brand/vitest.config.ts`, `packages/brand/src/mark.ts`, `packages/brand/src/index.ts`, `packages/brand/test/mark.test.ts`

**Interfaces:**
- Produces: `MARK` (geometry constant), `markSvg(opts?: MarkOptions): string`, `type MarkVariant = "full" | "small" | "knockout"`.

- [ ] **Step 1: Package files**

`packages/brand/package.json`:
```json
{
  "name": "@a-workbench/brand",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./dist/*": "./dist/*"
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc && node build.mjs",
    "test": "vitest run",
    "blip-check": "node scripts/blip-check.mjs"
  },
  "devDependencies": {
    "jsdom": "^25.0.1",
    "playwright": "^1.62.1",
    "typescript": "^5.4",
    "vitest": "^4.1.11"
  }
}
```

`packages/brand/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM"],
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noUnusedLocals": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`packages/brand/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", include: ["test/**/*.test.ts"], clearMocks: true } });
```

- [ ] **Step 2: Write the failing test**

`packages/brand/test/mark.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { MARK, markSvg } from "../src/mark";

describe("markSvg", () => {
  it("draws the wire, four hollow nodes and a filled hub in the full variant", () => {
    const svg = markSvg({ color: "#853291", surface: "#ffffff" });
    expect(svg).toContain(`d="${MARK.wire}"`);
    expect(svg).toContain('stroke-width="4.2"');
    expect(svg).toContain('stroke-width="1.8"');
    expect(svg).toContain('<circle cx="5" cy="8" r="3"');
    expect(svg).toContain('<rect x="24" y="5" width="6" height="6" rx="0.9"');
    expect(svg).toContain('points="10,20.4 13.3,26.8 6.7,26.8"');
    expect(svg).toContain('points="22,20.2 25.8,24 22,27.8 18.2,24"');
    expect(svg).toContain('<circle cx="16" cy="12" r="3.7" fill="#853291"');
    expect(svg).toContain('fill="#ffffff"'); // hollow nodes are filled with the surface
  });

  it("small variant keeps only the wire and the hub", () => {
    const svg = markSvg({ variant: "small" });
    expect(svg).toContain(MARK.wire);
    expect(svg).toContain('r="3.7"');
    expect(svg).not.toContain("<rect");
    expect(svg).not.toContain("points=");
  });

  it("knockout variant is a white mark on an accent tile", () => {
    const svg = markSvg({ variant: "knockout", color: "#853291" });
    expect(svg).toContain('<rect x="0" y="0" width="32" height="32" rx="7" fill="#853291"');
    expect(svg).toContain('stroke="#ffffff"');
  });

  it("uses currentColor when no colour is given so CSS can theme it", () => {
    expect(markSvg()).toContain('stroke="currentColor"');
  });

  it("sizes the root element and marks it decorative", () => {
    const svg = markSvg({ size: 24 });
    expect(svg).toMatch(/^<svg [^>]*width="24" height="24"/);
    expect(svg).toContain('aria-hidden="true"');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm install && npm test -w @a-workbench/brand`
Expected: FAIL — `Cannot find module '../src/mark'`.

- [ ] **Step 4: Implement `mark.ts` and the barrel**

`packages/brand/src/mark.ts`:
```ts
// The workbench mark: a "w" drawn as a wire between five nodes. Four hollow
// endpoint shapes are tools — circle, square, triangle, diamond — and the one
// filled node at the centre peak is the endpoint the agent talks to.
export const MARK = {
  viewBox: 32,
  wire: "M5 8 L10 24 L16 12 L22 24 L27 8",
  wireWidth: 4.2,
  nodeWidth: 1.8,
  hub: { cx: 16, cy: 12, r: 3.7 },
  nodes: [
    { shape: "circle", cx: 5, cy: 8, r: 3 },
    { shape: "square", x: 24, y: 5, size: 6, rx: 0.9 },
    { shape: "triangle", points: "10,20.4 13.3,26.8 6.7,26.8" },
    { shape: "diamond", points: "22,20.2 25.8,24 22,27.8 18.2,24" },
  ],
  // Node centres in mark units, used by the swarm to assign shapes by region.
  nodeCentres: [[5, 8], [27, 8], [10, 24], [22, 24], [16, 12]] as ReadonlyArray<readonly [number, number]>,
} as const;

export type MarkVariant = "full" | "small" | "knockout";

export interface MarkOptions {
  /** Stroke and hub colour. Defaults to currentColor. */
  color?: string;
  /** Fill for the hollow nodes so the wire visibly stops at each edge. Defaults to none. */
  surface?: string;
  /** full: nodes + hub. small: wire + hub (≤20px). knockout: white mark on an accent tile. */
  variant?: MarkVariant;
  /** Rendered width/height in px. Omit for a scalable element. */
  size?: number;
  /** Accessible name. Omit to mark the element decorative. */
  title?: string;
}

function nodeElements(surface: string): string {
  return MARK.nodes
    .map((n) => {
      switch (n.shape) {
        case "circle": return `<circle cx="${n.cx}" cy="${n.cy}" r="${n.r}" fill="${surface}"/>`;
        case "square": return `<rect x="${n.x}" y="${n.y}" width="${n.size}" height="${n.size}" rx="${n.rx}" fill="${surface}"/>`;
        default: return `<polygon points="${n.points}" fill="${surface}"/>`;
      }
    })
    .join("");
}

export function markSvg(opts: MarkOptions = {}): string {
  const variant = opts.variant ?? "full";
  const knockout = variant === "knockout";
  const color = knockout ? "#ffffff" : (opts.color ?? "currentColor");
  const tile = opts.color ?? "#853291";
  const surface = knockout ? tile : (opts.surface ?? "none");
  const dims = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  const a11y = opts.title ? ` role="img" aria-label="${opts.title}"` : ` aria-hidden="true"`;
  const parts: string[] = [];
  if (knockout) parts.push(`<rect x="0" y="0" width="32" height="32" rx="7" fill="${tile}"/>`);
  parts.push(`<path d="${MARK.wire}" fill="none" stroke="${color}" stroke-width="${MARK.wireWidth}" stroke-linecap="round" stroke-linejoin="round"/>`);
  if (variant !== "small") {
    parts.push(`<g fill="none" stroke="${color}" stroke-width="${MARK.nodeWidth}" stroke-linejoin="round">${nodeElements(surface)}</g>`);
  }
  parts.push(`<circle cx="${MARK.hub.cx}" cy="${MARK.hub.cy}" r="${MARK.hub.r}" fill="${color}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK.viewBox} ${MARK.viewBox}"${dims}${a11y}>${parts.join("")}</svg>`;
}
```

`packages/brand/src/index.ts`:
```ts
export { MARK, markSvg } from "./mark";
export type { MarkOptions, MarkVariant } from "./mark";
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w @a-workbench/brand`
Expected: PASS (5 tests). Also `npm run build -w @a-workbench/brand` — this will fail at `node build.mjs` (not written yet); that is expected until Task 3. Run `npx tsc -p packages/brand` alone to confirm the types compile.

- [ ] **Step 6: Commit**

```bash
git checkout -b brand-package main
git add packages/brand package-lock.json
git commit -m "feat(brand): add the Node W mark as data and an SVG renderer"
```

### Task 2: Tokens and lockup constants

**Files:**
- Create: `packages/brand/src/tokens.ts`, `packages/brand/src/wordmark.ts`, `packages/brand/test/tokens.test.ts`
- Modify: `packages/brand/src/index.ts`

**Interfaces:**
- Produces: `tokens = { accent, accentDark, accentSoft, accentLine }`, `SWARM_PALETTES: Record<"dark"|"accent", readonly string[]>`, `LOCKUP = { gap, standard: { mark, wordmark }, compact: { mark, wordmark } }`.

- [ ] **Step 1: Write the failing test**

`packages/brand/test/tokens.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tokens, SWARM_PALETTES } from "../src/tokens";
import { LOCKUP } from "../src/wordmark";

describe("tokens", () => {
  it("matches the accent family the portal and docs already use", () => {
    expect(tokens.accent).toBe("#853291");
    expect(tokens.accentDark).toBe("#c98ad2");
  });
  it("each swarm palette has eight steps: two rim, five body, one amber", () => {
    for (const p of Object.values(SWARM_PALETTES)) expect(p).toHaveLength(8);
    expect(SWARM_PALETTES.dark[7]).toBe("#ffb340");
    expect(SWARM_PALETTES.accent[7]).toBe("#ffc36b");
  });
});

describe("LOCKUP", () => {
  it("compact sits one step below standard for both mark and wordmark", () => {
    expect(LOCKUP.standard).toEqual({ mark: 24, wordmark: 16 });
    expect(LOCKUP.compact).toEqual({ mark: 20, wordmark: 14 });
    expect(LOCKUP.gap).toBe(8);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @a-workbench/brand`
Expected: FAIL — cannot find `../src/tokens`.

- [ ] **Step 3: Implement**

`packages/brand/src/tokens.ts`:
```ts
// Mirrors packages/shared/styles/tokens.css. A change here must be made there too;
// tokens.test.ts pins the values so the two cannot drift silently.
export const tokens = {
  accent: "#853291",
  accentDark: "#c98ad2",
  accentSoft: "#fef3ff",
  accentLine: "#e5b8ef",
} as const;

// Hero palettes. Index 0–1 are the rim (lightest), 2–6 the body spread, 7 the
// single warm counter-colour — about one body dot in six and one big ambient
// shape in three, which is what the approved prototype uses.
export const SWARM_PALETTES = {
  dark:   ["#ffffff", "#f3dcff", "#e5b8ef", "#c98ad2", "#ff8de6", "#a45bb0", "#853291", "#ffb340"],
  accent: ["#ffffff", "#fbeaff", "#f0c9f8", "#e5b8ef", "#ffa3ec", "#d49be0", "#c98ad2", "#ffc36b"],
} as const satisfies Record<string, readonly string[]>;

export type SwarmGround = keyof typeof SWARM_PALETTES;
```

`packages/brand/src/wordmark.ts`:
```ts
// Lockup layout. The portal's BrandLockup and the site header both read these
// so the mark/wordmark relationship is defined once.
export const LOCKUP = {
  gap: 8,
  standard: { mark: 24, wordmark: 16 },
  compact: { mark: 20, wordmark: 14 },
  name: "workbench",
} as const;
```

Append to `packages/brand/src/index.ts`:
```ts
export { tokens, SWARM_PALETTES } from "./tokens";
export type { SwarmGround } from "./tokens";
export { LOCKUP } from "./wordmark";
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w @a-workbench/brand`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/brand
git commit -m "feat(brand): export accent tokens, swarm palettes and lockup constants"
```

### Task 3: Static asset build

**Files:**
- Create: `packages/brand/build.mjs`, `packages/brand/test/build.test.ts`
- Modify: `turbo.json` (brand build has outputs), `.github/workflows/ci.yml`

**Interfaces:**
- Produces `packages/brand/dist/`: `mark.svg`, `mark-small.svg`, `mark-knockout.svg`, `favicon.svg`, `lockup-light.svg`, `lockup-dark.svg`, `favicon-32.png`, `apple-touch-180.png`, `og-1200x630.png`.

- [ ] **Step 1: Write the failing test**

`packages/brand/test/build.test.ts`:
```ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const dist = join(root, "dist");

describe("build.mjs", () => {
  beforeAll(() => {
    execFileSync("npx", ["tsc", "-p", root], { stdio: "inherit" });
    execFileSync("node", [join(root, "build.mjs")], { stdio: "inherit", env: { ...process.env } });
  }, 120_000);

  it.each(["mark.svg", "mark-small.svg", "mark-knockout.svg", "favicon.svg", "lockup-light.svg", "lockup-dark.svg"])(
    "writes %s", (f) => { expect(existsSync(join(dist, f))).toBe(true); },
  );

  it("favicon is the small variant with a fixed accent, since a tab has no CSS", () => {
    const svg = readFileSync(join(dist, "favicon.svg"), "utf8");
    expect(svg).toContain('stroke="#853291"');
    expect(svg).not.toContain("currentColor");
    expect(svg).not.toContain("<rect");
  });

  it("lockups carry the wordmark as text next to the mark", () => {
    const svg = readFileSync(join(dist, "lockup-light.svg"), "utf8");
    expect(svg).toContain(">workbench<");
  });

  it.each(["favicon-32.png", "apple-touch-180.png", "og-1200x630.png"])(
    "renders %s when a browser is available", (f) => {
      if (process.env.BRAND_SKIP_PNG) return;
      expect(statSync(join(dist, f)).size).toBeGreaterThan(500);
    },
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @a-workbench/brand`
Expected: FAIL — `build.mjs` not found.

- [ ] **Step 3: Implement `build.mjs`**

`packages/brand/build.mjs`:
```js
// Writes the static brand assets to dist/. SVGs come straight from the
// renderer; PNGs are screenshots of those SVGs taken with the Playwright the
// repo already has. Set BRAND_SKIP_PNG=1 to skip the browser step (no Chromium).
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
mkdirSync(dist, { recursive: true });

const { markSvg, tokens, LOCKUP } = await import(pathToFileURL(join(dist, "index.js")).href);

function lockupSvg({ color, text }) {
  const m = LOCKUP.standard.mark, w = LOCKUP.standard.wordmark, gap = LOCKUP.gap;
  const inner = markSvg({ color, surface: "none" }).replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
  const width = m + gap + Math.round(w * 0.62 * LOCKUP.name.length);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${m}" width="${width}" height="${m}" role="img" aria-label="workbench">` +
    `<svg x="0" y="0" width="${m}" height="${m}" viewBox="0 0 32 32">${inner}</svg>` +
    `<text x="${m + gap}" y="${Math.round(m * 0.72)}" font-family="Inter, -apple-system, system-ui, sans-serif" font-size="${w}" font-weight="700" letter-spacing="-0.01em" fill="${text}">${LOCKUP.name}</text></svg>`;
}

const files = {
  "mark.svg": markSvg({ color: tokens.accent, surface: "#ffffff" }),
  "mark-small.svg": markSvg({ color: tokens.accent, variant: "small" }),
  "mark-knockout.svg": markSvg({ color: tokens.accent, variant: "knockout" }),
  "favicon.svg": markSvg({ color: tokens.accent, variant: "small" }),
  "lockup-light.svg": lockupSvg({ color: tokens.accent, text: "#111928" }),
  "lockup-dark.svg": lockupSvg({ color: tokens.accentDark, text: "#e8eaed" }),
};
for (const [name, svg] of Object.entries(files)) writeFileSync(join(dist, name), svg);

if (process.env.BRAND_SKIP_PNG) { console.log("brand: skipped PNGs (BRAND_SKIP_PNG)"); process.exit(0); }

const { chromium } = await import("playwright");
const browser = await chromium.launch();
async function png(name, { width, height, html }) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><body style="margin:0;background:transparent">${html}</body>`);
  await page.screenshot({ path: join(dist, name), omitBackground: true });
  await page.close();
}
await png("favicon-32.png", { width: 32, height: 32, html: markSvg({ color: tokens.accent, variant: "small", size: 32 }) });
await png("apple-touch-180.png", { width: 180, height: 180, html: markSvg({ color: tokens.accent, variant: "knockout", size: 180 }) });
await png("og-1200x630.png", {
  width: 1200, height: 630,
  html: `<div style="width:1200px;height:630px;background:${tokens.accent};display:flex;align-items:center;justify-content:center;gap:40px;font-family:Inter,-apple-system,system-ui,sans-serif">` +
        markSvg({ color: "#ffffff", surface: tokens.accent, size: 220 }) +
        `<span style="color:#fff;font-size:120px;font-weight:800;letter-spacing:-.03em">workbench</span></div>`,
});
await browser.close();
console.log("brand: wrote", Object.keys(files).length + 3, "files to dist/");
```

- [ ] **Step 4: Run the tests**

Run: `npx playwright install chromium && npm test -w @a-workbench/brand`
Expected: PASS. Then `BRAND_SKIP_PNG=1 npm test -w @a-workbench/brand` also PASS (PNG cases skip).

- [ ] **Step 5: Wire turbo and CI**

`turbo.json` — replace the `build` task line:
```json
"build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
```

`.github/workflows/ci.yml` — insert before the `Build` step:
```yaml
      - name: Install Chromium for brand assets
        run: npx playwright install --with-deps chromium
```

- [ ] **Step 6: Full build passes from the root**

Run: `npm run build && ls packages/brand/dist`
Expected: nine files listed; turbo reports brand built before portal/server.

- [ ] **Step 7: Commit**

```bash
git add packages/brand turbo.json .github/workflows/ci.yml
git commit -m "feat(brand): build favicon, lockups, touch icon and OG image to dist"
```

Open PR 1: `gh pr create --base main --title "feat(brand): Node W mark package" --body "Adds packages/brand: mark geometry + SVG renderer, tokens, lockup constants, and a build that emits favicon/lockup/OG assets. No consumer changes yet."`

---

# PR 2 — `packages/brand`: swarm engine

Branch from PR 1's head: `git checkout -b swarm-engine brand-package`.

### Task 4: Mask sampling with rim detection (pure)

**Files:**
- Create: `packages/brand/src/swarm/sample.ts`, `packages/brand/test/sample.test.ts`

**Interfaces:**
- Produces:
  ```ts
  interface Mask { size: number; data: Uint8ClampedArray }   // RGBA, size×size
  interface SamplePoint { mx: number; my: number; rim: boolean; shape: 0|1|2|3; group: 0|1|2|3|4 }
  function inside(mask: Mask, x: number, y: number): boolean
  function isRim(mask: Mask, x: number, y: number, reach?: number): boolean
  function sampleMask(mask: Mask, opts: { gap: number; rimGap?: number; rnd: () => number; nodeCentres: ReadonlyArray<readonly [number, number]> }): SamplePoint[]
  ```

- [ ] **Step 1: Write the failing test**

`packages/brand/test/sample.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { inside, isRim, sampleMask, type Mask } from "../src/swarm/sample";
import { MARK } from "../src/mark";

// A 100×100 mask with a solid white square from (20,20) to (80,80).
function squareMask(): Mask {
  const size = 100, data = new Uint8ClampedArray(size * size * 4);
  for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) { const k = (y * size + x) * 4; data[k] = data[k + 1] = data[k + 2] = 255; data[k + 3] = 255; }
  return { size, data };
}
function lcg(seed = 1) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

describe("inside", () => {
  it("is true only for opaque white pixels", () => {
    const m = squareMask();
    expect(inside(m, 50, 50)).toBe(true);
    expect(inside(m, 10, 10)).toBe(false);
    expect(inside(m, -1, 50)).toBe(false);
  });
});

describe("isRim", () => {
  it("is true within 2.5px of the silhouette edge and false deeper in", () => {
    const m = squareMask();
    expect(isRim(m, 21, 50)).toBe(true);
    expect(isRim(m, 50, 50)).toBe(false);
  });
});

describe("sampleMask", () => {
  it("returns only points inside the mask, no two closer than the gap", () => {
    const pts = sampleMask(squareMask(), { gap: 4, rnd: lcg(), nodeCentres: MARK.nodeCentres });
    expect(pts.length).toBeGreaterThan(100);
    for (const p of pts) expect(inside(squareMask(), p.mx, p.my)).toBe(true);
    for (let i = 0; i < 200; i++) for (let j = i + 1; j < 200; j++) {
      const a = pts[i], b = pts[j];
      const d = Math.hypot(a.mx - b.mx, a.my - b.my);
      // body–body pairs keep the full gap; any pair involving a rim point may sit at the rim gap (0.62×)
      expect(d).toBeGreaterThanOrEqual((a.rim || b.rim ? 4 * 0.62 : 4) - 1e-9);
    }
  });

  it("marks rim points and packs them denser than the body", () => {
    const pts = sampleMask(squareMask(), { gap: 4, rnd: lcg(), nodeCentres: MARK.nodeCentres });
    const rim = pts.filter((p) => p.rim), body = pts.filter((p) => !p.rim);
    expect(rim.length).toBeGreaterThan(0);
    for (const p of rim) expect(isRim(squareMask(), p.mx, p.my)).toBe(true);
    expect(body.length).toBeGreaterThan(rim.length); // a filled square is mostly interior
  });

  it("assigns a pure shape near a node and any of the four elsewhere", () => {
    const pts = sampleMask(squareMask(), { gap: 4, rnd: lcg(), nodeCentres: MARK.nodeCentres });
    // (5,8) in mark units is (15.6, 25) here: near the circle node → shape 0
    const nearCircle = pts.filter((p) => Math.hypot(p.mx / 100 * 32 - 5, p.my / 100 * 32 - 8) < 2);
    for (const p of nearCircle) { expect(p.group).toBe(0); expect(p.shape).toBe(0); }
    expect(new Set(pts.map((p) => p.shape)).size).toBe(4);
  });

  it("is deterministic for the same rnd", () => {
    const a = sampleMask(squareMask(), { gap: 4, rnd: lcg(9), nodeCentres: MARK.nodeCentres });
    const b = sampleMask(squareMask(), { gap: 4, rnd: lcg(9), nodeCentres: MARK.nodeCentres });
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @a-workbench/brand -- sample`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/brand/src/swarm/sample.ts`:
```ts
export interface Mask { size: number; data: Uint8ClampedArray }
export interface SamplePoint { mx: number; my: number; rim: boolean; shape: 0 | 1 | 2 | 3; group: 0 | 1 | 2 | 3 | 4 }

export function inside(mask: Mask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.size || y >= mask.size) return false;
  const k = ((y | 0) * mask.size + (x | 0)) * 4;
  return mask.data[k + 3] > 128 && mask.data[k] > 128; // opaque and white: stroke, not a hollow node's interior
}

// Rim: any of the four neighbours `reach` px away is outside the silhouette.
export function isRim(mask: Mask, x: number, y: number, reach = 2.5): boolean {
  return !(inside(mask, x - reach, y) && inside(mask, x + reach, y) && inside(mask, x, y - reach) && inside(mask, x, y + reach));
}

export interface SampleOptions {
  gap: number;
  rimGap?: number;                  // fraction of gap; rim packs denser. Default 0.62
  rnd: () => number;                // deterministic source so a resize re-samples identically
  nodeCentres: ReadonlyArray<readonly [number, number]>;  // mark units (32-grid); last entry is the hub
  nodeRadius2?: number;             // squared distance (mark units) within which a point is "at" a node. Default 20
}

// Poisson-ish sampling: random candidates rejected when a neighbour sits closer
// than the gap, tracked in a grid whose cell is gap/√2 so one point fits a cell.
export function sampleMask(mask: Mask, opts: SampleOptions): SamplePoint[] {
  const { size } = mask, gap = opts.gap, rimGap = gap * (opts.rimGap ?? 0.62), r2 = opts.nodeRadius2 ?? 20;
  const cell = rimGap / Math.SQRT2, cols = Math.ceil(size / cell);
  const grid = new Int32Array(cols * cols).fill(-1);
  const pts: SamplePoint[] = [];
  const tries = size * size;
  for (let i = 0; i < tries; i++) {
    const x = opts.rnd() * size, y = opts.rnd() * size;
    if (!inside(mask, x, y)) continue;
    const rim = isRim(mask, x, y);
    const need = rim ? rimGap : gap;
    const gx = (x / cell) | 0, gy = (y / cell) | 0;
    const reach = Math.ceil(gap / cell);
    let ok = true;
    for (let yy = Math.max(0, gy - reach); yy <= Math.min(cols - 1, gy + reach) && ok; yy++) {
      for (let xx = Math.max(0, gx - reach); xx <= Math.min(cols - 1, gx + reach); xx++) {
        const j = grid[yy * cols + xx]; if (j < 0) continue;
        const p = pts[j], dx = p.mx - x, dy = p.my - y;
        const min = rim && p.rim ? rimGap : need;
        if (dx * dx + dy * dy < min * min) { ok = false; break; }
      }
    }
    if (!ok || grid[gy * cols + gx] >= 0) continue;
    const ux = x / size * 32, uy = y / size * 32;
    let group = 4, best = Infinity;
    opts.nodeCentres.forEach(([nx, ny], j) => { const d = (ux - nx) ** 2 + (uy - ny) ** 2; if (d < best) { best = d; group = j; } });
    const shape = (best < r2 && group < 4 ? group : (opts.rnd() * 4) | 0) as 0 | 1 | 2 | 3;
    grid[gy * cols + gx] = pts.length;
    pts.push({ mx: x, my: y, rim, shape, group: group as SamplePoint["group"] });
  }
  return pts;
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w @a-workbench/brand -- sample`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/brand/src/swarm/sample.ts packages/brand/test/sample.test.ts
git commit -m "feat(brand): sample the mark's mask into rim and body points"
```

### Task 5: Lane entrance math (pure)

**Files:**
- Create: `packages/brand/src/swarm/lanes.ts`, `packages/brand/test/lanes.test.ts`

**Interfaces:**
- Produces:
  ```ts
  const ENTER_MS = 4200, STAGGER_MS = 900, LANES = 12
  function smootherstep(p: number): number
  function settle(p: number): number
  interface LaneState { angle: number; tilt: number; roll: number; ease: number }
  function laneState(lane: number, elapsedMs: number): LaneState   // elapsed since `born`
  function entranceDone(elapsedMs: number): boolean
  function projectLane(x: number, y: number, z: number, s: LaneState, cam: number): [px: number, py: number, k: number]
  ```

- [ ] **Step 1: Write the failing test**

`packages/brand/test/lanes.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ENTER_MS, STAGGER_MS, LANES, smootherstep, settle, laneState, entranceDone, projectLane } from "../src/swarm/lanes";

describe("easings", () => {
  it("smootherstep and settle both run 0→1 and are monotonic", () => {
    let last = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) { const v = settle(p); expect(v).toBeGreaterThanOrEqual(last - 1e-12); last = v; }
    expect(smootherstep(0)).toBe(0); expect(smootherstep(1)).toBe(1);
    expect(settle(0)).toBe(0); expect(settle(1)).toBeCloseTo(1);
  });
});

describe("laneState", () => {
  it("lane 0 starts immediately; the last lane waits STAGGER_MS", () => {
    expect(laneState(0, 1).ease).toBeGreaterThan(0);
    expect(laneState(LANES - 1, STAGGER_MS - 1).ease).toBe(0);
  });
  it("every lane completes exactly one orbit and lands flat by ENTER_MS", () => {
    for (let l = 0; l < LANES; l++) {
      const s = laneState(l, ENTER_MS);
      expect(s.ease).toBeCloseTo(1);
      expect(s.angle).toBeCloseTo(Math.PI * 2);
      expect(s.tilt).toBeCloseTo(0, 6);
      expect(s.roll).toBeCloseTo(0, 6);
    }
    expect(entranceDone(ENTER_MS)).toBe(true);
    expect(entranceDone(ENTER_MS - 1)).toBe(false);
  });
  it("alternates roll direction by lane parity mid-orbit", () => {
    const a = laneState(0, ENTER_MS / 2), b = laneState(1, ENTER_MS / 2);
    expect(Math.sign(a.roll)).toBe(1); expect(Math.sign(b.roll)).toBe(-1);
  });
});

describe("projectLane", () => {
  it("is the identity at the end of the orbit", () => {
    const s = laneState(3, ENTER_MS);
    const [px, py, k] = projectLane(10, -7, 0, s, 1000);
    expect(px).toBeCloseTo(10); expect(py).toBeCloseTo(-7); expect(k).toBeCloseTo(1);
  });
  it("clamps perspective to 0.68–1.55", () => {
    const s = laneState(0, ENTER_MS / 4);
    const [, , k] = projectLane(0, 0, 5000, s, 100);
    expect(k).toBeGreaterThanOrEqual(0.68); expect(k).toBeLessThanOrEqual(1.55);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @a-workbench/brand -- lanes`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/brand/src/swarm/lanes.ts`:
```ts
// Eliza-style entrance: particles are split into lanes, each staggered, and
// each lane makes one full orbit through a virtual camera while easing from
// its ring start onto its target. Numbers are the approved prototype's.
export const ENTER_MS = 4200;
export const STAGGER_MS = 900;
export const LANES = 12;

export const smootherstep = (p: number) => p * p * p * (p * (p * 6 - 15) + 10);
// Departure eases gently (smootherstep), landing stretches long (quintic-out).
export const settle = (p: number) => { const s = smootherstep(p), i = 1 - s; return 1 - i * i; };

export interface LaneState { angle: number; tilt: number; roll: number; ease: number }

export function laneState(lane: number, elapsedMs: number): LaneState {
  const delay = (lane / (LANES - 1)) * STAGGER_MS;
  const p = Math.min(1, Math.max(0, (elapsedMs - delay) / (ENTER_MS - delay)));
  const spin = smootherstep(p);
  return {
    angle: spin * Math.PI * 2,
    tilt: Math.sin(spin * Math.PI) * 0.24,
    roll: Math.sin(spin * Math.PI) * 0.28 * (lane % 2 ? -1 : 1),
    ease: settle(p),
  };
}

export const entranceDone = (elapsedMs: number) => elapsedMs >= ENTER_MS;

// Rotate (x,y,z) by the lane's yaw/tilt/roll, then project with perspective.
export function projectLane(x: number, y: number, z: number, s: LaneState, cam: number): [number, number, number] {
  const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
  const X = x * ca + z * sa, Z1 = -x * sa + z * ca;
  const ct = Math.cos(s.tilt), st = Math.sin(s.tilt);
  const Y = y * ct - Z1 * st, depth = y * st + Z1 * ct;
  const cr = Math.cos(s.roll), sr = Math.sin(s.roll);
  const rx = X * cr - Y * sr, ry = X * sr + Y * cr;
  const k = Math.min(1.55, Math.max(0.68, cam / (cam + depth)));
  return [rx * k, ry * k, k];
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -w @a-workbench/brand -- lanes`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/brand/src/swarm/lanes.ts packages/brand/test/lanes.test.ts
git commit -m "feat(brand): lane-orbit entrance math for the swarm"
```

### Task 6: `createSwarm` — engine, rigid slab, ambient, lifecycle

**Files:**
- Create: `packages/brand/src/swarm/index.ts`, `packages/brand/test/swarm.test.ts`
- Modify: `packages/brand/src/index.ts`, `packages/brand/vitest.config.ts`

**Interfaces:**
- Produces:
  ```ts
  interface SwarmOptions {
    ground?: SwarmGround;                 // default "dark"
    markX?: number;                       // default 0.66
    markFrac?: number;                    // default 0.86
    ambient?: boolean;                    // default true
    rasterize?: (svg: string, size: number) => Promise<Mask>;   // test seam; default uses Image + offscreen canvas
    now?: () => number;                   // test seam; default performance.now
  }
  interface Swarm { destroy(): void; setGround(g: SwarmGround): void; replay(): void; state(): { ready: boolean; done: boolean; poseMix: number; count: number } }
  function createSwarm(canvas: HTMLCanvasElement, opts?: SwarmOptions): Swarm
  ```
- Consumes: `sampleMask`, `isRim` (Task 4); `laneState`, `entranceDone`, `projectLane`, `settle`, `ENTER_MS` (Task 5); `markSvg`, `MARK` (Task 1); `SWARM_PALETTES` (Task 2).

- [ ] **Step 1: Point vitest at jsdom for this file**

`packages/brand/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    clearMocks: true,
    environment: "node",
    environmentMatchGlobs: [["test/swarm.test.ts", "jsdom"]],
  },
});
```

- [ ] **Step 2: Write the failing test**

`packages/brand/test/swarm.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSwarm } from "../src/swarm/index";
import { ENTER_MS } from "../src/swarm/lanes";
import type { Mask } from "../src/swarm/sample";

// jsdom has no 2D context. A recording stub is enough: the engine only needs
// the calls to exist, and the tests read what was drawn.
function stubContext() {
  const calls: string[] = [];
  const ctx: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1, strokeStyle: "", shadowBlur: 0, shadowColor: "" };
  for (const m of ["setTransform", "clearRect", "save", "restore", "translate", "rotate", "scale", "beginPath", "arc", "rect", "moveTo", "lineTo", "closePath", "stroke"]) ctx[m] = vi.fn(() => calls.push(m));
  return { ctx, calls };
}
// A 64×64 mask whose centre 32×32 is solid.
async function rasterize(): Promise<Mask> {
  const size = 64, data = new Uint8ClampedArray(size * size * 4);
  for (let y = 16; y < 48; y++) for (let x = 16; x < 48; x++) { const k = (y * size + x) * 4; data[k] = data[k + 1] = data[k + 2] = data[k + 3] = 255; }
  return { size, data };
}

let canvas: HTMLCanvasElement, ctx: ReturnType<typeof stubContext>, clock = 0, rafCbs: FrameRequestCallback[] = [];
beforeEach(() => {
  clock = 0; rafCbs = [];
  ctx = stubContext();
  canvas = document.createElement("canvas");
  Object.defineProperty(canvas, "clientWidth", { value: 640 }); Object.defineProperty(canvas, "clientHeight", { value: 360 });
  vi.spyOn(canvas, "getContext").mockReturnValue(ctx.ctx as unknown as CanvasRenderingContext2D);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { rafCbs.push(cb); return rafCbs.length; });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = ""; const host = document.createElement("div"); host.appendChild(canvas); document.body.appendChild(host);
});
afterEach(() => vi.unstubAllGlobals());
const tick = (ms: number) => { clock += ms; const cbs = rafCbs.splice(0); for (const cb of cbs) cb(clock); };
const now = () => clock;

describe("createSwarm", () => {
  it("samples the mask, then draws every particle each frame", async () => {
    const s = createSwarm(canvas, { rasterize, now, ambient: false });
    await vi.waitFor(() => expect(s.state().ready).toBe(true));
    const n = s.state().count; expect(n).toBeGreaterThan(50);
    ctx.calls.length = 0; tick(16);
    expect(ctx.calls.filter((c) => c === "stroke").length).toBe(n);
    s.destroy();
  });

  it("is not done until ENTER_MS and blends the idle pose in over 1200ms after", async () => {
    const s = createSwarm(canvas, { rasterize, now, ambient: false });
    await vi.waitFor(() => expect(s.state().ready).toBe(true));
    tick(16); tick(ENTER_MS - 100);
    expect(s.state().done).toBe(false);
    tick(200);
    expect(s.state().done).toBe(true); expect(s.state().poseMix).toBeLessThan(0.3);
    tick(1300);
    expect(s.state().poseMix).toBe(1);
    s.destroy();
  });

  it("keeps every particle alpha at 1 on the hand-off frame (no blink)", async () => {
    const s = createSwarm(canvas, { rasterize, now, ambient: false });
    await vi.waitFor(() => expect(s.state().ready).toBe(true));
    const alphas: number[] = [];
    (ctx.ctx.stroke as ReturnType<typeof vi.fn>).mockImplementation(() => alphas.push(ctx.ctx.globalAlpha as number));
    tick(16); tick(ENTER_MS); alphas.length = 0; tick(16);
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.6);   // body 0.6, rim 0.95 — nothing faded
    s.destroy();
  });

  it("re-seeds onto an existing target, never off the mark", async () => {
    const s = createSwarm(canvas, { rasterize, now, ambient: false });
    await vi.waitFor(() => expect(s.state().ready).toBe(true));
    tick(16); tick(ENTER_MS + 2000);
    for (let i = 0; i < 400; i++) tick(16);   // long enough for every particle to have re-seeded at least once
    const targets = new Set(s.state().targets.map((t) => `${t.tx},${t.ty}`));
    for (const p of s.state().particles) expect(targets.has(`${p.tx},${p.ty}`)).toBe(true);
    s.destroy();
  });

  it("destroy cancels the frame and removes pointer listeners from the host", async () => {
    const host = canvas.parentElement!;
    const add = vi.spyOn(host, "addEventListener"), rem = vi.spyOn(host, "removeEventListener");
    const s = createSwarm(canvas, { rasterize, now, ambient: false });
    await vi.waitFor(() => expect(s.state().ready).toBe(true));
    s.destroy();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    for (const [type] of add.mock.calls) expect(rem).toHaveBeenCalledWith(type, expect.any(Function));
  });

  it("with reduced motion, renders one posed frame and never schedules a loop", async () => {
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} }));
    const s = createSwarm(canvas, { rasterize, now, ambient: false });
    await vi.waitFor(() => expect(s.state().ready).toBe(true));
    expect(rafCbs.length).toBe(0);
    expect(ctx.calls.filter((c) => c === "stroke").length).toBeGreaterThan(0);
    s.destroy();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w @a-workbench/brand -- swarm`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the engine**

`packages/brand/src/swarm/index.ts` — this is the approved prototype's script, organised. Every constant comes from the spec.
```ts
import { MARK, markSvg } from "../mark";
import { SWARM_PALETTES, type SwarmGround } from "../tokens";
import { sampleMask, type Mask, type SamplePoint } from "./sample";
import { ENTER_MS, LANES, laneState, entranceDone, projectLane, settle, smootherstep } from "./lanes";

export interface SwarmOptions {
  ground?: SwarmGround;
  markX?: number;
  markFrac?: number;
  ambient?: boolean;
  rasterize?: (svg: string, size: number) => Promise<Mask>;
  now?: () => number;
}
export interface SwarmTarget { tx: number; ty: number; tz: number; rim: boolean; shape: number }
interface Particle extends SwarmTarget {
  sx: number; sy: number; sz: number; lane: number; ci: number; size: number;
  x: number; y: number; k: number; ox: number; oy: number; ax: number; ay: number; spin: number;
  age: number; life: number; color: string;
}
interface Ambient { x: number; y: number; sx: number; sy: number; px: number; py: number; z: number; shape: number; ci: number; size: number; dx: number; dy: number; ax: number; ay: number; spin: number; wob: number; lane: number; color: string; big: boolean }
export interface Swarm {
  destroy(): void; setGround(g: SwarmGround): void; replay(): void;
  state(): { ready: boolean; done: boolean; poseMix: number; count: number; targets: SwarmTarget[]; particles: SwarmTarget[] };
}

const FADE = 70, PUSH_R = 100, PUSH_PX = 24, POSE_MS = 1200, GAP = 3.4, THICK = 0.06, CAM = 2.2;

// Default rasterizer: draw the mark SVG through an <img> onto an offscreen canvas.
async function rasterizeWithImage(svg: string, size: number): Promise<Mask> {
  const img = new Image();
  img.src = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("mark failed to load")); });
  const off = document.createElement("canvas"); off.width = off.height = size;
  const o = off.getContext("2d", { willReadFrequently: true })!;
  o.drawImage(img, 0, 0, size, size);
  return { size, data: o.getImageData(0, 0, size, size).data };
}

export function createSwarm(canvas: HTMLCanvasElement, opts: SwarmOptions = {}): Swarm {
  const host = canvas.parentElement ?? canvas;
  const ctx = canvas.getContext("2d")!;
  const now = opts.now ?? (() => performance.now());
  const rasterize = opts.rasterize ?? rasterizeWithImage;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const markX = opts.markX ?? 0.66, markFrac = opts.markFrac ?? 0.86, wantAmbient = opts.ambient ?? true;
  let ground: SwarmGround = opts.ground ?? "dark";
  let W = 0, H = 0, raf = 0, born = 0, done = reduced, doneAt = 0, poseMix = reduced ? 1 : 0, ready = false, disposed = false;
  let parts: Particle[] = [], targets: SwarmTarget[] = [], big: Ambient[] = [], tiny: Ambient[] = [];
  let slowFrames = 0, glow = true;
  const pointer = { x: -1e4, y: -1e4, nx: 0, ny: 0, down: false }, ease = { x: 0, y: 0 };
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  // The mask is white-on-transparent with the hollow nodes filled black, so
  // sampling keeps outlines only (see sample.ts `inside`).
  const maskSvg = () => markSvg({ color: "#ffffff", surface: "#000000" });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function colorFor(p: { rim?: boolean; ci: number; big?: boolean }, pal: readonly string[]) {
    if (p.big) return p.ci % 3 === 0 ? pal[7] : pal[2 + (p.ci % 5)];
    return p.rim ? pal[p.ci % 2] : pal[2 + (p.ci % 6)];
  }
  function recolor() { const pal = SWARM_PALETTES[ground]; for (const p of parts) p.color = colorFor(p, pal); for (const a of big) a.color = colorFor(a, pal); for (const a of tiny) a.color = pal[a.ci % 8]; }

  async function build() {
    resize();
    const size = Math.round(Math.min(W, H) * markFrac);
    if (size <= 0) return;
    seed = ((W * 73856093) ^ (H * 19349663)) >>> 0;
    const mask = await rasterize(maskSvg(), size);
    if (disposed) return;
    let pts: SamplePoint[] = sampleMask(mask, { gap: GAP, rnd, nodeCentres: MARK.nodeCentres });
    if (coarse) pts = pts.filter((_, i) => i % 2 === 0);
    const thick = size * THICK, reach = Math.max(W, H);
    targets = pts.map((p) => ({ tx: p.mx - size / 2, ty: p.my - size / 2, tz: (rnd() - 0.5) * thick, rim: p.rim, shape: p.shape }));
    parts = targets.map((t) => {
      const a = rnd() * Math.PI * 2, r = reach * (0.55 + rnd() * 0.5);
      return { ...t, sx: Math.cos(a) * r, sy: Math.sin(a) * r, sz: Math.min(W, H) * (0.35 + rnd() * 0.55) * (rnd() < 0.5 ? -1 : 1),
        lane: (rnd() * LANES) | 0, ci: (rnd() * 8) | 0, size: (t.rim ? 3.2 : 2.8) + rnd() * 2.6,
        x: 0, y: 0, k: 1, ox: 0, oy: 0, ax: rnd() * 6.28, ay: rnd() * 6.28, spin: (0.25 + rnd() * 0.6) * (rnd() < 0.5 ? -1 : 1),
        age: FADE, life: FADE + rnd() * 240 + 60, color: "" };   // age starts at FADE: fully visible at hand-off
    });
    const mk = (isBig: boolean): Ambient => {
      const ang = rnd() * 6.28, r = reach * (0.6 + rnd() * 0.5);
      return { x: rnd() * W, y: rnd() * H, sx: W / 2 + Math.cos(ang) * r, sy: H / 2 + Math.sin(ang) * r, px: 0, py: 0, z: rnd() * 2 - 1,
        shape: (rnd() * 4) | 0, ci: (rnd() * 8) | 0, size: isBig ? 22 + rnd() * rnd() * 84 : 2.5 + rnd() * 4,
        dx: (rnd() - 0.5) * 0.3, dy: -(0.06 + rnd() * 0.2), ax: rnd() * 6.28, ay: rnd() * 6.28,
        spin: (0.1 + rnd() * 0.35) * (rnd() < 0.5 ? -1 : 1), wob: rnd() * 6.28, lane: (rnd() * LANES) | 0, color: "", big: isBig };
    };
    big = wantAmbient ? Array.from({ length: Math.round(W / 32) }, () => mk(true)) : [];
    tiny = wantAmbient ? Array.from({ length: Math.round((W * H) / 6500) }, () => mk(false)) : [];
    recolor();
    born = 0; done = reduced; poseMix = reduced ? 1 : 0; ready = true;
    if (reduced) { step(now()); draw(now()); } else start();
  }

  function project(x: number, y: number, z: number, yaw: number, pitch: number, cam: number): [number, number, number] {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const X = x * cy + z * sy, Z1 = -x * sy + z * cy;
    const Y = y * cp - Z1 * sp, Z = y * sp + Z1 * cp;
    const k = cam / (cam + Z);
    return [X * k, Y * k, k];
  }

  function step(t: number) {
    if (!born) born = t;                        // clock starts on the first painted frame
    const el = t - born, ts = t / 1000, cx = W * markX, cy = H / 2, cam = Math.min(W, H) * CAM;
    ease.x += (pointer.nx - ease.x) * 0.06; ease.y += (pointer.ny - ease.y) * 0.06;
    if (!done && entranceDone(el)) { done = true; doneAt = t; }
    poseMix = reduced ? 1 : done ? Math.min(1, (t - doneAt) / POSE_MS) : 0;
    const pm = smootherstep(poseMix);
    const yaw = ((reduced ? 0 : Math.sin(ts * 0.25) * 0.10) + ease.x * 0.42) * pm;
    const pitch = ((reduced ? 0 : Math.cos(ts * 0.19) * 0.06) - ease.y * 0.30) * pm;
    const breathe = reduced ? 1 : 1 + Math.sin(ts * 0.4) * 0.02;
    const lanes = Array.from({ length: LANES }, (_, l) => laneState(l, el));
    for (const p of parts) {
      let px: number, py: number, k: number;
      if (!done) {
        const s = lanes[p.lane], e = s.ease;
        const rx = p.sx + (p.tx * breathe - p.sx) * e, ry = p.sy + (p.ty * breathe - p.sy) * e, rz = p.sz + (p.tz - p.sz) * e;
        [px, py, k] = projectLane(rx, ry, rz, s, cam); px += cx; py += cy;
      } else {
        [px, py, k] = project(p.tx * breathe, p.ty * breathe, p.tz, yaw, pitch, cam); px += cx; py += cy;
        const w = Math.sin(ts * 1.1 + p.tx * 0.02 + p.ty * 0.015) * 0.9 * poseMix;   // coherent ripple, phase from position
        px += w; py += w * 0.6;
        if (!reduced) { p.age++; if (--p.life <= 0) { const n = targets[(rnd() * targets.length) | 0]; p.tx = n.tx; p.ty = n.ty; p.tz = n.tz; p.rim = n.rim; p.shape = n.shape; p.color = colorFor(p, SWARM_PALETTES[ground]); p.ox = p.oy = 0; p.life = rnd() * 150 + 90 + FADE * 2; p.age = 0; } }
      }
      const dx = pointer.x - px, dy = pointer.y - py, d2 = dx * dx + dy * dy; let fx = 0, fy = 0;
      if ((!coarse || pointer.down) && d2 < PUSH_R * PUSH_R && d2 > 1) { const d = Math.sqrt(d2), f = (PUSH_R - d) / PUSH_R; fx = -(dx / d) * f * PUSH_PX; fy = -(dy / d) * f * PUSH_PX; }
      p.ox += (fx - p.ox) * 0.14; p.oy += (fy - p.oy) * 0.14;
      p.x = px + p.ox; p.y = py + p.oy; p.k = k;
      p.ax += p.spin * 0.02; p.ay += p.spin * 0.016;
    }
    for (const a of big.concat(tiny)) {
      const e = done ? 1 : lanes[a.lane].ease;
      if (done) { a.x += a.dx; a.y += a.dy; if (a.y < -80) { a.y = H + 80; a.x = rnd() * W; } else if (a.x < -80) a.x = W + 80; else if (a.x > W + 80) a.x = -80; }
      a.px = a.sx + (a.x - a.sx) * e; a.py = a.sy + (a.y - a.sy) * e;
      a.ax += a.spin * 0.01; a.ay += a.spin * 0.008;
    }
  }

  function path(shape: number, s: number) {
    ctx.beginPath();
    switch (shape) {
      case 0: ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); break;
      case 1: ctx.rect(-s / 2, -s / 2, s, s); break;
      case 2: ctx.moveTo(0, -s * 0.58); ctx.lineTo(s * 0.55, s * 0.38); ctx.lineTo(-s * 0.55, s * 0.38); ctx.closePath(); break;
      default: ctx.moveTo(0, -s * 0.62); ctx.lineTo(s * 0.62, 0); ctx.lineTo(0, s * 0.62); ctx.lineTo(-s * 0.62, 0); ctx.closePath();
    }
  }
  function drawOne(x: number, y: number, p: { ax: number; ay: number; shape: number; color: string }, s: number, alpha: number, lw: number, blur: number) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(p.ax); ctx.scale(Math.max(0.1, Math.abs(Math.cos(p.ay))), 1);
    ctx.globalAlpha = alpha; ctx.strokeStyle = p.color; ctx.lineWidth = lw;
    if (blur && glow) { ctx.shadowColor = p.color; ctx.shadowBlur = blur; }
    path(p.shape, s); ctx.stroke(); ctx.restore();
  }
  function draw(t: number) {
    ctx.clearRect(0, 0, W, H);
    const ts = t / 1000;
    for (const a of tiny) { const par = (0.6 + a.z * 0.4) * 30; drawOne(a.px - ease.x * par + Math.sin(ts * 0.3 + a.wob) * 3, a.py - ease.y * par + Math.cos(ts * 0.25 + a.wob) * 3, a, a.size, 0.25 + (a.z + 1) * 0.2, 1, 0); }
    for (const a of big) { const par = (0.7 + a.z * 0.5) * 48; drawOne(a.px - ease.x * par + Math.sin(ts * 0.22 + a.wob) * 6, a.py - ease.y * par + Math.cos(ts * 0.18 + a.wob) * 6, a, a.size, 0.28 + (a.z + 1) * 0.22, 1.4, 14); }
    const arrive = done ? 1 : Math.min(1, (t - born) / ENTER_MS), arrivalScale = 0.64 + settle(arrive) * 0.36;   // dots grow into place; no alpha ramp
    const order = parts.slice().sort((a, b) => a.k - b.k);
    for (const p of order) {
      const fade = done && !reduced ? Math.min(1, Math.min(p.age, p.life) / FADE) : 1;
      drawOne(p.x, p.y, p, p.size * arrivalScale * p.k, (p.rim ? 0.95 : 0.6) * fade, p.rim ? 1.3 : 1, 0);
    }
    ctx.globalAlpha = 1;
  }

  function loop(t: number) {
    const t0 = now(); step(t); draw(t);
    if (now() - t0 > 20) { if (++slowFrames >= 30 && glow) { glow = false; } } else slowFrames = 0;   // budget: drop ambient glow, the one expensive call
    raf = document.hidden ? 0 : requestAnimationFrame(loop);
  }
  function start() { if (!raf && !document.hidden && !reduced) raf = requestAnimationFrame(loop); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  const rect = () => canvas.getBoundingClientRect();
  const onMove = (e: PointerEvent) => { if (e.pointerType !== "mouse" && !pointer.down) return; const r = rect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.nx = (pointer.x / W) * 2 - 1; pointer.ny = (pointer.y / H) * 2 - 1; };
  const onDown = (e: PointerEvent) => { pointer.down = true; onMove(e); };
  const onUp = () => { pointer.down = false; };
  const onLeave = () => { pointer.x = pointer.y = -1e4; pointer.nx = pointer.ny = 0; pointer.down = false; };
  const onVis = () => { if (document.hidden) stop(); else start(); };
  const onResize = () => { void build(); };
  host.addEventListener("pointermove", onMove, { passive: true });
  host.addEventListener("pointerdown", onDown, { passive: true });
  host.addEventListener("pointerup", onUp, { passive: true });
  host.addEventListener("pointercancel", onLeave, { passive: true });
  host.addEventListener("pointerleave", onLeave, { passive: true });
  window.addEventListener("scroll", onLeave, { passive: true });
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("resize", onResize);
  void build();

  return {
    destroy() {
      disposed = true; stop();
      host.removeEventListener("pointermove", onMove); host.removeEventListener("pointerdown", onDown); host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onLeave); host.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onLeave); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("resize", onResize);
    },
    setGround(g) { ground = g; recolor(); },
    replay() { void build(); },
    state() { return { ready, done, poseMix, count: parts.length, targets, particles: parts.map(({ tx, ty, tz, rim, shape }) => ({ tx, ty, tz, rim, shape })) }; },
  };
}
```

Append to `packages/brand/src/index.ts`:
```ts
export { createSwarm } from "./swarm/index";
export type { Swarm, SwarmOptions, SwarmTarget } from "./swarm/index";
```

- [ ] **Step 5: Run the tests**

Run: `npm test -w @a-workbench/brand`
Expected: PASS — all files.

- [ ] **Step 6: Commit**

```bash
git add packages/brand
git commit -m "feat(brand): canvas swarm engine — rigid 3D mark, lane entrance, ambient field"
```

### Task 7: Blip check page and script

**Files:**
- Create: `packages/brand/scripts/swarm-page.html`, `packages/brand/scripts/blip-check.mjs`

**Interfaces:**
- Consumes: `createSwarm` from `../dist/index.js` (the built package).
- Produces: `npm run blip-check -w @a-workbench/brand` exits 0 when coverage never dips >15 % between adjacent 100 ms samples after 3.5 s.

- [ ] **Step 1: Host page**

`packages/brand/scripts/swarm-page.html`:
```html
<!doctype html>
<meta charset="utf-8">
<title>swarm check</title>
<style>html,body{margin:0;height:100%;background:#07090e}#host{position:relative;width:100vw;height:100vh}canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}</style>
<div id="host"><canvas id="swarm"></canvas></div>
<script type="module">
  import { createSwarm } from "../dist/index.js";
  window.swarm = createSwarm(document.getElementById("swarm"), { ground: "dark" });
</script>
```

- [ ] **Step 2: Check script**

`packages/brand/scripts/blip-check.mjs`:
```js
// Samples how much of the canvas is painted every 100ms through the entrance
// hand-off. A blink shows up as a dip between adjacent samples. Requires
// `npm run build -w @a-workbench/brand` first (imports ../dist).
import { chromium } from "playwright";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 800 } });
await page.goto(pathToFileURL(join(here, "swarm-page.html")).href);
await page.waitForFunction(() => window.swarm?.state().ready);
const t0 = Date.now(), rows = [];
while (Date.now() - t0 < 6500) {
  const n = await page.evaluate(() => { const c = document.getElementById("swarm"); const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 28) if (d[i] > 40) n++; return n; });
  rows.push({ t: (Date.now() - t0) / 1000, n }); await page.waitForTimeout(100);
}
await browser.close();
let worst = 0;
for (let i = 1; i < rows.length; i++) if (rows[i - 1].t >= 3.5) worst = Math.max(worst, (rows[i - 1].n - rows[i].n) / rows[i - 1].n);
console.log(rows.map((r) => `${r.t.toFixed(1)}:${r.n}`).join("  "));
console.log(`worst dip after 3.5s: ${(worst * 100).toFixed(1)}%`);
process.exit(worst > 0.15 ? 1 : 0);
```

- [ ] **Step 3: Run it**

Run: `npm run build -w @a-workbench/brand && npm run blip-check -w @a-workbench/brand`
Expected: exit 0, "worst dip" under 15 %. (The prototype measured 10108 → 10125 → 10164 across the hand-off.)

- [ ] **Step 4: Commit and open PR 2**

```bash
git add packages/brand/scripts
git commit -m "chore(brand): blip check for the swarm entrance hand-off"
gh pr create --base main --title "feat(brand): swarm hero engine" --body "Canvas engine that builds the Node W from outlined tool shapes: Poisson-sampled mask with a bright rim, rigid 3D slab that turns with the pointer, Eliza lane-orbit entrance, fade/reseed onto fixed targets, ambient field at two scales. Pure pieces are unit-tested; the hand-off is measured by scripts/blip-check.mjs."
```

---

# PR 3 — portal: mark swap and login hero

Branch: `git checkout -b portal-brand main` after PR 1 and PR 2 merge (or from `swarm-engine` if they haven't).

### Task 8: `BrandMark` renders the Node W; tile CSS and favicon go

**Files:**
- Modify: `packages/portal/src/components/BrandMark.tsx`, `packages/portal/src/components/BrandMark.test.tsx`, `packages/portal/src/styles.css:905-931`, `packages/portal/index.html`, `packages/portal/package.json`
- Create: `packages/portal/scripts/copy-brand.mjs`

**Interfaces:**
- Consumes: `markSvg`, `LOCKUP` from `@a-workbench/brand`.
- Produces: `BrandMark({ size })` renders inline SVG in a `span.brand-mark`; `BrandLockup({ size, compact })` unchanged signature.

- [ ] **Step 1: Add the dependency**

`packages/portal/package.json` → `dependencies`: add `"@a-workbench/brand": "*"`. Scripts: change `"build": "tsc && vite build"` to `"build": "node scripts/copy-brand.mjs && tsc && vite build"` and `"dev": "vite"` to `"dev": "node scripts/copy-brand.mjs && vite"`. Run `npm install`.

- [ ] **Step 2: Rewrite the test**

`packages/portal/src/components/BrandMark.test.tsx` — replace the file:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandMark, BrandLockup } from "./BrandMark";

describe("BrandMark", () => {
  it("is the Node W from the brand package, not a letter", () => {
    const { container } = render(<BrandMark />);
    const mark = container.querySelector(".brand-mark")!;
    expect(mark.querySelector("svg")).not.toBeNull();
    expect(mark.textContent).toBe("");
    expect(mark.innerHTML).toContain("M5 8 L10 24 L16 12 L22 24 L27 8");
  });

  it("uses currentColor so the accent token themes it", () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector(".brand-mark svg")!.outerHTML).toContain('stroke="currentColor"');
  });

  it("drops the node shapes at 20px and below", () => {
    const { container } = render(<BrandMark size={20} />);
    expect(container.querySelector(".brand-mark svg")!.outerHTML).not.toContain("<rect");
    const big = render(<BrandMark size={56} />);
    expect(big.container.querySelector(".brand-mark svg")!.outerHTML).toContain("<rect");
  });

  it("sizes the root svg", () => {
    const { container } = render(<BrandMark size={56} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "56");
  });

  it("is decorative — the wordmark beside it carries the name", () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("BrandLockup", () => {
  it("pairs the mark with the wordmark", () => {
    const { container } = render(<BrandLockup />);
    expect(container.querySelector(".brand-mark svg")).toBeInTheDocument();
    expect(screen.getByText("workbench")).toBeInTheDocument();
  });
  it("compact uses the 20px mark", () => {
    const { container } = render(<BrandLockup compact />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "20");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w @a-workbench/portal -- BrandMark`
Expected: FAIL — svg is null, textContent is "w".

- [ ] **Step 4: Implement**

`packages/portal/src/components/BrandMark.tsx`:
```tsx
import { markSvg, LOCKUP } from "@a-workbench/brand";

// The workbench mark, rendered from the brand package so the portal, the docs
// site and the marketing site cannot drift. Inline SVG (not an <img>) so the
// accent token colours it through currentColor in both themes.
export function BrandMark({ size = LOCKUP.standard.mark }: { size?: number }) {
  const svg = markSvg({ size, surface: "var(--surface)", variant: size <= 20 ? "small" : "full" });
  return <span className="brand-mark" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

// Mark plus wordmark. Every surface that shows both goes through this, so the
// gap between them is defined once. `compact` is the in-chrome scale.
export function BrandLockup({ size = LOCKUP.standard.mark, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <div className={`brand-lockup${compact ? " brand-lockup-sm" : ""}`}>
      <BrandMark size={compact ? LOCKUP.compact.mark : size} />
      <span className="brand-name">{LOCKUP.name}</span>
    </div>
  );
}
```

`packages/portal/src/styles.css` — replace the `.brand-mark { … }` block (the outline-tile rule with the long comment) with:
```css
/* The Node W from @a-workbench/brand, inline SVG coloured by the accent token. */
.brand-mark { display: inline-flex; align-items: center; justify-content: center; color: var(--accent); line-height: 0; }
.brand-mark svg { display: block; width: 100%; height: 100%; }
```
Keep `.brand-lockup`, `.brand-name`, `.brand-lockup-sm .brand-name` as they are.

`packages/portal/scripts/copy-brand.mjs`:
```js
// Copies the brand favicon into public/ so index.html can link it by path.
import { mkdirSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "brand", "dist"), dst = join(here, "..", "public");
mkdirSync(dst, { recursive: true });
for (const f of ["favicon.svg", "apple-touch-180.png"]) copyFileSync(join(src, f), join(dst, f));
```

`packages/portal/index.html` — replace the base64 `<link rel="icon" …>` line with:
```html
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/apple-touch-180.png" />
```

`.gitignore` — append:
```
# Copied from packages/brand/dist by packages/portal/scripts/copy-brand.mjs
packages/portal/public/
```

- [ ] **Step 5: Run tests and build**

Run: `npm run build -w @a-workbench/brand && npm test -w @a-workbench/portal && npm run build -w @a-workbench/portal`
Expected: PASS; `packages/portal/dist/favicon.svg` exists. Other tests that queried `.brand-mark` text (search: `grep -rn '"w"' packages/portal/src --include=*.test.tsx`) must be updated to assert on the svg instead.

- [ ] **Step 6: Commit**

```bash
git add packages/portal .gitignore package-lock.json
git commit -m "feat(portal): render the Node W from the brand package; retire the letter tile"
```

### Task 9: Login hero runs the swarm

**Files:**
- Create: `packages/portal/src/hooks/useSwarm.ts`, `packages/portal/src/hooks/useSwarm.test.tsx`
- Modify: `packages/portal/src/pages/Login.tsx:45-56`, `packages/portal/src/pages/Login.test.tsx`, `packages/portal/src/styles.css:52-90,136-140`

**Interfaces:**
- Consumes: `createSwarm(canvas, { ground })` from `@a-workbench/brand`.
- Produces: `useSwarm(ref: RefObject<HTMLCanvasElement | null>, opts: { ground: "dark" | "accent"; enabled?: boolean; markX?: number; ambient?: boolean }): void`.

- [ ] **Step 1: Write the failing hook test**

`packages/portal/src/hooks/useSwarm.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { useRef } from "react";

const destroy = vi.fn(), setGround = vi.fn();
const createSwarm = vi.fn(() => ({ destroy, setGround, replay: vi.fn(), state: vi.fn() }));
vi.mock("@a-workbench/brand", () => ({ createSwarm }));

import { useSwarm } from "./useSwarm";

function Host({ ground, enabled = true }: { ground: "dark" | "accent"; enabled?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useSwarm(ref, { ground, enabled });
  return <div><canvas ref={ref} /></div>;
}

beforeEach(() => { createSwarm.mockClear(); destroy.mockClear(); setGround.mockClear(); });

describe("useSwarm", () => {
  it("creates the swarm on mount with the given ground and destroys it on unmount", () => {
    const { unmount } = render(<Host ground="dark" />);
    expect(createSwarm).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), expect.objectContaining({ ground: "dark" }));
    unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
  it("switches ground without rebuilding", () => {
    const { rerender } = render(<Host ground="dark" />);
    rerender(<Host ground="accent" />);
    expect(createSwarm).toHaveBeenCalledTimes(1);
    expect(setGround).toHaveBeenCalledWith("accent");
  });
  it("does nothing when disabled", () => {
    render(<Host ground="dark" enabled={false} />);
    expect(createSwarm).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -w @a-workbench/portal -- useSwarm`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

`packages/portal/src/hooks/useSwarm.ts`:
```ts
import { useEffect, useRef, type RefObject } from "react";
import { createSwarm, type Swarm } from "@a-workbench/brand";

// Mounts the brand swarm on a canvas for the life of the component. Ground
// changes are forwarded, not rebuilt, so a theme toggle never replays the
// entrance.
export function useSwarm(ref: RefObject<HTMLCanvasElement | null>, opts: { ground: "dark" | "accent"; enabled?: boolean; markX?: number; ambient?: boolean }) {
  const swarm = useRef<Swarm | null>(null);
  const enabled = opts.enabled ?? true;
  useEffect(() => {
    if (!enabled || !ref.current) return;
    swarm.current = createSwarm(ref.current, { ground: opts.ground, markX: opts.markX, ambient: opts.ambient });
    return () => { swarm.current?.destroy(); swarm.current = null; };
    // ground is handled by the effect below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ref]);
  useEffect(() => { swarm.current?.setGround(opts.ground); }, [opts.ground]);
}
```

- [ ] **Step 4: Run hook tests**

Run: `npm test -w @a-workbench/portal -- useSwarm`
Expected: PASS (3 tests).

- [ ] **Step 5: Login test additions**

Append to `packages/portal/src/pages/Login.test.tsx` inside `describe("Login")`:
```tsx
  it("hosts the swarm canvas behind the hero copy", async () => {
    const { container } = render(<Login />);
    await waitFor(() => screen.getByRole("button", { name: /Continue with Google/ }));
    const aside = container.querySelector(".login-art")!;
    expect(aside.querySelector("canvas.login-art-canvas")).not.toBeNull();
    expect(aside.querySelector(".login-art-copy")).not.toBeNull();
    expect(screen.getByText("Connect your agent's toolbelt.")).toBeInTheDocument();
  });
```
Also add at the top, with the other mocks:
```tsx
vi.mock("@a-workbench/brand", async (orig) => ({ ...(await orig<typeof import("@a-workbench/brand")>()), createSwarm: vi.fn(() => ({ destroy: vi.fn(), setGround: vi.fn(), replay: vi.fn(), state: vi.fn() })) }));
```

- [ ] **Step 6: Run to verify it fails**

Run: `npm test -w @a-workbench/portal -- Login`
Expected: FAIL — no `canvas.login-art-canvas`.

- [ ] **Step 7: Modify `Login.tsx`**

Imports: add
```tsx
import { useRef } from "react";
import { useSwarm } from "../hooks/useSwarm";
```
(merge with the existing `useEffect, useState` import). Inside the component, before `return`:
```tsx
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dark = document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  // Below the two-column breakpoint the aside stacks above the form: centre the mark, drop the ambient field.
  const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 880px)").matches;
  useSwarm(canvasRef, { ground: dark ? "dark" : "accent", markX: narrow ? 0.5 : 0.66, ambient: !narrow });
```
Replace the `<aside className="login-art">…</aside>` block with:
```tsx
      <aside className="login-art" data-ground={dark ? "dark" : "accent"}>
        <canvas ref={canvasRef} className="login-art-canvas" aria-hidden="true" />
        <div className="login-art-copy">
          <div className="login-art-brand">
            <BrandLockup compact />
          </div>
          <div>
            <h1 className="login-art-title">Connect your agent's toolbelt.</h1>
            <p className="login-art-sub">
              One sign-in pairs your agent sessions to the tools you already use. Credentials stay encrypted on
              your own instance.
            </p>
          </div>
        </div>
      </aside>
```

- [ ] **Step 8: CSS**

In `packages/portal/src/styles.css`, replace the `.login-art { … }` rule and add the new ones:
```css
.login-art {
  position: relative;
  overflow: hidden;
  border-right: 1px solid var(--border);
  padding: var(--s-40);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  /* The hero is the one saturated surface on the light theme; on dark it
     matches the reference's near-black so the purples carry the colour. */
  background: #4a1552;
  color: #ffffff;
}
.login-art[data-ground="dark"] { background: #07090e; color: #e8eaed; }
.login-art-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.login-art-copy { position: relative; z-index: 1; display: flex; flex-direction: column; justify-content: space-between; gap: var(--s-32); min-height: 100%; }
.login-art .brand-mark { color: currentColor; }
.login-art .brand-name { color: currentColor; }
.login-art-title { color: currentColor; }
.login-art-sub { color: currentColor; opacity: .8; }
```
And in the `@media (max-width: 880px)` block replace `.login-art { display: none; }` with:
```css
  .login-art { min-height: 46vh; border-right: 0; border-bottom: 1px solid var(--border); }
```


- [ ] **Step 9: Run everything**

Run: `npm test -w @a-workbench/portal && npm run build -w @a-workbench/portal && npm run dev -w @a-workbench/portal`
Expected: tests PASS; open `http://localhost:3000/login` — entrance plays, mark turns with the mouse, copy readable on both themes (toggle via `localStorage.setItem('wb-theme','dark')` + reload). Stop dev server.

- [ ] **Step 10: Commit and open PR 3**

```bash
git add packages/portal
git commit -m "feat(portal): animate the login hero with the brand swarm"
gh pr create --base main --title "feat(portal): Node W mark and swarm login hero" --body "BrandMark renders the Node W from @a-workbench/brand (tile CSS and base64 favicon removed). The login aside hosts the swarm behind unchanged copy; ground follows the theme; narrow layouts centre the mark and drop the ambient field."
```

---

# PR 4 — landing site on Netlify

Branch: `git checkout -b landing-site main` after PR 1–3 merge.

### Task 10: Inventory — counts and icons from the repo

**Files:**
- Create: `site/lib/inventory.ts`, `site/lib/inventory.test.ts`, `site/package.json`, `site/tsconfig.json`, `site/vitest.config.ts`
- Modify: root `package.json` (`workspaces` gains `"site"`), `.gitignore`

**Interfaces:**
- Produces:
  ```ts
  interface IntegrationEntry { name: string; displayName: string; description: string; logoSvg: string; toolCount: number }
  interface Inventory { integrations: IntegrationEntry[]; totals: { integrations: number; tools: number; metaTools: number } }
  async function collectInventory(repoRoot: string): Promise<Inventory>
  ```

- [ ] **Step 1: Workspace files**

`site/package.json`:
```json
{
  "name": "@a-workbench/site",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsx build.ts",
    "test": "vitest run",
    "shots": "node scripts/shots.mjs"
  },
  "dependencies": { "@a-workbench/brand": "*" },
  "devDependencies": { "playwright": "^1.62.1", "tsx": "^4.23.0", "typescript": "^5.4", "vitest": "^4.1.11" }
}
```
`site/tsconfig.json`:
```json
{ "compilerOptions": { "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "strict": true, "noEmit": true, "skipLibCheck": true, "types": ["node"] }, "include": ["build.ts", "lib"] }
```
`site/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", clearMocks: true } });
```
Root `package.json`: `"workspaces": ["packages/*", "site"]`. `.gitignore` append `site/_site/` and `site/assets/tokens.css`. Run `npm install`.

- [ ] **Step 2: Write the failing test**

`site/lib/inventory.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { collectInventory } from "./inventory";

const root = join(__dirname, "..", "..");

describe("collectInventory", () => {
  it("lists every plugin directory with a manifest, with its logo inlined and a real tool count", async () => {
    const inv = await collectInventory(root);
    expect(inv.totals.integrations).toBeGreaterThanOrEqual(16);
    expect(inv.totals.tools).toBeGreaterThan(100);
    for (const i of inv.integrations) {
      expect(i.displayName.length).toBeGreaterThan(0);
      expect(i.logoSvg.startsWith("<svg")).toBe(true);
      expect(i.toolCount).toBeGreaterThan(0);
    }
    expect(inv.integrations.reduce((n, i) => n + i.toolCount, 0)).toBe(inv.totals.tools);
  }, 60_000);

  it("reads the meta-tool count from the server's definition, not a constant", async () => {
    const inv = await collectInventory(root);
    expect(inv.totals.metaTools).toBe(9);
  }, 60_000);

  it("never emits anything from the PII guard list", async () => {
    const inv = await collectInventory(root);
    expect(JSON.stringify(inv)).not.toMatch(/@(icloud|gmail)\.com/i);
  }, 60_000);
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w @a-workbench/site`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`site/lib/inventory.ts`:
```ts
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface IntegrationEntry { name: string; displayName: string; description: string; logoSvg: string; toolCount: number }
export interface Inventory { integrations: IntegrationEntry[]; totals: { integrations: number; tools: number; metaTools: number } }

// Same test the server's loader applies (packages/server/src/plugins/loader.ts
// isTool): a tool has a name, a handler function and a zod schema. Checking for
// `safeParse` avoids importing zod here and dodges dual-instance identity.
function isTool(v: unknown): boolean {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.name === "string" && typeof o.handler === "function" && typeof (o.inputSchema as { safeParse?: unknown })?.safeParse === "function";
}
function countTools(mod: Record<string, unknown>): number {
  const seen = new Set<string>();
  const visit = (c: unknown, depth = 0) => {
    if (typeof c !== "object" || c === null || depth > 2) return;
    for (const v of Object.values(c as Record<string, unknown>)) if (isTool(v)) seen.add((v as { name: string }).name);
    const o = c as Record<string, unknown>; visit(o.default, depth + 1); visit(o["module.exports"], depth + 1);
  };
  visit(mod);
  return seen.size;
}
const unwrap = (m: Record<string, unknown>) => (m.default && typeof m.default === "object" ? (m.default as Record<string, unknown>) : m);

export async function collectInventory(repoRoot: string): Promise<Inventory> {
  const pluginsDir = join(repoRoot, "packages", "plugins");
  const integrations: IntegrationEntry[] = [];
  for (const dir of readdirSync(pluginsDir).sort()) {
    const base = join(pluginsDir, dir);
    if (!existsSync(join(base, "manifest.ts"))) continue;
    const manifest = unwrap(await import(pathToFileURL(join(base, "manifest.ts")).href)) as { name: string; displayName?: string; description?: string; logo?: string };
    const tools = (await import(pathToFileURL(join(base, "tools", "index.ts")).href)) as Record<string, unknown>;
    const logoPath = manifest.logo && !/^https?:/.test(manifest.logo) ? join(base, manifest.logo) : undefined;
    if (!logoPath || !existsSync(logoPath)) throw new Error(`site: plugin "${dir}" has no bundled logo — every integration on the site needs one`);
    integrations.push({
      name: manifest.name, displayName: manifest.displayName ?? manifest.name, description: manifest.description ?? "",
      logoSvg: readFileSync(logoPath, "utf8").trim(), toolCount: countTools(tools),
    });
  }
  const metaSrc = readFileSync(join(repoRoot, "packages", "server", "src", "mcp", "meta-tools.ts"), "utf8");
  const metaBlock = metaSrc.slice(metaSrc.indexOf("export const metaTools = ["), metaSrc.indexOf("] as const", metaSrc.indexOf("export const metaTools")));
  const metaTools = (metaBlock.match(/^\s*name: "[a-z_]+",$/gm) ?? []).length;
  if (metaTools === 0) throw new Error("site: could not count meta-tools from packages/server/src/mcp/meta-tools.ts");
  return { integrations, totals: { integrations: integrations.length, tools: integrations.reduce((n, i) => n + i.toolCount, 0), metaTools } };
}
```
If the `] as const` anchor is not how `metaTools` closes in `meta-tools.ts`, open the file and use the exact closing text of that array literal in the `indexOf` (the `satisfies` comment above the array says it is a `satisfies` expression; the anchor is whatever follows the closing `]`).

- [ ] **Step 5: Run the tests**

Run: `npm test -w @a-workbench/site`
Expected: PASS (3 tests). If a tools module throws on import because it reaches for `process.env` at load, note the plugin in the commit message and guard that read in the plugin (a top-level env read in a tool module is a bug for the server too).

- [ ] **Step 6: Commit**

```bash
git add site package.json package-lock.json .gitignore
git commit -m "feat(site): inventory of integrations, logos and tool counts from the repo"
```

### Task 11: Page build — template, sections, hero, terminal replay

**Files:**
- Create: `site/build.ts`, `site/lib/template.ts`, `site/lib/template.test.ts`, `site/data/replay.json`, `site/assets/site.css`, `site/assets/site.js`
- Consumes: `collectInventory` (Task 10); `markSvg`, `LOCKUP`, `tokens` from `@a-workbench/brand`; `packages/brand/dist/*`; `packages/shared/styles/tokens.css`.

**Interfaces:**
- Produces: `renderPage(data: PageData): string` where
  ```ts
  interface PageData { inventory: Inventory; replay: ReplayStep[]; docsUrl: string; repoUrl: string; image: string; shots: { apps: string; connect: string; result: string } }
  interface ReplayStep { prompt?: string; call?: { tool: string; args: Record<string, unknown> }; result?: string }
  ```

- [ ] **Step 1: Replay transcript (synthetic)**

`site/data/replay.json`:
```json
[
  { "prompt": "Move every ticket in this sprint that's blocked to next sprint and tell the channel." },
  { "call": { "tool": "search_tools", "args": { "query": "jira sprint issues" } } },
  { "result": "jira_search_issues · jira_update_issue · jira_list_sprints (3 of 178)" },
  { "call": { "tool": "get_tool_schema", "args": { "name": "jira_search_issues" } } },
  { "result": "{ jql: string, fields?: string[], limit?: number }" },
  { "call": { "tool": "execute_tools", "args": { "calls": [
      { "tool": "jira_search_issues", "args": { "jql": "sprint in openSprints() AND status = Blocked", "fields": ["key", "summary"] } },
      { "tool": "slack_post_message", "args": { "channel": "#acme-eng", "text": "3 blocked tickets moved to next sprint: ACME-41, ACME-47, ACME-52" } }
  ] } } },
  { "result": "2 calls · 1.1s · 2 ok" }
]
```

- [ ] **Step 2: Write the failing template test**

`site/lib/template.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderPage } from "./template";

const data = {
  inventory: { integrations: [{ name: "github", displayName: "GitHub", description: "Code hosting", logoSvg: "<svg id='gh'></svg>", toolCount: 12 }], totals: { integrations: 1, tools: 12, metaTools: 9 } },
  replay: [{ prompt: "hello" }, { call: { tool: "search_tools", args: { query: "x" } } }, { result: "ok" }],
  docsUrl: "https://example.com/docs", repoUrl: "https://example.com/repo", image: "og-1200x630.png",
  shots: { apps: "shots/apps.png", connect: "shots/connect.png", result: "shots/result.png" },
};

describe("renderPage", () => {
  const html = renderPage(data);
  it("opens with the headline and the docker one-liner", () => {
    expect(html).toContain("One endpoint. Every tool your agent needs.");
    expect(html).toContain("docker run");
    expect(html).toContain('data-copy="docker run');
  });
  it("prints live counts, never typed numbers", () => {
    expect(html).toContain("1 integration");
    expect(html).toContain("12 tools");
    expect(html).toContain("9 meta-tools");
  });
  it("inlines every integration logo with its name", () => {
    expect(html).toContain("<svg id='gh'></svg>");
    expect(html).toContain("GitHub");
  });
  it("embeds the replay for the terminal script and the portal shots", () => {
    expect(html).toContain('id="replay-data"');
    expect(html).toContain("search_tools");
    expect(html).toContain('src="shots/apps.png"');
  });
  it("has exactly five sections in layout B order", () => {
    const ids = [...html.matchAll(/<section[^>]*id="([a-z-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["hero", "integrations", "demo", "pillars", "cta"]);
  });
  it("links docs and the repo, carries the OG image, and hosts a swarm canvas", () => {
    expect(html).toContain('href="https://example.com/docs"');
    expect(html).toContain('href="https://example.com/repo"');
    expect(html).toContain('property="og:image" content="og-1200x630.png"');
    expect(html).toContain('<canvas id="swarm"');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test -w @a-workbench/site -- template`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the template**

`site/lib/template.ts`:
```ts
import { markSvg, LOCKUP, tokens } from "@a-workbench/brand";
import type { Inventory } from "./inventory";

export interface ReplayStep { prompt?: string; call?: { tool: string; args: Record<string, unknown> }; result?: string }
export interface PageData { inventory: Inventory; replay: ReplayStep[]; docsUrl: string; repoUrl: string; image: string; shots: { apps: string; connect: string; result: string } }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const DOCKER = "docker run -p 3001:3001 -v workbench-data:/app/data ghcr.io/barockok/workbench";

export function renderPage(d: PageData): string {
  const { totals, integrations } = d.inventory;
  const counts = `${plural(totals.integrations, "integration")} · ${plural(totals.tools, "tool")} · ${totals.metaTools} meta-tools`;
  const lockup = `<a class="brand" href="/">${markSvg({ size: LOCKUP.standard.mark, surface: "var(--bg)" })}<span class="brand-name">${LOCKUP.name}</span></a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>workbench — one MCP endpoint for every tool your agent needs</title>
<meta name="description" content="Self-hosted MCP server. Per-user OAuth for ${counts}. Your tokens never leave your box.">
<meta property="og:title" content="workbench">
<meta property="og:description" content="One endpoint. Every tool your agent needs. Self-hosted, per-user OAuth, ${counts}.">
<meta property="og:image" content="${d.image}">
<meta property="og:type" content="website">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-180.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;700;800&family=JetBrains+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="tokens.css">
<link rel="stylesheet" href="site.css">
<script>(function(){try{var t=localStorage.getItem('wb-theme');if(t)document.documentElement.dataset.theme=t;}catch(e){}})();</script>
</head>
<body>
<header class="topbar">${lockup}<nav><a href="${esc(d.docsUrl)}">Docs</a><a href="${esc(d.repoUrl)}">GitHub</a></nav></header>

<section id="hero" class="hero">
  <canvas id="swarm" class="hero-canvas" aria-hidden="true"></canvas>
  <div class="hero-copy">
    <h1>One endpoint. Every tool your agent needs.</h1>
    <p class="lede">A self-hosted MCP server that holds a separate OAuth connection per user per provider and exposes ${counts} through a fixed set of nine. Your tokens never leave your box.</p>
    <div class="cta-row">
      <code class="cmd" data-copy="${esc(DOCKER)}"><span>${esc(DOCKER)}</span><button type="button" class="copy" aria-label="Copy command">Copy</button></code>
      <a class="button-secondary" href="${esc(d.docsUrl)}start/quickstart.html">Read the docs</a>
    </div>
  </div>
</section>

<section id="integrations" class="strip">
  <p class="strip-counts">${counts}</p>
  <ul class="logos">${integrations.map((i) => `<li title="${esc(i.displayName)} · ${plural(i.toolCount, "tool")}">${i.logoSvg}<span>${esc(i.displayName)}</span></li>`).join("")}</ul>
</section>

<section id="demo" class="demo">
  <div class="demo-col">
    <p class="eyebrow">For the agent</p>
    <h2>Three meta-tools, any integration.</h2>
    <div class="terminal" id="terminal" aria-live="polite"></div>
    <script id="replay-data" type="application/json">${JSON.stringify(d.replay).replace(/</g, "\\u003c")}</script>
  </div>
  <div class="demo-col">
    <p class="eyebrow">For you</p>
    <h2>Connect once. Revoke any time.</h2>
    <figure><img src="${esc(d.shots.apps)}" alt="The Apps page listing every integration with its tool count" loading="lazy"></figure>
    <figure><img src="${esc(d.shots.connect)}" alt="An agent asking for access to Google Sheets, with Approve and Cancel" loading="lazy"></figure>
    <figure><img src="${esc(d.shots.result)}" alt="Google Sheets connected — the success card with a link back to the dashboard" loading="lazy"></figure>
  </div>
</section>

<section id="pillars" class="pillars">
  <article><h3>Constant context</h3><p>The agent sees nine tools whether one integration is connected or all ${totals.integrations}. Everything else is reached by name.</p><a href="${esc(d.docsUrl)}start/concepts.html">How meta-tools work →</a></article>
  <article><h3>Per-user OAuth</h3><p>One token per person per provider, injected server-side. The agent never holds a credential.</p><a href="${esc(d.docsUrl)}start/how-it-works.html">The request path →</a></article>
  <article><h3>Yours to run</h3><p>SQLite or PostgreSQL, tokens encrypted at rest with AES-256-GCM, one container.</p><a href="${esc(d.docsUrl)}deploy/install.html">Deploy →</a></article>
</section>

<section id="cta" class="close">
  <h2>Your agent already knows what to do. Give it the tools.</h2>
  <code class="cmd" data-copy="${esc(DOCKER)}"><span>${esc(DOCKER)}</span><button type="button" class="copy" aria-label="Copy command">Copy</button></code>
  <p><a href="${esc(d.repoUrl)}">GitHub</a> · <a href="${esc(d.docsUrl)}">Documentation</a> · MIT</p>
</section>

<script type="module">
  import { createSwarm } from "./brand/index.js";
  const dark = document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  createSwarm(document.getElementById("swarm"), { ground: dark ? "dark" : "accent", markX: matchMedia("(max-width: 880px)").matches ? 0.5 : 0.66, ambient: !matchMedia("(max-width: 880px)").matches });
</script>
<script src="site.js" defer></script>
</body>
</html>`;
}
```
Note the accent used for the hero ground lives in CSS (`site.css`), reading `${tokens.accent}` is not needed here; the import of `tokens` is used by `build.ts` for the OG fallback only — if the linter flags it unused in this file, remove it from the import.

- [ ] **Step 5: Run template tests**

Run: `npm test -w @a-workbench/site -- template`
Expected: PASS (6 tests).

- [ ] **Step 6: Build script, CSS, JS**

`site/build.ts`:
```ts
import { mkdirSync, cpSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectInventory } from "./lib/inventory";
import { renderPage, type ReplayStep } from "./lib/template";

const here = dirname(fileURLToPath(import.meta.url)), root = join(here, ".."), out = join(here, "_site");
const brandDist = join(root, "packages", "brand", "dist");
if (!existsSync(join(brandDist, "index.js"))) throw new Error("site: build @a-workbench/brand first");

mkdirSync(join(out, "brand"), { recursive: true }); mkdirSync(join(out, "shots"), { recursive: true });
cpSync(brandDist, join(out, "brand"), { recursive: true });
for (const f of ["favicon.svg", "apple-touch-180.png", "og-1200x630.png"]) copyFileSync(join(brandDist, f), join(out, f));
copyFileSync(join(root, "packages", "shared", "styles", "tokens.css"), join(out, "tokens.css"));
for (const f of ["site.css", "site.js"]) copyFileSync(join(here, "assets", f), join(out, f));
for (const f of ["apps.png", "connect.png", "result.png"]) {
  const src = join(here, "assets", "shots", f);
  if (!existsSync(src)) throw new Error(`site: missing screenshot assets/shots/${f} — run \`npm run shots -w @a-workbench/site\``);
  copyFileSync(src, join(out, "shots", f));
}

const inventory = await collectInventory(root);
if (inventory.totals.integrations === 0 || inventory.totals.tools === 0 || inventory.totals.metaTools === 0) throw new Error("site: a count is zero");
const replay = JSON.parse(readFileSync(join(here, "data", "replay.json"), "utf8")) as ReplayStep[];
const html = renderPage({
  inventory, replay,
  docsUrl: process.env.SITE_DOCS_URL ?? "https://barockok.github.io/workbench/",
  repoUrl: "https://github.com/barockok/workbench",
  image: (process.env.URL ?? "") + "/og-1200x630.png",   // Netlify sets URL to the deploy's origin
  shots: { apps: "shots/apps.png", connect: "shots/connect.png", result: "shots/result.png" },
});
if (/@(icloud|gmail)\.com/i.test(html)) throw new Error("site: output matches the PII guard");
writeFileSync(join(out, "index.html"), html);
console.log(`site: ${inventory.totals.integrations} integrations, ${inventory.totals.tools} tools, ${inventory.totals.metaTools} meta-tools → _site/index.html`);
```

`site/assets/site.js`:
```js
// Copy buttons and the terminal replay. No framework; the page is one file.
for (const el of document.querySelectorAll("[data-copy] .copy")) {
  el.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(el.parentElement.dataset.copy); el.textContent = "Copied"; setTimeout(() => (el.textContent = "Copy"), 1600); } catch { el.textContent = "Select and copy"; }
  });
}
const term = document.getElementById("terminal"), steps = JSON.parse(document.getElementById("replay-data").textContent);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const line = (cls, text) => { const p = document.createElement("pre"); p.className = "t-" + cls; p.textContent = text; term.appendChild(p); return p; };
async function type(el, text, ms = 14) { if (reduced) { el.textContent = text; return; } for (const ch of text) { el.textContent += ch; await new Promise((r) => setTimeout(r, ms)); } }
async function run() {
  term.textContent = "";
  for (const s of steps) {
    if (s.prompt) await type(line("prompt", ""), "› " + s.prompt, 18);
    else if (s.call) await type(line("call", ""), `${s.call.tool}(${JSON.stringify(s.call.args, null, 1).replace(/\n\s*/g, " ")})`, 6);
    else if (s.result) { line("result", "← " + s.result); }
    await new Promise((r) => setTimeout(r, reduced ? 0 : 500));
  }
  if (!reduced) setTimeout(run, 6000);
}
new IntersectionObserver((e, o) => { if (e[0].isIntersecting) { run(); o.disconnect(); } }).observe(term);
```

`site/assets/site.css` — tokens come from `tokens.css`; this file is layout and the hero ground only:
```css
body { margin: 0; background: var(--bg); color: var(--text); font-family: Inter, -apple-system, system-ui, sans-serif; line-height: 1.5; }
a { color: inherit; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 16px 24px; max-width: 1200px; margin: 0 auto; }
.brand { display: inline-flex; align-items: center; gap: 8px; text-decoration: none; color: var(--accent); }
.brand-name { font-weight: 700; font-size: 16px; letter-spacing: -.01em; color: var(--text); }
.topbar nav { display: flex; gap: 20px; font-weight: 500; }
.hero { position: relative; overflow: hidden; min-height: 78vh; display: flex; align-items: flex-end; background: #4a1552; color: #fff; }
:root[data-theme="dark"] .hero { background: #07090e; color: #e8eaed; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .hero { background: #07090e; color: #e8eaed; } }
.hero-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.hero-copy { position: relative; z-index: 1; max-width: 1200px; width: 100%; margin: 0 auto; padding: 0 24px 72px; }
.hero h1 { font-size: clamp(34px, 5.2vw, 64px); font-weight: 800; letter-spacing: -.03em; line-height: 1.02; max-width: 12ch; margin: 0 0 16px; text-wrap: balance; }
.lede { font-size: 17px; max-width: 52ch; opacity: .85; margin: 0 0 28px; }
.cta-row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
.cmd { display: inline-flex; align-items: center; gap: 12px; font-family: "JetBrains Mono", ui-monospace, Menlo, monospace; font-size: 13px; background: rgba(0,0,0,.35); border: 1px solid rgba(255,255,255,.18); border-radius: 6px; padding: 10px 12px; }
.copy { font: inherit; background: #fff; color: #4a1552; border: 0; border-radius: 4px; padding: 4px 10px; cursor: pointer; }
.button-secondary { display: inline-block; padding: 10px 16px; border: 1px solid rgba(255,255,255,.4); border-radius: 6px; text-decoration: none; font-weight: 600; }
.strip { max-width: 1200px; margin: 0 auto; padding: 40px 24px 8px; }
.strip-counts { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: var(--text-3); margin: 0 0 18px; }
.logos { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 10px; }
.logos li { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; font-weight: 500; }
.logos svg { width: 22px; height: 22px; flex: none; }
.demo, .pillars { max-width: 1200px; margin: 0 auto; padding: 56px 24px; display: grid; gap: 32px; }
.demo { grid-template-columns: 1fr 1fr; }
.eyebrow { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--text-3); margin: 0 0 8px; }
.demo h2, .pillars h3 { letter-spacing: -.02em; margin: 0 0 16px; }
.terminal { background: var(--code-bg); color: #e8eaed; border-radius: 6px; padding: 16px; min-height: 260px; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 12.5px; overflow-x: auto; }
.terminal pre { margin: 0 0 8px; white-space: pre-wrap; }
.t-prompt { color: #fff; } .t-call { color: #e5b8ef; } .t-result { color: #a2abb8; }
.demo figure { margin: 0 0 14px; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
.demo img { display: block; width: 100%; height: auto; }
.pillars { grid-template-columns: repeat(3, 1fr); }
.pillars article { border-top: 2px solid var(--accent); padding-top: 14px; }
.pillars p { color: var(--text-2); }
.close { text-align: center; padding: 72px 24px 96px; background: var(--bg-sunk); }
.close h2 { font-size: clamp(24px, 3.4vw, 40px); letter-spacing: -.025em; max-width: 22ch; margin: 0 auto 24px; text-wrap: balance; }
.close .cmd { background: var(--code-bg); color: #e8eaed; border-color: transparent; }
.close .copy { background: var(--accent); color: #fff; }
@media (max-width: 880px) { .demo, .pillars { grid-template-columns: 1fr; } .hero { min-height: 70vh; } }
```

- [ ] **Step 7: Build locally**

Screenshots do not exist yet, so for this step create three placeholder files only to check the pipeline and delete them before committing: `mkdir -p site/assets/shots && for f in apps connect result; do cp packages/brand/dist/og-1200x630.png site/assets/shots/$f.png; done`. Then:
Run: `npm run build -w @a-workbench/brand && npm run build -w @a-workbench/site && npx serve site/_site` (or `python3 -m http.server -d site/_site 8080`)
Expected: page renders; hero swarm plays; counts show real numbers; terminal replay types. Then `rm site/assets/shots/*.png`.

- [ ] **Step 8: Commit**

```bash
git add site
git commit -m "feat(site): landing page build — hero, integration strip, demo split, pillars, close"
```

### Task 12: Portal screenshots via mocked API

**Files:**
- Create: `site/scripts/shots.mjs`, `site/scripts/fixtures/me.json`, `site/scripts/fixtures/connections.json`
- Consumes: the portal dev server (`npm run dev -w @a-workbench/portal`), `collectInventory` output for `/api/integrations`.

- [ ] **Step 1: Fixtures (synthetic only)**

`site/scripts/fixtures/me.json`:
```json
{ "id": "user-1", "email": "dev@example.com", "name": "Test User", "provider": "google" }
```
`site/scripts/fixtures/connections.json`:
```json
{ "connections": [ { "integration": "github", "connectedAt": "2026-09-01T09:00:00.000Z" }, { "integration": "slack", "connectedAt": "2026-09-01T09:05:00.000Z" } ] }
```
Before writing these, open `packages/portal/src/api.ts` and match the exact response shapes of `fetchMe`, `fetchConnections`, and `fetchIntegrations` (`IntegrationSummary[]` at lines 54–68). Adjust the field names above to what the portal reads; keep the values synthetic.

- [ ] **Step 2: Script**

`site/scripts/shots.mjs`:
```js
// Captures the three portal screenshots for the landing page against the portal
// dev server with every /api call mocked, so no login and no real data.
// Usage: (in one shell) npm run dev -w @a-workbench/portal ; (in another) npm run shots -w @a-workbench/site
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { collectInventory } from "../lib/inventory.ts";

const here = dirname(fileURLToPath(import.meta.url)), out = join(here, "..", "assets", "shots"), root = join(here, "..", "..");
mkdirSync(out, { recursive: true });
const fx = (f) => JSON.parse(readFileSync(join(here, "fixtures", f), "utf8"));
const inv = await collectInventory(root);
const integrations = inv.integrations.map((i) => ({ name: i.name, version: "1.0.0", displayName: i.displayName, description: i.description, logo: "logo.svg", toolCount: i.toolCount, configured: true, authType: "oauth2" }));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.addInitScript(() => localStorage.setItem("awb_token", "tok-abc"));
await page.route("**/api/**", async (route) => {
  const url = new URL(route.request().url()), p = url.pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  if (p === "/api/auth/me") return json(fx("me.json"));
  if (p === "/api/integrations") return json(integrations);
  if (p.startsWith("/api/integrations/") && p.endsWith("/logo")) {
    const name = p.split("/")[3]; const i = inv.integrations.find((x) => x.name === name);
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: i?.logoSvg ?? "" });
  }
  if (p === "/api/connections") return json(fx("connections.json"));
  if (p === "/api/stats") return json({ calls24h: 128, connections: 2, agents: 1 });
  if (p === "/api/agents") return json({ agents: [] });
  if (p === "/api/activity") return json({ items: [] });
  return json({}, 200);
});
const base = process.env.PORTAL_URL ?? "http://localhost:3000";
await page.goto(`${base}/apps`); await page.waitForSelector("text=GitHub"); await page.waitForTimeout(400);
await page.screenshot({ path: join(out, "apps.png") });
await page.goto(`${base}/authorize/choose?integration=google-sheets&agent=Claude%20Code`); await page.waitForTimeout(600);
await page.screenshot({ path: join(out, "connect.png") });
await page.goto(`${base}/connected/google-sheets?status=ok`); await page.waitForTimeout(600);
await page.screenshot({ path: join(out, "result.png") });
await browser.close();
console.log("site: wrote apps.png connect.png result.png to assets/shots/");
```
Open `packages/portal/src/App.tsx` (or the router file) and confirm the paths for the Apps page, the agent-approval page (`AuthorizeChoose`) and the result page (`ConnectResult`), plus the query parameters they read; correct the three `goto` URLs to match. `/api/stats`, `/api/agents`, `/api/activity` shapes: match what the corresponding pages destructure (search the page for `data.`).

- [ ] **Step 3: Capture**

Run (two shells): `npm run dev -w @a-workbench/portal` then `npm run shots -w @a-workbench/site`.
Expected: three PNGs in `site/assets/shots/`, each showing synthetic data only (`Test User`, `dev@example.com`). Open each and check before committing.

- [ ] **Step 4: Build the site with real shots and commit**

Run: `npm run build -w @a-workbench/site`
Expected: succeeds without the placeholder step.
```bash
git add site/scripts site/assets/shots
git commit -m "feat(site): portal screenshots captured against a mocked API"
```

### Task 13: Netlify config and CI

**Files:**
- Create: `netlify.toml`
- Modify: `.github/workflows/ci.yml` (site build + tests in the matrix job), `docs/site/build.mjs` (topbar link to the site)

- [ ] **Step 1: `netlify.toml`**

```toml
[build]
  base    = "."
  command = "npm ci && npx playwright install chromium && npm run build -w @a-workbench/shared -w @a-workbench/brand && npm run build -w @a-workbench/site"
  publish = "site/_site"

[build.environment]
  NODE_VERSION = "22"

[[headers]]
  for = "/*"
  [headers.values]
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
```

- [ ] **Step 2: CI**

`.github/workflows/ci.yml` — after the `Build the docs site` step add:
```yaml
      - name: Build the landing site
        run: npm run build -w @a-workbench/site

      - name: Landing site tests
        run: npm test -w @a-workbench/site
```

- [ ] **Step 3: Docs topbar links to the site**

`docs/site/build.mjs` — in the `topbar-actions` block (around line 377) add a link before the existing actions:
```js
    <a class="topbar-link" href="${SITE.marketing}">Home</a>
```
and in `docs/site/nav.json` `site` object add `"marketing": "https://workbench.netlify.app"` (replace with the actual Netlify subdomain once the site is created; note it in the PR).

- [ ] **Step 4: Run CI locally and commit**

Run: `npm run build && npm test -w @a-workbench/site && node docs/site/build.mjs`
Expected: all succeed.
```bash
git add netlify.toml .github/workflows/ci.yml docs/site/build.mjs docs/site/nav.json
git commit -m "chore(site): Netlify build config, CI job, docs link"
gh pr create --base main --title "feat(site): landing page on Netlify" --body "Static landing site in site/ (layout B): swarm hero with the docker one-liner, integration strip and counts from the plugin registry at build time, agent/you split with a typed replay and mocked-API portal screenshots, three pillars, close. Netlify builds from netlify.toml; CI builds and tests it."
```
Then, on Netlify: New site → import the GitHub repo → it reads `netlify.toml`; enable deploy previews. Paste the preview URL into the PR.

---

# PR 5 — docs and README sweep

Branch: `git checkout -b docs-brand main` after PR 1 merges (does not depend on 2–4).

### Task 14: Docs use the brand package; README header; leftovers removed

**Files:**
- Modify: `docs/site/build.mjs:352,368-371,444`, `docs/site/nav.json` (remove `mark`, `favicon`), `docs/site/assets/docs.css:98-107`, `README.md:1-8`, `.github/workflows/pages.yml`
- Create: `docs/site/test/brand.test.mjs`

**Interfaces:**
- Consumes: `packages/brand/dist/index.js` (`markSvg`), `packages/brand/dist/favicon.svg`, `og-1200x630.png`.

- [ ] **Step 1: Write the failing test**

`docs/site/test/brand.test.mjs` (run with `node --test`):
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)), site = join(here, ".."), out = join(site, "_site");
execFileSync("node", [join(site, "build.mjs")], { stdio: "inherit" });
const html = readFileSync(join(out, "index.html"), "utf8");

test("favicon is a file copied from the brand package, not a data URL", () => {
  assert.match(html, /<link rel="icon" href="[^"]*favicon\.svg" type="image\/svg\+xml">/);
  assert.ok(existsSync(join(out, "assets", "favicon.svg")));
  assert.doesNotMatch(html, /data:image\/svg\+xml/);
});
test("topbar mark is the Node W", () => {
  assert.match(html, /class="brand-mark"[^>]*>\s*<svg[^>]*>.*M5 8 L10 24 L16 12 L22 24 L27 8/s);
  assert.doesNotMatch(html, /class="brand-mark"[^>]*>w</);
});
test("pages carry the OG image", () => {
  assert.match(html, /<meta property="og:image" content="[^"]*og-1200x630\.png">/);
});
```
Add to the root `package.json` scripts: `"test:docs": "node --test docs/site/test/"`. The docs build needs `packages/brand/dist` — it is built by `npm run build`.

- [ ] **Step 2: Run to verify it fails**

Run: `npm run build -w @a-workbench/brand && npm run test:docs`
Expected: FAIL on all three.

- [ ] **Step 3: Modify `build.mjs`**

Near the top of `docs/site/build.mjs` (after the existing imports):
```js
import { pathToFileURL } from 'node:url';
const BRAND_DIST = join(ROOT, '..', '..', 'packages', 'brand', 'dist');
const { markSvg } = await import(pathToFileURL(join(BRAND_DIST, 'index.js')).href);
```
Line 352 `<link rel="icon" …>` becomes:
```js
<link rel="icon" href="${A}favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="${A}apple-touch-180.png">
<meta property="og:image" content="${A}og-1200x630.png">
```
Lines 369–370 (`brand-mark` span with `SITE.mark`) become:
```js
      <span class="brand-mark">${markSvg({ size: 24, surface: 'var(--surface)' })}</span>
```
Line 444 (the `cpSync` of tokens.css) — add after it:
```js
for (const f of ['favicon.svg', 'apple-touch-180.png', 'og-1200x630.png']) cpSync(join(BRAND_DIST, f), join(ROOT, 'assets', f));
```
and ensure the assets copy step that produces `_site/assets/` includes those files (it copies the whole `assets/` directory — verify with `ls docs/site/_site/assets` after a build). Add `docs/site/assets/favicon.svg`, `docs/site/assets/apple-touch-180.png`, `docs/site/assets/og-1200x630.png` to `.gitignore` under the existing "Generated copy" comment.

`docs/site/nav.json`: delete the `"mark"` and `"favicon"` keys from `site`.

`docs/site/assets/docs.css` lines 98–107 (`.brand-mark { … }`) become:
```css
.brand-mark { display: inline-flex; width: 24px; height: 24px; color: var(--accent); line-height: 0; transform: translateY(2px); }
.brand-mark svg { width: 100%; height: 100%; display: block; }
```

`.github/workflows/pages.yml` — before `node docs/site/build.mjs` add:
```yaml
      - run: npx playwright install --with-deps chromium
      - run: npm run build -w @a-workbench/shared -w @a-workbench/brand
```

- [ ] **Step 4: Run the docs tests**

Run: `npm run test:docs`
Expected: PASS (3 tests).

- [ ] **Step 5: README**

`packages/brand/dist` is gitignored, so GitHub cannot render from it. Append to the end of `packages/brand/build.mjs` (before the PNG section) a copy of the two lockups into a committed folder:
```js
const readmeDir = join(here, "..", "..", "docs", "assets", "brand");
mkdirSync(readmeDir, { recursive: true });
for (const f of ["lockup-light.svg", "lockup-dark.svg"]) writeFileSync(join(readmeDir, f), files[f]);
```
Run `npm run build -w @a-workbench/brand`, then replace `README.md` lines 1–4 with:
```markdown
<div align="center">

<img src="docs/assets/brand/lockup-light.svg#gh-light-mode-only" alt="workbench" height="40">
<img src="docs/assets/brand/lockup-dark.svg#gh-dark-mode-only" alt="workbench" height="40">

**Self-hosted MCP tool aggregator.** One endpoint, per-user OAuth, 178 tools across 16 integrations — behind 9 meta-tools.

[**Website**](https://workbench.netlify.app) ·
```
(keep the existing Documentation/Quickstart/… links after it). Commit `docs/assets/brand/*.svg`.

- [ ] **Step 6: Grep for leftovers**

Run: `grep -rn "font-size: 19\|text-anchor='middle'\|>w<" --include=*.json --include=*.mjs --include=*.html --include=*.css --include=*.tsx packages docs site | grep -v node_modules | grep -v _site`
Expected: no output. Any hit is a leftover of the letter tile — remove it.

- [ ] **Step 7: Commit and open PR 5**

```bash
git add docs README.md .gitignore .github/workflows/pages.yml packages/brand/build.mjs package.json docs/assets/brand
git commit -m "docs: Node W mark in the docs topbar, favicon and README; drop the letter tile"
gh pr create --base main --title "docs: brand sweep" --body "Docs site renders the mark from @a-workbench/brand and copies favicon/OG from its dist; README header uses the committed lockups; the nav.json favicon field and the encodeURIComponent path are gone."
```

---

## Done means (from the spec)

- [ ] `npm test` green across workspaces on Node 22 and 26 (CI).
- [ ] `packages/brand/dist` has all nine files after `npm run build`.
- [ ] `npm run blip-check -w @a-workbench/brand` exits 0.
- [ ] Login hero at 60 fps locally on both themes; narrow layout centres the mark.
- [ ] Netlify preview live, reviewed on desktop and phone; counts match `packages/plugins`.
- [ ] Docs and README show the new mark; `grep` in Task 14 step 6 is clean.
