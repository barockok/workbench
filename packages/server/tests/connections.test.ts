import { describe, it, expect, vi, beforeEach } from "vitest";

const { closeCookieSession } = vi.hoisted(() => ({
  closeCookieSession: vi.fn(async () => undefined),
}));
vi.mock("../src/auth/cookie", () => ({ closeCookieSession }));

import {
  createPending,
  getPending,
  markConnected,
  reapExpired,
  _clearAll,
} from "../src/auth/connections";

describe("pending-connection store", () => {
  beforeEach(() => {
    _clearAll();
    closeCookieSession.mockClear();
  });

  it("creates a PENDING record and reads it back", () => {
    const rec = createPending({
      userId: "u1",
      integration: "jira",
      type: "cookie",
      ttlSeconds: 600,
      cookieSessionId: "sess-1",
    });
    expect(rec.status).toBe("PENDING");
    expect(rec.connectionId).toBeDefined();
    expect(getPending(rec.connectionId)?.cookieSessionId).toBe("sess-1");
  });

  it("marks a record CONNECTED by (userId, integration)", () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "oauth2", ttlSeconds: 600 });
    markConnected("u1", "jira");
    expect(getPending(rec.connectionId)?.status).toBe("CONNECTED");
  });

  it("reaps an expired cookie record: closes session + marks EXPIRED", async () => {
    const rec = createPending({
      userId: "u1",
      integration: "jira",
      type: "cookie",
      ttlSeconds: -1, // already expired
      cookieSessionId: "sess-1",
    });
    await reapExpired();
    expect(closeCookieSession).toHaveBeenCalledWith("sess-1");
    expect(getPending(rec.connectionId)?.status).toBe("EXPIRED");
  });

  it("does not reap a still-valid record", async () => {
    const rec = createPending({ userId: "u1", integration: "jira", type: "cookie", ttlSeconds: 600, cookieSessionId: "s" });
    await reapExpired();
    expect(closeCookieSession).not.toHaveBeenCalled();
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
      cookieSessionId: "sess-1",
    });
    await reapExpired(); // PENDING → EXPIRED, but not pruned (within grace)
    expect(getPending(rec.connectionId)?.status).toBe("EXPIRED");
  });
});
