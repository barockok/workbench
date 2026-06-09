# Jot tar.gz Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe `deploy_jot` into a two-phase flow — the MCP tool validates metadata and returns a single-use upload URL; the agent uploads a `.tar.gz`; the server streams, extracts safely, and publishes it.

**Architecture:** A new in-memory pending-deploy store mints capability tokens. A new streaming extractor (`gunzip → tar-stream`) writes an uploaded archive into a tmp dir under size/count/path/type guards. The existing atomic-swap publish logic is factored into `commitJotDir`, which both the new upload route and the retained `deployJot` (now a thin file-seeding wrapper for tests) call. The `deploy_jot` tool stops carrying `files[]`.

**Tech Stack:** TypeScript, Fastify, Node `zlib` (built-in gunzip), `tar-stream` (new dep), Vitest.

Spec: `docs/superpowers/specs/2026-06-09-jot-targz-upload-design.md`

> **Note / deviation from spec:** the spec says "remove the old `deployJot(files)` path." This plan instead keeps `deployJot(files)` as a thin wrapper over the new `commitJotDir` (decode files → tmp dir → commit). It is no longer used by the MCP tool (the contract change holds), but stays as a test/seed helper so the existing jot test suite needs no migration — DRY, and less churn. `DeployFile`/`DeployInput` stay.

---

### Task 1: Add dependency + config keys

**Files:**
- Modify: `packages/server/package.json` (dependencies)
- Modify: `packages/server/src/config.ts:30-31`

- [ ] **Step 1: Install tar-stream**

Run:
```bash
cd packages/server && npm install tar-stream@3 && npm install -D @types/tar-stream
```
Expected: both added to `packages/server/package.json`; root lockfile updated.

- [ ] **Step 2: Add the two config keys**

In `packages/server/src/config.ts`, the jot keys currently are:
```ts
  JOTS_DIR: z.string().optional(),
  JOTS_MAX_BYTES: z.coerce.number().int().positive().default(5_242_880),
```
Replace that pair with:
```ts
  JOTS_DIR: z.string().optional(),
  JOTS_MAX_BYTES: z.coerce.number().int().positive().default(5_242_880),
  JOTS_MAX_FILES: z.coerce.number().int().positive().default(1000),
  JOTS_UPLOAD_TTL_SECONDS: z.coerce.number().int().positive().default(300),
```

- [ ] **Step 3: Verify it typechecks**

Run: `cd packages/server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/server/package.json package-lock.json packages/server/src/config.ts
git commit -m "chore(jots): add tar-stream dep + upload config keys"
```

---

### Task 2: Pending-deploy token store

A single-use, TTL-bound token store mapping a token to a pending deploy. Includes a test clock seam so expiry is testable without sleeping.

**Files:**
- Create: `packages/server/src/jots/pending.ts`
- Test: `packages/server/tests/jots/pending.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/jots/pending.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/config", () => ({
  config: { JOTS_UPLOAD_TTL_SECONDS: 300 },
}));

import { mint, consume, reapExpired, _setNowForTest } from "../../src/jots/pending";

describe("jots/pending", () => {
  let t = 1_000_000;
  beforeEach(() => {
    t = 1_000_000;
    _setNowForTest(() => t);
    // drain anything left from a prior test
    reapExpired();
  });

  it("mints a token and consumes it once", () => {
    const { token, expiresAt } = mint({ owner: "u1", name: "site", access: "public" });
    expect(typeof token).toBe("string");
    expect(token.length).toBe(64); // 32 random bytes hex
    expect(expiresAt).toBe(t + 300_000);
    const p = consume(token);
    expect(p).toMatchObject({ owner: "u1", name: "site", access: "public" });
    // single-use: a second consume yields null
    expect(consume(token)).toBeNull();
  });

  it("returns null for an unknown token", () => {
    expect(consume("nope")).toBeNull();
  });

  it("does not return an expired token", () => {
    const { token } = mint({ owner: "u1", name: "site", access: "public" });
    t += 300_001; // past TTL
    expect(consume(token)).toBeNull();
  });

  it("reapExpired drops only expired entries", () => {
    const a = mint({ owner: "u1", name: "a", access: "public" });
    t += 100_000;
    const b = mint({ owner: "u1", name: "b", access: "public" });
    t += 250_000; // a expired (350s old), b still alive (250s old)
    reapExpired();
    expect(consume(a.token)).toBeNull();
    expect(consume(b.token)).toMatchObject({ name: "b" });
  });

  it("carries the password hash for password jots", () => {
    const { token } = mint({ owner: "u1", name: "s", access: "password", passwordHash: "scrypt$x$y" });
    expect(consume(token)).toMatchObject({ access: "password", passwordHash: "scrypt$x$y" });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && npx vitest run tests/jots/pending.test.ts`
