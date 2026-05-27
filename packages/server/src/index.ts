import Fastify from "fastify";
import { config } from "./config";
import { handleMcpRequest } from "./mcp/server";
import { registerApiRoutes } from "./api/routes";
import { loadPlugins } from "./plugins/loader";
import "./telemetry/tracing";

async function main() {
  const app = Fastify({ logger: true });

  await loadPlugins();
  await registerApiRoutes(app);

  app.post("/mcp", async (request, reply) => {
    const body = request.body as Record<string, unknown>;
    const result = await handleMcpRequest(body);
    reply.send(result);
  });

  await app.listen({ port: parseInt(config.PORT), host: "0.0.0.0" });
  console.log(`Server running on port ${config.PORT}`);
}

main().catch(console.error);
