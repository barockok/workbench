import { FastifyInstance } from "fastify";
import { registry } from "../plugins/registry";
import { createAuthState } from "../auth/oauth";
import { verifyApiKey } from "../auth/users";

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/integrations", async (request, reply) => {
    const auth = request.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const userId = verifyApiKey(auth.slice(7));
    if (!userId) {
      return reply.status(401).send({ error: "Invalid token" });
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
    const { integration } = request.params as { integration: string };
    const { user } = request.query as { user: string };
    const state = createAuthState(user, integration);
    return { state };
  });
}
