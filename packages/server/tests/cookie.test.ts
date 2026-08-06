import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// resetBrowserProfile's test spies on `rm`; the native node:fs/promises module
// has non-configurable props, so re-export it as a plain object to make `rm`
// spy-able.
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: async () => undefined };
});

import {
  storeCookies,
  getCookies,
  deleteCookies,
  isCookieExpired,
  hasValidCookies,
  createProxyAuthHandler,
  resetBrowserProfile,
  filterCookies,
} from "../src/auth/cookie";
import { db } from "../src/db";

describe("cookie auth", () => {
  beforeAll(async () => {
    // Ensure clean state
    await db.run("DELETE FROM connections WHERE integration = ?", ["test-cookie"]);
  });

  afterAll(async () => {
    await db.run("DELETE FROM connections WHERE integration = ?", ["test-cookie"]);
  });

  describe("storeCookies / getCookies / deleteCookies", () => {
    it("stores and retrieves cookie data", async () => {
      const data = {
        domain: "example.com",
        cookies: [
          { name: "session_id", value: "abc123", domain: ".example.com", path: "/", expires: 9999999999 },
        ],
        capturedAt: Math.floor(Date.now() / 1000),
      };

      await storeCookies("user-1", "test-cookie", data);
      const retrieved = await getCookies("user-1", "test-cookie");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.domain).toBe("example.com");
      expect(retrieved?.cookies[0].name).toBe("session_id");
      expect(retrieved?.cookies[0].value).toBe("abc123");
    });

    it("returns null for missing cookies", async () => {
      const result = await getCookies("user-none", "test-none");
      expect(result).toBeNull();
    });

    it("deletes cookies", async () => {
      const data = {
        domain: "example.com",
        cookies: [{ name: "x", value: "y", domain: "example.com", path: "/" }],
        capturedAt: Math.floor(Date.now() / 1000),
      };
      await storeCookies("user-2", "test-cookie", data);
      await deleteCookies("user-2", "test-cookie");
      expect(await getCookies("user-2", "test-cookie")).toBeNull();
    });
  });

  describe("isCookieExpired", () => {
    it("returns false for non-expired cookies", () => {
      const data = {
        domain: "example.com",
        cookies: [{ name: "s", value: "v", domain: "example.com", path: "/", expires: 9999999999 }],
        capturedAt: Math.floor(Date.now() / 1000),
      };
      expect(isCookieExpired(data)).toBe(false);
    });

    it("returns true for expired cookies", () => {
      const data = {
        domain: "example.com",
        cookies: [{ name: "s", value: "v", domain: "example.com", path: "/", expires: 1000 }],
        capturedAt: Math.floor(Date.now() / 1000),
      };
      expect(isCookieExpired(data)).toBe(true);
    });

    it("returns false for session cookies (no expires)", () => {
      const data = {
        domain: "example.com",
        cookies: [{ name: "s", value: "v", domain: "example.com", path: "/" }],
        capturedAt: Math.floor(Date.now() / 1000),
      };
      expect(isCookieExpired(data)).toBe(false);
    });

    it("returns false when one cookie expired but a live one remains (don't let junk poison the set)", () => {
      // Multi-subdomain repro: a short-lived SSO/analytics cookie expires
      // seconds after capture, but the long-lived session token is still valid.
      const now = Math.floor(Date.now() / 1000);
      const data = {
        domain: "example.com",
        cookies: [
          { name: "sso_session_hash", value: "x", domain: "sso.example.com", path: "/", expires: now - 10 },
          { name: "__Secure-session-token.0", value: "y", domain: "app.example.com", path: "/", expires: now + 86400 },
        ],
        capturedAt: now,
      };
      expect(isCookieExpired(data)).toBe(false);
    });

    it("returns true only when every cookie with an expiry is expired", () => {
      const now = Math.floor(Date.now() / 1000);
      const data = {
        domain: "example.com",
        cookies: [
          { name: "a", value: "1", domain: "example.com", path: "/", expires: now - 10 },
          { name: "b", value: "2", domain: "example.com", path: "/", expires: now - 5 },
        ],
        capturedAt: now,
      };
      expect(isCookieExpired(data)).toBe(true);
    });
  });

  describe("createProxyAuthHandler", () => {
    it("enables Fetch with auth handling on each attached target", () => {
      const sent: any[] = [];
      const h = createProxyAuthHandler({ username: "u", password: "p" });
      h({ method: "Target.attachedToTarget", params: { sessionId: "S1" } }, (m) => sent.push(m));
      expect(sent[0]).toMatchObject({ sessionId: "S1", method: "Fetch.enable", params: { handleAuthRequests: true } });
    });

    it("answers a PROXY auth challenge with the configured credentials", () => {
      const sent: any[] = [];
      const h = createProxyAuthHandler({ username: "u", password: "p" });
      h(
        { method: "Fetch.authRequired", sessionId: "S1", params: { requestId: "R1", authChallenge: { source: "Proxy" } } },
        (m) => sent.push(m)
      );
      expect(sent[0]).toMatchObject({
        sessionId: "S1",
        method: "Fetch.continueWithAuth",
        params: { requestId: "R1", authChallengeResponse: { response: "ProvideCredentials", username: "u", password: "p" } },
      });
    });

    it("does NOT hand proxy creds to a server (site) auth challenge", () => {
      const sent: any[] = [];
      const h = createProxyAuthHandler({ username: "u", password: "p" });
      h(
        { method: "Fetch.authRequired", sessionId: "S1", params: { requestId: "R1", authChallenge: { source: "Server" } } },
        (m) => sent.push(m)
      );
      expect(sent[0].params.authChallengeResponse).toEqual({ response: "Default" });
    });

    it("continues non-auth paused requests", () => {
      const sent: any[] = [];
      const h = createProxyAuthHandler({ username: "u", password: "p" });
      h({ method: "Fetch.requestPaused", sessionId: "S1", params: { requestId: "R2" } }, (m) => sent.push(m));
      expect(sent[0]).toMatchObject({ sessionId: "S1", method: "Fetch.continueRequest", params: { requestId: "R2" } });
    });
  });

  describe("hasValidCookies", () => {
    it("returns true for valid cookies", async () => {
      const data = {
        domain: "example.com",
        cookies: [{ name: "s", value: "v", domain: "example.com", path: "/", expires: 9999999999 }],
        capturedAt: Math.floor(Date.now() / 1000),
      };
      await storeCookies("user-3", "test-cookie", data);
      expect(await hasValidCookies("user-3", "test-cookie")).toBe(true);
    });

    it("returns false for expired cookies", async () => {
      const data = {
        domain: "example.com",
        cookies: [{ name: "s", value: "v", domain: "example.com", path: "/", expires: 1000 }],
        capturedAt: Math.floor(Date.now() / 1000),
      };
      await storeCookies("user-4", "test-cookie", data);
      expect(await hasValidCookies("user-4", "test-cookie")).toBe(false);
    });

    it("returns false for missing cookies", async () => {
      expect(await hasValidCookies("user-none", "test-none")).toBe(false);
    });
  });

  describe("resetBrowserProfile", () => {
    it("wipes the user's profile dir", async () => {
      const rmMod = await import("node:fs/promises");
      const rmSpy = vi.spyOn(rmMod, "rm").mockResolvedValue(undefined as any);
      await resetBrowserProfile("reset-me");
      const wiped = rmSpy.mock.calls.some((c) => String(c[0]).includes("/reset-me"));
      expect(wiped).toBe(true);
    });
  });

  describe("filterCookies", () => {
    const now = Math.floor(Date.now() / 1000);
    const raw = [
      { name: "live", value: "1", domain: ".example.com", path: "/", expires: now + 86400 },
      { name: "dead", value: "2", domain: "example.com", path: "/", expires: now - 10 },
      { name: "session", value: "3", domain: "app.example.com", path: "/" },
      { name: "sibling", value: "4", domain: "other.com", path: "/", expires: now + 86400 },
    ];

    it("keeps cookies on the target domain and its subdomains", () => {
      const out = filterCookies(raw, ["example.com"], now);
      const names = out.map((c) => c.name).sort();
      expect(names).toEqual(["live", "session"]);
    });

    it("drops cookies already expired at capture time", () => {
      const out = filterCookies(raw, ["example.com"], now);
      expect(out.find((c) => c.name === "dead")).toBeUndefined();
    });

    it("excludes sibling/unrelated hosts", () => {
      const out = filterCookies(raw, ["example.com"], now);
      expect(out.find((c) => c.name === "sibling")).toBeUndefined();
    });

    it("normalizes expires: 0/absent becomes undefined", () => {
      const out = filterCookies(raw, ["example.com"], now);
      expect(out.find((c) => c.name === "session")?.expires).toBeUndefined();
    });
  });
});
