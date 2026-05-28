import { z } from "zod";
import { registry } from "../plugins/registry";
import { createContext } from "../plugins/context";
import { getToken } from "../auth/tokens";
import { hasValidCookies } from "../auth/cookie";
import { withSpan } from "../telemetry/tracing";

const metaTools = [
  {
    name: "search_tools",
    description: "Search available tools by name or description",
    inputSchema: z.object({ query: z.string() }),
    handler: async (_ctx: unknown, args: { query: string }) => {
      const tools = registry.searchTools(args.query);
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          integration: t.integration,
        })),
      };
    },
  },
  {
    name: "get_tool_schema",
    description: "Get input schema for a specific tool",
    inputSchema: z.object({ tool: z.string() }),
    handler: async (_ctx: unknown, args: { tool: string }) => {
      const t = registry.getTool(args.tool);
      if (!t) return { error: "Tool not found" };
      return { schema: t.inputSchema };
    },
  },
  {
    name: "execute_tool",
    description: "Execute a tool by name with arguments",
    inputSchema: z.object({
      tool: z.string(),
      args: z.record(z.unknown()),
    }),
    handler: async (ctx: { userId: string }, args: { tool: string; args: Record<string, unknown> }) => {
      return withSpan(
        "execute_tool",
        async () => {
          const tool = registry.getTool(args.tool);
          if (!tool) {
            return { error: "Tool not found" };
          }

          const integ = registry.getIntegration(tool.integration);
          const isConnected = integ?.auth.type === "cookie"
            ? hasValidCookies(ctx.userId, tool.integration)
            : !!getToken(ctx.userId, tool.integration);

          if (!isConnected) {
            return {
              error: "NOT_CONNECTED",
              integration: tool.integration,
              message: `${tool.integration} not connected. Use get_auth_url('${tool.integration}') to connect.`,
            };
          }

          // Validate args against the plugin tool's own schema so that
          // Zod defaults (e.g. pageSize=10) get applied. Without this,
          // execute_tool blindly forwards whatever the caller sent and
          // the plugin sees `undefined` for optional-with-default fields.
          let parsedArgs: unknown = args.args;
          try {
            const schema = (tool as { inputSchema?: { safeParse?: (v: unknown) => { success: boolean; data?: unknown; error?: { message: string } } } }).inputSchema;
            if (schema?.safeParse) {
              const parsed = schema.safeParse(args.args ?? {});
              if (!parsed.success) {
                return { error: `Invalid arguments for ${args.tool}: ${parsed.error?.message ?? "schema mismatch"}` };
              }
              parsedArgs = parsed.data;
            }
          } catch {
            // fall through with raw args if schema parsing throws unexpectedly
          }

          try {
            const toolCtx = createContext(ctx.userId, tool.integration);
            const result = await tool.handler(toolCtx, parsedArgs as Record<string, unknown>);
            return { result };
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            return { error: err };
          }
        },
        { tool: args.tool }
      );
    },
  },
  {
    name: "list_integrations",
    description: "List all available integrations and connection status",
    inputSchema: z.object({}),
    handler: async (ctx: { userId: string }) => {
      const integrations = registry.listIntegrations();
      return {
        integrations: integrations.map((i) => ({
          name: i.name,
          version: i.version,
          connected:
            i.auth.type === "cookie"
              ? hasValidCookies(ctx.userId, i.name)
              : !!getToken(ctx.userId, i.name),
        })),
      };
    },
  },
  {
    name: "get_auth_url",
    description: "Get OAuth URL to connect an integration",
    inputSchema: z.object({ integration: z.string() }),
    handler: async (ctx: { userId: string }, args: { integration: string }) => {
      const integration = registry.getIntegration(args.integration);
      if (!integration) return { error: "Integration not found" };

      if (integration.auth.type === "cookie") {
        return {
          type: "cookie",
          url: `/api/auth/${args.integration}?user=${ctx.userId}`,
          instructions: `Open the URL, log in to ${integration.auth.loginUrl}, then confirm.`,
        };
      }

      return {
        url: `/api/auth/${args.integration}?user=${ctx.userId}`,
      };
    },
  },
];

export async function handleMcpRequest(body: Record<string, unknown>, userId: string): Promise<Record<string, unknown> | null> {
  const { method, params, id } = body;

  // MCP lifecycle: initialize handshake.
  if (method === "initialize") {
    const requested = (params as { protocolVersion?: string } | undefined)?.protocolVersion;
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: requested ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "a-workbench", version: "0.1.0" },
      },
    };
  }

  // Client confirms it's done initializing — no response required.
  if (method === "notifications/initialized" || method === "initialized") {
    return null;
  }

  // Optional capability methods: respond with empty lists so clients don't
  // treat them as protocol violations.
  if (method === "resources/list") {
    return { jsonrpc: "2.0", id, result: { resources: [] } };
  }
  if (method === "prompts/list") {
    return { jsonrpc: "2.0", id, result: { prompts: [] } };
  }

  if (method === "tools/list") {
    const schemas: Record<string, Record<string, unknown>> = {
      search_tools: {
        type: "object",
        properties: { query: { type: "string", description: "Search keyword" } },
        required: ["query"],
      },
      get_tool_schema: {
        type: "object",
        properties: { tool: { type: "string", description: "Tool name" } },
        required: ["tool"],
      },
      execute_tool: {
        type: "object",
        properties: {
          tool: { type: "string", description: "Tool name returned by search_tools" },
          args: { type: "object", description: "Arguments for the tool", additionalProperties: true },
        },
        required: ["tool", "args"],
      },
      list_integrations: { type: "object", properties: {} },
      get_auth_url: {
        type: "object",
        properties: { integration: { type: "string", description: "Integration name" } },
        required: ["integration"],
      },
    };
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: metaTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: schemas[t.name] ?? { type: "object", properties: {} },
        })),
      },
    };
  }

  if (method === "tools/call") {
    const toolParams = params as { name: string; arguments: Record<string, unknown> };
    const tool = metaTools.find((t) => t.name === toolParams.name);
    if (!tool) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Tool not found: ${toolParams.name}` },
      };
    }

    const parsed = tool.inputSchema.safeParse(toolParams.arguments);
    if (!parsed.success) {
      return {
        jsonrpc: "2.0",
        id,
        error: { code: -32602, message: `Invalid arguments: ${parsed.error.message}` },
      };
    }

    const result = await tool.handler({ userId }, parsed.data as any);
    return {
      jsonrpc: "2.0",
      id,
      result: {
        content: [{ type: "text", text: JSON.stringify(result) }],
      },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}
