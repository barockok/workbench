# Built-in Jots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in jots feature so an authenticated MCP user can deploy a static web artifact to workbench and serve it as a public or password-gated site at `/j/<name>/`.

**Architecture:** Port jotter's auth model (scrypt password hash + path-scoped HMAC cookie) into the Fastify server as a `jots/` module. Storage is a flat directory of per-jot subdirs, each with a `jot.json` manifest. Three MCP meta-tools (`deploy_jot`, `list_jots`, `delete_jot`) write/list/delete; Fastify routes (`GET /j/:name/*`, `POST /j/:name/__auth`) serve and gate. Global namespace, creator-locked writes, account-less viewing.

**Tech Stack:** TypeScript, Fastify, Node `crypto` (scrypt/HMAC), Zod, Vitest.

Spec: `docs/superpowers/specs/2026-06-09-builtin-jots-design.md`

---

## File Structure

- Create `packages/server/src/jots/auth.ts` — password hashing + cookie token (port).
- Create `packages/server/src/jots/paths.ts` — name validation, request-path parse, traversal-safe resolve.
- Create `packages/server/src/jots/mime.ts` — extension → content-type (port).
- Create `packages/server/src/jots/store.ts` — manifest I/O, ownership, atomic deploy, delete, list.
- Create `packages/server/src/jots/routes.ts` — `registerJotRoutes(app)`: serve + unlock.
- Modify `packages/server/src/config.ts` — add `JOTS_DIR`, `JOTS_MAX_BYTES`.
- Modify `packages/server/src/index.ts` — register jot routes before the portal.
- Modify `packages/server/src/mcp/meta-tools.ts` — add `deploy_jot`, `list_jots`, `delete_jot` + wire schemas.
- Modify `docs/architecture.md` — document the tools + serve path.
- Tests under `packages/server/tests/jots/`.

---

## Task 1: Config — JOTS_DIR and JOTS_MAX_BYTES

**Files:**
- Modify: `packages/server/src/config.ts:28-29`
- Create: `packages/server/src/jots/dir.ts`
- Test: `packages/server/tests/jots/dir.test.ts`

- [ ] **Step 1: Add config keys**

In `packages/server/src/config.ts`, inside `configSchema`, after the `BROWSER_SESSION_TTL_SECONDS` line add:

```ts
  JOTS_DIR: z.string().optional(),
  JOTS_MAX_BYTES: z.coerce.number().int().positive().default(5_242_880),
```

- [ ] **Step 2: Write the failing test for the dir resolver**

Create `packages/server/tests/jots/dir.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { jotsRoot } from "../../src/jots/dir";

describe("jotsRoot", () => {
  it("defaults to a 'jots' dir next to the database", () => {
    // DATABASE_URL defaults to ./data/tokens.db in test env
    expect(jotsRoot()).toBe(path.resolve(path.dirname("./data/tokens.db"), "jots"));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/jots/dir.test.ts`
Expected: FAIL — cannot find module `../../src/jots/dir`.

- [ ] **Step 4: Implement the resolver**

Create `packages/server/src/jots/dir.ts`:

```ts
import path from "node:path";
import { config } from "../config";

// Where jots live on disk. Mirrors the browser-profiles default: a sibling of
// the SQLite DB unless JOTS_DIR overrides it. Resolved (absolute) so the serve
// traversal guard can compare prefixes reliably.
export function jotsRoot(): string {
  const base = config.JOTS_DIR || path.join(path.dirname(config.DATABASE_URL), "jots");
  return path.resolve(base);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/jots/dir.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/config.ts packages/server/src/jots/dir.ts packages/server/tests/jots/dir.test.ts
git commit -m "feat(jots): config JOTS_DIR + JOTS_MAX_BYTES and dir resolver"
```

---

## Task 2: Auth module (port scrypt + HMAC)

**Files:**
- Create: `packages/server/src/jots/auth.ts`
- Test: `packages/server/tests/jots/auth.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/jots/auth.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, makeToken, verifyToken, cookieName } from "../../src/jots/auth";

describe("jots/auth", () => {
  it("hashes and verifies a password", () => {
    const stored = hashPassword("hunter2");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("hunter2", stored)).toBe(true);
    expect(verifyPassword("wrong", stored)).toBe(false);
  });

  it("rejects malformed stored hashes", () => {
    expect(verifyPassword("x", "garbage")).toBe(false);
    expect(verifyPassword("x", "")).toBe(false);
  });

  it("makes and verifies a per-jot token", () => {
    const t = makeToken("secret", "report");
    expect(verifyToken("secret", "report", t)).toBe(true);
    expect(verifyToken("secret", "other", t)).toBe(false);   // token bound to name
    expect(verifyToken("other", "report", t)).toBe(false);   // token bound to secret
    expect(verifyToken("secret", "report", "tampered")).toBe(false);
  });

  it("namespaces the cookie name", () => {
    expect(cookieName("report")).toBe("jot_report");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/jots/auth.test.ts`
