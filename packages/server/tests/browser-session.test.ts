import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
const { proxyAuthMock } = vi.hoisted(() => ({ proxyAuthMock: vi.fn(() => ({ close: vi.fn() })) }));

vi.mock("../src/auth/profile-chromium", async () => {
  const real = await vi.importActual<typeof import("../src/auth/profile-chromium")>(
    "../src/auth/profile-chromium"
  );
  return {
    ...real,
    activeProfiles: new Set<string>(),
    spawnProfileChromium: spawnMock,
  };
});

vi.mock("../src/auth/cookie", async () => {
  const real = await vi.importActual<typeof import("../src/auth/cookie")>("../src/auth/cookie");
  return { ...real, startProxyAuth: proxyAuthMock };
});

// CdpClient opens a `ws`; emit "open" so its `ready` promise resolves. Enables
// are fire-and-forget so no reply frame is needed.
vi.mock("ws", async () => {
  const { EventEmitter } = await import("node:events");
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;
    readyState = 1;
    send = vi.fn();
    close = vi.fn(() => { this.readyState = 3; });
    constructor() {
      super();
      setImmediate(() => this.emit("open"));
    }
  }
  return { default: FakeWebSocket, WebSocket: FakeWebSocket };
});

import {
  ensureSession,
  getWarmSession,
  getWarmCdpEndpoint,
  closeBrowserSession,
  reapIdleSessions,
} from "../src/auth/browser-session";
import { activeProfiles } from "../src/auth/profile-chromium";

function fakeProc() {
  const { EventEmitter } = require("node:events");
  const p = new EventEmitter();
  p.kill = vi.fn();
  return p;
}

beforeEach(() => {
  spawnMock.mockReset();
  spawnMock.mockResolvedValue({
    proc: fakeProc(),
    remotePort: 9999,
    cdpBrowserWsUrl: "ws://127.0.0.1:9999/browser",
    cdpPageWsUrl: "ws://127.0.0.1:9999/page",
  });
  activeProfiles.clear();
});

describe("reapIdleSessions", () => {
  it("reapIdleSessions closes a session idle past the TTL", async () => {
    await ensureSession("user-r");
    expect(getWarmSession("user-r")).toBeDefined();
    // far-future now → any session is past the TTL cutoff
    reapIdleSessions(Date.now() + 10_000_000);
    expect(getWarmSession("user-r")).toBeUndefined();
    expect(activeProfiles.has("user-r")).toBe(false);
  });
});

describe("ensureSession proxy-auth wiring", () => {
  beforeEach(() => { proxyAuthMock.mockClear(); });
  afterEach(async () => {
    delete process.env.CAPTURE_PROXY;
    delete process.env.CAPTURE_PROXY_USERNAME;
    delete process.env.CAPTURE_PROXY_PASSWORD;
    await closeBrowserSession("user-proxy");
    await closeBrowserSession("user-noproxy");
    await closeBrowserSession("user-proxy-close");
  });

  it("opens a proxy-auth socket when CAPTURE_PROXY + creds are set", async () => {
    process.env.CAPTURE_PROXY = "http://proxy:8080";
    process.env.CAPTURE_PROXY_USERNAME = "u";
    process.env.CAPTURE_PROXY_PASSWORD = "p";
    await ensureSession("user-proxy");
    expect(proxyAuthMock).toHaveBeenCalledWith("ws://127.0.0.1:9999/browser", "u", "p");
  });

  it("does not open a proxy-auth socket without proxy env", async () => {
    await ensureSession("user-noproxy");
    expect(proxyAuthMock).not.toHaveBeenCalled();
  });

  it("closes the proxy-auth socket when closeBrowserSession is called", async () => {
    process.env.CAPTURE_PROXY = "http://proxy:8080";
    process.env.CAPTURE_PROXY_USERNAME = "u";
    process.env.CAPTURE_PROXY_PASSWORD = "p";
    await ensureSession("user-proxy-close");
    const mockWs = proxyAuthMock.mock.results[0].value;
    await closeBrowserSession("user-proxy-close");
    expect(mockWs.close).toHaveBeenCalled();
  });
});

describe("ensureSession", () => {
  it("launches a session once and reuses it", async () => {
    const a = await ensureSession("user-x");
    const b = await ensureSession("user-x");
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    await closeBrowserSession("user-x");
  });

  it("acquires the activeProfiles lock", async () => {
    await ensureSession("user-y");
    expect(activeProfiles.has("user-y")).toBe(true);
    await closeBrowserSession("user-y");
    expect(activeProfiles.has("user-y")).toBe(false);
  });

  it("throws BROWSER_SESSION_BUSY when the lock is already held", async () => {
    activeProfiles.add("user-z");
    await expect(ensureSession("user-z")).rejects.toThrow("BROWSER_SESSION_BUSY");
  });

  it("getWarmCdpEndpoint returns the page WS only for the right token", async () => {
    const s = await ensureSession("user-t");
    expect(getWarmCdpEndpoint("user-t", s.cdpToken)).toBe("ws://127.0.0.1:9999/page");
    expect(getWarmCdpEndpoint("user-t", "wrong")).toBeNull();
    expect(getWarmCdpEndpoint("nobody", s.cdpToken)).toBeNull();
    await closeBrowserSession("user-t");
    expect(getWarmSession("user-t")).toBeUndefined();
  });
});
