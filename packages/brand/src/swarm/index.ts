import { MARK, markSvg } from "../mark.js";
import { SWARM_PALETTES, type SwarmGround } from "../tokens.js";
import { sampleMask, type Mask, type SamplePoint } from "./sample.js";
import { ENTER_MS, LANES, laneState, entranceDone, projectLane, settle, smootherstep } from "./lanes.js";

export interface SwarmOptions {
  ground?: SwarmGround;
  markX?: number;
  markFrac?: number;
  ambient?: boolean;
  rasterize?: (svg: string, size: number) => Promise<Mask>;
  now?: () => number;
}
export interface SwarmTarget { tx: number; ty: number; tz: number; rim: boolean; shape: number }
interface Particle extends SwarmTarget {
  sx: number; sy: number; sz: number; lane: number; ci: number; size: number;
  x: number; y: number; k: number; ox: number; oy: number; ax: number; ay: number; spin: number;
  age: number; life: number; color: string;
}
interface Ambient { x: number; y: number; sx: number; sy: number; px: number; py: number; z: number; shape: number; ci: number; size: number; dx: number; dy: number; ax: number; ay: number; spin: number; wob: number; lane: number; color: string; big: boolean }
export interface Swarm {
  destroy(): void; setGround(g: SwarmGround): void; replay(): void;
  state(): { ready: boolean; done: boolean; poseMix: number; count: number; targets: SwarmTarget[]; particles: SwarmTarget[] };
}

const FADE = 70, PUSH_R = 100, PUSH_PX = 24, POSE_MS = 1200, GAP = 3.4, THICK = 0.06, CAM = 2.2;

// Default rasterizer: draw the mark SVG through an <img> onto an offscreen canvas.
async function rasterizeWithImage(svg: string, size: number): Promise<Mask> {
  const img = new Image();
  img.src = "data:image/svg+xml;utf8," + encodeURIComponent(svg);
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("mark failed to load")); });
  const off = document.createElement("canvas"); off.width = off.height = size;
  const o = off.getContext("2d", { willReadFrequently: true })!;
  o.drawImage(img, 0, 0, size, size);
  return { size, data: o.getImageData(0, 0, size, size).data };
}

