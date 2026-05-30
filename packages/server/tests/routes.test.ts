import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import Fastify from "fastify";
import { registerApiRoutes } from "../src/api/routes";
import { db } from "../src/db";
import { registry } from "../src/plugins/registry";
import { signConnectToken } from "../src/auth/connect-token";
import { stopReaper } from "../src/auth/connections";

vi.mock("../src/config", () => ({
  config: {
    GOOGLE_CLIENT_ID: "test-google-client-id",
    GOOGLE_CLIENT_SECRET: "test-google-client-secret",
    PORTAL_URL: "http://localhost:5173",
    SESSION_SECRET: "test-session-secret-32-chars-long!!",
    ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000000",
    NODE_ENV: "test",
    PORT: "3000",
    DATABASE_URL: "./data/tokens.db",
    PLUGINS_DIR: "./plugins",
    AUDIT_LOG_DEST: "sqlite",
    AUDIT_LOG_KAFKA_TOPIC: "audit-log",
    SERVER_PUBLIC_URL: "http://localhost:3000",
  },
}));

vi.mock("../src/auth/google", () => ({
  buildAuthUrl: vi.fn(() => "https://accounts.google.com/oauth?test=1"),
  handleCallback: vi.fn(),
}));

vi.mock("../src/auth/plugin-oauth", () => ({
  buildPluginAuthUrl: vi.fn(() => "https://example.com/oauth?plugin=1"),
  handlePluginCallback: vi.fn(),
}));

vi.mock("../src/auth/session", () => ({
  signSession: vi.fn(() => "signed-jwt-token"),
  verifySession: vi.fn((token: string) => {
    if (token === "valid-jwt") return { userId: "user-1", email: "test@example.com" };
    throw new Error("Invalid token");
  }),
}));

vi.mock("../src/auth/users", () => ({
  verifyApiKey: vi.fn((key: string) => (key === "valid-api-key" ? "user-1" : null)),
  getUserById: vi.fn((id: string) =>
    id === "user-1" ? { id: "user-1", email: "test@example.com" } : null
  ),
}));

vi.mock("../src/auth/tokens", () => ({
  getToken: vi.fn(() => null),
}));

vi.mock("../src/auth/cookie", () => ({
  startCookieSession: vi.fn(() => Promise.resolve({ sessionId: "sess-1", cdpUrl: "ws://cdp" })),
  captureCookies: vi.fn(() =>
    Promise.resolve({ domain: "example.com", cookies: [{ name: "x", value: "y" }], capturedAt: 1 })
  ),
  closeCookieSession: vi.fn(() => Promise.resolve()),
  storeCookies: vi.fn(),
  hasValidCookies: vi.fn(() => false),
  getSessionOwner: vi.fn(() => null),
}));

vi.mock("../src/auth/oauth", () => ({
  createAuthState: vi.fn(() => "test-state"),
}));

vi.mock("../src/auth/connections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/auth/connections")>();
  return {
    ...actual,
    startReaper: vi.fn(),
    stopReaper: vi.fn(),
    markConnected: vi.fn(),
  };
});

async function buildApp() {
  const app = Fastify();
  await registerApiRoutes(app);
  return app;
}

