import { metaTools, metaToolSchemas } from "./meta-tools";
import {
  packageResultContent,
  packageResultText,
  packageBatchResultContent,
  encodeEnvelope,
  MAX_RESULT_CHARS,
  CONTINUATION_PARTS_KEY,
  type ContinuationEnvelope,
} from "./result-overflow";

// Upstream APIs can return arbitrarily large payloads and plugin handlers
// mostly pass them through; without a cap a single tools/call can blow the
// caller's context window. Oversized results are split into chunks: every
// stored part is returned as a separate content[] text block so the agent
// can concatenate without a continue loop. execute_tools packages each
// results[] item independently. continue_tool_result remains for re-fetch.
export {
  MAX_RESULT_CHARS,
  packageResultText,
  packageResultContent,
  packageBatchResultContent,
};

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

    // continue_tool_result may return multiple envelopes via a sentinel so each
    // becomes its own content[] text block (avoids re-overflow of a nested array).
    const continuationParts = (result as { [CONTINUATION_PARTS_KEY]?: ContinuationEnvelope[] } | null)?.[
      CONTINUATION_PARTS_KEY
    ];
    if (Array.isArray(continuationParts)) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: continuationParts.map((env) => ({
            type: "text",
            text: encodeEnvelope(env),
          })),
        },
      };
    }

    // A plugin handler may return an image sentinel; surface it as a real MCP
    // image content block instead of JSON text. The renderer stays agnostic of
    // which meta-tool produced the result: it just looks for `_mcpImage`
    // wherever it can sit — on the value itself, under a `{ result }` wrapper,
    // or inside an `execute_tools` `{ results: [{ result }] }` batch (which may
    // carry several screenshots). Any sentinels found become image blocks;
    // otherwise text-wrap with eager multi-content on overflow (per-item for
    // execute_tools).
    type ImageSentinel = { _mcpImage?: { data: string; mimeType: string } };
    const collectImages = (node: unknown): { data: string; mimeType: string }[] => {
      if (!node || typeof node !== "object") return [];
      const direct = (node as ImageSentinel)._mcpImage;
      if (direct) return [direct];
      const wrapped = (node as { result?: unknown }).result;
      if (wrapped !== undefined) return collectImages(wrapped);
      const batch = (node as { results?: unknown }).results;
      if (Array.isArray(batch)) return batch.flatMap(collectImages);
      return [];
    };
    const images = collectImages(result);
    let textBlocks: string[];
    if (images.length) {
      textBlocks = [];
    } else if (
      toolParams.name === "execute_tools" &&
      result &&
      typeof result === "object" &&
      Array.isArray((result as { results?: unknown }).results)
    ) {
      textBlocks = packageBatchResultContent(
        userId,
        (result as { results: unknown[] }).results
      );
    } else {
      textBlocks = packageResultContent(userId, JSON.stringify(result));
    }
    const content = images.length
      ? images.map((img) => ({ type: "image", data: img.data, mimeType: img.mimeType }))
      : textBlocks.map((text) => ({ type: "text" as const, text }));

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
