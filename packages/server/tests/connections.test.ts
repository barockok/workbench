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
});
