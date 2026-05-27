import Fastify from "fastify";
import { config } from "./config";
import { createMcpServer } from "./mcp/server";
import { registerApiRoutes } from "./api/routes";
import { loadPlugins } from "./plugins/loader";

async function main() {
  const app = Fastify({ logger: true });

  await loadPlugins();
  await registerApiRoutes(app);

  const mcpServer = createMcpServer();
  app.post("/mcp", async (request, reply) => {
    reply.send({ status: "ok" });
  });

  await app.listen({ port: parseInt(config.PORT), host: "0.0.0.0" });
  console.log(`Server running on port ${config.PORT}`);
}

main().catch(console.error);
