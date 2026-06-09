import { randomUUID } from "node:crypto";

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
 *
 * Resolution is by (userId, integration) — NOT by connectionId — because the
 * capture/oauth-callback handlers don't carry the originating connectionId.
 * "Newest wins" is deliberate: on the rare same-user/same-integration
 * concurrent connect, the most recent attempt is the one marked CONNECTED.
 * Impact is benign (both records belong to the same user/target). The `>=`
 * tiebreak picks the last-inserted record on a same-second createdAt tie
 * (Map iteration is insertion-ordered), i.e. latest-inserted.
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

/** Grace window (seconds) before a terminal record is pruned from the store. */
const PRUNE_GRACE_SECONDS = 3600;

/**
 * Sweep: any PENDING record past expiry → mark EXPIRED.
 * Then prune terminal records (CONNECTED/EXPIRED) whose expiry is older than the
 * grace window, so the store doesn't grow unbounded in a long-running server.
 * The grace (1h) sits well beyond any wait_for_connection timeout (max 900s), so
 * an in-flight wait can still read a freshly-EXPIRED record before it's pruned.
 */
export async function reapExpired(): Promise<void> {
  const t = nowSec();
  const pruneCutoff = t - PRUNE_GRACE_SECONDS;
  const toDelete: string[] = [];
  for (const rec of store.values()) {
    if (rec.status === "PENDING" && rec.expiresAt <= t) {
      rec.status = "EXPIRED";
    }
    if (
      (rec.status === "CONNECTED" || rec.status === "EXPIRED") &&
      rec.expiresAt <= pruneCutoff
    ) {
      toDelete.push(rec.connectionId);
    }
  }
  for (const id of toDelete) {
    store.delete(id);
  }
}

/** Immediately reap one connection (used by wait_for_connection timeout). */
export async function reapOne(connectionId: string): Promise<void> {
  const rec = store.get(connectionId);
  if (!rec || rec.status !== "PENDING") return;
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
