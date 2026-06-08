import { describe, it, expect, vi } from "vitest";
import {
  navigate,
  screenshot,
  click,
  typeText,
  pressKey,
  scroll,
  type WarmSession,
} from "../src/auth/browser-session";

function sessionWithCdp(send: ReturnType<typeof vi.fn>): WarmSession {
  return { cdp: { send } } as unknown as WarmSession;
}

describe("browser actions", () => {
  it("navigate issues Page.navigate and returns url + title", async () => {
    const send = vi.fn(async (method: string) => {
      if (method === "Runtime.evaluate") return { result: { value: "Example" } };
      return {};
    });
    const out = await navigate(sessionWithCdp(send), "https://example.com");
    expect(send).toHaveBeenCalledWith("Page.navigate", { url: "https://example.com" });
    expect(out).toEqual({ url: "https://example.com", title: "Example" });
  });

  it("screenshot returns base64 png data", async () => {
    const send = vi.fn(async () => ({ data: "iVBORw0KGgo=" }));
    const out = await screenshot(sessionWithCdp(send));
    expect(send).toHaveBeenCalledWith("Page.captureScreenshot", { format: "png" });
    expect(out).toBe("iVBORw0KGgo=");
  });

  it("click dispatches press + release at coords", async () => {
    const send = vi.fn(async () => ({}));
    await click(sessionWithCdp(send), 100, 200, "left");
    expect(send).toHaveBeenNthCalledWith(1, "Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mousePressed", x: 100, y: 200, button: "left", clickCount: 1 }));
    expect(send).toHaveBeenNthCalledWith(2, "Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mouseReleased", x: 100, y: 200, button: "left" }));
  });

  it("typeText inserts text", async () => {
    const send = vi.fn(async () => ({}));
    await typeText(sessionWithCdp(send), "hello");
    expect(send).toHaveBeenCalledWith("Input.insertText", { text: "hello" });
  });

  it("pressKey sends keyDown + keyUp with modifiers for a chord", async () => {
    const send = vi.fn(async () => ({}));
    await pressKey(sessionWithCdp(send), "ctrl+a");
    expect(send).toHaveBeenNthCalledWith(1, "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "rawKeyDown", modifiers: 2 }));
    expect(send).toHaveBeenNthCalledWith(2, "Input.dispatchKeyEvent",
      expect.objectContaining({ type: "keyUp", modifiers: 2 }));
  });

  it("scroll sends a mouseWheel with downward delta", async () => {
    const send = vi.fn(async () => ({}));
    await scroll(sessionWithCdp(send), "down", 600);
    expect(send).toHaveBeenCalledWith("Input.dispatchMouseEvent",
      expect.objectContaining({ type: "mouseWheel", deltaY: 600 }));
  });
});
