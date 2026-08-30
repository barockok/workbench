# Screenshot Token Economy — Design

**Date:** 2026-06-08
**Status:** Approved
**Builds on:** Remote browser tools (`docs/superpowers/specs/2026-06-08-remote-browser-tools-design.md`)

## Goal

Cut the model-vision token cost of the `browser_*` computer-use tools without removing the model's ability to see. Four additive changes.

## Key fact

Claude charges image tokens by **decoded pixel dimensions** (≈ `w*h/750`), not by byte size. So:
- **Downscaling resolution** cuts tokens (fewer pixels).
- **JPEG/quality** cuts wire+base64 bytes only — secondary, not a token lever.

## The four changes

### 1. Downscale + JPEG screenshots
`browser_screenshot` gains optional args `{ format?: "jpeg"|"png" (default "jpeg"), quality?: number (default 60, jpeg only), maxWidth?: number (default 1000) }`.

Implementation in `screenshot(s, opts)`:
- `Page.getLayoutMetrics` → read the CSS layout viewport width/height (`cssLayoutViewport.clientWidth/clientHeight`, fall back to `layoutViewport`).
- `scale = min(1, maxWidth / viewportWidth)` — never upscale.
- `Page.captureScreenshot { format, quality (jpeg only), clip: { x:0, y:0, width: vw, height: vh, scale } }`.
- Returns base64 in the chosen format; mimeType `image/jpeg` or `image/png`.

`clip.scale` shrinks the output pixel dimensions, which is what actually reduces image tokens. Default 1000px wide JPEG is the cheap default; a caller wanting detail passes `maxWidth: 1280` or `format:"png"`.

### 2. Change-detection (skip identical pixels)
The model often re-screenshots an unchanged page (failed click, still-loading). Catch it server-side.

- `WarmSession` gains `lastShotHash?: string`.
- In `screenshot`, after capture: `hash = sha256(base64Data)`.
- If `hash === s.lastShotHash` → return the sentinel-free object `{ unchanged: true }` (a few text tokens, **no image block**).
- Else set `s.lastShotHash = hash` and return `{ _mcpImage: { data, mimeType } }`.

Exact-byte hash is safe: identical downscaled JPEG input → identical bytes → same hash. A changed page differs. The meta-tool returns whatever `screenshot` returns (image sentinel OR `{unchanged:true}` text) — the MCP server already routes `_mcpImage` to an image block and everything else to text, so no server change needed.

Note: `browser_navigate`/`browser_click` etc. do not reset `lastShotHash`; they don't need to — the next screenshot's bytes differ whenever the page actually changed, and match when it didn't. That's the whole point.

### 3. Tool-description guidance (soft)
Reword tool descriptions so the model self-limits:
- `browser_screenshot`: note it costs vision tokens; call it only when the page likely changed and you must see it; after a click/type, act on what you already saw unless the outcome is uncertain. Also document `maxWidth`/`format` and the `unchanged:true` response.
- `browser_read_text` (new, item 4): described as the cheap way to read text-heavy pages without a screenshot.

No behavior change — description text only.

### 4. `browser_read_text` tool (cheaper alternative)
A text-extraction tool so the model reads instead of seeing for text/form tasks.

- Helper `readText(s, maxChars = 20000)`: `Runtime.evaluate { expression: "document.body.innerText", returnByValue: true }` → string, truncated to `maxChars` (note truncation in the return).
- Meta-tool `browser_read_text` input `{ maxChars?: number (default 20000) }`, returns `{ text, truncated: boolean }` (plain text → cheap).
- `innerText` (not `textContent`) gives visible, layout-aware text — good enough for v1. Accessibility-tree extraction is a later refinement if needed.

## Out of scope (decided)
- **Hosted screenshot URL** — dropped. A URL the model can't see doesn't help model vision, and the human already has the zero-token live-view (`browser_live_url`). Not building it.

## Testing
- `screenshot` downscale: mock `Page.getLayoutMetrics` (viewport 2000 wide) + `captureScreenshot`; assert `clip.scale === 0.5` for `maxWidth:1000`, format/quality passed through, never upscales (viewport 800 → scale 1).
- change-detection: two captures returning identical `data` → first returns `_mcpImage`, second returns `{unchanged:true}`; different `data` → both image.
- `readText`: returns `document.body.innerText` value; truncates past `maxChars` and flags `truncated:true`.
- meta-tools: `browser_read_text` returns `{text,truncated}`; `browser_screenshot` forwards opts.
- Full server suite stays green.