Expected: FAIL — cannot find module `../../src/jots/pending`.

- [ ] **Step 3: Implement the store**

Create `packages/server/src/jots/pending.ts`:
```ts
import crypto from "node:crypto";
import { config } from "../config";

export interface PendingDeploy {
  owner: string;
  name: string;
  access: "public" | "password";
  passwordHash?: string;
  expiresAt: number;
}

const pending = new Map<string, PendingDeploy>();

// Clock seam: overridable in tests so TTL expiry is testable without sleeping.
let now: () => number = () => Date.now();
export function _setNowForTest(fn: () => number): void {
  now = fn;
}

export function mint(input: Omit<PendingDeploy, "expiresAt">): { token: string; expiresAt: number } {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = now() + config.JOTS_UPLOAD_TTL_SECONDS * 1000;
  pending.set(token, { ...input, expiresAt });
  return { token, expiresAt };
}

// Single-use: deletes on read. Returns null for unknown or expired tokens.
export function consume(token: string): PendingDeploy | null {
  const p = pending.get(token);
  if (!p) return null;
  pending.delete(token);
  if (p.expiresAt < now()) return null;
  return p;
}

export function reapExpired(): void {
  const t = now();
  for (const [k, v] of pending) {
    if (v.expiresAt < t) pending.delete(k);
  }
}

// Periodic cleanup of abandoned tokens. Mirrors auth/connections reaper.
let timer: ReturnType<typeof setInterval> | null = null;
export function startUploadReaper(intervalMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => reapExpired(), intervalMs);
  timer.unref?.();
}
export function stopUploadReaper(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/server && npx vitest run tests/jots/pending.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/jots/pending.ts packages/server/tests/jots/pending.test.ts
git commit -m "feat(jots): single-use TTL token store for upload deploys"
```

---

### Task 3: Streaming tar.gz extractor

Stream `gunzip → tar-stream` into a tmp dir with guards: safe paths, files-and-dirs only, mid-stream size cap, file-count cap, empty/malformed detection. Directory entries are ignored (parent dirs are created from file paths); only regular files are written.

**Files:**
- Create: `packages/server/src/jots/extract.ts`
- Test: `packages/server/tests/jots/extract.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/jots/extract.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pack as tarPack } from "tar-stream";
import { createGzip } from "node:zlib";

vi.mock("../../src/config", () => ({
  config: { JOTS_MAX_BYTES: 1000, JOTS_MAX_FILES: 5 },
}));

import { extractTarGzToDir, JotExtractError } from "../../src/jots/extract";

interface Entry { name: string; content?: string; type?: "file" | "directory" | "symlink"; linkname?: string; }

// Build a .tar.gz buffer from a list of entries.
function makeTarGz(entries: Entry[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tarPack();
    const gzip = createGzip();
    const chunks: Buffer[] = [];
    gzip.on("data", (c: Buffer) => chunks.push(c));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);
    pack.pipe(gzip);
    (function next(i: number) {
      if (i >= entries.length) { pack.finalize(); return; }
      const e = entries[i];
      if (e.type === "directory") {
        pack.entry({ name: e.name, type: "directory" });
        return next(i + 1);
      }
      if (e.type === "symlink") {
        pack.entry({ name: e.name, type: "symlink", linkname: e.linkname ?? "x" });
        return next(i + 1);
      }
      pack.entry({ name: e.name }, e.content ?? "", () => next(i + 1));
    })(0);
  });
}

let tmp: string;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jot-extract-")); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

async function run(entries: Entry[], dest = path.join(tmp, "out")) {
  fs.mkdirSync(dest, { recursive: true });
  const buf = await makeTarGz(entries);
  return extractTarGzToDir(Readable.from(buf), dest);
}

describe("jots/extract", () => {
  it("extracts files and nested dirs", async () => {
    const dest = path.join(tmp, "out");
    const res = await run([
      { name: "index.html", content: "<h1>hi</h1>" },
      { name: "assets/app.js", content: "console.log(1)" },
    ], dest);
    expect(res.fileCount).toBe(2);
    expect(fs.readFileSync(path.join(dest, "index.html"), "utf8")).toContain("hi");
    expect(fs.readFileSync(path.join(dest, "assets/app.js"), "utf8")).toContain("console.log");
  });

  it("rejects a path-traversal entry", async () => {
    await expect(run([{ name: "../escape.txt", content: "x" }])).rejects.toMatchObject({ code: "INVALID_PATH" });
  });

  it("rejects a symlink entry", async () => {
    await expect(run([{ name: "link", type: "symlink", linkname: "../../etc/passwd" }]))
      .rejects.toMatchObject({ code: "UNSUPPORTED_ENTRY" });
  });

  it("aborts when decompressed bytes exceed the cap", async () => {
    await expect(run([{ name: "big.bin", content: "x".repeat(2000) }]))
      .rejects.toMatchObject({ code: "TOO_LARGE" });
  });

  it("rejects too many files", async () => {
    const entries: Entry[] = [];
    for (let i = 0; i < 6; i++) entries.push({ name: `f${i}.txt`, content: "x" });
    await expect(run(entries)).rejects.toMatchObject({ code: "TOO_MANY_FILES" });
  });

  it("rejects an empty archive", async () => {
    await expect(run([])).rejects.toMatchObject({ code: "NO_FILES" });
  });

  it("rejects a non-gzip body", async () => {
    const dest = path.join(tmp, "out");
    fs.mkdirSync(dest, { recursive: true });
    await expect(extractTarGzToDir(Readable.from(Buffer.from("not a gzip")), dest))
      .rejects.toMatchObject({ code: "BAD_ARCHIVE" });
  });

  it("is a JotExtractError instance", async () => {
    const err = await run([{ name: "../x", content: "y" }]).catch((e) => e);
    expect(err).toBeInstanceOf(JotExtractError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && npx vitest run tests/jots/extract.test.ts`
