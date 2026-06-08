import { ChildProcess } from "node:child_process";
import WebSocket from "ws";
import { config } from "../config";
import { activeProfiles, spawnProfileChromium } from "./profile-chromium";

// Persistent CDP client: one long-lived socket to a page target, many
// request/response commands multiplexed by auto-incrementing id.
class CdpClient {
  private ws: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  readonly ready: Promise<void>;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl, { perMessageDeflate: false, origin: "http://127.0.0.1" });
    this.ready = new Promise((resolve, reject) => {
      this.ws.on("open", () => {
        // Fire-and-forget enables; we don't await their replies.
        this.fire("Page.enable");
        this.fire("Runtime.enable");
        resolve();
      });
      this.ws.once("error", reject);
    });
    this.ws.on("message", (raw: WebSocket.RawData) => {
      let msg: { id?: number; result?: Record<string, unknown>; error?: { message: string } };
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (typeof msg.id !== "number") return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`cdp: ${msg.error.message}`));
      else p.resolve(msg.result ?? {});
    });
  }

  private fire(method: string, params: Record<string, unknown> = {}): void {
    const id = ++this.id;
    try { this.ws.send(JSON.stringify({ id, method, params })); } catch { /* noop */ }
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`cdp ${method} timed out`));
      }, 10000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.ws.send(JSON.stringify({ id, method, params })); }
      catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e instanceof Error ? e : new Error(String(e))); }
    });
  }

  close(): void {
    for (const p of this.pending.values()) { clearTimeout(p.timer); }
    this.pending.clear();
    try { this.ws.close(); } catch { /* noop */ }
  }
}

export interface WarmSession {
  proc: ChildProcess;
  remotePort: number;
  cdpPageWsUrl: string;
  cdpBrowserWsUrl: string;
  cdpToken: string;
  userId: string;
  lastActivity: number;
  cdp: CdpClient;
}

const warmSessions = new Map<string, WarmSession>();

export async function ensureSession(userId: string): Promise<WarmSession> {
  const existing = warmSessions.get(userId);
  if (existing) { existing.lastActivity = Date.now(); return existing; }

  if (activeProfiles.has(userId)) {
    throw new Error("BROWSER_SESSION_BUSY: a browser session is already active for this user");
  }
  activeProfiles.add(userId);
  try {
    const spawned = await spawnProfileChromium(userId, {});
    const cdp = new CdpClient(spawned.cdpPageWsUrl);
    await cdp.ready;
    const session: WarmSession = {
      proc: spawned.proc,
      remotePort: spawned.remotePort,
      cdpPageWsUrl: spawned.cdpPageWsUrl,
      cdpBrowserWsUrl: spawned.cdpBrowserWsUrl,
      cdpToken: crypto.randomUUID(),
      userId,
      lastActivity: Date.now(),
      cdp,
    };
    warmSessions.set(userId, session);
    spawned.proc.on("exit", () => {
      activeProfiles.delete(userId);
      warmSessions.delete(userId);
      try { session.cdp.close(); } catch { /* noop */ }
    });
    return session;
  } catch (e) {
    activeProfiles.delete(userId);
    throw e;
  }
}

export function touch(userId: string): void {
  const s = warmSessions.get(userId);
  if (s) s.lastActivity = Date.now();
}

export function getWarmSession(userId: string): WarmSession | undefined {
  return warmSessions.get(userId);
}

// Live-view proxy auth: page WS endpoint, gated on the session's cdpToken.
export function getWarmCdpEndpoint(userId: string, cdpToken: string): string | null {
  const s = warmSessions.get(userId);
  if (!s) return null;
  if (s.cdpToken !== cdpToken) return null;
  return s.cdpPageWsUrl;
}

export async function closeBrowserSession(userId: string): Promise<void> {
  const s = warmSessions.get(userId);
  if (!s) return;
  warmSessions.delete(userId);
  activeProfiles.delete(userId);
  try { s.cdp.close(); } catch { /* noop */ }
  try { s.proc.kill("SIGKILL"); } catch { /* noop */ }
}

