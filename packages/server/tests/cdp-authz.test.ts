import { describe, it, expect, vi, beforeEach } from "vitest";

const { getWarmCdpEndpointMock, verifyConnectTokenMock } = vi.hoisted(() => ({
  getWarmCdpEndpointMock: vi.fn(),
  verifyConnectTokenMock: vi.fn(),
}));

vi.mock("../src/auth/browser-session", () => ({
  getWarmCdpEndpoint: getWarmCdpEndpointMock,
}));

vi.mock("../src/auth/connect-token", () => ({
  verifyConnectToken: verifyConnectTokenMock,
}));

import { authorizeCdpFrame } from "../src/auth/cdp-authz";

const ENDPOINT = "ws://127.0.0.1:9222/devtools/page/ABC";

beforeEach(() => {
  getWarmCdpEndpointMock.mockReset();
  verifyConnectTokenMock.mockReset();
});

describe("authorizeCdpFrame", () => {
  it("returns the warm endpoint when portal user matches the sessionId", async () => {
    getWarmCdpEndpointMock.mockReturnValue(ENDPOINT);
    const result = await authorizeCdpFrame(
      { sessionId: "user-1", cdpToken: "tok-1" },
      "user-1",
      "__browser__"
    );
    expect(result).toBe(ENDPOINT);
    expect(getWarmCdpEndpointMock).toHaveBeenCalledWith("user-1", "tok-1");
    // A matching portal user never needs the connect-JWT branch.
    expect(verifyConnectTokenMock).not.toHaveBeenCalled();
  });

  it("returns null when portal user does not match the sessionId", async () => {
    getWarmCdpEndpointMock.mockReturnValue(ENDPOINT);
    const result = await authorizeCdpFrame(
      { sessionId: "user-2", cdpToken: "tok-1" },
      "user-1",
      "__browser__"
    );
    expect(result).toBeNull();
    expect(getWarmCdpEndpointMock).not.toHaveBeenCalled();
  });

  it("accepts a valid connect JWT with matching integration+sessionId+cdpToken", async () => {
    verifyConnectTokenMock.mockResolvedValue({
      userId: "user-1",
      integration: "jira",
      sessionId: "user-1",
      cdpToken: "tok-1",
    });
    getWarmCdpEndpointMock.mockReturnValue(ENDPOINT);
    const result = await authorizeCdpFrame(
      { sessionId: "user-1", cdpToken: "tok-1", bearer: "jwt" },
      null,
      "jira"
    );
    expect(result).toBe(ENDPOINT);
    expect(verifyConnectTokenMock).toHaveBeenCalledWith("jwt");
    expect(getWarmCdpEndpointMock).toHaveBeenCalledWith("user-1", "tok-1");
  });

  it("rejects a connect JWT scoped to the wrong integration (cross-proxy replay guard)", async () => {
    // JWT minted for the browser-session proxy, replayed against a cookie proxy.
    verifyConnectTokenMock.mockResolvedValue({
      userId: "user-1",
      integration: "__browser__",
      sessionId: "user-1",
      cdpToken: "tok-1",
    });
    getWarmCdpEndpointMock.mockReturnValue(ENDPOINT);
    const result = await authorizeCdpFrame(
      { sessionId: "user-1", cdpToken: "tok-1", bearer: "jwt" },
      null,
      "jira"
    );
    expect(result).toBeNull();
    expect(getWarmCdpEndpointMock).not.toHaveBeenCalled();
  });

  it("rejects a connect JWT scoped to an integration when __browser__ is expected", async () => {
    verifyConnectTokenMock.mockResolvedValue({
      userId: "user-1",
      integration: "jira",
      sessionId: "user-1",
      cdpToken: "tok-1",
    });
    const result = await authorizeCdpFrame(
      { sessionId: "user-1", cdpToken: "tok-1", bearer: "jwt" },
      null,
      "__browser__"
    );
    expect(result).toBeNull();
  });

  it("rejects a connect JWT with mismatched sessionId", async () => {
    verifyConnectTokenMock.mockResolvedValue({
      userId: "user-1",
      integration: "jira",
      sessionId: "user-OTHER",
      cdpToken: "tok-1",
    });
    const result = await authorizeCdpFrame(
      { sessionId: "user-1", cdpToken: "tok-1", bearer: "jwt" },
      null,
      "jira"
    );
    expect(result).toBeNull();
  });

  it("rejects a connect JWT with mismatched cdpToken", async () => {
    verifyConnectTokenMock.mockResolvedValue({
      userId: "user-1",
      integration: "jira",
      sessionId: "user-1",
      cdpToken: "tok-OTHER",
    });
    const result = await authorizeCdpFrame(
      { sessionId: "user-1", cdpToken: "tok-1", bearer: "jwt" },
      null,
      "jira"
    );
    expect(result).toBeNull();
  });

  it("returns null when verifyConnectToken throws (bad token)", async () => {
    verifyConnectTokenMock.mockRejectedValue(new Error("bad token"));
    const result = await authorizeCdpFrame(
      { sessionId: "user-1", cdpToken: "tok-1", bearer: "not-a-jwt" },
      null,
      "jira"
    );
    expect(result).toBeNull();
    expect(getWarmCdpEndpointMock).not.toHaveBeenCalled();
  });

  it("returns null when authorized but no warm session exists", async () => {
    getWarmCdpEndpointMock.mockReturnValue(null);
    const result = await authorizeCdpFrame(
      { sessionId: "user-1", cdpToken: "tok-1" },
      "user-1",
      "__browser__"
    );
    expect(result).toBeNull();
    expect(getWarmCdpEndpointMock).toHaveBeenCalledWith("user-1", "tok-1");
  });

  it("returns null when there is neither a portal user nor a bearer", async () => {
    const result = await authorizeCdpFrame(
      { sessionId: "user-1", cdpToken: "tok-1" },
      null,
      "__browser__"
    );
    expect(result).toBeNull();
    expect(verifyConnectTokenMock).not.toHaveBeenCalled();
  });
});