Expected: FAIL — cannot find module `../../src/jots/extract`.

- [ ] **Step 3: Implement the extractor**

Create `packages/server/src/jots/extract.ts`:
```ts
import { createGunzip } from "node:zlib";
import { extract as tarExtract } from "tar-stream";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { config } from "../config";
import { safeRelPath } from "./paths";

export type JotExtractCode =
  | "INVALID_PATH"
  | "UNSUPPORTED_ENTRY"
  | "TOO_LARGE"
  | "TOO_MANY_FILES"
  | "BAD_ARCHIVE"
  | "NO_FILES";

export class JotExtractError extends Error {
  constructor(public code: JotExtractCode) {
    super(code);
    this.name = "JotExtractError";
  }
}

// Stream an uploaded gzip tarball into destDir, applying safety guards. Only
// regular files are written; directory entries are ignored (parents are created
// from file paths). Rejects with a JotExtractError on any violation.
export function extractTarGzToDir(
  src: Readable,
  destDir: string
): Promise<{ fileCount: number; bytes: number }> {
  return new Promise((resolve, reject) => {
    const gunzip = createGunzip();
    const ex = tarExtract();
    let bytes = 0;
    let fileCount = 0;
    let settled = false;

    const fail = (code: JotExtractCode) => {
      if (settled) return;
      settled = true;
      ex.destroy();
      gunzip.destroy();
      reject(new JotExtractError(code));
    };

    gunzip.on("error", () => fail("BAD_ARCHIVE"));
    ex.on("error", () => fail("BAD_ARCHIVE"));
    src.on("error", () => fail("BAD_ARCHIVE"));

    ex.on("entry", (header, stream, next) => {
      if (settled) {
        stream.resume();
        return;
      }
      // Directory entries: nothing to write, dirs come from file paths.
      if (header.type === "directory") {
        stream.on("end", next);
        stream.resume();
        return;
      }
      // Only regular files allowed. Symlinks/hardlinks/devices are escape vectors.
      if (header.type !== "file") {
        stream.resume();
        return fail("UNSUPPORTED_ENTRY");
      }
      const rel = safeRelPath(header.name);
      if (!rel) {
        stream.resume();
        return fail("INVALID_PATH");
      }
      if (fileCount + 1 > config.JOTS_MAX_FILES) {
        stream.resume();
        return fail("TOO_MANY_FILES");
      }
      fileCount++;
      const dest = join(destDir, rel);
      mkdirSync(dirname(dest), { recursive: true });
      const ws = createWriteStream(dest);
      ws.on("error", () => fail("BAD_ARCHIVE"));
      stream.on("error", () => fail("BAD_ARCHIVE"));
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > config.JOTS_MAX_BYTES) {
          ws.destroy();
          fail("TOO_LARGE");
        }
      });
      ws.on("close", () => {
        if (!settled) next();
      });
      stream.pipe(ws);
    });

    ex.on("finish", () => {
      if (settled) return;
      if (fileCount === 0) {
        settled = true;
        return reject(new JotExtractError("NO_FILES"));
      }
      settled = true;
      resolve({ fileCount, bytes });
    });

    src.pipe(gunzip).pipe(ex);
  });
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/server && npx vitest run tests/jots/extract.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/jots/extract.ts packages/server/tests/jots/extract.test.ts
git commit -m "feat(jots): streaming tar.gz extractor with path/type/size/count guards"
```

