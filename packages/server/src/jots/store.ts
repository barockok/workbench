import crypto from "node:crypto";
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

  // Ownership: an existing jot owned by someone else is off-limits. Check before the
  // decode/size loop so an unowned name short-circuits without forcing that work.
  const existing = readManifest(name);
  if (existing && existing.owner !== owner) return { error: "JOT_NAME_TAKEN" };

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
  const tmpDir = `${finalDir}.tmp-${crypto.randomBytes(4).toString("hex")}`;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  try {
    for (const { rel, buf } of decoded) {
      const dest = path.join(tmpDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }
    fs.writeFileSync(path.join(tmpDir, MANIFEST), JSON.stringify(manifest, null, 2));
    // Non-atomic on macOS (rename can't replace a non-empty dir → ENOTEMPTY), so we
    // drop the old tree first. Brief window where finalDir is absent; acceptable here.
    fs.rmSync(finalDir, { recursive: true, force: true });
    fs.renameSync(tmpDir, finalDir);
  } catch (e) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.error("[deployJot] unexpected error:", e);
    return { error: "DEPLOY_FAILED" };
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
    if (e.name.includes(".tmp-")) continue;
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
