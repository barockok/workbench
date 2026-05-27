import Fastify from "fastify";
import { config } from "./config";
import { handleMcpRequest } from "./mcp/server";
import { registerApiRoutes } from "./api/routes";
import { loadPlugins } from "./plugins/loader";
import { verifyApiKey } from "./auth/users";
import { verifySession } from "./auth/session";
import "./telemetry/tracing";

async function getUserIdFromAuth(auth?: string): Promise<string | null> {
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const session = await verifySession(token);
    return session.userId;
  } catch {
    return verifyApiKey(token);
  }
}

async function main() {
  const app = Fastify({ logger: true });

  await loadPlugins();
  await registerApiRoutes(app);

  app.post("/mcp", async (request, reply) => {
    const auth = request.headers.authorization;
    const userId = await getUserIdFromAuth(auth);
    if (!userId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const body = request.body as Record<string, unknown>;
    const result = await handleMcpRequest(body, userId);
    reply.send(result);
  });

  await app.listen({ port: parseInt(config.PORT), host: "0.0.0.0" });
  console.log(`Server running on port ${config.PORT}`);
}

main().catch(console.error);