---

### Task 4: `commitJotDir` + refactor `deployJot` to use it

Factor the manifest-write + atomic-swap out of `deployJot` into `commitJotDir(srcDir)`. Reimplement `deployJot(files)` as a thin wrapper that decodes files into a tmp dir then calls `commitJotDir` — keeping all existing jot tests green.

**Files:**
- Modify: `packages/server/src/jots/store.ts:51-105`
- Test: `packages/server/tests/jots/store.test.ts` (add cases; existing pass unchanged)

- [ ] **Step 1: Write the failing test (new commitJotDir cases)**

Append to `packages/server/tests/jots/store.test.ts` inside its top-level `describe` (import `commitJotDir` and `fs`/`path`/`os` if not already imported at the top — check the file header and add only what's missing):
```ts
  it("commitJotDir publishes a prepared directory", () => {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "jot-src-"));
    fs.writeFileSync(path.join(src, "index.html"), "<h1>committed</h1>");
    const res = commitJotDir({ name: "fromdir", owner: "u1", access: "public", srcDir: src });
    expect(res).toMatchObject({ name: "fromdir", access: "public" });
    expect(readManifest("fromdir")).toMatchObject({ owner: "u1", access: "public" });
  });

  it("commitJotDir refuses a name owned by another user", () => {
    deployJot({ name: "owned", owner: "u1", access: "public", files: [{ path: "index.html", content: "x" }] });
    const src = fs.mkdtempSync(path.join(os.tmpdir(), "jot-src-"));
    fs.writeFileSync(path.join(src, "index.html"), "x");
    const res = commitJotDir({ name: "owned", owner: "u2", access: "public", srcDir: src });
    expect(res).toEqual({ error: "JOT_NAME_TAKEN" });
  });
```

If `store.test.ts` does not already import `os`/`commitJotDir`, add to its imports:
```ts
import os from "node:os";
```
and add `commitJotDir` to the existing `import { ... } from "../../src/jots/store"` line.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && npx vitest run tests/jots/store.test.ts`
Expected: FAIL — `commitJotDir` is not exported.

- [ ] **Step 3: Refactor store.ts**

In `packages/server/src/jots/store.ts`, replace the entire `deployJot` function (the block starting `export function deployJot(input: DeployInput): DeployResult {` and ending at its closing `}` before `export interface JotSummary`) with these two functions:
```ts
// Publish an already-prepared directory: write the manifest into it, then
// atomically swap it into place as /jots/<name>/. The directory becomes the
// live jot (renamed, not copied), so it must be on the same filesystem as
// jotsRoot() — callers create it under jotsRoot().
export function commitJotDir(input: {
  name: string;
  owner: string;
  access: "public" | "password";
  passwordHash?: string;
  srcDir: string;
}): DeployResult {
  const { name, owner, access, passwordHash, srcDir } = input;
  if (!isValidJotName(name)) return { error: "INVALID_NAME" };
  if (access === "password" && !passwordHash) return { error: "PASSWORD_REQUIRED" };

  const existing = readManifest(name);
  if (existing && existing.owner !== owner) return { error: "JOT_NAME_TAKEN" };

  const now = new Date().toISOString();
  const manifest: Manifest = {
    access,
    owner,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    ...(access === "password" ? { hash: passwordHash } : {}),
  };

  const finalDir = jotDir(name);
  try {
    fs.writeFileSync(path.join(srcDir, MANIFEST), JSON.stringify(manifest, null, 2));
    // Non-atomic on macOS (rename can't replace a non-empty dir → ENOTEMPTY), so
    // drop the old tree first. Brief window where finalDir is absent; acceptable.
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(srcDir, finalDir);
  } catch (e) {
    fs.rmSync(srcDir, { recursive: true, force: true });
    console.error("[commitJotDir] unexpected error:", e);
    return { error: "DEPLOY_FAILED" };
  }
  return { name, access, url: jotUrl(name) };
}

// Decode an inline file array into a tmp dir, then commit it. Retained as a
// test/seed helper; the deploy_jot MCP tool now uses the upload flow instead.
export function deployJot(input: DeployInput): DeployResult {
  const { name, owner, access, passwordHash, files } = input;
  if (!isValidJotName(name)) return { error: "INVALID_NAME" };
  if (access === "password" && !passwordHash) return { error: "PASSWORD_REQUIRED" };
  if (!Array.isArray(files) || files.length === 0) return { error: "NO_FILES" };

  const existing = readManifest(name);
  if (existing && existing.owner !== owner) return { error: "JOT_NAME_TAKEN" };

  fs.mkdirSync(jotsRoot(), { recursive: true });
  const tmpDir = `${jotDir(name)}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });

  let total = 0;
  for (const f of files) {
    const rel = safeRelPath(f.path);
    if (!rel) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { error: "INVALID_PATH" };
    }
    const buf = Buffer.from(f.content ?? "", f.encoding === "base64" ? "base64" : "utf8");
    total += buf.length;
    if (total > config.JOTS_MAX_BYTES) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return { error: "TOO_LARGE" };
    }
    const dest = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
  }
  return commitJotDir({ name, owner, access, passwordHash, srcDir: tmpDir });
}
```

This reuses the existing imports already at the top of `store.ts` (`crypto`, `fs`, `path`, `config`, `jotsRoot`, `isValidJotName`, `safeRelPath`, `MANIFEST`). No import changes needed.

- [ ] **Step 4: Run the full jot suite to verify everything passes**

Run: `cd packages/server && npx vitest run tests/jots/`
Expected: PASS — existing store/routes/auth tests unchanged + 2 new commitJotDir cases.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/jots/store.ts packages/server/tests/jots/store.test.ts
git commit -m "refactor(jots): extract commitJotDir; deployJot becomes a thin wrapper"
```

---

### Task 5: Upload route + gzip body parser

Add `POST /j/upload/:token` that consumes the token, extracts the streamed tarball into a tmp dir under `jotsRoot()`, and commits it. Register a raw-stream parser for gzip content types so Fastify hands the request stream straight through (also sidesteps the default 1 MB body limit).

**Files:**
- Modify: `packages/server/src/jots/routes.ts` (imports + `registerJotRoutes` body)
- Test: `packages/server/tests/jots/routes.test.ts` (add an upload `describe`)

- [ ] **Step 1: Write the failing test**

Add to `packages/server/tests/jots/routes.test.ts`. First extend the imports at the top of the file:
```ts
import { createGzip } from "node:zlib";
import { pack as tarPack } from "tar-stream";
import { mint } from "../../src/jots/pending";
```
Then add this `describe` block as a sibling of the existing `describe("jots/routes", ...)` (i.e. after its closing `});`):
```ts
function tarGz(files: { name: string; content: string }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pack = tarPack();
    const gzip = createGzip();
    const chunks: Buffer[] = [];
    gzip.on("data", (c: Buffer) => chunks.push(c));
    gzip.on("end", () => resolve(Buffer.concat(chunks)));
    gzip.on("error", reject);
    pack.pipe(gzip);
    (function next(i: number) {
      if (i >= files.length) { pack.finalize(); return; }
      pack.entry({ name: files[i].name }, files[i].content, () => next(i + 1));
    })(0);
  });
}

