# Screenshot Token Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Cut model-vision token cost of the browser tools: downscale+JPEG screenshots, server-side change-detection, a text-read tool, and prompt guidance.

**Architecture:** All server-side, additive to `browser-session.ts` (helpers) and `meta-tools.ts` (tool surface). No portal/route changes.

**Spec:** `docs/superpowers/specs/2026-06-08-screenshot-token-economy-design.md`

---

## Task 1: Downscale + JPEG + change-detection in `screenshot`

**Files:**
- Modify: `packages/server/src/auth/browser-session.ts`
- Modify: `packages/server/src/mcp/meta-tools.ts`
- Modify tests: `packages/server/tests/browser-actions.test.ts`, `packages/server/tests/browser-meta-tools.test.ts`

The current `screenshot(s)` returns a base64 string and the `browser_screenshot` meta-tool wraps it into `{ _mcpImage: { data, mimeType: "image/png" } }`. We move the sentinel construction INTO the helper so it can also decide "unchanged".

- [ ] **Step 1: Replace the screenshot tests** in `packages/server/tests/browser-actions.test.ts`. Remove the existing `"screenshot returns base64 png data"` test and add:

```ts
  it("screenshot downscales via clip.scale and returns a jpeg image", async () => {
    const send = vi.fn(async (m: string) => {
      if (m === "Page.getLayoutMetrics") return { cssLayoutViewport: { clientWidth: 2000, clientHeight: 1000 } };
      return { data: "JPEGDATA" };
    });
    const s = { cdp: { send } } as any;
    const out = await screenshot(s, { maxWidth: 1000 });
    expect(send).toHaveBeenCalledWith(
      "Page.captureScreenshot",
      expect.objectContaining({
        format: "jpeg",
        quality: 60,
        clip: expect.objectContaining({ x: 0, y: 0, width: 2000, height: 1000, scale: 0.5 }),
      })
    );
    expect(out).toEqual({ _mcpImage: { data: "JPEGDATA", mimeType: "image/jpeg" } });
  });

  it("screenshot returns { unchanged: true } when bytes are identical", async () => {
    const send = vi.fn(async (m: string) =>
      m === "Page.getLayoutMetrics" ? { cssLayoutViewport: { clientWidth: 1000, clientHeight: 800 } } : { data: "SAME" }
    );
    const s = { cdp: { send } } as any;
    const a = await screenshot(s);
    const b = await screenshot(s);
    expect(a).toHaveProperty("_mcpImage");
    expect(b).toEqual({ unchanged: true });
  });

  it("screenshot never upscales (scale capped at 1)", async () => {
    const send = vi.fn(async (m: string) =>
      m === "Page.getLayoutMetrics" ? { cssLayoutViewport: { clientWidth: 800, clientHeight: 600 } } : { data: "X" }
    );
    const s = { cdp: { send } } as any;
    await screenshot(s, { maxWidth: 1000 });
    expect(send).toHaveBeenCalledWith("Page.captureScreenshot", expect.objectContaining({ clip: expect.objectContaining({ scale: 1 }) }));
  });

  it("screenshot honors format:png (no quality, png mime)", async () => {
    const send = vi.fn(async (m: string) =>
      m === "Page.getLayoutMetrics" ? { cssLayoutViewport: { clientWidth: 1000, clientHeight: 800 } } : { data: "PNGDATA" }
    );
    const s = { cdp: { send } } as any;
    const out = await screenshot(s, { format: "png" });
    const call = send.mock.calls.find((c) => c[0] === "Page.captureScreenshot")!;
    expect(call[1].format).toBe("png");
    expect(call[1].quality).toBeUndefined();
    expect(out).toEqual({ _mcpImage: { data: "PNGDATA", mimeType: "image/png" } });
  });
```

- [ ] **Step 2: Run, confirm FAIL** — `cd packages/server && npx vitest run tests/browser-actions.test.ts` (old behavior / new signature mismatch).

- [ ] **Step 3: Add `lastShotHash` to `WarmSession`** in `browser-session.ts` — add the field to the interface:
```ts
  lastShotHash?: string;
```
(place it after `lastActivity: number;`).

- [ ] **Step 4: Add the crypto import** at the top of `browser-session.ts`:
```ts
import { createHash } from "node:crypto";
```

