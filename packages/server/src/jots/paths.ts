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
  if (p.includes("\x00")) return null;
  if (p.startsWith("/")) return null;
  const norm = path.posix.normalize(p);
  if (norm.startsWith("..") || norm === ".") return null;
  if (path.posix.basename(norm).toLowerCase() === MANIFEST) return null;
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
  if (path.basename(target).toLowerCase() === MANIFEST) return null;
  return target;
}
