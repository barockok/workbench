import { describe, it, expect } from "vitest";
import { registry } from "../src/plugins/registry";

describe("registry", () => {
  it("registers and retrieves tool", () => {
    registry.register({
      integration: {
        name: "test",
        version: "1.0.0",
        auth: { type: "none" },
      },
      tools: [
        {
          name: "test_action",
          description: "Test",
          integration: "test",
          inputSchema: {},
          handler: async () => "ok",
        },
      ],
    });

    const tool = registry.getTool("test_action");
    expect(tool?.name).toBe("test_action");
  });

  it("searches tools", () => {
    const results = registry.searchTools("action");
    expect(results.length).toBeGreaterThan(0);
  });
});
