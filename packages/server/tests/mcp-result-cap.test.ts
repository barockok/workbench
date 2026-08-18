import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  packageResultText,
  packageResultContent,
  packageBatchResultContent,
  getContinuationPart,
  getContinuationParts,
  maxResultChars,
  chunkChars,
  maxOverflowParts,
  _clearForTest,
  _setNowForTest,
} from "../src/mcp/result-overflow";
import { handleMcpRequest } from "../src/mcp/server";
import { metaTools } from "../src/mcp/meta-tools";
import { config } from "../src/config";

// Snapshot of defaults — suites that mutate MAX_RESULT_CHARS must call the getters.
const MAX_RESULT_CHARS = maxResultChars();
const CHUNK_CHARS = chunkChars();

describe("packageResultText / continuation", () => {
  beforeEach(() => {
    _clearForTest();
    _setNowForTest(() => Date.now());
  });

  it("passes small results through untouched", () => {
    const text = JSON.stringify({ ok: true });
    expect(packageResultText("u1", text)).toBe(text);
  });

  it("passes a result exactly at the cap through untouched", () => {
    const text = "x".repeat(MAX_RESULT_CHARS);
    expect(packageResultText("u1", text)).toBe(text);
  });

  it("returns a continuation envelope for oversized results instead of truncating", () => {
    const text = "y".repeat(MAX_RESULT_CHARS + 5_000);
    const packed = packageResultText("u1", text);
    expect(packed.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);

    const env = JSON.parse(packed);
    expect(env.truncated).toBe(true);
    expect(env.part).toBe(1);
    expect(env.hasMore).toBe(true);
    expect(env.nextPart).toBe(2);
    expect(env.complete).toBe(true);
    expect(env.totalChars).toBe(text.length);
    expect(env.chunk).toBe(text.slice(0, CHUNK_CHARS));
    expect(env.instruction).toContain("All available parts are returned");
    expect(env.instruction).toContain("continue_tool_result");
  });

  it("eager-packages every stored part as a separate content string", () => {
    const text = "z".repeat(CHUNK_CHARS * 2 + 100);
    const parts = packageResultContent("u1", text);
    expect(parts).toHaveLength(3);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
    }
    const envs = parts.map((p) => JSON.parse(p));
    expect(envs.map((e) => e.part)).toEqual([1, 2, 3]);
    expect(envs.every((e) => e.continuationId === envs[0].continuationId)).toBe(true);
    expect(envs[0].instruction).toContain("All available parts are returned");
    expect(envs[0].chunk + envs[1].chunk + envs[2].chunk).toBe(text);
  });

  it("lets the owner fetch subsequent parts and reconstruct the full text", () => {
    const text = "z".repeat(CHUNK_CHARS * 2 + 100);
    const env1 = JSON.parse(packageResultText("u1", text));
    expect(env1.totalParts).toBe(3);
    expect(env1.complete).toBe(true);

    const part2 = getContinuationPart("u1", env1.continuationId, 2);
    expect("error" in part2).toBe(false);
    if ("error" in part2) return;
    expect(part2.part).toBe(2);
    expect(part2.hasMore).toBe(true);
    expect(part2.instruction).toContain(`continuationId="${env1.continuationId}"`);
    expect(part2.instruction).not.toContain("All available parts are returned");

    const part3 = getContinuationPart("u1", env1.continuationId, 3);
    expect("error" in part3).toBe(false);
    if ("error" in part3) return;
    expect(part3.hasMore).toBe(false);
    expect(part3.nextPart).toBeNull();
    expect(part3.complete).toBe(true);

    expect(env1.chunk + part2.chunk + part3.chunk).toBe(text);
  });

  it("rejects other users and unknown ids", () => {
    const text = "a".repeat(MAX_RESULT_CHARS + 1);
    const env = JSON.parse(packageResultText("owner", text));
    expect(getContinuationPart("other", env.continuationId, 1)).toEqual({
      error: "Unknown or expired continuationId",
    });
    expect(getContinuationPart("owner", "missing", 1)).toEqual({
      error: "Unknown or expired continuationId",
    });
  });

  it("expires continuations after TTL", () => {
    let t = 1_000_000;
    _setNowForTest(() => t);
    const text = "b".repeat(MAX_RESULT_CHARS + 1);
    const env = JSON.parse(packageResultText("u1", text));
    t += 11 * 60 * 1000;
    expect(getContinuationPart("u1", env.continuationId, 1)).toEqual({
      error: "Unknown or expired continuationId",
    });
  });
});

