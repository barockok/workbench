import { describe, it, expect, vi, beforeEach } from "vitest";

const { ensureMock, signMock } = vi.hoisted(() => ({
  ensureMock: vi.fn(),
  signMock: vi.fn(),
}));

vi.mock("../src/auth/browser-session", () => ({
  ensureSession: ensureMock,
  touch: vi.fn(),
  navigate: vi.fn(), screenshot: vi.fn(), click: vi.fn(),
  typeText: vi.fn(), pressKey: vi.fn(), scroll: vi.fn(), readText: vi.fn(),
  closeBrowserSession: vi.fn(),
}));
vi.mock("../src/auth/connect-token", () => ({
  signConnectToken: signMock,
}));

import { browserPlugin } from "../src/plugins/internal/browser";

beforeEach(() => {
  vi.clearAllMocks();
  ensureMock.mockResolvedValue({ userId: "u1", cdpToken: "ctok" });
  signMock.mockResolvedValue("jwt-xyz");
});

describe("browser_live_url", () => {
  it("mints a connect JWT bound to the session and returns a /browser URL", async () => {
    const t = browserPlugin.tools.find((m) => m.name === "browser_live_url")!;
    const out = (await (t.handler as any)({ userId: "u1" }, {})) as { url: string };
    expect(signMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u1", sessionId: "u1", cdpToken: "ctok", integration: "__browser__" }),
      expect.any(Number)
    );
    expect(out.url).toContain("/browser?t=jwt-xyz");
  });
});
