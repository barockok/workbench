# Brand mark, animated hero, and landing site

**Date:** 2026-09-06
**Status:** approved design, ready for implementation planning

## Summary

workbench gets a real mark to replace the placeholder letter tile, a shared
package that owns that mark and an animated "swarm" hero built from it, a login
hero that uses the swarm, and a separate marketing site on Netlify that sits in
front of the documentation. Composio's homepage is the structural reference for
the site; Eliza Research's particle entrance and Dala's outlined-shape field are
the references for the hero.

Order of work: brand package → swarm engine → login hero → site → docs and
README sweep. Each is its own PR off `main`.

## Decisions already made

| Question | Decision |
|---|---|
| Mark direction | Hybrid: reads as a "w", carries meaning. **Node W**: a wire between five nodes; four hollow endpoint shapes are tools, one filled centre node is the endpoint. |
| Endpoint shapes | Four distinct shapes: circle, square, triangle, diamond. Hollow (outlined), not filled. |
| Weights | Wire 4.2, node outlines 1.8, hub filled r3.7, in a 32-unit viewBox. |
| Small size | At ≤20px the nodes collapse: wire + hub only. |
| Colour | Existing accent token family (`#853291` light, `#c98ad2` dark). Works reversed (white on accent) and as a knockout tile. |
| Landing home | Separate site, Netlify, default `*.netlify.app` until a domain is named. Static build, no framework. |
| Landing CTA | Run it: the docker one-liner in the hero; secondary "Read the docs". |
| Landing structure | Layout **B, compact**: hero, integration strip, agent/you split, three pillars, closing CTA. |
| Login hero | The swarm, with copy unchanged. |
| Hero treatment | Outlined shapes (Dala), rigid 3D slab, Eliza lane-orbit entrance, ambient field at two scales, purple spread plus one amber step. Ground near-black on dark theme, deep accent on light. |
| Asset home | `packages/brand` workspace consumed by portal, docs, and site. |

## 1. Brand package — `packages/brand`

Source of truth for the mark. No React dependency so the docs build (plain
node) and the site can import it.

### Files

- `src/mark.ts` — geometry as data and one renderer.
  - `MARK`: wire path `M5 8 L10 24 L16 12 L22 24 L27 8`; nodes
    circle (5,8) r3 · square (24,5) 6×6 rx0.9 · triangle (10,20.4)(13.3,26.8)(6.7,26.8)
    · diamond (22,20.2)(25.8,24)(22,27.8)(18.2,24); hub circle (16,12) r3.7;
    strokes wire 4.2 / nodes 1.8; caps and joins round.
  - `markSvg({ color, surface, variant })` → SVG string.
    `variant`: `full` (nodes + hub), `small` (wire + hub), `knockout`
    (accent rounded square, white mark). `surface` fills the hollow nodes so
    the wire visibly stops at each shape's edge.
- `src/wordmark.ts` — lockup constants: mark/wordmark size ratio, gap, the
  compact scale used beside navigation.
- `src/swarm.ts` — hero engine (section 2).
- `src/tokens.ts` — the accent family and the two hero palettes, exported so a
  token change flows through.
- `build.mjs` — writes `dist/`:
  `mark.svg`, `mark-small.svg`, `mark-knockout.svg`, `favicon.svg`,
  `favicon-32.png`, `apple-touch-180.png`, `og-1200x630.png` (mark + wordmark
  on accent), `lockup-light.svg`, `lockup-dark.svg`. PNGs rendered by the
  Playwright already in the repo from a throwaway HTML page. Runs in `prepare`
  and in CI.
- `scripts/blip-check.mjs` — opens a page hosting the swarm, samples painted
  canvas coverage every 100 ms across the entrance hand-off, fails if coverage
  dips more than 15 % between adjacent samples after 3.5 s.

### Exports

`@workbench/brand` → `{ MARK, markSvg, LOCKUP, createSwarm, tokens }`.
Static files via `@workbench/brand/dist/*`.

### Consumers

- Portal `BrandMark.tsx` inlines `markSvg()`; the letter-tile CSS is deleted.
- Docs build copies `dist/favicon.svg`; the `nav.json` `favicon` field and the
  `encodeURIComponent` path in `docs/site/build.mjs` are removed.
- Site copies `dist/*` at build.

## 2. Swarm engine — `packages/brand/src/swarm.ts`

