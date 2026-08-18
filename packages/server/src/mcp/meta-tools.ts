import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { registry } from "../plugins/registry";
import { createContext } from "../plugins/context";
import { auditLogger } from "../audit/logger";
import { getToken } from "../auth/tokens";
import { getUserById } from "../auth/users";
import { hasValidCookies } from "../auth/cookie";
import { withSpan } from "../telemetry/tracing";
import { toolExecutionsTotal, toolExecutionDuration } from "../telemetry/metrics";
import { config } from "../config";
import { buildPluginAuthUrl } from "../auth/plugin-oauth";
import { createPending, getPending, reapOne } from "../auth/connections";
import { signConnectToken } from "../auth/connect-token";
import { ensureSession, navigate } from "../auth/browser-session";
import { getContinuationParts, CONTINUATION_PARTS_KEY } from "./result-overflow";

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
): Promise<
  | { connectionId: string; type: "oauth2" | "cookie"; url: string }
  | { error: string }
> {
  const integ = registry.getIntegration(integration);
  if (!integ) return { error: "Integration not found" };
  if (integ.auth.type === "none") {
    return { error: `${integration} is built-in and always connected — no connect needed.` };
  }
  const ttl = config.CONNECT_TTL_SECONDS;

  if (integ.auth.type === "cookie") {
    try {
      const session = await ensureSession(userId);
      await navigate(session, integ.auth.loginUrl);
      const rec = createPending({ userId, integration, type: "cookie", ttlSeconds: ttl });
      const jwt = await signConnectToken(
        { connectionId: rec.connectionId, userId, integration, sessionId: userId, cdpToken: session.cdpToken },
        ttl
      );
      return { connectionId: rec.connectionId, type: "cookie", url: `${config.PORTAL_URL}/connect/${integration}?t=${jwt}` };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  try {
    const rec = createPending({ userId, integration, type: "oauth2", ttlSeconds: ttl });
    const url = await buildPluginAuthUrl(userId, integration);
    return { connectionId: rec.connectionId, type: "oauth2", url };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// Core single-tool execution: connection check, schema validation, audit, run.
// The per-item engine behind `execute_tools` (batch). Never throws — failures
// come back as { error }.
type ExecResult = { result: unknown } | { error: string; integration?: string; message?: string };
async function executeSingle(
  userId: string,
  toolName: string,
  rawArgs: Record<string, unknown>
): Promise<ExecResult> {
  const targetTool = registry.getTool(toolName);
  return withSpan(
    "execute_single",
    async () => {
      const start = Date.now();

      if (!targetTool) {
        await auditLogger.log({
          user_id: userId,
          tool: toolName,
          action: "EXECUTE",
          success: false,
          error: "Tool not found",
          duration_ms: Date.now() - start,
        });
        return { error: "Tool not found" };
      }

      const integ = registry.getIntegration(targetTool.integration);
      const isConnected =
        integ?.auth.type === "none"
          ? true
          : integ?.auth.type === "cookie"
            ? await hasValidCookies(userId, targetTool.integration)
            : !!(await getToken(userId, targetTool.integration));

      if (!isConnected) {
        await auditLogger.log({
          user_id: userId,
          integration: targetTool.integration,
          tool: toolName,
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
      // we'd blindly forward whatever the caller sent and the plugin
      // would see `undefined` for optional-with-default fields.
      let parsedArgs: unknown = rawArgs;
      try {
        const parsed = targetTool.inputSchema.safeParse(rawArgs ?? {});
        if (!parsed.success) {
          await auditLogger.log({
            user_id: userId,
            integration: targetTool.integration,
            tool: toolName,
            action: "EXECUTE",
            success: false,
            error: "INVALID_ARGS",
            duration_ms: Date.now() - start,
          });
          return { error: `Invalid arguments for ${toolName}: ${parsed.error?.message ?? "schema mismatch"}` };
        }
        parsedArgs = parsed.data;
      } catch (e) {
        // Unexpected throw during schema parsing (e.g. a malformed schema).
        // Don't swallow silently: record it observably, then fall through
        // with raw args so execution still proceeds.
        const err = e instanceof Error ? e.message : String(e);
        await auditLogger.log({
          user_id: userId,
          integration: targetTool.integration,
          tool: toolName,
          action: "EXECUTE",
          success: false,
          error: `SAFEPARSE_ERROR: ${err}`,
          duration_ms: Date.now() - start,
        });
      }

      try {
        const toolCtx = await createContext(userId, targetTool.integration);
        const result = await targetTool.handler(toolCtx, parsedArgs as Record<string, unknown>);
        const duration_ms = Date.now() - start;
        await auditLogger.log({
          user_id: userId,
          integration: targetTool.integration,
          tool: toolName,
          action: "EXECUTE",
          success: true,
          duration_ms,
        });
        console.log(JSON.stringify({
          level: 30,
          msg: "tool executed",
          user_id: userId,
          integration: targetTool.integration,
          tool: toolName,
          success: true,
          duration_ms,
        }));
        const durationS = duration_ms / 1000;
        toolExecutionsTotal.inc({ integration: targetTool.integration, tool: toolName, success: "true" });
        toolExecutionDuration.observe({ integration: targetTool.integration, tool: toolName, success: "true" }, durationS);
        return { result };
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        const duration_ms = Date.now() - start;
        await auditLogger.log({
          user_id: userId,
          integration: targetTool.integration,
          tool: toolName,
          action: "EXECUTE",
          success: false,
          error: err,
          duration_ms,
        });
        console.log(JSON.stringify({
          level: 50,
          msg: "tool execute failed",
          user_id: userId,
          integration: targetTool.integration,
          tool: toolName,
          success: false,
          error: err,
          duration_ms,
        }));
        const durationS = duration_ms / 1000;
        toolExecutionsTotal.inc({ integration: targetTool.integration, tool: toolName, success: "false" });
        toolExecutionDuration.observe({ integration: targetTool.integration, tool: toolName, success: "false" }, durationS);
        return { error: err };
      }
    },
    { tool: toolName, integration: targetTool?.integration || "unknown" }
  );
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
      // Return portable JSON Schema, not raw Zod internals, so any MCP client
      // can consume it without Zod knowledge. Non-Zod schemas pass through.
      const schema =
        t.inputSchema instanceof z.ZodType
          ? zodToJsonSchema(t.inputSchema as z.ZodTypeAny)
          : t.inputSchema;
      return { schema };
    },
  },
  {
    name: "execute_tools",
    description:
      "Execute one or more tools in a single call. Runs them concurrently (bounded) and returns a `results` array in the same order as `executions`. A single tool failing does not abort the others — its entry carries an `error` instead of a `result`. For a single tool, pass a one-element `executions` array. " +
      "Oversized per-item responses: content[0] is {\"results\":[...]} where each entry is either a normal {result}/{error}, or a truncated stub (truncated:true, continuationId, resultIndex, totalParts, complete, partsIncluded) when that item alone exceeded ~60k chars. For stubs with partsIncluded:true, following content blocks are that item's continuation envelopes — concatenate chunk fields for that continuationId in ascending part order, then JSON.parse (do not concat across items). At most MAX_OVERFLOW_ITEMS oversized items include parts eagerly; stubs with partsIncluded:false need continue_tool_result (omit part). Small siblings stay inline in content[0].",
    inputSchema: z.object({
      executions: z
        .array(z.object({ tool: z.string(), args: z.record(z.unknown()).default({}) }))
        .min(1),
    }),
    handler: async (
      ctx: { userId: string },
      args: { executions: { tool: string; args: Record<string, unknown> }[] }
    ) => {
      const { executions } = args;
      const results: ExecResult[] = new Array(executions.length);
      // Bounded worker pool: cap concurrency so a large batch can't open an
      // unbounded number of upstream connections at once. Results stay ordered
      // because each worker writes to its claimed index.
      const CONCURRENCY = 8;
      let next = 0;
      const worker = async (): Promise<void> => {
        for (;;) {
          const i = next++;
          if (i >= executions.length) return;
          const ex = executions[i];
          results[i] = await executeSingle(ctx.userId, ex.tool, ex.args ?? {});
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, executions.length) }, () => worker())
      );
      return { results };
    },
  },
  {
    name: "whoami",
    description: "Return the current authenticated workbench user (id + email). Like /me — identity only, not connected integrations.",
    inputSchema: z.object({}),
    handler: async (ctx: { userId: string }) => {
      const user = await getUserById(ctx.userId);
      if (!user) return { error: "User not found" };
      return { id: user.id, email: user.email };
    },
  },
  {
    name: "list_integrations",
    description: "List all available integrations and connection status",
    inputSchema: z.object({}),
    handler: async (ctx: { userId: string }) => {
      const integrations = registry.listIntegrations();
      const items = await Promise.all(
        integrations.map(async (i) => ({
          name: i.name,
          version: i.version,
          connected:
            i.auth.type === "none"
              ? true
              : i.auth.type === "cookie"
                ? await hasValidCookies(ctx.userId, i.name)
                : !!(await getToken(ctx.userId, i.name)),
        }))
      );
      return { integrations: items };
    },
  },
  {
    name: "connect",
    description: "Begin connecting an integration. For oauth2, returns a URL (OAuth consent page) and a connectionId; call wait_for_connection afterward. For cookie integrations, always returns a portal login URL and a connectionId — the user opens it to log in live and click Capture; call wait_for_connection afterward.",
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
  {
    name: "continue_tool_result",
    description:
      "Re-fetch overflow parts by continuationId if a prior tools/call response was incomplete or discarded. Oversized results already return every stored part as separate text content blocks (for execute_tools, per oversized results[] item) — concatenate chunk fields for that continuationId in ascending part order; call this only when a part is missing. Omit part to receive all stored parts as separate content blocks; or pass part for a single chunk.",
    inputSchema: z.object({
      continuationId: z.string(),
      part: z.number().int().positive().optional(),
    }),
    handler: (ctx: { userId: string }, args: { continuationId: string; part?: number }) => {
      const parts = getContinuationParts(ctx.userId, args.continuationId, args.part);
      if ("error" in parts) return Promise.resolve(parts);
      // Sentinel: handleMcpRequest expands each envelope into its own content[] text block.
      return Promise.resolve({ [CONTINUATION_PARTS_KEY]: parts });
    },
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
  execute_tools: {
    type: "object",
    properties: {
      executions: {
        type: "array",
        description: "Tools to run; results are returned in this same order.",
        items: {
          type: "object",
          properties: {
            tool: { type: "string", description: "Tool name returned by search_tools" },
            args: { type: "object", description: "Arguments for the tool", additionalProperties: true },
          },
          required: ["tool"],
        },
      },
    },
    required: ["executions"],
  },
  whoami: { type: "object", properties: {} },
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
  continue_tool_result: {
    type: "object",
    properties: {
      continuationId: {
        type: "string",
        description: "continuationId from a truncated tool result",
      },
      part: {
        type: "number",
        description:
          "Optional 1-based part number. Omit to re-fetch all stored parts as separate content blocks; pass to fetch a single chunk.",
      },
    },
    required: ["continuationId"],
  },
};