Expected: FAIL — cannot find module `../../src/jots/auth`.

- [ ] **Step 3: Implement (port from jotter, typed)**

Create `packages/server/src/jots/auth.ts`:

```ts
import crypto from "node:crypto";

// Password hashing: scrypt, self-describing string "scrypt$<saltHex>$<hashHex>".
const SCRYPT_KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let actual: Buffer;
  try {
    actual = crypto.scryptSync(password, salt, expected.length);
  } catch {
    return false;
  }
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// Per-jot cookie token: HMAC(secret, jotName). Self-verifying, no session store.
export function makeToken(secret: string, jotName: string): string {
  return crypto.createHmac("sha256", secret).update(jotName).digest("hex");
}

export function verifyToken(secret: string, jotName: string, token: string): boolean {
  if (typeof token !== "string") return false;
  const expected = makeToken(secret, jotName);
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function cookieName(jotName: string): string {
  return `jot_${jotName}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/jots/auth.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/jots/auth.ts packages/server/tests/jots/auth.test.ts
git commit -m "feat(jots): port scrypt password + HMAC cookie auth"
```

---

## Task 3: Paths module (name validation + traversal guard)

**Files:**
- Create: `packages/server/src/jots/paths.ts`
- Test: `packages/server/tests/jots/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/jots/paths.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import { isValidJotName, safeRelPath, resolveInside, MANIFEST } from "../../src/jots/paths";