Framework-free, one `<canvas>`, 2D context. The approved prototype is
`docs/superpowers/specs/2026-09-06-brand-hero-prototype.html`; the engine is
that file's script, modularised, with the behaviour below preserved exactly.

### API

```ts
createSwarm(canvas: HTMLCanvasElement, opts?: {
  ground?: 'dark' | 'accent';   // palette; the host paints the background
  markX?: number;               // mark centre as a fraction of width, default 0.66
  markFrac?: number;            // mark size as a fraction of min(W,H), default 0.86
  ambient?: boolean;            // default true
}): { destroy(): void; setGround(g): void; replay(): void }
```

Pointer listeners attach to the canvas's parent; the canvas itself has
`pointer-events: none` so copy stays clickable.

### Behaviour

- **Sampling.** The mark is drawn to an offscreen canvas at `markFrac`; points
  are Poisson-sampled from opaque white pixels with gap 3.4 px (rim: 0.62×).
  A point is *rim* if any of its four 2.5 px neighbours is outside the mask.
  Each point takes the shape of its nearest node when within 20 units², else
  a random one of the four. Particles are stroked, never filled.
- **Rigid slab.** Every target has `(tx, ty, tz)`, `tz` random within 16 % of
  the mark size, read as a thick 3D object: rim points draw from the full
  ±THICK/2 range so the silhouette's edges carry the depth (they form the
  side walls), body points from a shallower ±THICK/4 range so the face stays
  a dense core. The whole cloud yaws (±0.6 rad × pointer x) and pitches
  (±0.4 rad × pointer y) with the eased pointer (0.09), plus a slow idle
  pose, and projects through a camera at 1.7 × min(W,H). A coherent
  position-phased ripple (0.9 px) replaces any per-particle drift. Local
  push: radius 100, 24 px, eased 0.14, returns. Depth shading: each mark
  particle's projected scale (near → larger) maps to a 0.75–1.35× size
  multiplier and a 0.55–1.0× alpha multiplier (far to near, clamped ≤1), on
  top of the existing rim/body alpha — near dots read larger and brighter
  than far ones, drawn far-to-near. At the full turn the mark's four node
  shapes stay identifiable at a glance.
- **Entrance (Eliza).** 12 lanes, 4200 ms, 900 ms stagger. Particles start on a
  ring 0.55–1.05 × max(W,H) out with a random z, and each lane makes one full
  orbit (yaw 2π, tilt 0.24, roll ±0.28, perspective clamped 0.68–1.55) while
  smootherstep-blending onto the target. Dots grow into place
  (`0.64 + settle × 0.36`); there is no alpha ramp.
- **Hand-off.** Fade clocks start pre-armed (`age = FADE`) and the idle
  yaw/pitch/ripple blend in over 1200 ms, so coverage is flat across the
  hand-off (verified: 10108 → 10125 → 10164 sampled every 100 ms).
- **Idle.** Dots live 60–300 frames, fade out over 70, re-seed onto a random
  *fixed* target, fade in. Shapes tumble on their own axis (in-plane spin plus
  a foreshortening flip). Breathe ±2 %.
- **Ambient.** Big shapes: ~W/32 of them, 22–106 px, glow 14, strongest
  parallax (up to 48 px), one in three amber. Tiny: ~W·H/6500, 2.5–6.5 px.
  Both ride the lanes in from the ring, then drift upward and wrap.
- **Palette.** Index 0–1 rim (white, pale lavender), 2–6 purple spread
  (`#e5b8ef #c98ad2 #ff8de6 #a45bb0 #853291`), 7 amber (`#ffb340` dark,
  `#ffc36b` accent). Rim dots draw at 0.95 alpha with 1.3 px line, body at
  0.6 / 1 px, sorted far-to-near.
- **Respect.** `prefers-reduced-motion`: static posed frame, no loop.
  `visibilitychange` pauses. DPR capped at 2. Counts scale with area; touch
  halves the mark count and only pushes while pressed; scroll cancels.
- **Budget.** 60 fps on an M-series laptop at 1440×900. If 30 consecutive
  frames exceed 20 ms, ambient glow (`shadowBlur`) is dropped for the session.

### Tests

vitest with jsdom and a minimal 2D-context stub: sampled points lie inside the
mask; rim points are within 2.5 px of an edge; every lane's ease reaches 1 by
`ENTER_MS`; pose is identity at hand-off; re-seeded particles land on a target;
`destroy()` removes listeners and cancels the frame.