- [ ] **Step 5: Replace the `screenshot` helper** with:
```ts
export interface ShotOpts { format?: "jpeg" | "png"; quality?: number; maxWidth?: number }

export async function screenshot(
  s: WarmSession,
  opts: ShotOpts = {}
): Promise<{ _mcpImage: { data: string; mimeType: string } } | { unchanged: true }> {
  const format = opts.format ?? "jpeg";
  const quality = opts.quality ?? 60;
  const maxWidth = opts.maxWidth ?? 1000;

  const metrics = (await s.cdp.send("Page.getLayoutMetrics")) as {
    cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
    layoutViewport?: { clientWidth?: number; clientHeight?: number };
  };
  const vp = metrics.cssLayoutViewport ?? metrics.layoutViewport ?? {};
  const vw = vp.clientWidth ?? 1280;
  const vh = vp.clientHeight ?? 800;
  const scale = Math.min(1, maxWidth / vw);

  const params: Record<string, unknown> = { format, clip: { x: 0, y: 0, width: vw, height: vh, scale } };
  if (format === "jpeg") params.quality = quality;

  const r = (await s.cdp.send("Page.captureScreenshot", params)) as { data?: string };
  const data = r.data ?? "";
  const hash = createHash("sha256").update(data).digest("hex");
  if (hash === s.lastShotHash) return { unchanged: true };
  s.lastShotHash = hash;
  return { _mcpImage: { data, mimeType: format === "jpeg" ? "image/jpeg" : "image/png" } };
}
```

- [ ] **Step 6: Update the `browser_screenshot` meta-tool** in `meta-tools.ts`. The handler now passes opts and returns the helper result directly:
```ts
  {
    name: "browser_screenshot",
    description: "Capture a screenshot of the current viewport so you can see the page. Costs vision tokens — call it only when the page likely changed and you need to look; after a click/type, act on what you already saw unless the result is uncertain. Downscaled JPEG by default (maxWidth 1000). If the pixels are identical to your last shot it returns { unchanged: true } instead of an image. For text-heavy pages prefer browser_read_text.",
    inputSchema: z.object({
      format: z.enum(["jpeg", "png"]).optional(),
      quality: z.number().int().min(1).max(100).optional(),
      maxWidth: z.number().int().positive().optional(),
    }),
    handler: async (ctx: { userId: string }, args: { format?: "jpeg" | "png"; quality?: number; maxWidth?: number }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      return browserScreenshot(s, args);
    },
  },
```
Update its wire schema in `metaToolSchemas`:
```ts
  browser_screenshot: {
    type: "object",
    properties: {
      format: { type: "string", enum: ["jpeg", "png"], description: "Image format (default jpeg)" },
      quality: { type: "number", description: "JPEG quality 1-100 (default 60)" },
      maxWidth: { type: "number", description: "Downscale so width ≤ this many px (default 1000). Lower = fewer tokens." },
    },
  },
```

- [ ] **Step 7: Update the `browser_screenshot` meta-tool test** in `packages/server/tests/browser-meta-tools.test.ts`. The handler now returns whatever `screenshot` returns. Replace the existing `"browser_screenshot returns an _mcpImage sentinel"` test with:
```ts
  it("browser_screenshot forwards opts and returns the helper result", async () => {
    shotMock.mockResolvedValue({ _mcpImage: { data: "B64", mimeType: "image/jpeg" } });
    const out = await (tool("browser_screenshot").handler as any)({ userId: "u1" }, { maxWidth: 800 });
    expect(shotMock).toHaveBeenCalledWith({ userId: "u1" }, { maxWidth: 800 });
    expect(out).toEqual({ _mcpImage: { data: "B64", mimeType: "image/jpeg" } });
  });
```

- [ ] **Step 8: Run tests + typecheck + full suite**
```
cd packages/server && npx vitest run tests/browser-actions.test.ts tests/browser-meta-tools.test.ts && npx tsc --noEmit && npx vitest run
```
All green.

- [ ] **Step 9: Commit**
```bash
git add packages/server/src/auth/browser-session.ts packages/server/src/mcp/meta-tools.ts packages/server/tests/browser-actions.test.ts packages/server/tests/browser-meta-tools.test.ts
git commit -m "feat(browser): downscale+JPEG screenshots with change-detection to cut vision tokens"
```

---

## Task 2: `browser_read_text` tool

**Files:**
- Modify: `packages/server/src/auth/browser-session.ts` (add `readText` helper)
- Modify: `packages/server/src/mcp/meta-tools.ts` (add tool + schema + import)
- Modify tests: `packages/server/tests/browser-actions.test.ts`, `packages/server/tests/browser-meta-tools.test.ts`

