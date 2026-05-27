import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
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

// Mock Playwright
vi.mock("playwright", () => ({
  chromium: {
    launchServer: vi.fn(),
    connect: vi.fn(),
  },
}));

import { chromium } from "playwright";

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
    it("starts a session and returns cdpUrl", async () => {
      const mockBrowserServer = {
        close: vi.fn().mockResolvedValue(undefined),
        wsEndpoint: vi.fn().mockReturnValue("ws://localhost:12345"),
      };

      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue({
          cookies: vi.fn().mockResolvedValue([]),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
      };

      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        cookies: vi.fn().mockResolvedValue([]),
      };

      mockBrowser.newContext.mockResolvedValue(mockContext);

      vi.mocked(chromium.launchServer).mockResolvedValue(mockBrowserServer as any);
      vi.mocked(chromium.connect).mockResolvedValue(mockBrowser as any);

      const { sessionId, cdpUrl } = await startCookieSession(
        "user-1",
        "test-integ",
        "https://example.com/login",
        "example.com"
      );

      expect(sessionId).toBeDefined();
      expect(cdpUrl).toBe("ws://localhost:12345");
      expect(chromium.launchServer).toHaveBeenCalledWith({ headless: false });

      await closeCookieSession(sessionId);
      expect(mockBrowserServer.close).toHaveBeenCalled();
    });

    it("captures cookies for allowed domains", async () => {
      const mockCookie = {
        name: "session_id",
        value: "abc",
        domain: "example.com",
        path: "/",
        expires: 9999999999,
        httpOnly: true,
        secure: true,
        sameSite: "Lax" as const,
      };

      const mockBrowserServer = {
        close: vi.fn().mockResolvedValue(undefined),
        wsEndpoint: vi.fn().mockReturnValue("ws://localhost:12345"),
      };

      const mockBrowser = {
        newContext: vi.fn().mockResolvedValue({
          cookies: vi.fn().mockResolvedValue([mockCookie]),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      };

      const mockPage = {
        goto: vi.fn().mockResolvedValue(undefined),
      };

      const mockContext = {
        newPage: vi.fn().mockResolvedValue(mockPage),
        cookies: vi.fn().mockResolvedValue([mockCookie]),
      };

      mockBrowser.newContext.mockResolvedValue(mockContext);

      vi.mocked(chromium.launchServer).mockResolvedValue(mockBrowserServer as any);
      vi.mocked(chromium.connect).mockResolvedValue(mockBrowser as any);

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
