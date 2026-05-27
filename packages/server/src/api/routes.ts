import crypto from "crypto";
import { FastifyInstance } from "fastify";
import { registry } from "../plugins/registry";
import { createAuthState } from "../auth/oauth";
import { verifyApiKey, getUserById } from "../auth/users";
import { buildAuthUrl, handleCallback } from "../auth/google";
import { signSession, verifySession } from "../auth/session";
import { config } from "../config";

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
  // --- Auth routes ---
  app.get("/api/auth/google", async (_request, reply) => {
    if (!config.GOOGLE_CLIENT_ID) {
      return reply.status(503).send({ error: "Google SSO not configured" });
    }
    const state = crypto.randomUUID();
    const url = buildAuthUrl(state);
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
    const state = createAuthState(user.userId, integration);
    return { state };
  });
}