describe("API routes", () => {
  beforeEach(() => {
    db.exec("DELETE FROM users");
    db.exec("DELETE FROM pending_auth");
    vi.clearAllMocks();
  });

  afterAll(() => {
    stopReaper();
  });

  describe("GET /api/auth/google", () => {
    it("returns auth URL when configured", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/google" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).url).toContain("accounts.google.com");
    });

    it("returns 503 when not configured", async () => {
      const { config } = await import("../src/config");
      const original = config.GOOGLE_CLIENT_ID;
      config.GOOGLE_CLIENT_ID = undefined;
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/google" });
      expect(res.statusCode).toBe(503);
      config.GOOGLE_CLIENT_ID = original;
    });
  });

  describe("GET /api/auth/google/callback", () => {
    it("redirects with token on success", async () => {
      const { handleCallback } = await import("../src/auth/google");
      vi.mocked(handleCallback).mockResolvedValue({ userId: "user-1", email: "test@example.com" });
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/google/callback?code=abc&state=xyz" });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("token=signed-jwt-token");
    });

    it("returns 400 on provider error", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/google/callback?error=access_denied" });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toContain("access_denied");
    });

    it("returns 400 when code missing", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/google/callback?state=xyz" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 on callback failure", async () => {
      const { handleCallback } = await import("../src/auth/google");
      vi.mocked(handleCallback).mockRejectedValue(new Error("Invalid state"));
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/google/callback?code=abc&state=xyz" });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe("Invalid state");
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns user profile with valid JWT", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ id: "user-1", email: "test@example.com" });
    });

    it("returns user profile with valid API key", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: "Bearer valid-api-key" },
      });
      expect(res.statusCode).toBe(200);
    });

    it("returns 401 without auth", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/me" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for unknown user", async () => {
      const { getUserById } = await import("../src/auth/users");
      vi.mocked(getUserById).mockReturnValue(null);
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("returns success", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "POST", url: "/api/auth/logout" });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).success).toBe(true);
    });
  });

  describe("GET /api/integrations", () => {
    it("returns integrations for authenticated user", async () => {
      vi.spyOn(registry, "listIntegrations").mockReturnValue([
        { name: "slack", version: "1.0.0", auth: { type: "oauth2" as const, authorizationUrl: "", tokenUrl: "", scopes: [] } },
      ]);
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/integrations",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).integrations).toHaveLength(1);
    });

    it("returns 401 without auth", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/integrations" });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /api/auth/:integration", () => {
    const mockOauthInteg = {
      name: "slack",
      version: "1.0.0",
      auth: { type: "oauth2" as const, authorizationUrl: "https://slack.com/oauth", tokenUrl: "https://slack.com/token", scopes: ["chat:write"] },
    };

    const mockCookieInteg = {
      name: "legacy",
      version: "1.0.0",
      auth: { type: "cookie" as const, loginUrl: "https://legacy.com/login", targetDomain: "legacy.com" },
    };

    it("returns oauth2 URL for oauth2 integration", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockOauthInteg);
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/slack",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).type).toBe("oauth2");
      expect(JSON.parse(res.body).url).toBeDefined();
    });

    it("returns cookie session for cookie integration", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieInteg);
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/legacy",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.type).toBe("cookie");
      expect(body.sessionId).toBe("sess-1");
    });

    it("returns state for unknown auth type", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue({
        name: "none",
        version: "1.0.0",
        auth: { type: "none" as const },
      });
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/none",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).state).toBe("test-state");
    });

    it("returns 401 without auth", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/slack" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 404 for unknown integration", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(undefined);
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/unknown",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 503 when oauth client not configured", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockOauthInteg);
      const { buildPluginAuthUrl } = await import("../src/auth/plugin-oauth");
      vi.mocked(buildPluginAuthUrl).mockImplementation(() => {
        throw new Error("OAuth client not configured for slack");
      });
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/slack",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(503);
    });
  });

  describe("GET /api/auth/plugin/:integration/callback", () => {
    it("redirects on success", async () => {
      const { handlePluginCallback } = await import("../src/auth/plugin-oauth");
      vi.mocked(handlePluginCallback).mockResolvedValue({ userId: "user-1" });
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/plugin/slack/callback?code=abc&state=xyz" });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toContain("connected=slack");
    });

    it("returns 400 on provider error", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/plugin/slack/callback?error=denied" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when code or state missing", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/plugin/slack/callback?code=abc" });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 on handler failure", async () => {
      const { handlePluginCallback } = await import("../src/auth/plugin-oauth");
      vi.mocked(handlePluginCallback).mockRejectedValue(new Error("Invalid state"));
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/auth/plugin/slack/callback?code=abc&state=xyz" });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("POST /api/auth/cookie/:integration/capture", () => {
    it("captures cookies for owner", async () => {
      const { getSessionOwner, captureCookies, storeCookies, closeCookieSession } = await import("../src/auth/cookie");
      vi.mocked(getSessionOwner).mockReturnValue({ userId: "user-1", integration: "legacy" });
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/cookie/legacy/capture",
        headers: { authorization: "Bearer valid-jwt" },
        payload: { sessionId: "sess-1" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).success).toBe(true);
      expect(storeCookies).toHaveBeenCalled();
      expect(closeCookieSession).toHaveBeenCalled();
    });

    it("returns 401 without auth", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/cookie/legacy/capture",
        payload: { sessionId: "sess-1" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for non-owner", async () => {
      const { getSessionOwner } = await import("../src/auth/cookie");
      vi.mocked(getSessionOwner).mockReturnValue({ userId: "user-2", integration: "legacy" });
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/cookie/legacy/capture",
        headers: { authorization: "Bearer valid-jwt" },
        payload: { sessionId: "sess-1" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 403 for wrong integration", async () => {
      const { getSessionOwner } = await import("../src/auth/cookie");
      vi.mocked(getSessionOwner).mockReturnValue({ userId: "user-1", integration: "other" });
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/cookie/legacy/capture",
        headers: { authorization: "Bearer valid-jwt" },
        payload: { sessionId: "sess-1" },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 400 on capture error", async () => {
      const { getSessionOwner, captureCookies } = await import("../src/auth/cookie");
      vi.mocked(getSessionOwner).mockReturnValue({ userId: "user-1", integration: "legacy" });
      vi.mocked(captureCookies).mockRejectedValue(new Error("Session expired"));
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/cookie/legacy/capture",
        headers: { authorization: "Bearer valid-jwt" },
        payload: { sessionId: "sess-1" },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).error).toBe("Session expired");
    });
  });

  describe("POST /api/auth/cookie/:integration/cancel", () => {
    it("cancels session for owner", async () => {
      const { getSessionOwner, closeCookieSession } = await import("../src/auth/cookie");
      vi.mocked(getSessionOwner).mockReturnValue({ userId: "user-1", integration: "legacy" });
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/cookie/legacy/cancel",
        headers: { authorization: "Bearer valid-jwt" },
        payload: { sessionId: "sess-1" },
      });
      expect(res.statusCode).toBe(200);
      expect(closeCookieSession).toHaveBeenCalledWith("sess-1");
    });

    it("returns 401 without auth", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/cookie/legacy/cancel",
        payload: { sessionId: "sess-1" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for non-owner", async () => {
      const { getSessionOwner } = await import("../src/auth/cookie");
      vi.mocked(getSessionOwner).mockReturnValue({ userId: "user-2", integration: "legacy" });
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/cookie/legacy/cancel",
        headers: { authorization: "Bearer valid-jwt" },
        payload: { sessionId: "sess-1" },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("connect endpoints", () => {
    const mockCookieIntegForConnect = {
      name: "legacy",
      version: "1.0.0",
      auth: {
        type: "cookie" as const,
        loginUrl: "https://legacy.com/login",
        targetDomain: "legacy.com",
      },
    };

    it("GET /api/connect/session returns session info for a valid token", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieIntegForConnect);
      const jwt = await signConnectToken(
        { connectionId: "c1", userId: "u1", integration: "legacy", sessionId: "s1", cdpToken: "t1" },
        600
      );
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/connect/session",
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.integration).toBe("legacy");
      expect(body.sessionId).toBe("s1");
      expect(body.cdpToken).toBe("t1");
      expect(body.cdpProxyUrl).toBe("/api/auth/cookie/legacy/cdp");
    });

    it("GET /api/connect/session 401s on a bad token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/connect/session",
        headers: { authorization: "Bearer garbage" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("GET /api/connect/session 404s when integration is not cookie-type / not found", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(undefined);
      const jwt = await signConnectToken(
        { connectionId: "c1", userId: "u1", integration: "legacy", sessionId: "s1", cdpToken: "t1" },
        600
      );
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/connect/session",
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it("POST /api/connect/capture captures cookies for the token owner", async () => {
      const { getSessionOwner, captureCookies, storeCookies, closeCookieSession } = await import("../src/auth/cookie");
      const { markConnected } = await import("../src/auth/connections");
      vi.mocked(getSessionOwner).mockReturnValue({ userId: "u1", integration: "legacy" });
      vi.mocked(captureCookies).mockResolvedValue({
        domain: "legacy.com",
        cookies: [{ name: "x", value: "y" }],
        capturedAt: 1,
      });
      const jwt = await signConnectToken(
        { connectionId: "c1", userId: "u1", integration: "legacy", sessionId: "s1", cdpToken: "t1" },
        600
      );
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/connect/capture",
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.cookieCount).toBe(1);
      expect(storeCookies).toHaveBeenCalled();
      expect(closeCookieSession).toHaveBeenCalledWith("s1");
      expect(markConnected).toHaveBeenCalledWith("u1", "legacy");
      expect(captureCookies).toHaveBeenCalledWith("s1");
    });

    it("POST /api/connect/capture 403s on ownership mismatch", async () => {
      const { getSessionOwner } = await import("../src/auth/cookie");
      vi.mocked(getSessionOwner).mockReturnValue({ userId: "other", integration: "legacy" });
      const jwt = await signConnectToken(
        { connectionId: "c1", userId: "u1", integration: "legacy", sessionId: "s1", cdpToken: "t1" },
        600
      );
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/connect/capture",
        headers: { authorization: `Bearer ${jwt}` },
      });
      expect(res.statusCode).toBe(403);
    });

    it("POST /api/connect/capture 401s on a bad token", async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/api/connect/capture",
        headers: { authorization: "Bearer garbage" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /api/connections", () => {
    it("returns connection status for oauth2 integrations", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue({ accessToken: "tok", scopes: "" });
      vi.spyOn(registry, "listIntegrations").mockReturnValue([
        { name: "slack", version: "1.0.0", auth: { type: "oauth2" as const, authorizationUrl: "", tokenUrl: "", scopes: [] } },
      ]);
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/connections",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).connections[0].connected).toBe(true);
    });

    it("returns connection status for cookie integrations", async () => {
      const { hasValidCookies } = await import("../src/auth/cookie");
      vi.mocked(hasValidCookies).mockReturnValue(true);
      vi.spyOn(registry, "listIntegrations").mockReturnValue([
        { name: "legacy", version: "1.0.0", auth: { type: "cookie" as const, loginUrl: "", targetDomain: "" } },
      ]);
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url: "/api/connections",
        headers: { authorization: "Bearer valid-jwt" },
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).connections[0].connected).toBe(true);
    });

    it("returns 401 without auth", async () => {
      const app = await buildApp();
      const res = await app.inject({ method: "GET", url: "/api/connections" });
      expect(res.statusCode).toBe(401);
    });
  });
});