describe("jots/paths", () => {
  it("validates jot names", () => {
    expect(isValidJotName("report")).toBe(true);
    expect(isValidJotName("a-b-9")).toBe(true);
    expect(isValidJotName("-bad")).toBe(false);
    expect(isValidJotName("Bad")).toBe(false);
    expect(isValidJotName("has space")).toBe(false);
    expect(isValidJotName("a".repeat(65))).toBe(false);
  });

  it("accepts safe relative deploy paths", () => {
    expect(safeRelPath("index.html")).toBe("index.html");
    expect(safeRelPath("assets/app.js")).toBe("assets/app.js");
  });

  it("rejects unsafe deploy paths", () => {
    expect(safeRelPath("../escape")).toBeNull();
    expect(safeRelPath("/abs")).toBeNull();
    expect(safeRelPath("a/../../b")).toBeNull();
    expect(safeRelPath(MANIFEST)).toBeNull();
    expect(safeRelPath("sub/jot.json")).toBeNull();
    expect(safeRelPath("")).toBeNull();
  });

  it("resolves serve paths inside the jot dir, blocking escape and the manifest", () => {
    const dir = "/srv/jots/report";
    expect(resolveInside(dir, "")).toBe(path.join(dir, "index.html"));
    expect(resolveInside(dir, "a/")).toBe(path.join(dir, "a/index.html"));
    expect(resolveInside(dir, "app.js")).toBe(path.join(dir, "app.js"));
    expect(resolveInside(dir, "../../etc/passwd")).toBeNull();
    expect(resolveInside(dir, MANIFEST)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/jots/paths.test.ts`
Expected: FAIL — cannot find module `../../src/jots/paths`.

- [ ] **Step 3: Implement**

Create `packages/server/src/jots/paths.ts`:

```ts
import path from "node:path";

export const JOT_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
export const MANIFEST = "jot.json";

export function isValidJotName(name: string): boolean {
  return typeof name === "string" && name.length <= 64 && JOT_NAME_RE.test(name);
}

// Validate a deploy-time relative file path. Returns the normalized POSIX path,
// or null if empty, absolute, escaping, or naming the manifest at any level.
export function safeRelPath(p: string): string | null {
  if (typeof p !== "string" || p === "") return null;
  if (p.startsWith("/")) return null;
  const norm = path.posix.normalize(p);
  if (norm.startsWith("..") || norm.includes("/../") || norm === "." ) return null;
  if (path.posix.basename(norm) === MANIFEST) return null;
  return norm;
}

// Resolve a serve request's rest-path inside a jot dir, rejecting traversal and
// the manifest. Empty / trailing-slash resolves to index.html.
export function resolveInside(jotDir: string, rest: string): string | null {
  let rel = rest;
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const target = path.resolve(jotDir, rel);
  const base = path.resolve(jotDir);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  if (path.basename(target) === MANIFEST) return null;
  return target;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/jots/paths.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/jots/paths.ts packages/server/tests/jots/paths.test.ts
git commit -m "feat(jots): jot-name validation + traversal-safe path resolution"
```

---

## Task 4: MIME module (port)

**Files:**
- Create: `packages/server/src/jots/mime.ts`
- Test: `packages/server/tests/jots/mime.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/jots/mime.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { contentType } from "../../src/jots/mime";

describe("jots/mime", () => {
  it("maps known extensions", () => {
    expect(contentType("a/index.html")).toBe("text/html; charset=utf-8");
    expect(contentType("app.js")).toBe("text/javascript; charset=utf-8");
    expect(contentType("data.json")).toBe("application/json; charset=utf-8");
    expect(contentType("logo.svg")).toBe("image/svg+xml");
  });
  it("falls back to octet-stream", () => {
    expect(contentType("file.unknownext")).toBe("application/octet-stream");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/jots/mime.test.ts`
Expected: FAIL — cannot find module `../../src/jots/mime`.

- [ ] **Step 3: Implement (port from jotter)**

Create `packages/server/src/jots/mime.ts`:

```ts
import path from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
};

export function contentType(filePath: string): string {
  return TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/jots/mime.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/jots/mime.ts packages/server/tests/jots/mime.test.ts
git commit -m "feat(jots): port mime content-type map"
```

---

## Task 5: Store — manifest I/O, ownership, atomic deploy, list, delete

**Files:**
- Create: `packages/server/src/jots/store.ts`
- Test: `packages/server/tests/jots/store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/jots/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmp: string;

vi.mock("../../src/jots/dir", () => ({ jotsRoot: () => tmp }));
vi.mock("../../src/config", () => ({
  config: { JOTS_MAX_BYTES: 1000, SERVER_PUBLIC_URL: "https://wb.test", NODE_ENV: "test" },
}));

import { deployJot, listJots, deleteJot, readManifest } from "../../src/jots/store";

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jots-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const file = (p: string, content: string) => ({ path: p, content });

describe("jots/store", () => {
  it("creates a jot and returns its url", () => {
    const r = deployJot({ name: "report", owner: "u1", access: "public", files: [file("index.html", "<h1>hi</h1>")] });
    expect(r).toEqual({ name: "report", access: "public", url: "https://wb.test/j/report/" });
    expect(fs.readFileSync(path.join(tmp, "report", "index.html"), "utf8")).toBe("<h1>hi</h1>");
    expect(readManifest("report")?.owner).toBe("u1");
  });

  it("lets the owner overwrite, replacing the whole tree", () => {
    deployJot({ name: "report", owner: "u1", access: "public", files: [file("old.html", "x"), file("index.html", "1")] });
    const r = deployJot({ name: "report", owner: "u1", access: "public", files: [file("index.html", "2")] });
    expect("url" in r).toBe(true);
    expect(fs.existsSync(path.join(tmp, "report", "old.html"))).toBe(false);
    expect(fs.readFileSync(path.join(tmp, "report", "index.html"), "utf8")).toBe("2");
  });

  it("blocks a different owner from overwriting", () => {
    deployJot({ name: "report", owner: "u1", access: "public", files: [file("index.html", "1")] });
    const r = deployJot({ name: "report", owner: "u2", access: "public", files: [file("index.html", "2")] });
    expect(r).toEqual({ error: "JOT_NAME_TAKEN" });
    expect(fs.readFileSync(path.join(tmp, "report", "index.html"), "utf8")).toBe("1");
  });

  it("stores a password hash for password jots", () => {
    deployJot({ name: "secret", owner: "u1", access: "password", passwordHash: "scrypt$a$b", files: [file("index.html", "x")] });
    const m = readManifest("secret");
    expect(m?.access).toBe("password");
    expect(m?.hash).toBe("scrypt$a$b");
  });

  it("rejects bad name, empty files, unsafe path, oversize, and missing password hash", () => {
    expect(deployJot({ name: "Bad", owner: "u1", access: "public", files: [file("index.html", "x")] })).toEqual({ error: "INVALID_NAME" });
    expect(deployJot({ name: "ok", owner: "u1", access: "public", files: [] })).toEqual({ error: "NO_FILES" });
    expect(deployJot({ name: "ok", owner: "u1", access: "public", files: [file("../x", "x")] })).toEqual({ error: "INVALID_PATH" });
    expect(deployJot({ name: "ok", owner: "u1", access: "public", files: [file("index.html", "x".repeat(1001))] })).toEqual({ error: "TOO_LARGE" });
    expect(deployJot({ name: "ok", owner: "u1", access: "password", files: [file("index.html", "x")] })).toEqual({ error: "PASSWORD_REQUIRED" });
  });

  it("decodes base64 file content", () => {
    deployJot({ name: "b", owner: "u1", access: "public", files: [{ path: "index.html", content: Buffer.from("hello").toString("base64"), encoding: "base64" }] });
    expect(fs.readFileSync(path.join(tmp, "b", "index.html"), "utf8")).toBe("hello");
  });

  it("lists only the caller's own jots", () => {
    deployJot({ name: "mine", owner: "u1", access: "public", files: [file("index.html", "x")] });
    deployJot({ name: "theirs", owner: "u2", access: "public", files: [file("index.html", "x")] });
    const list = listJots("u1");
    expect(list.map((j) => j.name)).toEqual(["mine"]);
    expect(list[0].url).toBe("https://wb.test/j/mine/");
  });

  it("deletes only when the owner matches", () => {
    deployJot({ name: "mine", owner: "u1", access: "public", files: [file("index.html", "x")] });
    expect(deleteJot("mine", "u2")).toEqual({ error: "FORBIDDEN" });
    expect(deleteJot("mine", "u1")).toEqual({ ok: true });
    expect(fs.existsSync(path.join(tmp, "mine"))).toBe(false);
    expect(deleteJot("missing", "u1")).toEqual({ error: "NOT_FOUND" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/jots/store.test.ts`
Expected: FAIL — cannot find module `../../src/jots/store`.

- [ ] **Step 3: Implement**

Create `packages/server/src/jots/store.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { jotsRoot } from "./dir";
import { isValidJotName, safeRelPath, MANIFEST } from "./paths";

export interface Manifest {
  access: "public" | "password";
  hash?: string;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

export interface DeployFile {
  path: string;
  content: string;
  encoding?: "utf8" | "base64";
}

export interface DeployInput {
  name: string;
  owner: string;
  access: "public" | "password";
  passwordHash?: string;
  files: DeployFile[];
}

export type DeployResult = { name: string; access: string; url: string } | { error: string };

function jotDir(name: string): string {
  return path.join(jotsRoot(), name);
}

function jotUrl(name: string): string {
  return `${config.SERVER_PUBLIC_URL}/j/${name}/`;
}

export function readManifest(name: string): Manifest | null {
  try {
    const raw = fs.readFileSync(path.join(jotDir(name), MANIFEST), "utf8");
    const m = JSON.parse(raw) as Manifest;
    if (m && (m.access === "public" || m.access === "password") && typeof m.owner === "string") return m;
  } catch {
    /* missing or malformed → null */
  }
  return null;
}

export function deployJot(input: DeployInput): DeployResult {
  const { name, owner, access, passwordHash, files } = input;
  if (!isValidJotName(name)) return { error: "INVALID_NAME" };
  if (access === "password" && !passwordHash) return { error: "PASSWORD_REQUIRED" };
  if (!Array.isArray(files) || files.length === 0) return { error: "NO_FILES" };

  // Decode + validate all files before touching disk.
  const decoded: { rel: string; buf: Buffer }[] = [];
  let total = 0;
  for (const f of files) {
    const rel = safeRelPath(f.path);
    if (!rel) return { error: "INVALID_PATH" };
    const buf = Buffer.from(f.content ?? "", f.encoding === "base64" ? "base64" : "utf8");
    total += buf.length;
    if (total > config.JOTS_MAX_BYTES) return { error: "TOO_LARGE" };
    decoded.push({ rel, buf });
  }

  // Ownership: an existing jot owned by someone else is off-limits.
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

  fs.mkdirSync(jotsRoot(), { recursive: true });
  const finalDir = jotDir(name);
  const tmpDir = `${finalDir}.tmp-${process.pid}`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  try {
    for (const { rel, buf } of decoded) {
      const dest = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }
    fs.writeFileSync(path.join(tmpDir, MANIFEST), JSON.stringify(manifest, null, 2));
    // Atomic-ish swap: drop the old tree, move the new one into place.
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, finalDir);
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    return { error: e instanceof Error ? e.message : String(e) };
  }

  return { name, access, url: jotUrl(name) };
}

export interface JotSummary {
  name: string;
  access: string;
  url: string;
  updatedAt: string;
}

export function listJots(owner: string): JotSummary[] {
  const root = jotsRoot();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: JotSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = readManifest(e.name);
    if (!m || m.owner !== owner) continue;
    out.push({ name: e.name, access: m.access, url: jotUrl(e.name), updatedAt: m.updatedAt });
  }
  out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return out;
}

export function deleteJot(name: string, owner: string): { ok: true } | { error: string } {
  const m = readManifest(name);
  if (!m) return { error: "NOT_FOUND" };
  if (m.owner !== owner) return { error: "FORBIDDEN" };
  fs.rmSync(jotDir(name), { recursive: true, force: true });
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/jots/store.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/jots/store.ts packages/server/tests/jots/store.test.ts
git commit -m "feat(jots): store — manifest I/O, ownership, atomic deploy, list, delete"
```

---

## Task 6: Serve routes (`GET /j/:name/*`, `POST /j/:name/__auth`)

**Files:**
- Create: `packages/server/src/jots/routes.ts`
- Modify: `packages/server/src/index.ts` (import + register before portal)
- Test: `packages/server/tests/jots/routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/jots/routes.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { FastifyInstance } from "fastify";

let tmp: string;

vi.mock("../../src/jots/dir", () => ({ jotsRoot: () => tmp }));
vi.mock("../../src/config", () => ({
  config: { JOTS_MAX_BYTES: 1_000_000, SERVER_PUBLIC_URL: "https://wb.test", SESSION_SECRET: "test-secret-32-chars-long-xxxxxx", NODE_ENV: "test" },
}));

import { registerJotRoutes } from "../../src/jots/routes";
import { deployJot } from "../../src/jots/store";
import { hashPassword, makeToken, cookieName } from "../../src/jots/auth";

let app: FastifyInstance;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jots-routes-"));
  app = Fastify();
  await registerJotRoutes(app);
  await app.ready();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("jots/routes", () => {
  it("serves a public jot", async () => {
    deployJot({ name: "pub", owner: "u1", access: "public", files: [{ path: "index.html", content: "<h1>hi</h1>" }] });
    const res = await app.inject({ method: "GET", url: "/j/pub/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("hi");
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("404s an unknown jot and an invalid name", async () => {
    expect((await app.inject({ method: "GET", url: "/j/nope/" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/j/Bad/" })).statusCode).toBe(404);
  });

  it("never serves the manifest", async () => {
    deployJot({ name: "pub", owner: "u1", access: "public", files: [{ path: "index.html", content: "x" }] });
    expect((await app.inject({ method: "GET", url: "/j/pub/jot.json" })).statusCode).toBe(404);
  });

  it("blocks traversal", async () => {
    deployJot({ name: "pub", owner: "u1", access: "public", files: [{ path: "index.html", content: "x" }] });
    const res = await app.inject({ method: "GET", url: "/j/pub/..%2f..%2fetc%2fpasswd" });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("shows the unlock page for an HTML request to a password jot", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "index.html", content: "secret" }] });
    const res = await app.inject({ method: "GET", url: "/j/sec/", headers: { accept: "text/html" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Unlock");
    expect(res.body).not.toContain("secret");
  });

  it("401s a non-HTML request to a locked password jot", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "data.json", content: "{}" }] });
    const res = await app.inject({ method: "GET", url: "/j/sec/data.json", headers: { accept: "application/json" } });
    expect(res.statusCode).toBe(401);
  });

  it("unlocks with the right password and sets a scoped cookie", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "index.html", content: "secret" }] });
    const bad = await app.inject({ method: "POST", url: "/j/sec/__auth", payload: "password=nope", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/j/sec/__auth", payload: "password=pw", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(ok.statusCode).toBe(302);
    const setCookie = String(ok.headers["set-cookie"]);
    expect(setCookie).toContain("jot_sec=");
    expect(setCookie).toContain("Path=/j/sec/");
  });

  it("serves a password jot when a valid cookie is present", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "index.html", content: "secret" }] });
    const token = makeToken("test-secret-32-chars-long-xxxxxx", "sec");
    const res = await app.inject({ method: "GET", url: "/j/sec/", headers: { cookie: `${cookieName("sec")}=${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("secret");
  });

  it("rejects a cookie minted for a different jot", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "index.html", content: "secret" }] });
    const wrong = makeToken("test-secret-32-chars-long-xxxxxx", "other");
    const res = await app.inject({ method: "GET", url: "/j/sec/", headers: { accept: "application/json", cookie: `jot_sec=${wrong}` } });
    expect(res.statusCode).toBe(401);
  });

  it("redirects /j/:name to /j/:name/", async () => {
    deployJot({ name: "pub", owner: "u1", access: "public", files: [{ path: "index.html", content: "x" }] });
    const res = await app.inject({ method: "GET", url: "/j/pub" });
    expect(res.statusCode).toBe(301);
    expect(res.headers["location"]).toBe("/j/pub/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/jots/routes.test.ts`
Expected: FAIL — cannot find module `../../src/jots/routes`.

- [ ] **Step 3: Implement**

Create `packages/server/src/jots/routes.ts`:

```ts
import fs from "node:fs";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config";
import { jotsRoot } from "./dir";
import { isValidJotName, resolveInside } from "./paths";
import { readManifest } from "./store";
import { contentType } from "./mime";
import { verifyPassword, makeToken, verifyToken, cookieName } from "./auth";
import path from "node:path";

function secret(): string {
  return config.SESSION_SECRET;
}

function secureCookie(): boolean {
  return config.NODE_ENV === "production";
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function wantsHtml(req: FastifyRequest): boolean {
  const accept = (req.headers["accept"] as string) || "";
  if (req.headers["x-requested-with"]) return false;
  const dest = req.headers["sec-fetch-dest"] as string | undefined;
  if (dest && dest !== "document" && dest !== "iframe") return false;
  return accept.includes("text/html");
}

function unlockPage(jotName: string, error: boolean): string {
  const msg = error ? `<p class="err">Wrong password.</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Locked · ${jotName}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0e0e10;color:#eee;display:grid;place-items:center;height:100vh;margin:0}
  form{background:#1a1a1e;padding:2rem;border-radius:12px;width:min(320px,90vw);box-shadow:0 10px 40px #0008}
  h1{font-size:1rem;font-weight:600;margin:0 0 1rem}
  input{width:100%;box-sizing:border-box;padding:.6rem;border-radius:8px;border:1px solid #333;background:#0e0e10;color:#eee;margin-bottom:.8rem}
  button{width:100%;padding:.6rem;border:0;border-radius:8px;background:#5b8cff;color:#fff;font-weight:600;cursor:pointer}
  .err{color:#ff6b6b;font-size:.85rem;margin:.2rem 0 .8rem}
</style></head><body>
<form method="POST" action="/j/${jotName}/__auth">
  <h1>🔒 ${jotName}</h1>
  ${msg}
  <input type="password" name="password" placeholder="Password" autofocus required>
  <button type="submit">Unlock</button>
</form></body></html>`;
}

function streamFile(reply: FastifyReply, filePath: string): void {
  reply.header("content-type", contentType(filePath));
  reply.send(fs.createReadStream(filePath));
}

export async function registerJotRoutes(app: FastifyInstance): Promise<void> {
  // Accept urlencoded bodies for the unlock form.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => done(null, body)
  );

  // Bare /j/:name → canonical trailing slash.
  app.get<{ Params: { name: string } }>("/j/:name", async (req, reply) => {
    return reply.redirect(`/j/${req.params.name}/`, 301);
  });

  app.post<{ Params: { name: string } }>("/j/:name/__auth", async (req, reply) => {
    const { name } = req.params;
    if (!isValidJotName(name)) return reply.code(404).send("Not found");
    const manifest = readManifest(name);
    if (!manifest) return reply.code(404).send("Not found");
    if (manifest.access !== "password") return reply.redirect(`/j/${name}/`, 302);

    const params = new URLSearchParams(typeof req.body === "string" ? req.body : "");
    const pw = params.get("password") || "";
    if (!manifest.hash || !verifyPassword(pw, manifest.hash)) {
      return reply.code(401).type("text/html; charset=utf-8").send(unlockPage(name, true));
    }
    const token = makeToken(secret(), name);
    const attrs = [
      `${cookieName(name)}=${token}`,
      `Path=/j/${name}/`,
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=2592000",
    ];
    if (secureCookie()) attrs.push("Secure");
    return reply.header("set-cookie", attrs.join("; ")).redirect(`/j/${name}/`, 302);
  });

  app.get<{ Params: { name: string; "*": string } }>("/j/:name/*", async (req, reply) => {
    const { name } = req.params;
    const rest = req.params["*"] ?? "";
    if (!isValidJotName(name)) return reply.code(404).send("Not found");

    const manifest = readManifest(name);
    if (!manifest) return reply.code(404).send("Not found");

    if (manifest.access === "password") {
      const cookies = parseCookies(req.headers["cookie"]);
      const ok = verifyToken(secret(), name, cookies[cookieName(name)]);
      if (!ok) {
        if (wantsHtml(req)) {
          return reply.code(200).type("text/html; charset=utf-8").send(unlockPage(name, false));
        }
        return reply.code(401).send("Unauthorized");
      }
    }

    const jotDir = path.join(jotsRoot(), name);
    const filePath = resolveInside(jotDir, rest);
    if (!filePath) return reply.code(403).send("Forbidden");

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return reply.code(404).send("Not found");
    }
    if (stat.isDirectory()) {
      const idx = path.join(filePath, "index.html");
      if (!fs.existsSync(idx)) return reply.code(404).send("Not found");
      return streamFile(reply, idx);
    }
    return streamFile(reply, filePath);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/jots/routes.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Register the routes before the portal**

In `packages/server/src/index.ts`, add the import near the other route imports (around line 6-8):

```ts
import { registerJotRoutes } from "./jots/routes";
```

Then, immediately before the `await registerPortal(app);` call (around line 344), add:

```ts
  await registerJotRoutes(app);
```

- [ ] **Step 6: Run the full server suite to confirm nothing regressed**

Run: `cd packages/server && npx vitest run`
Expected: PASS (all existing tests + the new jots tests).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/jots/routes.ts packages/server/src/index.ts packages/server/tests/jots/routes.test.ts
git commit -m "feat(jots): serve + unlock routes, registered before the portal SPA"
```

---

## Task 7: MCP tools — deploy_jot, list_jots, delete_jot

**Files:**
- Modify: `packages/server/src/mcp/meta-tools.ts` (add import, three tools, three wire schemas)
- Test: `packages/server/tests/meta-tools-jots.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/meta-tools-jots.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/jots/store", () => ({
  deployJot: vi.fn(),
  listJots: vi.fn(),
  deleteJot: vi.fn(),
}));
vi.mock("../src/jots/auth", () => ({
  hashPassword: vi.fn(() => "scrypt$salt$hash"),
}));

import { metaTools } from "../src/mcp/meta-tools";
import * as store from "../src/jots/store";
import { hashPassword } from "../src/jots/auth";

function findTool(name: string) {
  return metaTools.find((t) => t.name === name)!;
}

describe("meta-tools jots", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deploy_jot forwards a public deploy and returns the store result", async () => {
    vi.mocked(store.deployJot).mockReturnValue({ name: "r", access: "public", url: "https://wb.test/j/r/" });
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "r", access: "public", files: [{ path: "index.html", content: "x" }] });
    expect(store.deployJot).toHaveBeenCalledWith({ name: "r", owner: "u1", access: "public", passwordHash: undefined, files: [{ path: "index.html", content: "x" }] });
    expect(result).toEqual({ name: "r", access: "public", url: "https://wb.test/j/r/" });
  });

  it("deploy_jot hashes the password for a password jot", async () => {
    vi.mocked(store.deployJot).mockReturnValue({ name: "s", access: "password", url: "https://wb.test/j/s/" });
    const tool = findTool("deploy_jot");
    await tool.handler({ userId: "u1" }, { name: "s", access: "password", password: "pw", files: [{ path: "index.html", content: "x" }] });
    expect(hashPassword).toHaveBeenCalledWith("pw");
    expect(store.deployJot).toHaveBeenCalledWith(expect.objectContaining({ access: "password", passwordHash: "scrypt$salt$hash" }));
  });

  it("deploy_jot errors if a password jot has no password", async () => {
    const tool = findTool("deploy_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "s", access: "password", files: [{ path: "index.html", content: "x" }] });
    expect(result).toEqual({ error: "PASSWORD_REQUIRED" });
    expect(store.deployJot).not.toHaveBeenCalled();
  });

  it("list_jots returns the caller's jots", async () => {
    vi.mocked(store.listJots).mockReturnValue([{ name: "r", access: "public", url: "https://wb.test/j/r/", updatedAt: "t" }]);
    const tool = findTool("list_jots");
    const result = await tool.handler({ userId: "u1" }, {});
    expect(store.listJots).toHaveBeenCalledWith("u1");
    expect(result).toEqual({ jots: [{ name: "r", access: "public", url: "https://wb.test/j/r/", updatedAt: "t" }] });
  });

  it("delete_jot forwards owner + name", async () => {
    vi.mocked(store.deleteJot).mockReturnValue({ ok: true });
    const tool = findTool("delete_jot");
    const result = await tool.handler({ userId: "u1" }, { name: "r" });
    expect(store.deleteJot).toHaveBeenCalledWith("r", "u1");
    expect(result).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && npx vitest run tests/meta-tools-jots.test.ts`
Expected: FAIL — `findTool("deploy_jot")` returns undefined → `.handler` throws.

- [ ] **Step 3: Add the imports**

In `packages/server/src/mcp/meta-tools.ts`, after the existing `import { getUserById } from "../auth/users";` line add:

```ts
import { deployJot, listJots, deleteJot } from "../jots/store";
import { hashPassword } from "../jots/auth";
```

- [ ] **Step 4: Add the three tools**

In `packages/server/src/mcp/meta-tools.ts`, inside the `metaTools` array, immediately before the `whoami` tool object, add:

```ts
  {
    name: "deploy_jot",
    description:
      "Deploy a static web artifact as a shareable site at /j/<name>/. `access` is 'public' or 'password' (password jots require `password`). `files` is the full file tree to publish; a re-deploy replaces it wholesale. Names are global and creator-locked: deploying a name owned by another user returns JOT_NAME_TAKEN.",
    inputSchema: z.object({
      name: z.string(),
      access: z.enum(["public", "password"]),
      password: z.string().optional(),
      files: z
        .array(
          z.object({
            path: z.string(),
            content: z.string(),
            encoding: z.enum(["utf8", "base64"]).optional(),
          })
        )
        .min(1),
    }),
    handler: async (
      ctx: { userId: string },
      args: {
        name: string;
        access: "public" | "password";
        password?: string;
        files: { path: string; content: string; encoding?: "utf8" | "base64" }[];
      }
    ) => {
      if (args.access === "password" && !args.password) return { error: "PASSWORD_REQUIRED" };
      const passwordHash = args.access === "password" ? hashPassword(args.password as string) : undefined;
      return deployJot({
        name: args.name,
        owner: ctx.userId,
        access: args.access,
        passwordHash,
        files: args.files,
      });
    },
  },
  {
    name: "list_jots",
    description: "List the jots you have deployed (name, access, url, updatedAt). Only your own jots are returned.",
    inputSchema: z.object({}),
    handler: async (ctx: { userId: string }) => ({ jots: listJots(ctx.userId) }),
  },
  {
    name: "delete_jot",
    description: "Delete a jot you own by name. Returns FORBIDDEN if another user owns it, NOT_FOUND if it doesn't exist.",
    inputSchema: z.object({ name: z.string() }),
    handler: async (ctx: { userId: string }, args: { name: string }) => deleteJot(args.name, ctx.userId),
  },
```

- [ ] **Step 5: Add the wire schemas**

In `packages/server/src/mcp/meta-tools.ts`, inside `metaToolSchemas`, immediately before the `whoami:` entry add:

```ts
  deploy_jot: {
    type: "object",
    properties: {
      name: { type: "string", description: "Jot name; [a-z0-9-], ≤64 chars" },
      access: { type: "string", enum: ["public", "password"], description: "Gate type" },
      password: { type: "string", description: "Required when access=password" },
      files: {
        type: "array",
        description: "File tree to publish; a re-deploy replaces it wholesale",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path, e.g. index.html or assets/app.js" },
            content: { type: "string", description: "File content (utf8 text, or base64 when encoding=base64)" },
            encoding: { type: "string", enum: ["utf8", "base64"], description: "Defaults to utf8" },
          },
          required: ["path", "content"],
        },
      },
    },
    required: ["name", "access", "files"],
  },
  list_jots: { type: "object", properties: {} },
  delete_jot: {
    type: "object",
    properties: { name: { type: "string", description: "Name of the jot to delete" } },
    required: ["name"],
  },
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd packages/server && npx vitest run tests/meta-tools-jots.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 7: Typecheck + full suite**

Run: `cd packages/server && npx tsc --noEmit && npx vitest run`
Expected: tsc clean; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/mcp/meta-tools.ts packages/server/tests/meta-tools-jots.test.ts
git commit -m "feat(jots): deploy_jot, list_jots, delete_jot MCP tools"
```

---

## Task 8: Docs

**Files:**
- Modify: `docs/architecture.md` (meta-tool table)

- [ ] **Step 1: Add the tools to the meta-tool table**

In `docs/architecture.md`, in the meta-tool table (the rows after `list_integrations`), add:

```markdown
| `deploy_jot` / `list_jots` / `delete_jot` | Publish a static web artifact as a public/password site at `/j/<name>/`; list/delete your own. Global namespace, creator-locked writes, account-less viewing |
```

- [ ] **Step 2: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: document jot deploy tools + /j serve path"
```

---

## Self-Review Notes

- **Spec coverage:** storage/manifest (T5), serve+gate at `/j/` before portal (T6), ported auth/paths/mime (T2-T4), deploy/list/delete tools with creator-lock + password hashing + size/path validation (T5, T7), config `JOTS_DIR`/`JOTS_MAX_BYTES` reusing `SESSION_SECRET` (T1, T6), tests across all (each task), docs (T8). All spec sections map to a task.
- **Type consistency:** `deployJot(DeployInput)` / `listJots(owner)` / `deleteJot(name, owner)` signatures are identical across store (T5), routes (T6 uses `readManifest`), and tools (T7). Error strings (`JOT_NAME_TAKEN`, `PASSWORD_REQUIRED`, `INVALID_NAME`, `INVALID_PATH`, `NO_FILES`, `TOO_LARGE`, `FORBIDDEN`, `NOT_FOUND`) are consistent between store impl and tool/store tests.
- **Manifest hiding:** enforced twice — `safeRelPath` blocks deploying any `jot.json` (T3), `resolveInside` blocks serving it (T3/T6).
- **Secret:** routes read `config.SESSION_SECRET`; no new secret env, per spec.