describe("jots/routes upload", () => {
  it("publishes an uploaded tarball and then serves it", async () => {
    const { token } = mint({ owner: "u1", name: "uploaded", access: "public" });
    const body = await tarGz([{ name: "index.html", content: "<h1>UP</h1>" }]);
    const up = await app.inject({
      method: "POST",
      url: `/j/upload/${token}`,
      payload: body,
      headers: { "content-type": "application/gzip" },
    });
    expect(up.statusCode).toBe(200);
    expect(JSON.parse(up.body)).toMatchObject({ name: "uploaded", access: "public" });
    const served = await app.inject({ method: "GET", url: "/j/uploaded/" });
    expect(served.statusCode).toBe(200);
    expect(served.body).toContain("UP");
  });

  it("404s an unknown or already-used token", async () => {
    const { token } = mint({ owner: "u1", name: "once", access: "public" });
    const body = await tarGz([{ name: "index.html", content: "x" }]);
    const first = await app.inject({ method: "POST", url: `/j/upload/${token}`, payload: body, headers: { "content-type": "application/gzip" } });
    expect(first.statusCode).toBe(200);
    // replay: token already consumed
    const replay = await app.inject({ method: "POST", url: `/j/upload/${token}`, payload: body, headers: { "content-type": "application/gzip" } });
    expect(replay.statusCode).toBe(404);
    // never-minted token
    const unknown = await app.inject({ method: "POST", url: "/j/upload/deadbeef", payload: body, headers: { "content-type": "application/gzip" } });
    expect(unknown.statusCode).toBe(404);
  });

  it("400s a traversal entry in the tarball", async () => {
    const { token } = mint({ owner: "u1", name: "evil", access: "public" });
    const body = await tarGz([{ name: "../escape", content: "x" }]);
    const res = await app.inject({ method: "POST", url: `/j/upload/${token}`, payload: body, headers: { "content-type": "application/gzip" } });
    expect(res.statusCode).toBe(400);
  });
});
```

Note: `app` is the module-level Fastify instance created in the existing `beforeEach`; `registerJotRoutes` is already called there.

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && npx vitest run tests/jots/routes.test.ts`
Expected: FAIL — `POST /j/upload/:token` returns 404 for the valid-token case (route not yet defined) / parser missing.