describe("MAX_OVERFLOW_TOKENS cap", () => {
  const originalTokens = config.MAX_OVERFLOW_TOKENS;
  const originalChars = config.MAX_RESULT_CHARS;

  beforeEach(() => {
    _clearForTest();
    _setNowForTest(() => Date.now());
    config.MAX_RESULT_CHARS = 60_000;
    // 120k / 60k = 2 parts. Natural size needs 3; keep only 2.
    config.MAX_OVERFLOW_TOKENS = 2 * config.MAX_RESULT_CHARS;
  });

  afterEach(() => {
    config.MAX_OVERFLOW_TOKENS = originalTokens;
    config.MAX_RESULT_CHARS = originalChars;
  });

  it("caps fetchable parts and marks complete false when more existed", () => {
    const size = chunkChars();
    const text = "d".repeat(size * 2 + 100);
    const env1 = JSON.parse(packageResultText("u1", text));
    expect(env1.totalParts).toBe(2);
    expect(env1.complete).toBe(false);
    expect(env1.hasMore).toBe(true);
    expect(env1.totalChars).toBe(size * 2);

    const part2 = getContinuationPart("u1", env1.continuationId, 2);
    expect("error" in part2).toBe(false);
    if ("error" in part2) return;
    expect(part2.hasMore).toBe(false);
    expect(part2.complete).toBe(false);
    expect(part2.instruction).toContain("MAX_OVERFLOW_TOKENS=120000");
    expect(part2.instruction).toContain("omitted");

    expect(getContinuationPart("u1", env1.continuationId, 3)).toEqual({
      error: "part must be an integer from 1 to 2",
    });

    expect(env1.chunk + part2.chunk).toBe(text.slice(0, size * 2));
  });

  it("defaults to 5 parts at 300000 / 60000", () => {
    config.MAX_RESULT_CHARS = 60_000;
    config.MAX_OVERFLOW_TOKENS = 300_000;
    expect(maxOverflowParts()).toBe(5);
  });

  it("increases part count when MAX_RESULT_CHARS halves at a fixed token budget", () => {
    config.MAX_OVERFLOW_TOKENS = 300_000;
    config.MAX_RESULT_CHARS = 30_000;
    expect(maxOverflowParts()).toBe(10);

    const size = chunkChars();
    const text = "g".repeat(size * 10 + 100);
    const parts = packageResultContent("u1", text);
    expect(parts).toHaveLength(10);
    const env1 = JSON.parse(parts[0]);
    expect(env1.totalParts).toBe(10);
    expect(env1.complete).toBe(false);
    expect(env1.totalChars).toBe(size * 10);
  });
});

describe("continue_tool_result meta-tool", () => {
  beforeEach(() => {
    _clearForTest();
    _setNowForTest(() => Date.now());
  });

  it("is listed and fetches a single part via tools/call", async () => {
    const list = await handleMcpRequest({ method: "tools/list", id: 1 }, "user-1");
    const names = (list as any).result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("continue_tool_result");

    const text = "c".repeat(CHUNK_CHARS * 2 + 100);
    const env1 = JSON.parse(packageResultText("user-1", text));

    const res = await handleMcpRequest(
      {
        method: "tools/call",
        id: 2,
        params: {
          name: "continue_tool_result",
          arguments: { continuationId: env1.continuationId, part: 2 },
        },
      },
      "user-1"
    );
    const content = (res as any).result.content as { type: string; text: string }[];
    expect(content).toHaveLength(1);
    const body = JSON.parse(content[0].text);
    expect(body.part).toBe(2);
    expect(body.chunk).toBe(text.slice(CHUNK_CHARS, CHUNK_CHARS * 2));
    expect(body.hasMore).toBe(true);
    expect(body.instruction).toContain(`continuationId="${env1.continuationId}"`);
  });

  it("omitting part returns all stored parts as separate content blocks", async () => {
    const text = "e".repeat(CHUNK_CHARS * 2 + 50);
    const env1 = JSON.parse(packageResultText("user-1", text));
    expect(env1.totalParts).toBe(3);

    const res = await handleMcpRequest(
      {
        method: "tools/call",
        id: 3,
        params: {
          name: "continue_tool_result",
          arguments: { continuationId: env1.continuationId },
        },
      },
      "user-1"
    );
    const content = (res as any).result.content as { type: string; text: string }[];
    expect(content).toHaveLength(3);
    const envs = content.map((c) => JSON.parse(c.text));
    expect(envs.map((e) => e.part)).toEqual([1, 2, 3]);
    expect(envs[0].instruction).toContain("All available parts are returned");
    expect(envs.map((e) => e.chunk).join("")).toBe(text);
  });
});

