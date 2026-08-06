import { rm, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config";
import { activeProfiles, profilesBaseDir, profileDirName } from "./profile-chromium";

// Persistent per-user profiles keep the user logged in, but the session state
// that earns that persistence (Cookies, Local Storage, IndexedDB, History) is a
// few MB. The rest is regenerable: HTTP cache, compiled-script cache, GPU/shader
// caches, and the Safe Browsing blocklist — the last of which is an identical
// multi-MB download in every profile and useless to a headless browser that
// nobody is protecting from phishing.
//
// Deleting these logs nobody out. Chromium recreates whatever it needs on the
// next launch.
const THROWAWAY_PATHS = [
  // profile root
  "Safe Browsing",
  "ShaderCache",
  "GrShaderCache",
  "GraphiteDawnCache",
  "component_crx_cache",
  "extensions_crx_cache",
  "Crashpad",
  "optimization_guide_model_store",
  // per-profile directory
  "Default/Cache",
  "Default/Code Cache",
  "Default/GPUCache",
  "Default/DawnCache",
  "Default/DawnGraphiteCache",
  "Default/DawnWebGPUCache",
  "Default/Application Cache",
];

// Files chromium rewrites whenever a profile is actually used. The profile
// directory's own mtime is not usable for staleness: trimming caches mutates it,
// which would keep every profile looking freshly used forever.
const USE_MARKERS = ["Default/Cookies", "Default/Preferences"];

async function duBytes(path: string): Promise<number> {
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    // Not a directory (or gone) — fall back to a plain stat.
    try {
      const s = await stat(path);
      return s.isFile() ? s.size : 0;
    } catch {
      return 0;
    }
  }
  for (const e of entries) {
    const p = join(path, e.name);
    if (e.isDirectory()) total += await duBytes(p);
    else if (e.isFile()) {
      try { total += (await stat(p)).size; } catch { /* raced with chromium */ }
    }
  }
  return total;
}

// Delete the regenerable parts of one profile. Best-effort: a path that is
// missing, or that chromium recreates mid-sweep, is not an error.
export async function trimProfileCaches(profileDir: string): Promise<number> {
  let freed = 0;
  for (const rel of THROWAWAY_PATHS) {
    const target = join(profileDir, rel);
    const size = await duBytes(target);
    if (size === 0) continue;
    try {
      await rm(target, { recursive: true, force: true });
      freed += size;
    } catch { /* in use or already gone */ }
  }
  return freed;
}

export async function listProfileDirs(base = profilesBaseDir()): Promise<string[]> {
  try {
    const entries = await readdir(base, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => join(base, e.name));
  } catch {
    return [];
  }
}

export async function profileLastUsed(profileDir: string): Promise<number> {
  let newest = 0;
  for (const rel of USE_MARKERS) {
    try { newest = Math.max(newest, (await stat(join(profileDir, rel))).mtimeMs); }
    catch { /* marker absent */ }
  }
  if (newest > 0) return newest;
  try { return (await stat(profileDir)).mtimeMs; } catch { return 0; }
}

export interface ReapResult {
  trimmed: number;
  freedBytes: number;
  deleted: string[];
  skippedActive: number;
}

// Sweep the profile base: trim regenerable caches everywhere, and delete whole
// profiles nobody has used inside the TTL. Profiles with a live session are
// skipped — chromium holds their user-data-dir open.
export async function reapProfileDisk(
  opts: { now?: number; baseDir?: string; ttlDays?: number } = {}
): Promise<ReapResult> {
  const now = opts.now ?? Date.now();
  const base = opts.baseDir ?? profilesBaseDir();
  const ttlMs = (opts.ttlDays ?? config.BROWSER_PROFILE_TTL_DAYS) * 86_400_000;
  const active = new Set([...activeProfiles].map((userId) => join(base, profileDirName(userId))));
  const result: ReapResult = { trimmed: 0, freedBytes: 0, deleted: [], skippedActive: 0 };

  for (const dir of await listProfileDirs(base)) {
    if (active.has(dir)) { result.skippedActive++; continue; }

    if (ttlMs > 0 && now - (await profileLastUsed(dir)) > ttlMs) {
      const size = await duBytes(dir);
      try {
        await rm(dir, { recursive: true, force: true });
        result.deleted.push(dir);
        result.freedBytes += size;
        continue;
      } catch { /* fall through to a trim */ }
    }

    const freed = await trimProfileCaches(dir);
    if (freed > 0) { result.trimmed++; result.freedBytes += freed; }
  }
  return result;
}

let diskReaperStarted = false;
export function startProfileDiskReaper(): void {
  if (diskReaperStarted) return;
  diskReaperStarted = true;
  const run = () => {
    void reapProfileDisk()
      .then((r) => {
        if (r.freedBytes === 0 && r.deleted.length === 0) return;
        console.log(
          `[profile-disk] reclaimed ${(r.freedBytes / 1e6).toFixed(1)}MB ` +
            `(trimmed ${r.trimmed}, deleted ${r.deleted.length}, skipped ${r.skippedActive} active)`
        );
      })
      .catch((e) => console.warn(`[profile-disk] reap failed: ${String(e)}`));
  };
  setInterval(run, config.BROWSER_PROFILE_REAP_INTERVAL_SECONDS * 1000).unref();
  run();
}
