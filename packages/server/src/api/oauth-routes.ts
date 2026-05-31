import { FastifyInstance } from "fastify";
import { protectedResourceMetadata, authorizationServerMetadata } from "../auth/oauth-server/metadata";
import { registerClient } from "../auth/oauth-server/clients";

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

  // /authorize and /token are added in later tasks.
}
