import { describe, it, expect, beforeEach } from "vitest";
import { registry } from "../src/plugins/registry";

beforeEach(() => {
  // Clear registry state between tests
  (registry as any).plugins.clear();
  (registry as any).tools.clear();
});

describe("registry", () => {
  it("registers and retrieves tool", () => {
    registry.register({
      integration: {
        name: "test",
        version: "1.0.0",
        auth: { type: "none" as const },
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

  it("returns undefined for missing tool", () => {
    expect(registry.getTool("missing")).toBeUndefined();
  });

  it("retrieves integration by name", () => {
    registry.register({
      integration: {
        name: "test-integ",
        version: "1.0.0",
        auth: { type: "none" as const },
      },
      tools: [],
    });

    const integ = registry.getIntegration("test-integ");
    expect(integ?.name).toBe("test-integ");
  });

  it("returns undefined for missing integration", () => {
    expect(registry.getIntegration("missing")).toBeUndefined();
  });

  it("lists all integrations", () => {
    registry.register({
      integration: { name: "a", version: "1.0.0", auth: { type: "none" as const } },
      tools: [],
    });
    registry.register({
      integration: { name: "b", version: "2.0.0", auth: { type: "none" as const } },
      tools: [],
    });

    const integrations = registry.listIntegrations();
    expect(integrations).toHaveLength(2);
    expect(integrations.map((i) => i.name)).toContain("a");
    expect(integrations.map((i) => i.name)).toContain("b");
  });

  it("lists all tools", () => {
    registry.register({
      integration: { name: "test", version: "1.0.0", auth: { type: "none" as const } },
      tools: [
        { name: "tool1", description: "First", integration: "test", inputSchema: {}, handler: async () => "ok" },
        { name: "tool2", description: "Second", integration: "test", inputSchema: {}, handler: async () => "ok" },
      ],
    });

    const tools = registry.listTools();
    expect(tools).toHaveLength(2);
  });

  it("searches tools by name", () => {
    registry.register({
      integration: { name: "test", version: "1.0.0", auth: { type: "none" as const } },
      tools: [
        { name: "alpha_tool", description: "Alpha", integration: "test", inputSchema: {}, handler: async () => "ok" },
        { name: "beta_tool", description: "Beta", integration: "test", inputSchema: {}, handler: async () => "ok" },
      ],
    });

    const results = registry.searchTools("alpha");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("alpha_tool");
  });

  it("searches tools by description", () => {
    registry.register({
      integration: { name: "test", version: "1.0.0", auth: { type: "none" as const } },
      tools: [
        { name: "tool1", description: "Special handler", integration: "test", inputSchema: {}, handler: async () => "ok" },
        { name: "tool2", description: "Other thing", integration: "test", inputSchema: {}, handler: async () => "ok" },
      ],
    });

    const results = registry.searchTools("special");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("tool1");
  });

  it("returns empty array for no matches", () => {
    registry.register({
      integration: { name: "test", version: "1.0.0", auth: { type: "none" as const } },
      tools: [
        { name: "tool1", description: "Desc", integration: "test", inputSchema: {}, handler: async () => "ok" },
      ],
    });

    expect(registry.searchTools("nomatch")).toHaveLength(0);
  });
});
