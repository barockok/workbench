import { describe, it, expect, vi, beforeEach } from "vitest";

const { ensureMock, touchMock, navMock, shotMock, clickMock, typeMock, keyMock, scrollMock, closeMock } =
  vi.hoisted(() => ({
    ensureMock: vi.fn(),
    touchMock: vi.fn(),
    navMock: vi.fn(),
    shotMock: vi.fn(),
    clickMock: vi.fn(),
    typeMock: vi.fn(),
    keyMock: vi.fn(),
    scrollMock: vi.fn(),
    closeMock: vi.fn(),
  }));

vi.mock("../src/auth/browser-session", () => ({
  ensureSession: ensureMock,
  touch: touchMock,
  navigate: navMock,
  screenshot: shotMock,
  click: clickMock,
  typeText: typeMock,
  pressKey: keyMock,
  scroll: scrollMock,
  closeBrowserSession: closeMock,
}));

import { metaTools } from "../src/mcp/meta-tools";

function tool(name: string) {
  const t = metaTools.find((m) => m.name === name);
  if (!t) throw new Error(`missing ${name}`);
  return t;
}

beforeEach(() => {
  vi.clearAllMocks();
  ensureMock.mockResolvedValue({ userId: "u1" });
});

describe("browser_* meta-tools", () => {
  it("browser_navigate ensures session, touches, navigates", async () => {
    navMock.mockResolvedValue({ url: "https://e.com", title: "E" });
    const out = await (tool("browser_navigate").handler as any)({ userId: "u1" }, { url: "https://e.com" });
    expect(ensureMock).toHaveBeenCalledWith("u1");
    expect(touchMock).toHaveBeenCalledWith("u1");
    expect(out).toEqual({ url: "https://e.com", title: "E" });
  });

  it("browser_screenshot returns an _mcpImage sentinel", async () => {
    shotMock.mockResolvedValue("BASE64PNG");
    const out = await (tool("browser_screenshot").handler as any)({ userId: "u1" }, {});
    expect(out).toEqual({ _mcpImage: { data: "BASE64PNG", mimeType: "image/png" } });
  });

  it("browser_click returns ok", async () => {
    const out = await (tool("browser_click").handler as any)({ userId: "u1" }, { x: 1, y: 2, button: "left" });
    expect(clickMock).toHaveBeenCalledWith({ userId: "u1" }, 1, 2, "left");
    expect(out).toEqual({ ok: true });
  });

  it("browser_close closes the session", async () => {
    const out = await (tool("browser_close").handler as any)({ userId: "u1" }, {});
    expect(closeMock).toHaveBeenCalledWith("u1");
    expect(out).toEqual({ ok: true });
  });
});