let reaperStarted = false;
export function startBrowserReaper(): void {
  if (reaperStarted) return;
  reaperStarted = true;
  setInterval(() => {
    const cutoff = Date.now() - config.BROWSER_SESSION_TTL_SECONDS * 1000;
    for (const [userId, s] of warmSessions) {
      if (s.lastActivity < cutoff) void closeBrowserSession(userId);
    }
  }, 30_000).unref();
}

// ─── CDP action helpers ───────────────────────────────────────────────────
// Each takes a WarmSession and speaks CDP through its persistent client.

export async function navigate(
  s: WarmSession,
  url: string
): Promise<{ url: string; title: string; warning?: string }> {
  let warning: string | undefined;
  try {
    await s.cdp.send("Page.navigate", { url });
    // Give the load a moment; Page.loadEventFired isn't awaited here to keep
    // the helper simple — a short settle covers most SPAs. (Follow-up: await
    // the load event.)
    await new Promise((r) => setTimeout(r, 800));
  } catch (e) {
    warning = e instanceof Error ? e.message : String(e);
  }
  const title = await pageTitle(s);
  return warning ? { url, title, warning } : { url, title };
}

async function pageTitle(s: WarmSession): Promise<string> {
  try {
    const r = (await s.cdp.send("Runtime.evaluate", {
      expression: "document.title",
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    const v = r.result?.value;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

export async function screenshot(s: WarmSession): Promise<string> {
  const r = (await s.cdp.send("Page.captureScreenshot", { format: "png" })) as { data?: string };
  return r.data ?? "";
}

type MouseButton = "left" | "right" | "middle";
export async function click(s: WarmSession, x: number, y: number, button: MouseButton = "left"): Promise<void> {
  await s.cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
  await s.cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
}

export async function typeText(s: WarmSession, text: string): Promise<void> {
  await s.cdp.send("Input.insertText", { text });
}

// Minimal key map for the common driving keys. Chords like "ctrl+a" parse the
// trailing token as the key and the leading tokens as modifiers.
const MODIFIERS: Record<string, number> = { alt: 1, ctrl: 2, control: 2, meta: 4, cmd: 4, shift: 8 };
const KEYS: Record<string, { keyCode: number; key: string }> = {
  enter: { keyCode: 13, key: "Enter" },
  tab: { keyCode: 9, key: "Tab" },
  escape: { keyCode: 27, key: "Escape" },
  esc: { keyCode: 27, key: "Escape" },
  backspace: { keyCode: 8, key: "Backspace" },
  delete: { keyCode: 46, key: "Delete" },
  arrowup: { keyCode: 38, key: "ArrowUp" },
  arrowdown: { keyCode: 40, key: "ArrowDown" },
  arrowleft: { keyCode: 37, key: "ArrowLeft" },
  arrowright: { keyCode: 39, key: "ArrowRight" },
};

export async function pressKey(s: WarmSession, keys: string): Promise<void> {
  const parts = keys.split("+").map((p) => p.trim().toLowerCase()).filter(Boolean);
  let modifiers = 0;
  let last = "";
  for (const p of parts) {
    if (MODIFIERS[p] !== undefined) modifiers |= MODIFIERS[p];
    else last = p;
  }
  const mapped = KEYS[last];
  const base: Record<string, unknown> = mapped
    ? { windowsVirtualKeyCode: mapped.keyCode, key: mapped.key, modifiers }
    : { key: last, text: last.length === 1 ? last : undefined, modifiers };
  await s.cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await s.cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

type ScrollDir = "up" | "down" | "left" | "right";
export async function scroll(s: WarmSession, direction: ScrollDir, amount = 600): Promise<void> {
  const deltaX = direction === "left" ? -amount : direction === "right" ? amount : 0;
  const deltaY = direction === "up" ? -amount : direction === "down" ? amount : 0;
  await s.cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 640, y: 400, deltaX, deltaY });
}