export function createSwarm(canvas: HTMLCanvasElement, opts: SwarmOptions = {}): Swarm {
  const host = canvas.parentElement ?? canvas;
  const ctx = canvas.getContext("2d")!;
  const now = opts.now ?? (() => performance.now());
  const rasterize = opts.rasterize ?? rasterizeWithImage;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const markX = opts.markX ?? 0.66, markFrac = opts.markFrac ?? 0.86, wantAmbient = opts.ambient ?? true;
  let ground: SwarmGround = opts.ground ?? "dark";
  let W = 0, H = 0, raf = 0, born = 0, done = reduced, doneAt = 0, poseMix = reduced ? 1 : 0, ready = false, disposed = false;
  let parts: Particle[] = [], targets: SwarmTarget[] = [], big: Ambient[] = [], tiny: Ambient[] = [];
  let slowFrames = 0, glow = true;
  const pointer = { x: -1e4, y: -1e4, nx: 0, ny: 0, down: false }, ease = { x: 0, y: 0 };
  let seed = 11; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

  // The mask is white-on-transparent with the hollow nodes filled black, so
  // sampling keeps outlines only (see sample.ts `inside`).
  const maskSvg = () => markSvg({ color: "#ffffff", surface: "#000000" });

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function colorFor(p: { rim?: boolean; ci: number; big?: boolean }, pal: readonly string[]) {
    if (p.big) return p.ci % 3 === 0 ? pal[7] : pal[2 + (p.ci % 5)];
    return p.rim ? pal[p.ci % 2] : pal[2 + (p.ci % 6)];
  }
  function recolor() { const pal = SWARM_PALETTES[ground]; for (const p of parts) p.color = colorFor(p, pal); for (const a of big) a.color = colorFor(a, pal); for (const a of tiny) a.color = pal[a.ci % 8]; }

  async function build() {
    resize();
    const size = Math.round(Math.min(W, H) * markFrac);
    if (size <= 0) return;
    seed = ((W * 73856093) ^ (H * 19349663)) >>> 0;
    const mask = await rasterize(maskSvg(), size);
    if (disposed) return;
    let pts: SamplePoint[] = sampleMask(mask, { gap: GAP, rnd, nodeCentres: MARK.nodeCentres });
    if (coarse) pts = pts.filter((_, i) => i % 2 === 0);
    const thick = size * THICK, reach = Math.max(W, H);
    targets = pts.map((p) => ({ tx: p.mx - size / 2, ty: p.my - size / 2, tz: (rnd() - 0.5) * thick, rim: p.rim, shape: p.shape }));
    parts = targets.map((t) => {
      const a = rnd() * Math.PI * 2, r = reach * (0.55 + rnd() * 0.5);
      return { ...t, sx: Math.cos(a) * r, sy: Math.sin(a) * r, sz: Math.min(W, H) * (0.35 + rnd() * 0.55) * (rnd() < 0.5 ? -1 : 1),
        lane: (rnd() * LANES) | 0, ci: (rnd() * 8) | 0, size: (t.rim ? 3.2 : 2.8) + rnd() * 2.6,
        x: 0, y: 0, k: 1, ox: 0, oy: 0, ax: rnd() * 6.28, ay: rnd() * 6.28, spin: (0.25 + rnd() * 0.6) * (rnd() < 0.5 ? -1 : 1),
        age: FADE, life: FADE + rnd() * 240 + 60, color: "" };   // age starts at FADE: fully visible at hand-off
    });
    const mk = (isBig: boolean): Ambient => {
      const ang = rnd() * 6.28, r = reach * (0.6 + rnd() * 0.5);
      return { x: rnd() * W, y: rnd() * H, sx: W / 2 + Math.cos(ang) * r, sy: H / 2 + Math.sin(ang) * r, px: 0, py: 0, z: rnd() * 2 - 1,
        shape: (rnd() * 4) | 0, ci: (rnd() * 8) | 0, size: isBig ? 22 + rnd() * rnd() * 84 : 2.5 + rnd() * 4,
        dx: (rnd() - 0.5) * 0.3, dy: -(0.06 + rnd() * 0.2), ax: rnd() * 6.28, ay: rnd() * 6.28,
        spin: (0.1 + rnd() * 0.35) * (rnd() < 0.5 ? -1 : 1), wob: rnd() * 6.28, lane: (rnd() * LANES) | 0, color: "", big: isBig };
    };
    big = wantAmbient ? Array.from({ length: Math.round(W / 32) }, () => mk(true)) : [];
    tiny = wantAmbient ? Array.from({ length: Math.round((W * H) / 6500) }, () => mk(false)) : [];
    recolor();
    born = 0; done = reduced; poseMix = reduced ? 1 : 0; ready = true;
    if (reduced) { step(now()); draw(now()); } else start();
  }

  function project(x: number, y: number, z: number, yaw: number, pitch: number, cam: number): [number, number, number] {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const X = x * cy + z * sy, Z1 = -x * sy + z * cy;
    const Y = y * cp - Z1 * sp, Z = y * sp + Z1 * cp;
    const k = cam / (cam + Z);
    return [X * k, Y * k, k];
  }

  function step(t: number) {
    if (!born) born = t;                        // clock starts on the first painted frame
    const el = t - born, ts = t / 1000, cx = W * markX, cy = H / 2, cam = Math.min(W, H) * CAM;
    ease.x += (pointer.nx - ease.x) * 0.06; ease.y += (pointer.ny - ease.y) * 0.06;
    if (!done && entranceDone(el)) { done = true; doneAt = t; }
    poseMix = reduced ? 1 : done ? Math.min(1, (t - doneAt) / POSE_MS) : 0;
    const pm = smootherstep(poseMix);
    const yaw = ((reduced ? 0 : Math.sin(ts * 0.25) * 0.10) + ease.x * 0.42) * pm;
    const pitch = ((reduced ? 0 : Math.cos(ts * 0.19) * 0.06) - ease.y * 0.30) * pm;
    const breathe = reduced ? 1 : 1 + Math.sin(ts * 0.4) * 0.02;
    const lanes = Array.from({ length: LANES }, (_, l) => laneState(l, el));
    for (const p of parts) {
      let px: number, py: number, k: number;
      if (!done) {
        const s = lanes[p.lane], e = s.ease;
        const rx = p.sx + (p.tx * breathe - p.sx) * e, ry = p.sy + (p.ty * breathe - p.sy) * e, rz = p.sz + (p.tz - p.sz) * e;
        [px, py, k] = projectLane(rx, ry, rz, s, cam); px += cx; py += cy;
      } else {
        [px, py, k] = project(p.tx * breathe, p.ty * breathe, p.tz, yaw, pitch, cam); px += cx; py += cy;
        const w = Math.sin(ts * 1.1 + p.tx * 0.02 + p.ty * 0.015) * 0.9 * poseMix;   // coherent ripple, phase from position
        px += w; py += w * 0.6;
        if (!reduced) { p.age++; if (--p.life <= 0) { const n = targets[(rnd() * targets.length) | 0]; p.tx = n.tx; p.ty = n.ty; p.tz = n.tz; p.rim = n.rim; p.shape = n.shape; p.color = colorFor(p, SWARM_PALETTES[ground]); p.ox = p.oy = 0; p.life = rnd() * 150 + 90 + FADE * 2; p.age = 0; } }
      }
      const dx = pointer.x - px, dy = pointer.y - py, d2 = dx * dx + dy * dy; let fx = 0, fy = 0;
      if ((!coarse || pointer.down) && d2 < PUSH_R * PUSH_R && d2 > 1) { const d = Math.sqrt(d2), f = (PUSH_R - d) / PUSH_R; fx = -(dx / d) * f * PUSH_PX; fy = -(dy / d) * f * PUSH_PX; }
      p.ox += (fx - p.ox) * 0.14; p.oy += (fy - p.oy) * 0.14;
      p.x = px + p.ox; p.y = py + p.oy; p.k = k;
      p.ax += p.spin * 0.02; p.ay += p.spin * 0.016;
    }
    for (const a of big.concat(tiny)) {
      const e = done ? 1 : lanes[a.lane].ease;
      if (done) { a.x += a.dx; a.y += a.dy; if (a.y < -80) { a.y = H + 80; a.x = rnd() * W; } else if (a.x < -80) a.x = W + 80; else if (a.x > W + 80) a.x = -80; }
      a.px = a.sx + (a.x - a.sx) * e; a.py = a.sy + (a.y - a.sy) * e;
      a.ax += a.spin * 0.01; a.ay += a.spin * 0.008;
    }
  }

  function path(shape: number, s: number) {
    ctx.beginPath();
    switch (shape) {
      case 0: ctx.arc(0, 0, s * 0.5, 0, Math.PI * 2); break;
      case 1: ctx.rect(-s / 2, -s / 2, s, s); break;
      case 2: ctx.moveTo(0, -s * 0.58); ctx.lineTo(s * 0.55, s * 0.38); ctx.lineTo(-s * 0.55, s * 0.38); ctx.closePath(); break;
      default: ctx.moveTo(0, -s * 0.62); ctx.lineTo(s * 0.62, 0); ctx.lineTo(0, s * 0.62); ctx.lineTo(-s * 0.62, 0); ctx.closePath();
    }
  }
  function drawOne(x: number, y: number, p: { ax: number; ay: number; shape: number; color: string }, s: number, alpha: number, lw: number, blur: number) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(p.ax); ctx.scale(Math.max(0.1, Math.abs(Math.cos(p.ay))), 1);
    ctx.globalAlpha = alpha; ctx.strokeStyle = p.color; ctx.lineWidth = lw;
    if (blur && glow) { ctx.shadowColor = p.color; ctx.shadowBlur = blur; }
    path(p.shape, s); ctx.stroke(); ctx.restore();
  }
  function draw(t: number) {
    ctx.clearRect(0, 0, W, H);
    const ts = t / 1000;
    for (const a of tiny) { const par = (0.6 + a.z * 0.4) * 30; drawOne(a.px - ease.x * par + Math.sin(ts * 0.3 + a.wob) * 3, a.py - ease.y * par + Math.cos(ts * 0.25 + a.wob) * 3, a, a.size, 0.25 + (a.z + 1) * 0.2, 1, 0); }
    for (const a of big) { const par = (0.7 + a.z * 0.5) * 48; drawOne(a.px - ease.x * par + Math.sin(ts * 0.22 + a.wob) * 6, a.py - ease.y * par + Math.cos(ts * 0.18 + a.wob) * 6, a, a.size, 0.28 + (a.z + 1) * 0.22, 1.4, 14); }
    const arrive = done ? 1 : Math.min(1, (t - born) / ENTER_MS), arrivalScale = 0.64 + settle(arrive) * 0.36;   // dots grow into place; no alpha ramp
    const order = parts.slice().sort((a, b) => a.k - b.k);
    for (const p of order) {
      const fade = done && !reduced ? Math.min(1, Math.min(p.age, p.life) / FADE) : 1;
      drawOne(p.x, p.y, p, p.size * arrivalScale * p.k, (p.rim ? 0.95 : 0.6) * fade, p.rim ? 1.3 : 1, 0);
    }
    ctx.globalAlpha = 1;
  }

  function loop(t: number) {
    const t0 = now(); step(t); draw(t);
    if (now() - t0 > 20) { if (++slowFrames >= 30 && glow) { glow = false; } } else slowFrames = 0;   // budget: drop ambient glow, the one expensive call
    raf = document.hidden ? 0 : requestAnimationFrame(loop);
  }
  function start() { if (!raf && !document.hidden && !reduced) raf = requestAnimationFrame(loop); }
  function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }

  const rect = () => canvas.getBoundingClientRect();
  const onMove = (e: PointerEvent) => { if (e.pointerType !== "mouse" && !pointer.down) return; const r = rect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.nx = (pointer.x / W) * 2 - 1; pointer.ny = (pointer.y / H) * 2 - 1; };
  const onDown = (e: PointerEvent) => { pointer.down = true; onMove(e); };
  const onUp = () => { pointer.down = false; };
  const onLeave = () => { pointer.x = pointer.y = -1e4; pointer.nx = pointer.ny = 0; pointer.down = false; };
  const onVis = () => { if (document.hidden) stop(); else start(); };
  const onResize = () => { void build(); };
  host.addEventListener("pointermove", onMove, { passive: true });
  host.addEventListener("pointerdown", onDown, { passive: true });
  host.addEventListener("pointerup", onUp, { passive: true });
  host.addEventListener("pointercancel", onLeave, { passive: true });
  host.addEventListener("pointerleave", onLeave, { passive: true });
  window.addEventListener("scroll", onLeave, { passive: true });
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("resize", onResize);
  void build();

  return {
    destroy() {
      disposed = true; stop();
      host.removeEventListener("pointermove", onMove); host.removeEventListener("pointerdown", onDown); host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onLeave); host.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("scroll", onLeave); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("resize", onResize);
    },
    setGround(g) { ground = g; recolor(); },
    replay() { void build(); },
    state() { return { ready, done, poseMix, count: parts.length, targets, particles: parts.map(({ tx, ty, tz, rim, shape }) => ({ tx, ty, tz, rim, shape })) }; },
  };
}
