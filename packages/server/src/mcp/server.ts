import { metaTools, metaToolSchemas } from "./meta-tools";

// Upstream APIs can return arbitrarily large payloads and plugin handlers
// mostly pass them through; without a cap a single tools/call can blow the
// caller's context window. Truncated output is no longer valid JSON — the
// notice tells the model to narrow the request instead of re-parsing.
export const MAX_RESULT_CHARS = 60_000;

export function capResultText(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) return text;
  return (
    text.slice(0, MAX_RESULT_CHARS) +
    `\n…[result truncated: ${text.length} chars total, showing first ${MAX_RESULT_CHARS}. Narrow the request (limit/fields/pagination) to get complete data.]`
  );
}

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
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: metaTools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: metaToolSchemas[t.name] ?? { type: "object", properties: {} },
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

    // A handler may return an image sentinel; surface it as a real MCP image
    // content block instead of JSON text. Everything else is text-wrapped.
    // Also check one level down: execute_tool wraps the plugin result in
    // { result }, and browser_screenshot (a plugin tool now) returns the
    // sentinel there.
    type ImageSentinel = { _mcpImage?: { data: string; mimeType: string } };
    const img =
      (result as ImageSentinel | null)?._mcpImage ??
      ((result as { result?: ImageSentinel } | null)?.result?._mcpImage);
    const content = img
      ? [{ type: "image", data: img.data, mimeType: img.mimeType }]
      : [{ type: "text", text: capResultText(JSON.stringify(result)) }];

    return {
      jsonrpc: "2.0",
      id,
      result: { content },
    };
  }

  return {
    jsonrpc: "2.0",
    id,
    error: { code: -32601, message: `Method not found: ${method}` },
  };
}
