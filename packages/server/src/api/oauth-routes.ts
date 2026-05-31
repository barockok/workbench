import crypto from "crypto";
import { FastifyInstance } from "fastify";
import { protectedResourceMetadata, authorizationServerMetadata } from "../auth/oauth-server/metadata";
import { registerClient, getClient } from "../auth/oauth-server/clients";
import { config } from "../config";
import { db } from "../db";
import { buildAuthUrl } from "../auth/google";

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/.well-known/oauth-protected-resource", async () => protectedResourceMetadata());
  app.get("/.well-known/oauth-authorization-server", async () => authorizationServerMetadata());

  // Dynamic Client Registration (RFC 7591) — public clients only.
  app.post("/register", async (request, reply) => {
    const body = (request.body ?? {}) as { client_name?: string; redirect_uris?: string[] };
    if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return reply.status(400).send({ error: "invalid_client_metadata", error_description: "redirect_uris required" });
    }
    const client = registerClient({ client_name: body.client_name, redirect_uris: body.redirect_uris });
    return reply.status(201).send({
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  app.get("/authorize", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const client = q.client_id ? getClient(q.client_id) : undefined;
    if (!client) return reply.status(400).send({ error: "invalid_request", error_description: "unknown client_id" });
    if (q.response_type !== "code") return reply.status(400).send({ error: "unsupported_response_type" });
    if (!client.redirect_uris.includes(q.redirect_uri)) {
      return reply.status(400).send({ error: "invalid_request", error_description: "redirect_uri not registered" });
    }
    if (!q.code_challenge || q.code_challenge_method !== "S256") {
      return reply.status(400).send({ error: "invalid_request", error_description: "PKCE S256 required" });
    }

    // Stash the validated request under a ticket; resume after Google SSO.
    const ticket = crypto.randomBytes(16).toString("hex");
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "INSERT INTO pending_auth (state, user_id, integration, expires_at, session_data) VALUES (?, ?, ?, ?, ?)"
    ).run(
      ticket, "", "__oauth_authorize__", now + 600,
      JSON.stringify({
        clientId: client.client_id,
        redirectUri: q.redirect_uri,
        codeChallenge: q.code_challenge,
        scope: q.scope || "mcp",
        state: q.state || "",
        resource: q.resource || `${config.SERVER_PUBLIC_URL}/mcp`,
      })
    );

    return reply.redirect(buildAuthUrl(ticket));
  });
}
