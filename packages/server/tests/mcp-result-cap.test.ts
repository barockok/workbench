import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  packageResultText,
  getContinuationPart,
  MAX_RESULT_CHARS,
  CHUNK_CHARS,
  _clearForTest,
  _setNowForTest,
} from "../src/mcp/result-overflow";
import { handleMcpRequest } from "../src/mcp/server";
import { config } from "../src/config";

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
    expect(env.instruction).toContain("continue_tool_result");
    expect(env.instruction).toContain(env.continuationId);
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

describe("MAX_OVERFLOW_PARTS cap", () => {
  const original = config.MAX_OVERFLOW_PARTS;

  beforeEach(() => {
    _clearForTest();
    _setNowForTest(() => Date.now());
    config.MAX_OVERFLOW_PARTS = 2;
  });

  afterEach(() => {
    config.MAX_OVERFLOW_PARTS = original;
  });

  it("caps fetchable parts and marks complete false when more existed", () => {
    // Natural size needs 3 parts; MAX_OVERFLOW_PARTS=2 keeps only 2.
    const text = "d".repeat(CHUNK_CHARS * 2 + 100);
    const env1 = JSON.parse(packageResultText("u1", text));
    expect(env1.totalParts).toBe(2);
    expect(env1.complete).toBe(false);
    expect(env1.hasMore).toBe(true);
    expect(env1.totalChars).toBe(CHUNK_CHARS * 2);

    const part2 = getContinuationPart("u1", env1.continuationId, 2);
    expect("error" in part2).toBe(false);
    if ("error" in part2) return;
    expect(part2.hasMore).toBe(false);
    expect(part2.complete).toBe(false);
    expect(part2.instruction).toContain("MAX_OVERFLOW_PARTS=2");
    expect(part2.instruction).toContain("omitted");

    expect(getContinuationPart("u1", env1.continuationId, 3)).toEqual({
      error: "part must be an integer from 1 to 2",
    });

    expect(env1.chunk + part2.chunk).toBe(text.slice(0, CHUNK_CHARS * 2));
  });
});

describe("continue_tool_result meta-tool", () => {
  beforeEach(() => {
    _clearForTest();
    _setNowForTest(() => Date.now());
  });

  it("is listed and fetches the next part via tools/call", async () => {
    const list = await handleMcpRequest({ method: "tools/list", id: 1 }, "user-1");
    const names = (list as any).result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("continue_tool_result");

    const text = "c".repeat(MAX_RESULT_CHARS + 10_000);
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
    const body = JSON.parse((res as any).result.content[0].text);
    expect(body.part).toBe(2);
    expect(body.chunk).toBe(text.slice(CHUNK_CHARS, CHUNK_CHARS * 2));
    expect(body.hasMore).toBe(false);
    expect(body.complete).toBe(true);
    expect(body.instruction).toContain("final chunk");
  });
});
