import { describe, it, expect, beforeEach } from "vitest";

import {
  createPending,
  getPending,
  markConnected,
  reapExpired,
  redeemPending,
  _clearAll,
} from "../src/auth/connections";

describe("pending-connection store", () => {
  beforeEach(() => {
    _clearAll();
  });

  it("creates a PENDING record and reads it back", () => {
    const rec = createPending({
      userId: "u1",
      integration: "jira",
      type: "cookie",
      ttlSeconds: 600,
    });
    expect(rec.status).toBe("PENDING");
    expect(rec.connectionId).toBeDefined();
  });

  it("marks a record CONNECTED by (userId, integration)", () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "oauth2", ttlSeconds: 600 });
    markConnected("u1", "jira");
    expect(getPending(rec.connectionId)?.status).toBe("CONNECTED");
  });

  it("expires a pending cookie connection without tearing down any browser session", async () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: 0 });
    await reapExpired();
    expect(getPending(rec.connectionId)?.status).toBe("EXPIRED");
  });

  it("reaps an expired record and marks it EXPIRED", async () => {
    const rec = createPending({
      userId: "u1",
      integration: "jira",
      type: "cookie",
      ttlSeconds: -1, // already expired
    });
    await reapExpired();
    expect(getPending(rec.connectionId)?.status).toBe("EXPIRED");
  });

  it("does not reap a still-valid record", async () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: 600 });
    await reapExpired();
    expect(getPending(rec.connectionId)?.status).toBe("PENDING");
  });

  it("prunes a terminal record whose expiry is past the grace window", async () => {
    const rec = createPending({
      userId: "u1",
      integration: "jira",
      type: "oauth2",
      ttlSeconds: -7200, // expired > 1h ago
    });
    markConnected("u1", "jira"); // terminal: CONNECTED
    expect(getPending(rec.connectionId)?.status).toBe("CONNECTED");
    await reapExpired();
    expect(getPending(rec.connectionId)).toBeUndefined();
  });

  it("does not prune a terminal record still within the grace window", async () => {
    const rec = createPending({
      userId: "u1",
      integration: "jira",
      type: "cookie",
      ttlSeconds: -1, // expiresAt ~now, within 1h grace
    });
    await reapExpired(); // PENDING → EXPIRED, but not pruned (within grace)
    expect(getPending(rec.connectionId)?.status).toBe("EXPIRED");
  });

  it("redeems a pending record once and stamps redeemedAt", () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: 600 });
    const first = redeemPending(rec.connectionId);
    expect(first).not.toBeNull();
    expect(first!.connectionId).toBe(rec.connectionId);
    expect(first!.redeemedAt).toBeGreaterThan(0);
    // Still PENDING: wait_for_connection must keep waiting until the flow completes.
    expect(first!.status).toBe("PENDING");
  });

  it("refuses a second redemption of the same record", () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: 600 });
    expect(redeemPending(rec.connectionId)).not.toBeNull();
    expect(redeemPending(rec.connectionId)).toBeNull();
  });

  it("refuses an unknown connectionId", () => {
    expect(redeemPending("no-such-id")).toBeNull();
  });

  it("refuses an expired record", () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: -1 });
    expect(redeemPending(rec.connectionId)).toBeNull();
  });
});
