import { z } from "zod";
import { registry } from "../plugins/registry";
import { createContext } from "../plugins/context";
import { auditLogger } from "../audit/logger";
import { getToken } from "../auth/tokens";
import { withSpan } from "../telemetry/tracing";

export const metaTools = [
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
      const targetTool = registry.getTool(args.tool);
      return withSpan(
        "execute_tool",
        async () => {
          const start = Date.now();

          if (!targetTool) {
            await auditLogger.log({
              user_id: ctx.userId,
              tool: args.tool,
              action: "EXECUTE",
              success: false,
              error: "Tool not found",
              duration_ms: Date.now() - start,
            });
            return { error: "Tool not found" };
          }

          const token = getToken(ctx.userId, targetTool.integration);
          if (!token) {
            await auditLogger.log({
              user_id: ctx.userId,
              integration: targetTool.integration,
              tool: args.tool,
              action: "EXECUTE",
              success: false,
              error: "NOT_CONNECTED",
              duration_ms: Date.now() - start,
            });
            return {
              error: "NOT_CONNECTED",
              integration: targetTool.integration,
              message: `${targetTool.integration} not connected. Use get_auth_url('${targetTool.integration}') to connect.`,
            };
          }

          try {
            const toolCtx = createContext(ctx.userId, targetTool.integration);
            const result = await targetTool.handler(toolCtx, args.args);
            await auditLogger.log({
              user_id: ctx.userId,
              integration: targetTool.integration,
              tool: args.tool,
              action: "EXECUTE",
              success: true,
              duration_ms: Date.now() - start,
            });
            return { result };
          } catch (e) {
            const err = e instanceof Error ? e.message : String(e);
            await auditLogger.log({
              user_id: ctx.userId,
              integration: targetTool.integration,
              tool: args.tool,
              action: "EXECUTE",
              success: false,
              error: err,
              duration_ms: Date.now() - start,
            });
            return { error: err };
          }
        },
        { tool: args.tool, integration: targetTool?.integration || "unknown" }
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
          connected: !!getToken(ctx.userId, i.name),
        })),
      };
    },
  },
  {
    name: "get_auth_url",
    description: "Get OAuth URL to connect an integration",
    inputSchema: z.object({ integration: z.string() }),
    handler: async (ctx: { userId: string }, args: { integration: string }) => {
      return {
        url: `/api/auth/${args.integration}?user=${ctx.userId}`,
      };
    },
  },
];