- [ ] **Step 1: Write failing helper tests** — add to `packages/server/tests/browser-actions.test.ts`:
```ts
  it("readText returns innerText", async () => {
    const send = vi.fn(async () => ({ result: { value: "Hello world" } }));
    const { readText } = await import("../src/auth/browser-session");
    const out = await readText({ cdp: { send } } as any);
    expect(send).toHaveBeenCalledWith("Runtime.evaluate", expect.objectContaining({ expression: "document.body.innerText", returnByValue: true }));
    expect(out).toEqual({ text: "Hello world", truncated: false });
  });

  it("readText truncates past maxChars and flags it", async () => {
    const send = vi.fn(async () => ({ result: { value: "abcdefghij" } }));
    const { readText } = await import("../src/auth/browser-session");
    const out = await readText({ cdp: { send } } as any, 4);
    expect(out).toEqual({ text: "abcd", truncated: true });
  });
```
(If `readText` is already statically imported at the top of the test file with the other helpers, add it there instead of dynamic import and call directly.)

- [ ] **Step 2: Run, confirm FAIL.** `cd packages/server && npx vitest run tests/browser-actions.test.ts`

- [ ] **Step 3: Add the `readText` helper** to `browser-session.ts` (near the other action helpers):
```ts
export async function readText(s: WarmSession, maxChars = 20000): Promise<{ text: string; truncated: boolean }> {
  const r = (await s.cdp.send("Runtime.evaluate", {
    expression: "document.body.innerText",
    returnByValue: true,
  })) as { result?: { value?: unknown } };
  const full = typeof r.result?.value === "string" ? r.result.value : "";
  const truncated = full.length > maxChars;
  return { text: truncated ? full.slice(0, maxChars) : full, truncated };
}
```

- [ ] **Step 4: Add the meta-tool.** Import in `meta-tools.ts` (extend the existing browser-session import to add `readText as browserReadText`). Add the tool:
```ts
  {
    name: "browser_read_text",
    description: "Read the visible text of the current page (document.innerText) as plain text — far cheaper than a screenshot for text-heavy pages, forms, and reading. Use this instead of browser_screenshot when you don't need to see layout/pixels.",
    inputSchema: z.object({ maxChars: z.number().int().positive().optional() }),
    handler: async (ctx: { userId: string }, args: { maxChars?: number }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      return browserReadText(s, args.maxChars);
    },
  },
```
Wire schema:
```ts
  browser_read_text: {
    type: "object",
    properties: { maxChars: { type: "number", description: "Max characters to return (default 20000)" } },
  },
```

- [ ] **Step 5: Add a meta-tool test** to `packages/server/tests/browser-meta-tools.test.ts`. Extend the `vi.mock("../src/auth/browser-session", ...)` factory to include `readText: <a hoisted mock>` (add `readMock` to the `vi.hoisted` block and `readText: readMock` to the mock), then:
```ts
  it("browser_read_text returns the text result", async () => {
    readMock.mockResolvedValue({ text: "page text", truncated: false });
    const out = await (tool("browser_read_text").handler as any)({ userId: "u1" }, { maxChars: 500 });
    expect(readMock).toHaveBeenCalledWith({ userId: "u1" }, 500);
    expect(out).toEqual({ text: "page text", truncated: false });
  });
```

- [ ] **Step 6: Run tests + typecheck + full suite** — all green.
```
cd packages/server && npx vitest run tests/browser-actions.test.ts tests/browser-meta-tools.test.ts && npx tsc --noEmit && npx vitest run
```

- [ ] **Step 7: Commit**
```bash
git add packages/server/src/auth/browser-session.ts packages/server/src/mcp/meta-tools.ts packages/server/tests/browser-actions.test.ts packages/server/tests/browser-meta-tools.test.ts
git commit -m "feat(browser): browser_read_text tool (cheap text alternative to screenshots)"
```

---

## Task 3: Docs

**Files:**
- Modify: `docs/how-to-use.md`

- [ ] **Step 1: Update the Browser tools section** — in the bullet list under "### Browser tools (computer-use)", change the `browser_screenshot` line and add `browser_read_text`:
```markdown
- `browser_screenshot({ format?, quality?, maxWidth? })` — downscaled JPEG by default (maxWidth 1000) to keep vision tokens low; returns `{ unchanged: true }` instead of an image when the page is pixel-identical to your last shot
- `browser_read_text({ maxChars? })` — visible page text as plain text; far cheaper than a screenshot for reading/forms
```
And add a sentence after the list:
```markdown
Screenshots cost vision tokens (priced by pixel dimensions), so the model is told to shoot only when the page changed, to prefer `browser_read_text` for text, and downscaling/maxWidth trims the cost further.
```

- [ ] **Step 2: Commit**
```bash
git add docs/how-to-use.md
git commit -m "docs: screenshot token-economy options + browser_read_text"
```

---

## Final Review
Dispatch a code-reviewer over `git diff` of the three commits against this plan + spec. Confirm: change-detection can't pin a stale frame (hash only set on emit), downscale math correct, no token-lever confusion (JPEG≠token saver, resolution is).
