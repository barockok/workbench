import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
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
import {
  ensureSession,
  touch,
  navigate as browserNavigate,
  screenshot as browserScreenshot,
  click as browserClick,
  typeText as browserType,
  pressKey as browserKey,
  scroll as browserScroll,
  closeBrowserSession,
} from "../auth/browser-session";

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

// Core single-tool execution: connection check, schema validation, audit, run.
// Shared by `execute_tool` (one call) and `execute_tools` (batch), so both
// behave identically per item. Never throws — failures come back as { error }.
type ExecResult = { result: unknown } | { error: string; integration?: string; message?: string };
async function executeSingle(
  userId: string,
  toolName: string,
  rawArgs: Record<string, unknown>
): Promise<ExecResult> {
  const targetTool = registry.getTool(toolName);
  return withSpan(
    "execute_tool",
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
      const isConnected = integ?.auth.type === "cookie"
        ? hasValidCookies(userId, targetTool.integration)
        : !!getToken(userId, targetTool.integration);

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
      // execute_tool blindly forwards whatever the caller sent and
      // the plugin sees `undefined` for optional-with-default fields.
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
        const toolCtx = createContext(userId, targetTool.integration);
        const result = await targetTool.handler(toolCtx, parsedArgs as Record<string, unknown>);
        await auditLogger.log({
          user_id: userId,
          integration: targetTool.integration,
          tool: toolName,
          action: "EXECUTE",
          success: true,
          duration_ms: Date.now() - start,
        });
        return { result };
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        await auditLogger.log({
          user_id: userId,
          integration: targetTool.integration,
          tool: toolName,
          action: "EXECUTE",
          success: false,
          error: err,
          duration_ms: Date.now() - start,
        });
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
    name: "execute_tool",
    description: "Execute a tool by name with arguments",
    inputSchema: z.object({
      tool: z.string(),
      args: z.record(z.unknown()),
    }),
    handler: (ctx: { userId: string }, args: { tool: string; args: Record<string, unknown> }) =>
      executeSingle(ctx.userId, args.tool, args.args),
  },
  {
    name: "execute_tools",
    description:
      "Execute multiple tools in one call. Runs them concurrently (bounded) and returns a `results` array in the same order as `executions`. A single tool failing does not abort the others — its entry carries an `error` instead of a `result`.",
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
  {
    name: "browser_navigate",
    description: "Navigate the per-user browser session to a URL. Opens a warm session if none is active. Returns the final url and page title.",
    inputSchema: z.object({ url: z.string().url() }),
    handler: async (ctx: { userId: string }, args: { url: string }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      return browserNavigate(s, args.url);
    },
  },
  {
    name: "browser_screenshot",
    description: "Capture a PNG screenshot of the current viewport. Returns an image the model can view. Use it to see the page before clicking.",
    inputSchema: z.object({}),
    handler: async (ctx: { userId: string }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      const data = await browserScreenshot(s);
      return { _mcpImage: { data, mimeType: "image/png" } };
    },
  },
  {
    name: "browser_click",
    description: "Click at viewport coordinates (x, y) in the per-user browser session.",
    inputSchema: z.object({
      x: z.number(),
      y: z.number(),
      button: z.enum(["left", "right", "middle"]).default("left"),
    }),
    handler: async (ctx: { userId: string }, args: { x: number; y: number; button: "left" | "right" | "middle" }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      await browserClick(s, args.x, args.y, args.button);
      return { ok: true };
    },
  },
  {
    name: "browser_type",
    description: "Type text into the currently focused element. Click the field first.",
    inputSchema: z.object({ text: z.string() }),
    handler: async (ctx: { userId: string }, args: { text: string }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      await browserType(s, args.text);
      return { ok: true };
    },
  },
  {
    name: "browser_key",
    description: "Press a key or chord, e.g. 'Enter', 'Tab', 'ctrl+a', 'ArrowDown'.",
    inputSchema: z.object({ keys: z.string() }),
    handler: async (ctx: { userId: string }, args: { keys: string }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      await browserKey(s, args.keys);
      return { ok: true };
    },
  },
  {
    name: "browser_scroll",
    description: "Scroll the viewport up/down/left/right by an optional pixel amount (default 600).",
    inputSchema: z.object({
      direction: z.enum(["up", "down", "left", "right"]),
      amount: z.number().int().positive().default(600),
    }),
    handler: async (ctx: { userId: string }, args: { direction: "up" | "down" | "left" | "right"; amount: number }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      await browserScroll(s, args.direction, args.amount);
      return { ok: true };
    },
  },
  {
    name: "browser_close",
    description: "Close the per-user warm browser session (the persistent profile is kept). Frees the single-writer lock so a cookie capture can run.",
    inputSchema: z.object({}),
    handler: async (ctx: { userId: string }) => {
      await closeBrowserSession(ctx.userId);
      return { ok: true };
    },
  },
  {
    name: "browser_live_url",
    description: "Get a short-lived URL to watch and take over the per-user browser session in a web canvas. Open it to drive the same browser by hand, then return control to the model.",
    inputSchema: z.object({}),
    handler: async (ctx: { userId: string }) => {
      const s = await ensureSession(ctx.userId);
      touch(ctx.userId);
      const jwt = await signConnectToken(
        { connectionId: ctx.userId, userId: ctx.userId, integration: "__browser__", sessionId: ctx.userId, cdpToken: s.cdpToken },
        config.CONNECT_TTL_SECONDS
      );
      return { url: `${config.PORTAL_URL}/browser?t=${jwt}` };
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
  execute_tool: {
    type: "object",
    properties: {
      tool: { type: "string", description: "Tool name returned by search_tools" },
      args: { type: "object", description: "Arguments for the tool", additionalProperties: true },
    },
    required: ["tool", "args"],
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
  browser_navigate: {
    type: "object",
    properties: { url: { type: "string", description: "URL to navigate to" } },
    required: ["url"],
  },
  browser_screenshot: { type: "object", properties: {} },
  browser_click: {
    type: "object",
    properties: {
      x: { type: "number", description: "Viewport x coordinate" },
      y: { type: "number", description: "Viewport y coordinate" },
      button: { type: "string", enum: ["left", "right", "middle"], description: "Mouse button (default left)" },
    },
    required: ["x", "y"],
  },
  browser_type: {
    type: "object",
    properties: { text: { type: "string", description: "Text to type into the focused element" } },
    required: ["text"],
  },
  browser_key: {
    type: "object",
    properties: { keys: { type: "string", description: "Key or chord, e.g. Enter, ctrl+a" } },
    required: ["keys"],
  },
  browser_scroll: {
    type: "object",
    properties: {
      direction: { type: "string", enum: ["up", "down", "left", "right"], description: "Scroll direction" },
      amount: { type: "number", description: "Pixels to scroll (default 600)" },
    },
    required: ["direction"],
  },
  browser_close: { type: "object", properties: {} },
  browser_live_url: { type: "object", properties: {} },
};
