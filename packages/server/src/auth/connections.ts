import { randomUUID } from "node:crypto";
import { closeCookieSession } from "./cookie";

export type ConnectionType = "oauth2" | "cookie";
export type ConnectionStatus = "PENDING" | "CONNECTED" | "EXPIRED";

export interface PendingConnection {
  connectionId: string;
  userId: string;
  integration: string;
  type: ConnectionType;
  status: ConnectionStatus;
  createdAt: number; // unix seconds
  expiresAt: number; // unix seconds
  cookieSessionId?: string;
}

const store = new Map<string, PendingConnection>();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function createPending(args: {
  userId: string;
  integration: string;
  type: ConnectionType;
  ttlSeconds: number;
  cookieSessionId?: string;
}): PendingConnection {
  const createdAt = nowSec();
  const rec: PendingConnection = {
    connectionId: randomUUID(),
    userId: args.userId,
    integration: args.integration,
    type: args.type,
    status: "PENDING",
    createdAt,
    expiresAt: createdAt + args.ttlSeconds,
    cookieSessionId: args.cookieSessionId,
  };
  store.set(rec.connectionId, rec);
  return rec;
}

export function getPending(connectionId: string): PendingConnection | undefined {
  return store.get(connectionId);
}

/**
 * Flip the newest PENDING record for (userId, integration) to CONNECTED.
 * Called from the cookie capture handler and the oauth callback handler.
 */
export function markConnected(userId: string, integration: string): void {
  let newest: PendingConnection | undefined;
  for (const rec of store.values()) {
    if (rec.userId === userId && rec.integration === integration && rec.status === "PENDING") {
      if (!newest || rec.createdAt >= newest.createdAt) newest = rec;
    }
  }
  if (newest) newest.status = "CONNECTED";
}

/** Sweep: any PENDING record past expiry → close its cookie session + mark EXPIRED. */
export async function reapExpired(): Promise<void> {
  const t = nowSec();
  for (const rec of store.values()) {
    if (rec.status === "PENDING" && rec.expiresAt <= t) {
      if (rec.cookieSessionId) {
        await closeCookieSession(rec.cookieSessionId).catch(() => undefined);
      }
      rec.status = "EXPIRED";
    }
  }
}

/** Immediately reap one connection (used by wait_for_connection timeout). */
export async function reapOne(connectionId: string): Promise<void> {
  const rec = store.get(connectionId);
  if (!rec || rec.status !== "PENDING") return;
  if (rec.cookieSessionId) {
    await closeCookieSession(rec.cookieSessionId).catch(() => undefined);
  }
  rec.status = "EXPIRED";
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startReaper(intervalMs = 60_000): void {
  if (timer) return;
  timer = setInterval(() => {
    void reapExpired();
  }, intervalMs);
  timer.unref?.();
}

export function stopReaper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Test-only: wipe the store. */
export function _clearAll(): void {
  store.clear();
}