describe("packageBatchResultContent (per-item overflow)", () => {
  beforeEach(() => {
    _clearForTest();
    _setNowForTest(() => Date.now());
  });

  it("keeps an all-small batch as a single {results} content block", () => {
    const results = [{ result: { ok: 1 } }, { error: "nope" }];
    const parts = packageBatchResultContent("u1", results);
    expect(parts).toHaveLength(1);
    expect(JSON.parse(parts[0])).toEqual({ results });
  });

  it("stubs oversized items and eagerly returns their parts with resultIndex", () => {
    const small = { result: { id: "small" } };
    const bigItem = { result: { body: "x".repeat(CHUNK_CHARS * 2 + 200) } };
    const parts = packageBatchResultContent("u1", [small, bigItem]);
    expect(parts.length).toBeGreaterThan(1);

    const header = JSON.parse(parts[0]);
    expect(header.results).toHaveLength(2);
    expect(header.results[0]).toEqual(small);
    expect(header.results[1].truncated).toBe(true);
    expect(header.results[1].resultIndex).toBe(1);
    expect(header.results[1].partsIncluded).toBe(true);
    expect(header.results[1].continuationId).toBeTruthy();
    expect(header.results[1].chunk).toBeUndefined();

    const envs = parts.slice(1).map((p) => JSON.parse(p));
    expect(envs.every((e) => e.resultIndex === 1)).toBe(true);
    expect(envs.every((e) => e.continuationId === header.results[1].continuationId)).toBe(true);
    expect(envs.map((e) => e.part)).toEqual(
      Array.from({ length: envs.length }, (_, i) => i + 1)
    );
    expect(envs.map((e) => e.chunk).join("")).toBe(JSON.stringify(bigItem));
  });

  it("gives each oversized sibling its own continuationId", () => {
    // Body must push JSON.stringify(item) over MAX_RESULT_CHARS (not just CHUNK_CHARS).
    const a = { result: { body: "a".repeat(MAX_RESULT_CHARS) } };
    const b = { result: { body: "b".repeat(MAX_RESULT_CHARS) } };
    expect(JSON.stringify(a).length).toBeGreaterThan(MAX_RESULT_CHARS);
    const parts = packageBatchResultContent("u1", [a, b]);
    const header = JSON.parse(parts[0]);
    expect(header.results[0].truncated).toBe(true);
    expect(header.results[1].truncated).toBe(true);
    expect(header.results[0].partsIncluded).toBe(true);
    expect(header.results[1].partsIncluded).toBe(true);
    expect(header.results[0].continuationId).not.toBe(header.results[1].continuationId);
    expect(header.results[0].resultIndex).toBe(0);
    expect(header.results[1].resultIndex).toBe(1);

    const envs = parts.slice(1).map((p) => JSON.parse(p));
    const for0 = envs.filter((e) => e.resultIndex === 0);
    const for1 = envs.filter((e) => e.resultIndex === 1);
    expect(for0.map((e) => e.chunk).join("")).toBe(JSON.stringify(a));
    expect(for1.map((e) => e.chunk).join("")).toBe(JSON.stringify(b));
  });
});

describe("MAX_OVERFLOW_ITEMS batch guardrail", () => {
  const original = config.MAX_OVERFLOW_ITEMS;

  beforeEach(() => {
    _clearForTest();
    _setNowForTest(() => Date.now());
    config.MAX_OVERFLOW_ITEMS = 1;
  });

  afterEach(() => {
    config.MAX_OVERFLOW_ITEMS = original;
  });

  it("eager-includes only the first N oversized items; defers the rest to continue_tool_result", () => {
    const a = { result: { body: "a".repeat(MAX_RESULT_CHARS) } };
    const b = { result: { body: "b".repeat(MAX_RESULT_CHARS) } };
    const parts = packageBatchResultContent("u1", [a, b]);
    const header = JSON.parse(parts[0]);
    expect(header.results[0].partsIncluded).toBe(true);
    expect(header.results[1].partsIncluded).toBe(false);
    expect(header.results[1].instruction).toContain("MAX_OVERFLOW_ITEMS=1");
    expect(header.results[1].instruction).toContain("continue_tool_result");

    const envs = parts.slice(1).map((p) => JSON.parse(p));
    expect(envs.every((e) => e.resultIndex === 0)).toBe(true);
    expect(envs.map((e) => e.chunk).join("")).toBe(JSON.stringify(a));

    // Deferred item is still stored — omit part to re-fetch all chunks.
    const deferred = getContinuationParts("u1", header.results[1].continuationId);
    expect("error" in deferred).toBe(false);
    if ("error" in deferred) return;
    expect(deferred.map((p) => p.chunk).join("")).toBe(JSON.stringify(b));
  });
});

