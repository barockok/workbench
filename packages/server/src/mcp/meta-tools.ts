import { z } from "zod";
import { registry } from "../plugins/registry";
import { createContext } from "../plugins/context";
import { auditLogger } from "../audit/logger";
import { getToken } from "../auth/tokens";
import { hasValidCookies, startCookieSession, closeCookieSession } from "../auth/cookie";
import { withSpan } from "../telemetry/tracing";
import { config } from "../config";
import { buildPluginAuthUrl } from "../auth/plugin-oauth";
import { createPending, getPending, reapOne } from "../auth/connections";
import { signConnectToken } from "../auth/connect-token";

// Shape of a meta-tool definition. `inputSchema` is a real Zod schema so we
// can call `.safeParse` directly without hand-rolled casts. `handler` is kept
// loosely typed because each tool has its own ctx/args signature.
interface MetaTool {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  handler: (ctx: never, args: never) => Promise<unknown>;
}

async function startConnect(
  userId: string,
  integration: string
): Promise<{ connectionId: string; type: "oauth2" | "cookie"; url: string } | { error: string }> {
  const integ = registry.getIntegration(integration);
  if (!integ) return { error: "Integration not found" };
  const ttl = config.CONNECT_TTL_SECONDS;

  if (integ.auth.type === "cookie") {
    let sessionId: string | undefined;
    try {
      const session = await startCookieSession(
        userId, integration, integ.auth.loginUrl, integ.auth.targetDomain, integ.auth.cookieDomains
      );
      sessionId = session.sessionId;
      const rec = createPending({ userId, integration, type: "cookie", ttlSeconds: ttl, cookieSessionId: sessionId });
      const jwt = await signConnectToken(
        { connectionId: rec.connectionId, userId, integration, sessionId, cdpToken: session.cdpToken }, ttl
      );
      return { connectionId: rec.connectionId, type: "cookie", url: `${config.PORTAL_URL}/connect/${integration}?t=${jwt}` };
    } catch (err) {
      if (sessionId) await closeCookieSession(sessionId).catch(() => undefined);
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    const rec = createPending({ userId, integration, type: "oauth2", ttlSeconds: ttl });
    const url = buildPluginAuthUrl(userId, integration);
    return { connectionId: rec.connectionId, type: "oauth2", url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// `satisfies` (not an explicit annotation) keeps each element's `name` as a
// string literal, so `metaToolSchemas` below can require exactly these keys.
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

          const integ = registry.getIntegration(targetTool.integration);
          const isConnected = integ?.auth.type === "cookie"
            ? hasValidCookies(ctx.userId, targetTool.integration)
            : !!getToken(ctx.userId, targetTool.integration);

          if (!isConnected) {
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
              message: `${targetTool.integration} not connected. Use connect('${targetTool.integration}') to connect.`,
            };
          }

          // Validate args against the plugin tool's own schema so that
          // Zod defaults (e.g. pageSize=10) get applied. Without this,
          // execute_tool blindly forwards whatever the caller sent and
          // the plugin sees `undefined` for optional-with-default fields.
          let parsedArgs: unknown = args.args;
          try {
            const parsed = targetTool.inputSchema.safeParse(args.args ?? {});
            if (!parsed.success) {
              await auditLogger.log({
                user_id: ctx.userId,
                integration: targetTool.integration,
                tool: args.tool,
                action: "EXECUTE",
                success: false,
                error: "INVALID_ARGS",
                duration_ms: Date.now() - start,
              });
              return { error: `Invalid arguments for ${args.tool}: ${parsed.error?.message ?? "schema mismatch"}` };
            }
            parsedArgs = parsed.data;
          } catch (e) {
            // Unexpected throw during schema parsing (e.g. a malformed schema).
            // Don't swallow silently: record it observably, then fall through
            // with raw args so execution still proceeds.
            const err = e instanceof Error ? e.message : String(e);
            await auditLogger.log({
              user_id: ctx.userId,
              integration: targetTool.integration,
              tool: args.tool,
              action: "EXECUTE",
              success: false,
              error: `SAFEPARSE_ERROR: ${err}`,
              duration_ms: Date.now() - start,
            });
          }

          try {
            const toolCtx = createContext(ctx.userId, targetTool.integration);
            const result = await targetTool.handler(toolCtx, parsedArgs as Record<string, unknown>);
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
          connected:
            i.auth.type === "cookie"
              ? hasValidCookies(ctx.userId, i.name)
              : !!getToken(ctx.userId, i.name),
        })),
      };
    },
  },
  {
    name: "connect",
    description: "Begin connecting an integration. Returns an openable URL (OAuth consent for oauth2, a browser login link for cookie auth) and a connectionId. Then call wait_for_connection.",
    inputSchema: z.object({ integration: z.string() }),
    handler: (ctx: { userId: string }, args: { integration: string }) => startConnect(ctx.userId, args.integration),
  },
  {
    name: "wait_for_connection",
    description: "Block until a connection started by connect() completes. Returns status CONNECTED, TIMEOUT, or EXPIRED.",
    inputSchema: z.object({ connectionId: z.string(), timeoutSec: z.number().int().positive().max(900).default(300) }),
    handler: async (ctx: { userId: string }, args: { connectionId: string; timeoutSec: number }) => {
      const deadline = Date.now() + args.timeoutSec * 1000;
      for (;;) {
        const rec = getPending(args.connectionId);
        if (!rec) return { error: "Unknown connectionId" };
        if (rec.userId !== ctx.userId) return { error: "Unknown connectionId" }; // same shape — no existence oracle
        if (rec.status === "CONNECTED") return { status: "CONNECTED" };
        if (rec.status === "EXPIRED") return { status: "EXPIRED" };
        if (Date.now() >= deadline) { await reapOne(args.connectionId); return { status: "TIMEOUT" }; }
        await new Promise((r) => setTimeout(r, 1000));
      }
    },
  },
  {
    name: "get_auth_url",
    description: "Deprecated alias of connect(). Get a URL to connect an integration.",
    inputSchema: z.object({ integration: z.string() }),
    handler: (ctx: { userId: string }, args: { integration: string }) => startConnect(ctx.userId, args.integration),
  },
] satisfies readonly MetaTool[];

// JSON Schema descriptions for the meta-tools, surfaced via MCP `tools/list`.
// Kept here so the tool definitions and their wire schemas stay co-located.
// Keyed by tool name so adding a meta-tool without a wire schema is a
// compile error rather than a silent fallback in tools/list.
export const metaToolSchemas: Record<(typeof metaTools)[number]["name"], Record<string, unknown>> = {
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
  connect: {
    type: "object",
    properties: { integration: { type: "string", description: "Integration name" } },
    required: ["integration"],
  },
  wait_for_connection: {
    type: "object",
    properties: {
      connectionId: { type: "string", description: "ID returned by connect()" },
      timeoutSec: { type: "number", description: "Max seconds to wait (default 300)" },
    },
    required: ["connectionId"],
  },
  get_auth_url: {
    type: "object",
    properties: { integration: { type: "string", description: "Integration name" } },
    required: ["integration"],
  },
};
