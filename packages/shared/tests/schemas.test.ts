import { describe, it, expect } from "vitest";
import { integrationSchema, searchToolsSchema } from "../src/schemas";

describe("schemas", () => {
  it("validates search_tools input", () => {
    const result = searchToolsSchema.safeParse({ query: "jira" });
    expect(result.success).toBe(true);
  });

  it("rejects empty query", () => {
    const result = searchToolsSchema.safeParse({ query: "" });
    expect(result.success).toBe(false);
  });

  it("validates apikey integration fields", () => {
    const result = integrationSchema.safeParse({
      name: "newrelic",
      version: "1.0.0",
      auth: {
        type: "apikey",
        headerName: "Api-Key",
        allowedHosts: ["api.newrelic.com"],
        fields: [
          { key: "apiKey", label: "API Key", secret: true },
          { key: "region", label: "Region", options: ["US", "EU"] },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects apikey integrations without fields", () => {
    const result = integrationSchema.safeParse({
      name: "broken",
      version: "1.0.0",
      auth: { type: "apikey", headerName: "X-Key" },
    });
    expect(result.success).toBe(false);
  });
});
