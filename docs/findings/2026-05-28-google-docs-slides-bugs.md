# google-docs / google-slides Plugin Bugs

**Date:** 2026-05-28
**Branch:** docs/staging-report (with main merged)
**Test Environment:** Local dev server (tsx), Playwright MCP Extension
**Tester:** staging automation

---

## Summary

End-to-end validation of `google-docs` and `google-slides` plugins found 3 bugs: 1 functional (default parameter), 1 security (query injection), 1 incomplete implementation.

---

## Bug 1: `orderBy` default value rejected by Google Drive API

**Severity:** Medium — breaks search tools out of the box
**Files:**
- `packages/plugins/google-docs/tools/docs.ts:94`
- `packages/plugins/google-slides/tools/slides.ts:63`

**Problem:**
Both `searchDocuments` and `searchSlides` define:
```ts
orderBy: z.string().default("modifiedTime desc")
```

Google Drive API v3 `files.list` rejects `"modifiedTime desc"` with:
```json
{"code":400,"message":"Invalid Value","errors":[{"location":"orderBy"}]}
```

**Workaround:** Pass `orderBy: "modifiedTime"` (without ` desc` suffix).

**Fix:** Change default to `"modifiedTime"` or `"modifiedTime+desc"` (plus-encoded space). Verify which format Drive API actually accepts.

---

## Bug 2: Drive API query injection via `args.query`

**Severity:** Medium — user input interpolated unescaped into API query string
**Files:**
- `packages/plugins/google-docs/tools/docs.ts:98-100`
- `packages/plugins/google-slides/tools/slides.ts:68-70`
- `packages/plugins/google-drive/tools/drive.ts:53` (same pattern)

**Problem:**
```ts
const q = args.query
  ? `mimeType='...' and name contains '${args.query}'`
  : "mimeType='...'";
```

A malicious `query` value containing a single quote breaks out of the `contains` clause:
```
query = "test' or trashed=true or name contains '"
```

Produces:
```
mimeType='...' and name contains 'test' or trashed=true or name contains ''
```

This allows arbitrary Drive API query manipulation (read scope escalation, access to trashed files, etc.).

**Fix:** Escape single quotes in `args.query` before interpolation, or use Drive API's `fullText` search with parameterized queries.

---

## Bug 3: `createFromMarkdown` creates blank slides only

**Severity:** Low — feature incomplete, not broken
**File:** `packages/plugins/google-slides/tools/slides.ts:79-128`

**Problem:**
The `createFromMarkdown` handler:
1. Parses markdown by splitting on `^---$`
2. Creates a blank presentation
3. Creates blank slides via `batchUpdate` with `createSlide` requests
4. **Never inserts the actual markdown text into the slides**

The parsed markdown content is completely discarded after step 1.

**Expected:** Each slide should contain the corresponding markdown section as text.

**Fix:** After creating slides, add `insertText` requests to populate each slide with its markdown content. Parse markdown formatting (headings, bullets, etc.) into appropriate Slides API text styling requests.

---

## Also Fixed During This Session

### Dynamic import file extensions in `loader.ts`

**File:** `packages/server/src/plugins/loader.ts`

Compiled JS doing `await import(path.join(pluginPath, "manifest"))` fails in Docker with tsx because Node ESM requires explicit file extensions. Fixed by adding `.ts` extension:
```ts
await import(path.join(pluginPath, "manifest.ts"));
await import(path.join(pluginPath, "tools/index.ts"));
```

This fix should be committed to main.

---

## Verification Artifacts

- **Created doc:** `1tZuL_NOOQXm2FezMUX7PjZPBIFBInZ6WkKOF7O0Nelg` ("Test Doc - google-docs")
- **Created presentation:** `17ROb1HMawEZeprDO4tE02i2vwAHrQFwW58_qwrpjksQ` ("Test Slides - google-slides")
- **OAuth tokens:** Stored for both integrations, verified via `/api/connections`
