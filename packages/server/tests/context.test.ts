import { describe, it, expect, beforeEach, vi } from "vitest";
import { createContext } from "../src/plugins/context";
import { registry } from "../src/plugins/registry";

vi.mock("../src/auth/tokens", () => ({
  getToken: vi.fn(),
}));

vi.mock("../src/auth/cookie", () => ({
  getCookies: vi.fn(),
  isCookieExpired: vi.fn(() => false),
}));

const mockCookieIntegration = {
  name: "legacy",
  version: "1.0.0",
  auth: {
    type: "cookie" as const,
    targetDomain: "legacy.com",
    cookieDomains: [".legacy.com"],
  },
};

describe("createContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(() => Promise.resolve(new Response("ok"))) as any;
  });

  describe("getToken", () => {
    it("returns access token when connected", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue({ accessToken: "tok-123", scopes: "read" });
      const ctx = createContext("user-1", "slack");
      const token = await ctx.getToken();
      expect(token).toBe("tok-123");
      expect(getToken).toHaveBeenCalledWith("user-1", "slack");
    });

    it("caches token after first call", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue({ accessToken: "tok-123", scopes: "read" });
      const ctx = createContext("user-1", "slack");
      await ctx.getToken();
      await ctx.getToken();
      expect(getToken).toHaveBeenCalledTimes(1);
    });

    it("throws when not connected", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue(null);
      const ctx = createContext("user-1", "slack");
      await expect(ctx.getToken()).rejects.toThrow("Not connected");
    });
  });

  describe("http with oauth2", () => {
    it("sets Bearer header and calls fetch", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue({ accessToken: "tok-123", scopes: "read" });
      vi.spyOn(registry, "getIntegration").mockReturnValue({
        name: "slack",
        version: "1.0.0",
        auth: { type: "oauth2" as const, authorizationUrl: "", tokenUrl: "", scopes: [] },
      });

      const ctx = createContext("user-1", "slack");
      await ctx.http("https://api.slack.com/test");

      expect(global.fetch).toHaveBeenCalledWith(
        "https://api.slack.com/test",
        expect.objectContaining({ headers: expect.any(Headers) })
      );
      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].headers.get("Authorization")).toBe("Bearer tok-123");
    });

    it("preserves existing headers", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue({ accessToken: "tok-123", scopes: "read" });
      vi.spyOn(registry, "getIntegration").mockReturnValue({
        name: "slack",
        version: "1.0.0",
        auth: { type: "oauth2" as const, authorizationUrl: "", tokenUrl: "", scopes: [] },
      });

      const ctx = createContext("user-1", "slack");
      await ctx.http("https://api.slack.com/test", { headers: { "X-Custom": "value" } });

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].headers.get("X-Custom")).toBe("value");
      expect(callArgs[1].headers.get("Authorization")).toBe("Bearer tok-123");
    });
  });

  describe("http with cookie auth", () => {
    it("sets Cookie header for allowed domain", async () => {
      const { getCookies } = await import("../src/auth/cookie");
      vi.mocked(getCookies).mockReturnValue({
        domain: "legacy.com",
        cookies: [{ name: "session", value: "abc", domain: "legacy.com", path: "/" }],
        capturedAt: 1,
      });
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegration as any);

      const ctx = createContext("user-1", "legacy");
      await ctx.http("https://legacy.com/api/data");

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].headers.get("Cookie")).toBe("session=abc");
      expect(callArgs[1].redirect).toBe("manual");
    });

    it("allows subdomain via cookieDomains", async () => {
      const { getCookies } = await import("../src/auth/cookie");
      vi.mocked(getCookies).mockReturnValue({
        domain: "legacy.com",
        cookies: [{ name: "session", value: "abc", domain: ".legacy.com", path: "/" }],
        capturedAt: 1,
      });
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegration as any);

      const ctx = createContext("user-1", "legacy");
      await ctx.http("https://app.legacy.com/api/data");
      expect(global.fetch).toHaveBeenCalled();
    });

    it("throws NOT_CONNECTED when no cookies", async () => {
      const { getCookies } = await import("../src/auth/cookie");
      vi.mocked(getCookies).mockReturnValue(null);
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegration as any);

      const ctx = createContext("user-1", "legacy");
      await expect(ctx.http("https://legacy.com/api/data")).rejects.toThrow("NOT_CONNECTED");
    });

    it("throws NOT_CONNECTED when cookies expired", async () => {
      const { getCookies, isCookieExpired } = await import("../src/auth/cookie");
      vi.mocked(getCookies).mockReturnValue({
        domain: "legacy.com",
        cookies: [{ name: "session", value: "abc", domain: "legacy.com", path: "/", expires: 1 }],
        capturedAt: 1,
      });
      vi.mocked(isCookieExpired).mockReturnValueOnce(true);
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegration as any);

      const ctx = createContext("user-1", "legacy");
      await expect(ctx.http("https://legacy.com/api/data")).rejects.toThrow("NOT_CONNECTED");
    });

    it("throws for foreign domain", async () => {
      const { getCookies } = await import("../src/auth/cookie");
      vi.mocked(getCookies).mockReturnValue({
        domain: "legacy.com",
        cookies: [{ name: "session", value: "abc", domain: "legacy.com", path: "/" }],
        capturedAt: 1,
      });
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegration as any);

      const ctx = createContext("user-1", "legacy");
      await expect(ctx.http("https://evil.com/steal")).rejects.toThrow(
        "Cookie auth: URL host evil.com not in declared cookieDomains"
      );
    });

    it("caches cookie data after first call", async () => {
      const { getCookies } = await import("../src/auth/cookie");
      vi.mocked(getCookies).mockReturnValue({
        domain: "legacy.com",
        cookies: [{ name: "session", value: "abc", domain: "legacy.com", path: "/" }],
        capturedAt: 1,
      });
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegration as any);

      const ctx = createContext("user-1", "legacy");
      await ctx.http("https://legacy.com/api/1");
      await ctx.http("https://legacy.com/api/2");

      expect(getCookies).toHaveBeenCalledTimes(1);
    });

    it("joins multiple cookies with semicolon", async () => {
      const { getCookies } = await import("../src/auth/cookie");
      vi.mocked(getCookies).mockReturnValue({
        domain: "legacy.com",
        cookies: [
          { name: "a", value: "1", domain: "legacy.com", path: "/" },
          { name: "b", value: "2", domain: "legacy.com", path: "/" },
        ],
        capturedAt: 1,
      });
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegration as any);

      const ctx = createContext("user-1", "legacy");
      await ctx.http("https://legacy.com/api/data");

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].headers.get("Cookie")).toBe("a=1; b=2");
    });
  });

  describe("http without integration config", () => {
    it("falls back to Bearer token when integration not in registry", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue({ accessToken: "tok-123", scopes: "read" });
      vi.spyOn(registry, "getIntegration").mockReturnValue(undefined);

      const ctx = createContext("user-1", "unknown");
      await ctx.http("https://api.example.com/test");

      const callArgs = (global.fetch as any).mock.calls[0];
      expect(callArgs[1].headers.get("Authorization")).toBe("Bearer tok-123");
    });
  });
});
