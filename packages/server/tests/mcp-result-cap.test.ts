import { describe, it, expect } from "vitest";
import { capResultText, MAX_RESULT_CHARS } from "../src/mcp/server";

describe("tool result size cap", () => {
  it("passes small results through untouched", () => {
    const text = JSON.stringify({ ok: true });
    expect(capResultText(text)).toBe(text);
  });

  it("passes a result exactly at the cap through untouched", () => {
    const text = "x".repeat(MAX_RESULT_CHARS);
    expect(capResultText(text)).toBe(text);
  });

  it("truncates oversized results and appends a notice", () => {
    const text = "y".repeat(MAX_RESULT_CHARS + 5_000);
    const capped = capResultText(text);
    expect(capped.length).toBeLessThan(text.length);
    expect(capped.startsWith("y".repeat(100))).toBe(true);
    expect(capped).toContain("[result truncated");
    expect(capped).toContain(String(text.length));
    expect(capped).toContain("Narrow the request");
  });
});
