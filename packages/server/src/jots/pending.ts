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