- [ ] **Step 3: Implement the route + parser**

In `packages/server/src/jots/routes.ts`, extend the imports. The current jot-store import is:
```ts
import { readManifest } from "./store";
```
Change it to:
```ts
import { readManifest, commitJotDir } from "./store";
```
Add these imports near the other `./` imports:
```ts
import crypto from "node:crypto";
import { jotsRoot } from "./dir";
import { consume } from "./pending";
import { extractTarGzToDir, JotExtractError } from "./extract";
```
(`fs`, `path`, and `jotsRoot` may already be imported — check the top of the file and avoid duplicate import lines; `jotsRoot` is imported in `dir.ts` and already used by the serve route, so it is already present.)

Inside `registerJotRoutes`, right after the existing urlencoded-parser guard block, add a raw-stream parser for gzip uploads:
```ts
  // Hand the raw request stream to the upload handler (no buffering) for the
  // gzip content types. This enables streaming extraction and bypasses the
  // default 1 MB bodyLimit. Guarded so a re-register is a no-op.
  for (const ct of ["application/gzip", "application/x-gzip", "application/octet-stream"]) {
    if (!app.hasContentTypeParser(ct)) {
      app.addContentTypeParser(ct, (_req, payload, done) => done(null, payload));
    }
  }
```

Then add the upload route (place it just before the `app.get<{ Params: { name: string; "*": string } }>("/j/:name/*", ...)` route):
```ts
  app.post<{ Params: { token: string } }>("/j/upload/:token", async (req, reply) => {
    const pending = consume(req.params.token);
    if (!pending) return reply.code(404).send("Not found");

    fs.mkdirSync(jotsRoot(), { recursive: true });
    const tmpDir = path.join(jotsRoot(), `${pending.name}.up-${crypto.randomBytes(4).toString("hex")}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
      await extractTarGzToDir(req.raw, tmpDir);
    } catch (e) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      if (e instanceof JotExtractError) {
        const status = e.code === "TOO_LARGE" || e.code === "TOO_MANY_FILES" ? 413 : 400;
        return reply.code(status).send({ error: e.code });
      }
      return reply.code(400).send({ error: "BAD_ARCHIVE" });
    }

    const result = commitJotDir({
      name: pending.name,
      owner: pending.owner,
      access: pending.access,
      passwordHash: pending.passwordHash,
      srcDir: tmpDir,
    });
    if ("error" in result) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      const status = result.error === "JOT_NAME_TAKEN" ? 409 : 500;
      return reply.code(status).send(result);
    }
    return reply.code(200).send(result);
  });
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/server && npx vitest run tests/jots/routes.test.ts`
Expected: PASS — existing route tests + 3 new upload tests.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/jots/routes.ts packages/server/tests/jots/routes.test.ts
git commit -m "feat(jots): POST /j/upload/:token — streamed tar.gz publish"
```

---

### Task 6: Reframe the `deploy_jot` MCP tool + start the reaper

`deploy_jot` stops taking `files[]`. It validates name/access/ownership, mints a token, and returns the upload URL. Wire the upload reaper into server boot.

**Files:**
- Modify: `packages/server/src/mcp/meta-tools.ts:8-9` (imports) and the `deploy_jot` tool block
- Modify: `packages/server/src/index.ts:342` area (start the reaper)
- Test: `packages/server/tests/meta-tools-jots.test.ts` (replace the deploy_jot cases)

- [ ] **Step 1: Update the test first**

In `packages/server/tests/meta-tools-jots.test.ts`, replace the `vi.mock("../src/jots/store", ...)` block and the three `deploy_jot ...` `it(...)` cases.

