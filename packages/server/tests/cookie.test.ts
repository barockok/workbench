import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// Shared mock state so we can drive the CDP responses per-test. Declared
// here in module scope so the hoisted vi.mock factories can read it.
const { mockCdpResponses } = vi.hoisted(() => ({
  mockCdpResponses: [] as { result?: Record<string, unknown>; error?: { message: string } }[],
}));

vi.mock("playwright", () => ({
  chromium: {
    executablePath: () => "/fake/chromium",
  },
}));

vi.mock("node:child_process", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    spawn: () => {
      const proc = new EventEmitter() as EventEmitter & { kill: () => void; pid: number };
      proc.kill = () => undefined;
      proc.pid = 1234;
      return proc;
    },
  };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, mkdtempSync: () => "/tmp/awb-cookie-test" };
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rm: async () => undefined };
});

vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    send = () => undefined;
    close = () => undefined;
    constructor() {
      super();
      setImmediate(() => {
        this.emit("open");
        const reply = mockCdpResponses.shift() ?? { result: {} };
        this.emit("message", JSON.stringify({ id: 1, ...reply }));
      });
    }
  }
  return { default: FakeWebSocket, WebSocket: FakeWebSocket };
});

import {
  startCookieSession,
  captureCookies,
  closeCookieSession,
  storeCookies,
  getCookies,
  deleteCookies,
  isCookieExpired,
  hasValidCookies,
} from "../src/auth/cookie";
import { db } from "../src/db";

describe("cookie auth", () => {
  beforeAll(() => {
    // Ensure clean state
    db.prepare("DELETE FROM connections WHERE integration = ?").run("test-cookie");
  });

  afterAll(() => {
    db.prepare("DELETE FROM connections WHERE integration = ?").run("test-cookie");
  });

  describe("storeCookies / getCookies / deleteCookies", () => {
    it("stores and retrieves cookie data", () => {
      const data = {
        domain: "example.com",
        cookies: [
          { name: "session_id", value: "abc123", domain: ".example.com", path: "/", expires: 9999999999 },
        ],
        capturedAt: Math.floor(Date.now() / 1000),
      };

      storeCookies("user-1", "test-cookie", data);
      const retrieved = getCookies("user-1", "test-cookie");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.domain).toBe("example.com");
      expect(retrieved?.cookies[0].name).toBe("session_id");
      expect(retrieved?.cookies[0].value).toBe("abc123");
    });

    it("returns null for missing cookies", () => {
      const result = getCookies("user-none", "test-none");
      expect(result).toBeNull();
    });

    it("deletes cookies", () => {
      const data = {
        domain: "example.com",
        cookies: [{ name: "x", value: "y", domain: "example.com", path: "/" }],
        capturedAt: Math.floor(Date.now() / 1000),
      };
      storeCookies("user-2", "test-cookie", data);
      deleteCookies("user-2", "test-cookie");
      expect(getCookies("user-2", "test-cookie")).toBeNull();
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
  });

  describe("hasValidCookies", () => {
    it("returns true for valid cookies", () => {
      const data = {
        domain: "example.com",
        cookies: [{ name: "s", value: "v", domain: "example.com", path: "/", expires: 9999999999 }],
        capturedAt: Math.floor(Date.now() / 1000),
      };
      storeCookies("user-3", "test-cookie", data);
      expect(hasValidCookies("user-3", "test-cookie")).toBe(true);
    });

    it("returns false for expired cookies", () => {
      const data = {
        domain: "example.com",
        cookies: [{ name: "s", value: "v", domain: "example.com", path: "/", expires: 1000 }],
        capturedAt: Math.floor(Date.now() / 1000),
      };
      storeCookies("user-4", "test-cookie", data);
      expect(hasValidCookies("user-4", "test-cookie")).toBe(false);
    });

    it("returns false for missing cookies", () => {
      expect(hasValidCookies("user-none", "test-none")).toBe(false);
    });
  });

  describe("startCookieSession / captureCookies / closeCookieSession", () => {
    function mockFetchForStart(extraTargets: unknown[] = []) {
      const browserWs = "ws://127.0.0.1:9000/devtools/browser/abc";
      const pageTarget = {
        id: "p1",
        type: "page",
        url: "https://example.com/login",
        webSocketDebuggerUrl: "ws://127.0.0.1:9000/devtools/page/p1",
      };
      const targets = [pageTarget, ...extraTargets];
      const fetchMock = vi.fn(async (url: string) => {
        if (url.endsWith("/json/version")) {
          return new Response(JSON.stringify({ webSocketDebuggerUrl: browserWs }), { status: 200 });
        }
        if (url.endsWith("/json")) {
          return new Response(JSON.stringify(targets), { status: 200 });
        }
        return new Response("", { status: 404 });
      });
      vi.stubGlobal("fetch", fetchMock);
      return { fetchMock, browserWs };
    }

    it("starts a session and returns cdpUrl + cdpToken", async () => {
      mockFetchForStart();
      const { sessionId, cdpUrl, cdpToken } = await startCookieSession(
        "user-1",
        "test-integ",
        "https://example.com/login",
        "example.com"
      );

      expect(sessionId).toBeDefined();
      expect(cdpUrl).toBe("ws://127.0.0.1:9000/devtools/page/p1");
      expect(cdpToken).toBeDefined();
      expect(cdpToken).not.toEqual(sessionId);

      await closeCookieSession(sessionId);
    });

    it("captures cookies for allowed domains", async () => {
      mockFetchForStart();
      const allCookies = [
        {
          name: "session_id",
          value: "abc",
          domain: "example.com",
          path: "/",
          expires: 9999999999,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
        {
          // Off-domain cookie that must be filtered out.
          name: "tracker",
          value: "xx",
          domain: "evil.example.org",
          path: "/",
          expires: 9999999999,
        },
      ];
      // Storage.getCookies CDP reply for captureCookies.
      mockCdpResponses.length = 0;
      mockCdpResponses.push({ result: { cookies: allCookies } });

      const { sessionId } = await startCookieSession(
        "user-1",
        "test-integ",
        "https://example.com/login",
        "example.com",
        [".example.com"]
      );

      const captured = await captureCookies(sessionId);
      expect(captured.cookies).toHaveLength(1);
      expect(captured.cookies[0].name).toBe("session_id");
      expect(captured.cookies[0].httpOnly).toBe(true);

      await closeCookieSession(sessionId);
    });
  });
});
