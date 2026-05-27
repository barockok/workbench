import { describe, it, expect } from "vitest";
import { searchToolsSchema, executeToolSchema } from "../src/schemas";

describe("schemas", () => {
  it("validates search_tools input", () => {
    const result = searchToolsSchema.safeParse({ query: "jira" });
    expect(result.success).toBe(true);
  });

  it("rejects empty query", () => {
    const result = searchToolsSchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  it("validates execute_tool input", () => {
    const result = executeToolSchema.safeParse({ tool: "jira_create", args: {} });
    expect(result.success).toBe(true);
  });
});