describe("eager multi-content on tools/call", () => {
  beforeEach(() => {
    _clearForTest();
    _setNowForTest(() => Date.now());
  });

  it("returns header + per-item parts for oversized execute_tools items", async () => {
    // Patch execute_tools to return a large payload without hitting real plugins.
    const tool = metaTools.find((t) => t.name === "execute_tools");
    expect(tool).toBeTruthy();
    const original = tool!.handler;
    const bigItem = { result: { body: "x".repeat(CHUNK_CHARS * 2 + 200) } };
    const small = { result: { ok: true } };
    const big = { results: [bigItem, small] };
    tool!.handler = async () => big;

    try {
      const res = await handleMcpRequest(
        {
          method: "tools/call",
          id: 10,
          params: {
            name: "execute_tools",
            arguments: {
              executions: [
                { tool: "noop", args: {} },
                { tool: "noop", args: {} },
              ],
            },
          },
        },
        "user-1"
      );
      const content = (res as any).result.content as { type: string; text: string }[];
      expect(content.length).toBeGreaterThan(1);
      for (const c of content) {
        expect(c.type).toBe("text");
        expect(c.text.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
      }
      const header = JSON.parse(content[0].text);
      expect(header.results[0].truncated).toBe(true);
      expect(header.results[0].resultIndex).toBe(0);
      expect(header.results[0].partsIncluded).toBe(true);
      expect(header.results[1]).toEqual(small);

      const envs = content.slice(1).map((c) => JSON.parse(c.text));
      expect(envs.every((e) => e.truncated === true && e.resultIndex === 0)).toBe(true);
      expect(envs.map((e) => e.chunk).join("")).toBe(JSON.stringify(bigItem));
    } finally {
      tool!.handler = original;
    }
  });

  it("under-cap tools/call stays a single plain JSON content block", async () => {
    const res = await handleMcpRequest(
      {
        method: "tools/call",
        id: 11,
        params: { name: "whoami", arguments: {} },
      },
      "missing-user"
    );
    const content = (res as any).result.content as { type: string; text: string }[];
    expect(content).toHaveLength(1);
    const body = JSON.parse(content[0].text);
    expect(body.truncated).toBeUndefined();
    expect(body.error).toBe("User not found");
  });
});

describe("overflow description contract", () => {
  it("execute_tools describes per-item overflow, partsIncluded, and deferred fetch", () => {
    const tool = metaTools.find((t) => t.name === "execute_tools");
    expect(tool?.description).toMatch(/per-item/i);
    expect(tool?.description).toMatch(/resultIndex/);
    expect(tool?.description).toMatch(/truncated:true/);
    expect(tool?.description).toMatch(/partsIncluded/);
    expect(tool?.description).toMatch(/MAX_OVERFLOW_ITEMS/);
    expect(tool?.description).toMatch(/partsIncluded:false need continue_tool_result/);
  });

  it("continue_tool_result describes optional re-fetch, not a required loop", () => {
    const tool = metaTools.find((t) => t.name === "continue_tool_result");
    expect(tool?.description).toMatch(/Re-fetch/i);
    expect(tool?.description).toMatch(/Omit part/);
    expect(tool?.description).not.toMatch(/Repeat until hasMore is false/);
  });
});

describe("getContinuationParts", () => {
  beforeEach(() => {
    _clearForTest();
    _setNowForTest(() => Date.now());
  });

  it("returns all parts when part is omitted", () => {
    const text = "f".repeat(CHUNK_CHARS * 2 + 10);
    const env1 = JSON.parse(packageResultText("u1", text));
    const parts = getContinuationParts("u1", env1.continuationId);
    expect("error" in parts).toBe(false);
    if ("error" in parts) return;
    expect(parts).toHaveLength(3);
    expect(parts[0].instruction).toContain("All available parts are returned");
    expect(parts.map((p) => p.chunk).join("")).toBe(text);
  });
});