Change the store mock to also mock pending. Do **not** mock `../src/config` — `meta-tools.ts` reads config fields at module-eval for other tools, so mocking the whole module risks blanking them. Instead assert against the real config defaults (`SERVER_PUBLIC_URL` = `http://localhost:3000`, `JOTS_MAX_BYTES` = `5242880`).
```ts
vi.mock("../src/jots/store", () => ({
  deployJot: vi.fn(),
  listJots: vi.fn(),
  deleteJot: vi.fn(),
  readManifest: vi.fn(() => null),
}));
vi.mock("../src/jots/pending", () => ({
  mint: vi.fn(() => ({ token: "tok123", expiresAt: 42 })),
}));
vi.mock("../src/jots/auth", () => ({
  hashPassword: vi.fn(() => "scrypt$salt$hash"),
}));
```
Add imports near the others:
```ts
import { mint } from "../src/jots/pending";
import { readManifest } from "../src/jots/store";
```
Replace the three old `deploy_jot` `it(...)` blocks with:
```ts
  it("deploy_jot mints a token and returns the upload URL for a public jot", async () => {
    vi.mocked(readManifest).mockReturnValue(null);
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "r", access: "public" });
    expect(mint).toHaveBeenCalledWith({ owner: "u1", name: "r", access: "public", passwordHash: undefined });
    expect(result).toMatchObject({ token: "tok123", expiresAt: 42, maxBytes: 5_242_880 });
    // host comes from config.SERVER_PUBLIC_URL (default http://localhost:3000)
    expect((result as { uploadUrl: string }).uploadUrl).toMatch(/\/j\/upload\/tok123$/);
  });

  it("deploy_jot hashes the password for a password jot", async () => {
    vi.mocked(readManifest).mockReturnValue(null);
    const tool = findTool("deploy_jot");
    await tool.handler({ userId: "u1" }, { name: "s", access: "password", password: "pw" });
    expect(hashPassword).toHaveBeenCalledWith("pw");
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ access: "password", passwordHash: "scrypt$salt$hash" }));
  });

  it("deploy_jot errors if a password jot has no password", async () => {
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "s", access: "password" });
    expect(result).toEqual({ error: "PASSWORD_REQUIRED" });
    expect(mint).not.toHaveBeenCalled();
  });

  it("deploy_jot rejects an invalid name", async () => {
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "Bad Name", access: "public" });
    expect(result).toEqual({ error: "INVALID_NAME" });
    expect(mint).not.toHaveBeenCalled();
  });

  it("deploy_jot refuses a name owned by another user", async () => {
    vi.mocked(readManifest).mockReturnValue({ access: "public", owner: "someone-else", createdAt: "t", updatedAt: "t" });
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "taken", access: "public" });
    expect(result).toEqual({ error: "JOT_NAME_TAKEN" });
    expect(mint).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/server && npx vitest run tests/meta-tools-jots.test.ts`
Expected: FAIL — handler still references `files`, `mint`/`readManifest` not imported in source.

- [ ] **Step 3: Update the source imports**

In `packages/server/src/mcp/meta-tools.ts`, the current jot imports are:
```ts
import { deployJot, listJots, deleteJot } from "../jots/store";
import { hashPassword } from "../jots/auth";
```
Change to:
```ts
import { listJots, deleteJot, readManifest } from "../jots/store";
import { hashPassword } from "../jots/auth";
import { isValidJotName } from "../jots/paths";
import { mint } from "../jots/pending";
```
(`deployJot` is no longer imported here — it stays in `store.ts` for tests. `config` is already imported.)

- [ ] **Step 4: Replace the deploy_jot tool block**

Replace the whole `deploy_jot` object (from `name: "deploy_jot",` through its closing `},` before the `list_jots` object) with:
```ts
    name: "deploy_jot",
    description:
      "Begin deploying a static web artifact to /j/<name>/. Returns an upload URL and a single-use token (valid ~5 min). Package your site directory as a gzip tarball and upload it, e.g.: `tar czf - -C <dir> . | curl --data-binary @- -H 'Content-Type: application/gzip' <uploadUrl>`. The archive is extracted server-side and published wholesale, replacing any previous deploy. `access` is 'public' or 'password' (password jots require `password`). Names are global and creator-locked: a name owned by another user returns JOT_NAME_TAKEN. Limits: <=5 MiB decompressed, <=1000 files. Jot pages are sandboxed (opaque origin) and must be self-contained.",
    inputSchema: z.object({
      name: z.string(),
      access: z.enum(["public", "password"]),
      password: z.string().optional(),
    }),
    handler: async (
      ctx: { userId: string },
      args: { name: string; access: "public" | "password"; password?: string }
    ) => {
      if (!isValidJotName(args.name)) return { error: "INVALID_NAME" };
      if (args.access === "password" && !args.password) return { error: "PASSWORD_REQUIRED" };
      const existing = readManifest(args.name);
      if (existing && existing.owner !== ctx.userId) return { error: "JOT_NAME_TAKEN" };
      const passwordHash = args.access === "password" ? hashPassword(args.password as string) : undefined;
      const { token, expiresAt } = mint({
        owner: ctx.userId,
        name: args.name,
        access: args.access,
        passwordHash,
      });
      return {
        uploadUrl: `${config.SERVER_PUBLIC_URL}/j/upload/${token}`,
        token,
        expiresAt,
        maxBytes: config.JOTS_MAX_BYTES,
      };
    },
  },
```

