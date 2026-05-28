import { describe, it, expect, beforeEach, vi } from "vitest";
import { metaTools } from "../src/mcp/meta-tools";
import { registry } from "../src/plugins/registry";

const mockTool = {
  name: "test_tool",
  description: "A test tool",
  integration: "test-integ",
  inputSchema: { type: "object" },
  handler: vi.fn(),
};

const mockOauthInteg = {
  name: "test-integ",
  version: "1.0.0",
  auth: { type: "oauth2" as const, authorizationUrl: "", tokenUrl: "", scopes: [] },
};

const mockCookieInteg = {
  name: "legacy",
  version: "1.0.0",
  auth: { type: "cookie" as const, loginUrl: "https://legacy.com/login", targetDomain: "legacy.com" },
};

vi.mock("../src/plugins/context", () => ({
  createContext: vi.fn(() => ({ userId: "user-1", getToken: vi.fn(), http: vi.fn() })),
}));

vi.mock("../src/audit/logger", () => ({
  auditLogger: { log: vi.fn(() => Promise.resolve()) },
}));

vi.mock("../src/auth/tokens", () => ({
  getToken: vi.fn(),
}));

vi.mock("../src/auth/cookie", () => ({
  hasValidCookies: vi.fn(() => false),
}));

vi.mock("../src/telemetry/tracing", () => ({
  withSpan: vi.fn((_name: string, fn: Function) => fn()),
}));

function findTool(name: string) {
  return metaTools.find((t) => t.name === name)!;
}

describe("meta-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("search_tools", () => {
    it("returns matching tools", async () => {
      vi.spyOn(registry, "searchTools").mockReturnValue([mockTool as any]);
      const tool = findTool("search_tools");
      const result = await tool.handler({ userId: "user-1" }, { query: "test" });
      expect(result.tools).toHaveLength(1);
      expect(result.tools[0].name).toBe("test_tool");
    });
  });

  describe("get_tool_schema", () => {
    it("returns schema for existing tool", async () => {
      vi.spyOn(registry, "getTool").mockReturnValue(mockTool as any);
      const tool = findTool("get_tool_schema");
      const result = await tool.handler({ userId: "user-1" }, { tool: "test_tool" });
      expect(result.schema).toEqual({ type: "object" });
    });

    it("returns error for missing tool", async () => {
      vi.spyOn(registry, "getTool").mockReturnValue(undefined);
      const tool = findTool("get_tool_schema");
      const result = await tool.handler({ userId: "user-1" }, { tool: "missing" });
      expect(result.error).toBe("Tool not found");
    });
  });

  describe("execute_tool", () => {
    it("returns error when tool not found", async () => {
      vi.spyOn(registry, "getTool").mockReturnValue(undefined);
      const tool = findTool("execute_tool");
      const result = await tool.handler({ userId: "user-1" }, { tool: "missing", args: {} });
      expect(result.error).toBe("Tool not found");
    });

    it("returns NOT_CONNECTED when oauth token missing", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue(null);
      vi.spyOn(registry, "getTool").mockReturnValue(mockTool as any);
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockOauthInteg as any);

      const tool = findTool("execute_tool");
      const result = await tool.handler({ userId: "user-1" }, { tool: "test_tool", args: {} });
      expect(result.error).toBe("NOT_CONNECTED");
      expect(result.integration).toBe("test-integ");
    });

    it("returns NOT_CONNECTED when cookie invalid", async () => {
      const { hasValidCookies } = await import("../src/auth/cookie");
      vi.mocked(hasValidCookies).mockReturnValue(false);
      vi.spyOn(registry, "getTool").mockReturnValue(mockTool as any);
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieInteg as any);

      const tool = findTool("execute_tool");
      const result = await tool.handler({ userId: "user-1" }, { tool: "test_tool", args: {} });
      expect(result.error).toBe("NOT_CONNECTED");
    });

    it("executes tool and returns result", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue({ accessToken: "tok", scopes: "" });
      vi.spyOn(registry, "getTool").mockReturnValue(mockTool as any);
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockOauthInteg as any);
      mockTool.handler.mockResolvedValue({ done: true });

      const tool = findTool("execute_tool");
      const result = await tool.handler({ userId: "user-1" }, { tool: "test_tool", args: { x: 1 } });
      expect(result.result).toEqual({ done: true });
      expect(mockTool.handler).toHaveBeenCalledWith(expect.anything(), { x: 1 });
    });

    it("catches and returns handler errors", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue({ accessToken: "tok", scopes: "" });
      vi.spyOn(registry, "getTool").mockReturnValue(mockTool as any);
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockOauthInteg as any);
      mockTool.handler.mockRejectedValue(new Error("boom"));

      const tool = findTool("execute_tool");
      const result = await tool.handler({ userId: "user-1" }, { tool: "test_tool", args: {} });
      expect(result.error).toBe("boom");
    });
  });

  describe("list_integrations", () => {
    it("lists integrations with connection status", async () => {
      const { getToken } = await import("../src/auth/tokens");
      vi.mocked(getToken).mockReturnValue({ accessToken: "tok", scopes: "" });
      vi.spyOn(registry, "listIntegrations").mockReturnValue([mockOauthInteg as any, mockCookieInteg as any]);

      const tool = findTool("list_integrations");
      const result = await tool.handler({ userId: "user-1" }, {});
      expect(result.integrations).toHaveLength(2);
      expect(result.integrations[0].connected).toBe(true);
    });
  });

  describe("get_auth_url", () => {
    it("returns url for oauth2 integration", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockOauthInteg as any);
      const tool = findTool("get_auth_url");
      const result = await tool.handler({ userId: "user-1" }, { integration: "test-integ" });
      expect(result.url).toContain("/api/auth/test-integ");
      expect(result.type).toBeUndefined();
    });

    it("returns cookie auth info for cookie integration", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(mockCookieInteg as any);
      const tool = findTool("get_auth_url");
      const result = await tool.handler({ userId: "user-1" }, { integration: "legacy" });
      expect(result.type).toBe("cookie");
      expect(result.url).toContain("/api/auth/legacy");
      expect(result.instructions).toContain("legacy.com");
    });

    it("returns error for unknown integration", async () => {
      vi.spyOn(registry, "getIntegration").mockReturnValue(undefined);
      const tool = findTool("get_auth_url");
      const result = await tool.handler({ userId: "user-1" }, { integration: "missing" });
      expect(result.error).toBe("Integration not found");
    });
  });
});
