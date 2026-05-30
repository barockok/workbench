import crypto from "crypto";
import { FastifyInstance } from "fastify";
import { registry } from "../plugins/registry";
import { createAuthState } from "../auth/oauth";
import { buildPluginAuthUrl, handlePluginCallback } from "../auth/plugin-oauth";
import { verifyApiKey, getUserById } from "../auth/users";
import { buildAuthUrl, handleCallback } from "../auth/google";
import { signSession, verifySession } from "../auth/session";
import { config } from "../config";
import { getToken } from "../auth/tokens";
import {
  startCookieSession,
  captureCookies,
  closeCookieSession,
  storeCookies,
  hasValidCookies,
  getSessionOwner,
} from "../auth/cookie";
import { verifyConnectToken } from "../auth/connect-token";
import { markConnected, startReaper } from "../auth/connections";

async function authenticate(request: { headers: { authorization?: string } }): Promise<{ userId: string } | null> {
  const auth = request.headers.authorization;
  if (!auth) return null;

  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    // Try session JWT first
    try {
      const session = await verifySession(token);
      return { userId: session.userId };
    } catch {
      // Fall back to API key
      const userId = verifyApiKey(token);
      if (userId) return { userId };
    }
  }
  return null;
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  startReaper();

  // --- Auth routes ---
  app.get("/api/auth/google", async (_request, reply) => {
    if (!config.GOOGLE_CLIENT_ID) {
      return reply.status(503).send({ error: "Google SSO not configured" });
    }
    const url = buildAuthUrl();
    return { url };
  });

  app.get("/api/auth/google/callback", async (request, reply) => {
    const { code, state, error } = request.query as Record<string, string>;
    if (error) {
      return reply.status(400).send({ error: `Google auth error: ${error}` });
    }
    if (!code) {
      return reply.status(400).send({ error: "Missing code" });
    }

    try {
      const { userId, email } = await handleCallback(code, state);
      const token = await signSession({ userId, email });
      // Redirect back to portal with token in hash fragment (safer than query)
      const redirect = new URL(config.PORTAL_URL);
      redirect.hash = `token=${token}`;
      return reply.redirect(redirect.toString());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Auth failed";
      return reply.status(400).send({ error: message });
    }
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const profile = getUserById(user.userId);
    if (!profile) {
      return reply.status(404).send({ error: "User not found" });
    }
    return { id: profile.id, email: profile.email };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    // Stateless JWT -- client discards token. Server-side revoke optional.
    return { success: true };
  });

  // --- Protected API routes ---
  app.get("/api/integrations", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const integrations = registry.listIntegrations();
    return {
      integrations: integrations.map((i) => ({
        name: i.name,
        version: i.version,
      })),
    };
  });

  app.get("/api/auth/:integration", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const { integration } = request.params as { integration: string };
    const integ = registry.getIntegration(integration);
    if (!integ) {
      return reply.status(404).send({ error: "Integration not found" });
    }

    if (integ.auth.type === "cookie") {
      const { sessionId, cdpToken } = await startCookieSession(
        user.userId,
        integration,
        integ.auth.loginUrl,
        integ.auth.targetDomain,
        integ.auth.cookieDomains
      );
      return {
        type: "cookie",
        sessionId,
        cdpToken,
        // Portal opens this relative WS URL — no secrets in the URL, so it
        // is safe to land in access logs / history. The client sends
        // {type:"auth",sessionId,cdpToken} as its first ws frame; the
        // server validates and only then dials chromium.
        cdpProxyUrl: `/api/auth/cookie/${integration}/cdp`,
        loginUrl: integ.auth.loginUrl,
      };
    }

    if (integ.auth.type === "oauth2") {
      try {
        const url = buildPluginAuthUrl(user.userId, integration);
        return { type: "oauth2", url };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(503).send({ error: message });
      }
    }

    const state = createAuthState(user.userId, integration);
    return { state };
  });

  // Plugin OAuth callback (generic — works for any oauth2 plugin
  // whose creds are wired in getPluginOAuthCreds). Namespaced under
  // /plugin/ to avoid colliding with /api/auth/google/callback (SSO).
  app.get("/api/auth/plugin/:integration/callback", async (request, reply) => {
    const { integration } = request.params as { integration: string };
    const { code, state, error } = request.query as Record<string, string>;

    if (error) {
      return reply.status(400).send({ error: `Provider error: ${error}` });
    }
    if (!code || !state) {
      return reply.status(400).send({ error: "Missing code or state" });
    }

    try {
      const { userId } = await handlePluginCallback(integration, code, state);
      markConnected(userId, integration);
      const redirect = new URL(config.PORTAL_URL);
      redirect.hash = `connected=${integration}`;
      return reply.redirect(redirect.toString());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // Cookie auth capture
  app.post("/api/auth/cookie/:integration/capture", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { integration } = request.params as { integration: string };
    const { sessionId } = request.body as { sessionId: string };

    const owner = getSessionOwner(sessionId);
    if (!owner || owner.userId !== user.userId || owner.integration !== integration) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    try {
      const cookies = await captureCookies(sessionId);
      if (cookies.cookies.length === 0) {
        return reply.status(400).send({ error: "No cookies captured. Complete login before capturing." });
      }
      storeCookies(user.userId, integration, cookies);
      await closeCookieSession(sessionId);
      markConnected(user.userId, integration);
      return { success: true, cookieCount: cookies.cookies.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // Cookie auth cancel
  app.post("/api/auth/cookie/:integration/cancel", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const { integration } = request.params as { integration: string };
    const { sessionId } = request.body as { sessionId: string };

    const owner = getSessionOwner(sessionId);
    if (!owner || owner.userId !== user.userId || owner.integration !== integration) {
      return reply.status(403).send({ error: "Forbidden" });
    }

    await closeCookieSession(sessionId);
    return { success: true };
  });

  // Connect-JWT endpoints (used by the /connect magic-link page — no portal session)
  app.get("/api/connect/session", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    let payload;
    try { payload = await verifyConnectToken(auth.slice(7)); }
    catch { return reply.status(401).send({ error: "Invalid or expired link" }); }
    const integ = registry.getIntegration(payload.integration);
    if (!integ || integ.auth.type !== "cookie") return reply.status(404).send({ error: "Integration not found" });
    return {
      integration: payload.integration,
      loginUrl: integ.auth.loginUrl,
      cdpProxyUrl: `/api/auth/cookie/${payload.integration}/cdp`,
      sessionId: payload.sessionId,
      cdpToken: payload.cdpToken,
    };
  });

  app.post("/api/connect/capture", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    let payload;
    try { payload = await verifyConnectToken(auth.slice(7)); }
    catch { return reply.status(401).send({ error: "Invalid or expired link" }); }
    const owner = getSessionOwner(payload.sessionId);
    if (!owner || owner.userId !== payload.userId || owner.integration !== payload.integration) {
      return reply.status(403).send({ error: "Forbidden" });
    }
    try {
      const cookies = await captureCookies(payload.sessionId);
      if (cookies.cookies.length === 0) {
        return reply.status(400).send({ error: "No cookies captured. Complete login before capturing." });
      }
      storeCookies(payload.userId, payload.integration, cookies);
      await closeCookieSession(payload.sessionId);
      markConnected(payload.userId, payload.integration);
      return { success: true, cookieCount: cookies.cookies.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // Connection status per integration
  app.get("/api/connections", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const integrations = registry.listIntegrations();
    return {
      connections: integrations.map((i) => ({
        name: i.name,
        connected:
          i.auth.type === "cookie"
            ? hasValidCookies(user.userId, i.name)
            : !!getToken(user.userId, i.name),
      })),
    };
  });
}