- [ ] **Step 5: Start the reaper at boot**

In `packages/server/src/index.ts`, the jot routes are registered at the line `await registerJotRoutes(app);`. Add the reaper import near the top with the other imports:
```ts
import { startUploadReaper } from "./jots/pending";
```
And immediately after `await registerJotRoutes(app);` add:
```ts
  startUploadReaper();
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd packages/server && npx vitest run tests/meta-tools-jots.test.ts`
Expected: PASS (5 deploy_jot cases + list_jots + delete_jot).

- [ ] **Step 7: Typecheck the whole server**

Run: `cd packages/server && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/mcp/meta-tools.ts packages/server/src/index.ts packages/server/tests/meta-tools-jots.test.ts
git commit -m "feat(jots): reframe deploy_jot to return an upload URL; start upload reaper"
```

---

### Task 7: Docs + full verification

Update the user/architecture docs to describe the upload flow, then run the full build + test suite.

**Files:**
- Modify: `docs/how-to-use.md` (jot section, if present) — or `docs/architecture.md` meta-tools table
- Modify: `docs/architecture.md:49` (the `deploy_jot` meta-tools row)

- [ ] **Step 1: Update the architecture meta-tools row**

In `docs/architecture.md`, the jot row currently reads (line ~49):
```
| `deploy_jot` / `list_jots` / `delete_jot` | Publish a static web artifact as a public/password site at `/j/<name>/`; list/delete your own. ...
```
Update the `deploy_jot` description to note the two-phase upload:
```
| `deploy_jot` / `list_jots` / `delete_jot` | `deploy_jot` returns a single-use upload URL (~5 min TTL); the client uploads the site as a gzip tarball (`tar czf - -C dir . \| curl --data-binary @- <uploadUrl>`), extracted + published at `/j/<name>/` (≤5 MiB decompressed, ≤1000 files). `list_jots`/`delete_jot` operate on your own. Global namespace, creator-locked writes, account-less viewing. Jot pages are sandboxed (CSP opaque origin) so they can't reach app cookies/APIs — keep them self-contained |
```

- [ ] **Step 2: Add an upload note to how-to-use.md**

In `docs/how-to-use.md`, find the jots/`deploy_jot` mention (search for `deploy_jot` or `/j/`). If a jots section exists, add this paragraph; if not, append a short `## Deploying a jot` section near the MCP-tools content:
```markdown
## Deploying a jot

`deploy_jot` is two steps. Call it with `{ name, access, password? }` — it validates
the name and returns `{ uploadUrl, token, expiresAt, maxBytes }`. Then package your
site directory and upload it as a gzip tarball:

    tar czf - -C ./my-site . | curl --data-binary @- -H 'Content-Type: application/gzip' "<uploadUrl>"

The server extracts the archive and publishes it at `/j/<name>/`, replacing any prior
deploy. Limits: ≤5 MiB decompressed, ≤1000 files; symlinks and path-traversal entries
are rejected. The upload token is single-use and expires after ~5 minutes — re-call
`deploy_jot` for a fresh one if it lapses.
```

- [ ] **Step 3: Run the full build**

Run: `npm run build`
Expected: 4 packages build, no TS errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm run test`
Expected: all server + shared tests pass (existing + new pending/extract/upload/deploy_jot cases).

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md docs/how-to-use.md
git commit -m "docs(jots): document the tar.gz upload deploy flow"
```

---

## Notes for the release

This is a breaking change to the `deploy_jot` MCP contract (no more `files[]`). Per the
spec rollout section, ship as a **minor bump (v0.9.0)** with release notes calling out
the contract change and the `tar czf … | curl` recipe. Run the existing `/prep-release`
flow after the plan is implemented and reviewed.
