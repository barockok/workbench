import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { metaTools } from "./meta-tools";

export function createMcpServer(): Server {
  const server = new Server(
    { name: "a-workbench", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: metaTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: "object", properties: {} },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = metaTools.find((t) => t.name === request.params.name);
    if (!tool) {
      throw new Error(`Tool not found: ${request.params.name}`);
    }

    const parsed = tool.inputSchema.safeParse(request.params.arguments);
    if (!parsed.success) {
      throw new Error(`Invalid arguments: ${parsed.error.message}`);
    }

    const result = await tool.handler({ userId: "anonymous" }, parsed.data);
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  });

  return server;
}
