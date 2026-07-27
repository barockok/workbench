import crypto from "crypto";
import fs from "fs";
import path from "path";
import { FastifyInstance } from "fastify";
import { Integration } from "@a-workbench/shared";
import { registry } from "../plugins/registry";
import { createAuthState } from "../auth/oauth";
import { buildPluginAuthUrl, handlePluginCallback, getPluginOAuthCreds } from "../auth/plugin-oauth";
import { verifyApiKey, getUserById, setApiKey, clearApiKey, hasApiKey, getApiKey } from "../auth/users";
import { buildAuthUrl, handleCallback } from "../auth/google";
import { buildAuthUrl as buildKeycloakAuthUrl, handleCallback as handleKeycloakCallback, isKeycloakConfigured } from "../auth/keycloak";
import { signSession, verifySession } from "../auth/session";
import { config } from "../config";
import { getToken, deleteToken, storeToken } from "../auth/tokens";
import {
  storeCookies,
  getCookies,
  hasValidCookies,
  deleteCookies,
  resetBrowserProfile,
  CookieData,
} from "../auth/cookie";
import { verifyConnectToken } from "../auth/connect-token";
import { signConnectToken } from "../auth/connect-token";
import { markConnected, startReaper } from "../auth/connections";
import { resumeAuthorize } from "../auth/oauth-server/resume";
import { listAgents, revokeAgent } from "../auth/oauth-server/agents";
import { ensureSession, navigate, captureLiveCookies } from "../auth/browser-session";

function isUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

// Whether an integration can actually be connected right now: built-ins
// (auth "none") and cookie auth are always ready; oauth2 needs client creds
// present in env; anything else (manual) is not connectable from the UI.
function isConfigured(i: Integration): boolean {
  if (i.auth.type === "none") return true;
  if (i.auth.type === "cookie") return true;
  // API-key integrations need no server-side creds — the user supplies the key
  // at connect time, so they're always ready to connect.
  if (i.auth.type === "apikey") return true;
  if (i.auth.type === "oauth2") return getPluginOAuthCreds(i.name) !== null;
  return false;
}

// A bundled logo filename becomes a server URL; a full URL passes through.
function resolveLogo(i: Integration): string | undefined {
  if (!i.logo) return undefined;
  return isUrl(i.logo) ? i.logo : `/api/integrations/${i.name}/logo`;
}

function contentType(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case ".svg": return "image/svg+xml";
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    default: return "application/octet-stream";
  }
}