## 3. Login hero — portal

- `Login.tsx` aside hosts a `<canvas>` behind the existing copy via a
  `useSwarm(ref, { ground })` hook (effect + cleanup). Ground follows the
  theme: `dark` on dark, `accent` on light.
- `.login-art` is the positioned host; canvas absolute; copy above; mark right
  of centre. Below the two-column breakpoint the aside stacks above the form
  with the mark centred and ambient off.
- Copy unchanged. `BrandLockup compact` renders the Node W so the animated
  mark and the static lockup share geometry.
- Connect, ConnectResult and AuthorizeChoose keep the static lockup; no swarm.
- Tests: aside contains a canvas; hook calls `destroy` on unmount;
  reduced-motion mounts without starting a loop.

## 4. Landing site — `site/`, Netlify

Static, no framework. `site/build.mjs` renders `site/index.html` from a
template plus data and writes `site/_site/`.

### Sections (layout B)

1. **Hero.** Swarm (mark at right, ambient on). Headline
   *One endpoint. Every tool your agent needs.* Subhead: self-hosted MCP
   server, per-user OAuth, live counts. CTA: docker one-liner with a copy
   button; secondary *Read the docs*.
2. **Integration strip.** Every integration's icon and name from the plugin
   manifests, with *N integrations · N tools · 9 meta-tools*.
3. **For the agent / for you.** Left: a typed terminal replay of
   `search_tools → get_tool_schema → execute_tools` running Jira and Slack in
   one call, driven by `site/data/replay.json` (real tool names and payload
   shapes, synthetic values only). Right: portal screenshots — Apps page with
   tool counts, connect flow, connected-result card — from
   `site/assets/`, captured by `npm run site:shots` (Playwright) against a
   local instance seeded with synthetic data.
4. **Three pillars.** Constant context (9 tools whether 1 or 16 connected);
   per-user OAuth (one token per person per provider); yours to run (SQLite
   or Postgres, AES-256-GCM at rest). Each links into the docs.
5. **Close.** The one-liner again, GitHub, docs.

### Build

- Imports the plugin registry from `packages/server` at build time for names,
  icons and counts, so nothing on the page can go stale.
- Copies `packages/brand/dist/*` and the portal's token block from
  `styles.css` so the three surfaces share one palette without a runtime
  dependency.
- Theme-aware (system, plus explicit `data-theme` stamp). Inter and JetBrains
  Mono from Google Fonts with system fallbacks. No third-party scripts, no
  analytics.
- Fails if any count is zero, any integration lacks an icon, or the HTML
  matches the repo's PII guard pattern.

### Netlify

`netlify.toml` at repo root:

```toml
[build]
  base    = "."
  command = "npm ci && npm run build -w packages/brand && node site/build.mjs"
  publish = "site/_site"
```

Deploy previews on PRs. Docs topbar brand links to the site; site links to
docs and GitHub.

## 5. Rollout and scope

- **Docs and README.** Docs topbar uses the brand lockup; favicon from `dist/`;
  README header gets the mark and wordmark (PNG for GitHub) and a link to the
  site; OG image in both `<head>`s.
- **Removed.** Letter-tile `.brand-mark` CSS, the `w` glyph favicon, the
  `nav.json` favicon field.
- **Repo rules.** Synthetic fixtures only (`acme`, `Test User`,
  `dev@example.com`); no AI co-author trailers; `.superpowers/` ignored.
- **Out of scope.** A bloom pass for the swarm (follow-up); custom domain and
  DNS; the four sections dropped from layout A (diagram, plugin authoring,
  security, developer features); app-shell nav changes beyond the mark swap.

### Done means

- `npm test` green across workspaces on Node 22 and 26.
- `packages/brand/dist` contains every file listed in section 1.
- Login hero holds 60 fps locally; `blip-check.mjs` passes.
- Netlify preview live, reviewed on desktop and phone.
- Docs and README show the new mark; old tile gone.

## References

- Prototype (approved v8): `docs/superpowers/specs/2026-09-06-brand-hero-prototype.html`
- Structure reference: composio.dev homepage
- Entrance reference: elizaresearch.ai (canvas, lane orbit)
- Shape-field reference: dala.craftedbygc.com (outlined instanced shapes, rim, ambient)