async function authenticate(request: {
  headers: { authorization?: string; "x-workbench-api-key"?: string };
}): Promise<{ userId: string } | null> {
  // API key auth: a dedicated header (not Authorization), so it never collides
  // with the portal's session JWT.
  const apiKey = request.headers["x-workbench-api-key"];
  if (apiKey) {
    const userId = verifyApiKey(apiKey);
    if (userId) return { userId };
  }

  // Session JWT (portal) via Authorization: Bearer.
  const auth = request.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const session = await verifySession(auth.slice(7));
      return { userId: session.userId };
    } catch {
      /* invalid session token */
    }
  }
  return null;
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  startReaper();

  // --- Auth routes ---
  app.get("/api/auth/providers", async () => {
    const providers: string[] = [];
    if (config.GOOGLE_CLIENT_ID) providers.push("google");
    if (isKeycloakConfigured()) providers.push("keycloak");
    return { providers };
  });

  app.get("/api/auth/google", async (_request, reply) => {
    if (!config.GOOGLE_CLIENT_ID) {
      return reply.status(503).send({ error: "Google SSO not configured" });
    }
    const url = buildAuthUrl();
    return { url };
  });

  app.get("/api/auth/keycloak", async (_request, reply) => {
    if (!isKeycloakConfigured()) {
      return reply.status(503).send({ error: "Keycloak SSO not configured" });
    }
    const url = await buildKeycloakAuthUrl();
    return { url };
  });

  app.get("/api/auth/keycloak/callback", async (request, reply) => {
    const { code, state, error } = request.query as Record<string, string>;
    if (error) return reply.status(400).send({ error: `Keycloak auth error: ${error}` });
    if (!code) return reply.status(400).send({ error: "Missing code" });
    try {
      const { userId, email } = await handleKeycloakCallback(code, state);
      const token = await signSession({ userId, email });
      const redirect = new URL(config.PORTAL_URL);
      redirect.hash = `token=${token}`;
      return reply.redirect(redirect.toString());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Auth failed";
      return reply.status(400).send({ error: message });
    }
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

      // If SSO was started by an OAuth /authorize, state carries ".<ticket>".
      const dot = state.indexOf(".");
      const oauthTicket = dot === -1 ? null : state.slice(dot + 1);
      if (oauthTicket) {
        const cookie = request.headers.cookie ?? "";
        const m = cookie.match(/(?:^|;\s*)awb_oauth_binding=([^;]+)/);
        const binding = m ? m[1] : undefined;
        const redirectUrl = resumeAuthorize(oauthTicket, userId, binding);
        // Clear the one-time binding cookie.
        reply.header("Set-Cookie", "awb_oauth_binding=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
        if (redirectUrl) return reply.redirect(redirectUrl);
        // binding/ticket invalid -> fall through to portal login
      }

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

  // --- MCP API key management (session-authenticated) ---
  // Mint/rotate a long-lived API key for use as the /mcp Bearer. The plaintext
  // is returned here and also kept encrypted so the owner can reveal it again.
  app.post("/api/keys", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    return setApiKey(user.userId);
  });

  // Whether the user currently has a key.
  app.get("/api/keys", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    return { hasKey: hasApiKey(user.userId) };
  });

  // Reveal the existing plaintext key (decrypted). Session-auth only.
  app.get("/api/keys/reveal", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const apiKey = getApiKey(user.userId);
    if (!apiKey) {
      return reply.status(404).send({ error: "No key set." });
    }
    return { apiKey };
  });

  app.delete("/api/keys", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    clearApiKey(user.userId);
    return { success: true };
  });

  // --- Protected API routes ---
  app.get("/api/integrations", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    return {
      integrations: registry.listIntegrations().map((i) => ({
        name: i.name,
        version: i.version,
        displayName: i.displayName,
        description: i.description,
        categories: i.categories,
        logo: resolveLogo(i),
        authType: i.auth.type,
        instance: i.auth.type === "oauth2" ? i.auth.instance : undefined,
        apikeyFields: i.auth.type === "apikey" ? i.auth.fields : undefined,
        toolCount: registry.listToolsByIntegration(i.name).length,
        configured: isConfigured(i),
      })),
    };
  });

  // Integration detail: metadata + the tools it exposes.
  app.get<{ Params: { integration: string } }>(
    "/api/integrations/:integration",
    async (request, reply) => {
      const user = await authenticate(request);
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const integration = request.params.integration;
      const integ = registry.getIntegration(integration);
      if (!integ) {
        return reply.status(404).send({ error: "Integration not found" });
      }
      return {
        name: integ.name,
        version: integ.version,
        displayName: integ.displayName,
        description: integ.description,
        categories: integ.categories,
        logo: resolveLogo(integ),
        authType: integ.auth.type,
        instance: integ.auth.type === "oauth2" ? integ.auth.instance : undefined,
        apikeyFields: integ.auth.type === "apikey" ? integ.auth.fields : undefined,
        tools: registry.listToolsByIntegration(integration).map((t) => ({
          name: t.name,
          description: t.description,
        })),
      };
    }
  );

  // Serve a plugin's bundled logo file. Public (no auth) so an <img src> works
  // without an Authorization header; logos aren't sensitive.
  app.get<{ Params: { integration: string } }>(
    "/api/integrations/:integration/logo",
    async (request, reply) => {
      const integration = request.params.integration;
      const integ = registry.getIntegration(integration);
      const dir = registry.getPluginDir(integration);
      if (!integ?.logo || isUrl(integ.logo) || !dir) {
        return reply.status(404).send({ error: "No logo" });
      }
      // basename() defuses any path traversal in the manifest's logo field.
      const file = path.join(dir, path.basename(integ.logo));
      if (!fs.existsSync(file)) {
        return reply.status(404).send({ error: "No logo" });
      }
      reply.header("Content-Type", contentType(file));
      reply.header("Cache-Control", "public, max-age=86400");
      return reply.send(fs.readFileSync(file));
    }
  );

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

    if (integ.auth.type === "none") {
      return { type: "none", connected: true };
    }

    if (integ.auth.type === "cookie") {
      const session = await ensureSession(user.userId);
      await navigate(session, integ.auth.loginUrl);
      return {
        type: "cookie",
        status: "login_required",
        cdpToken: session.cdpToken,
        cdpProxyUrl: `/api/auth/cookie/${integration}/cdp`,
        loginUrl: integ.auth.loginUrl,
      };
    }

    if (integ.auth.type === "oauth2") {
      try {
        const { instanceUrl } = request.query as { instanceUrl?: string };
        const url = buildPluginAuthUrl(user.userId, integration, instanceUrl);
        return { type: "oauth2", url };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return reply.status(503).send({ error: message });
      }
    }

    if (integ.auth.type === "apikey") {
      // Hand the portal the field spec so it can render the connect form; the
      // user POSTs the values back to /api/auth/apikey/:integration.
      return { type: "apikey", fields: integ.auth.fields };
    }

    const state = createAuthState(user.userId, integration);
    return { state };
  });

  // API-key connect: store the user-supplied credential + config fields. The
  // field flagged `secret` becomes the encrypted access token; the rest are
  // persisted as per-connection config (read by tools via ctx.getConfig()).
  app.post<{ Params: { integration: string }; Body: { values?: Record<string, string> } }>(
    "/api/auth/apikey/:integration",
    async (request, reply) => {
      const user = await authenticate(request);
      if (!user) return reply.status(401).send({ error: "Unauthorized" });

      const { integration } = request.params;
      const integ = registry.getIntegration(integration);
      if (!integ || integ.auth.type !== "apikey") {
        return reply.status(404).send({ error: "API-key integration not found" });
      }

      const values = request.body?.values ?? {};
      const secretField = integ.auth.fields.find((f) => f.secret);
      if (!secretField) {
        return reply.status(500).send({ error: "Integration has no secret field" });
      }

      // Validate: required (non-optional) fields must be present; any enum
      // field that *is* supplied must match its options.
      for (const f of integ.auth.fields) {
        const v = (values[f.key] ?? "").trim();
        if (!v) {
          if (f.optional) continue;
          return reply.status(400).send({ error: `Missing required field: ${f.label}` });
        }
        if (f.options && !f.options.includes(v)) {
          return reply.status(400).send({ error: `${f.label} must be one of: ${f.options.join(", ")}` });
        }
      }

      const secret = values[secretField.key].trim();
      const configFields: Record<string, string> = {};
      for (const f of integ.auth.fields) {
        if (f.secret) continue;
        const v = (values[f.key] ?? "").trim();
        // Skip optional fields left blank — don't persist empty strings.
        if (!v) continue;
        configFields[f.key] = v;
      }

      storeToken(user.userId, integration, {
        accessToken: secret,
        scopes: "",
        config: Object.keys(configFields).length ? JSON.stringify(configFields) : undefined,
      });
      // No markConnected(): apikey connect is synchronous (no PENDING record to
      // flip). The stored token alone makes /api/connections report connected.
      return { success: true };
    }
  );

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
    if (!user) return reply.status(401).send({ error: "Unauthorized" });

    const { integration } = request.params as { integration: string };
    const integ = registry.getIntegration(integration);
    if (!integ || integ.auth.type !== "cookie") {
      return reply.status(404).send({ error: "Cookie integration not found" });
    }

    try {
      const data = await captureLiveCookies(user.userId, integ.auth.targetDomain, integ.auth.cookieDomains);
      if (data.cookies.length === 0) {
        return reply.status(400).send({ error: "No cookies captured. Complete login before capturing." });
      }
      storeCookies(user.userId, integration, data);
      markConnected(user.userId, integration);
      return { success: true, cookieCount: data.cookies.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // Export a stored cookie-auth session as a portable bundle. Lets a user
  // capture on a machine whose egress IP the login provider accepts (e.g. a
  // residential ISP) and move the live session to a headless/in-cluster
  // workbench that the provider would otherwise block. Authed — the bundle
  // contains live session cookies, returned only to its owner.
  app.get<{ Params: { integration: string } }>(
    "/api/integrations/:integration/session/export",
    async (request, reply) => {
      const user = await authenticate(request);
      if (!user) return reply.status(401).send({ error: "Unauthorized" });
      const { integration } = request.params;
      const integ = registry.getIntegration(integration);
      if (!integ || integ.auth.type !== "cookie") {
        return reply.status(404).send({ error: "Cookie integration not found" });
      }
      const session = getCookies(user.userId, integration);
      if (!session) return reply.status(404).send({ error: "No session to export. Connect the integration first." });
      return { integration, session };
    }
  );

  // Import a cookie-auth session bundle (from /session/export elsewhere) and
  // store it under the caller, marking the integration connected.
  app.post<{
    Params: { integration: string };
    Body: { session?: CookieData | CookieData["cookies"] } | CookieData["cookies"];
  }>(
    "/api/integrations/:integration/session/import",
    async (request, reply) => {
      const user = await authenticate(request);
      if (!user) return reply.status(401).send({ error: "Unauthorized" });
      const { integration } = request.params;
      const integ = registry.getIntegration(integration);
      if (!integ || integ.auth.type !== "cookie") {
        return reply.status(404).send({ error: "Cookie integration not found" });
      }
      // Accept a bare cookie array (no { cookies } wrapper) at either the body
      // root or under `session`, and normalize it into a CookieData bundle.
      const body = request.body;
      const raw = Array.isArray(body) ? body : body?.session;
      const session: Partial<CookieData> | undefined = Array.isArray(raw) ? { cookies: raw } : raw;
      if (!session || !Array.isArray(session.cookies) || session.cookies.length === 0) {
        return reply.status(400).send({ error: "Invalid session bundle: expected non-empty { cookies } or a cookie array." });
      }
      const data: CookieData = {
        domain: session.domain ?? integ.auth.targetDomain,
        cookies: session.cookies,
        capturedAt: session.capturedAt ?? Math.floor(Date.now() / 1000),
      };
      storeCookies(user.userId, integration, data);
      markConnected(user.userId, integration);
      return { success: true, cookieCount: data.cookies.length };
    }
  );

  // Reset (wipe) the caller's persistent browser profile — logs them out of all
  // sites in the capture browser. Per-user, not per-integration.
  app.post("/api/browser-session/reset", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.status(401).send({ error: "Unauthorized" });
    try {
      await resetBrowserProfile(user.userId);
      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("BROWSER_SESSION_BUSY")) {
        return reply.status(409).send({ error: "A browser session is active. Finish or cancel it first." });
      }
      return reply.status(400).send({ error: message });
    }
  });

  // Mint a user-initiated live-view link for the per-user browser session.
  // Mirrors the browser_live_url meta-tool (the agent path) but is driven from
  // the portal: ensures a warm session, optionally navigates to a URL, and
  // returns a short-lived /browser?t= link the user opens to take over by hand.
  app.post("/api/browser-session/live-url", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.status(401).send({ error: "Unauthorized" });
    const { url } = (request.body ?? {}) as { url?: string };
    if (url !== undefined && typeof url !== "string") {
      return reply.status(400).send({ error: "url must be a string" });
    }
    if (url && !isUrl(url)) {
      return reply.status(400).send({ error: "url must be http(s)" });
    }
    try {
      const s = await ensureSession(user.userId);
      if (url) await navigate(s, url);
      const token = await signConnectToken(
        {
          connectionId: user.userId,
          userId: user.userId,
          integration: "__browser__",
          sessionId: user.userId,
          cdpToken: s.cdpToken,
        },
        config.CONNECT_TTL_SECONDS
      );
      return { url: `${config.PORTAL_URL}/browser?t=${token}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("BROWSER_SESSION_BUSY")) {
        return reply.status(409).send({ error: "A cookie capture is in progress. Finish or cancel it first." });
      }
      return reply.status(400).send({ error: message });
    }
  });

  // Cookie auth cancel
  app.post("/api/auth/cookie/:integration/cancel", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) return reply.status(401).send({ error: "Unauthorized" });
    // Capture shares the per-user browser session, which browser-use may also be
    // driving — do not kill it here. The idle reaper reclaims it on its own.
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
      sessionId: payload.userId,
      cdpToken: payload.cdpToken,
    };
  });

  app.post("/api/connect/capture", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return reply.status(401).send({ error: "Unauthorized" });
    let payload;
    try { payload = await verifyConnectToken(auth.slice(7)); }
    catch { return reply.status(401).send({ error: "Invalid or expired link" }); }
    const integ = registry.getIntegration(payload.integration);
    if (!integ || integ.auth.type !== "cookie") {
      return reply.status(404).send({ error: "Cookie integration not found" });
    }
    try {
      const data = await captureLiveCookies(payload.userId, integ.auth.targetDomain, integ.auth.cookieDomains);
      if (data.cookies.length === 0) {
        return reply.status(400).send({ error: "No cookies captured. Complete login before capturing." });
      }
      storeCookies(payload.userId, payload.integration, data);
      markConnected(payload.userId, payload.integration);
      return { success: true, cookieCount: data.cookies.length };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: message });
    }
  });

  // Live-view token exchange for the browser session. The /browser magic-link
  // page presents its connect JWT and gets back the relative CDP proxy URL +
  // the token to send in the WS auth frame. Mirrors /api/connect/session.
  app.get("/api/connect/browser-session", async (request, reply) => {
    const token = (request.query as { t?: string }).t;
    if (!token) return reply.status(400).send({ error: "Missing token" });
    let payload;
    try {
      payload = await verifyConnectToken(token);
    } catch {
      return reply.status(401).send({ error: "Link invalid or expired" });
    }
    if (payload.integration !== "__browser__") {
      return reply.status(400).send({ error: "Not a browser-session link" });
    }
    return {
      cdpProxyUrl: "/api/browser-session/cdp",
      sessionId: payload.sessionId,
      cdpToken: payload.cdpToken,
    };
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
          i.auth.type === "none"
            ? true // built-ins: always usable
            : i.auth.type === "cookie"
              ? hasValidCookies(user.userId, i.name)
              : !!getToken(user.userId, i.name),
      })),
    };
  });

  // Disconnect: drop stored creds (OAuth tokens or cookies) for one integration.
  app.delete<{ Params: { integration: string } }>(
    "/api/connections/:integration",
    async (request, reply) => {
      const user = await authenticate(request);
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const { integration } = request.params;
      const integ = registry.getIntegration(integration);
      if (!integ) {
        return reply.status(404).send({ error: "Integration not found" });
      }
      if (integ.auth.type === "none") {
        return reply.status(400).send({ error: "Built-in integration cannot be disconnected" });
      }
      // Both delete the same connections row; branch by auth type for clarity.
      if (integ.auth.type === "cookie") {
        deleteCookies(user.userId, integration);
      } else {
        deleteToken(user.userId, integration);
      }
      return { success: true };
    }
  );

  // Connected agents: MCP/OAuth clients the user has authorized to reach their
  // workbench. Distinct from /api/connections (workbench → SaaS). One row per
  // client_id.
  app.get("/api/agents", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    return { agents: listAgents(user.userId) };
  });

  // Revoke an agent: delete the user's refresh tokens for that client (soft
  // revoke — live access tokens lapse at their TTL). Idempotent: returns
  // { revoked: 0 } when there was nothing to remove.
  app.delete<{ Params: { clientId: string } }>(
    "/api/agents/:clientId",
    async (request, reply) => {
      const user = await authenticate(request);
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      const revoked = revokeAgent(user.userId, request.params.clientId);
      return { revoked };
    }
  );
}
