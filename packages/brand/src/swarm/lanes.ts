// Eliza-style entrance: particles are split into lanes, each staggered, and
// each lane makes one full orbit through a virtual camera while easing from
// its ring start onto its target. Numbers are the approved prototype's.
export const ENTER_MS = 4200;
export const STAGGER_MS = 900;
export const LANES = 12;

export const smootherstep = (p: number) => p * p * p * (p * (p * 6 - 15) + 10);
// Departure eases gently (smootherstep), landing stretches long (quintic-out).
export const settle = (p: number) => { const s = smootherstep(p), i = 1 - s; return 1 - i * i; };

export interface LaneState { angle: number; tilt: number; roll: number; ease: number }

export function laneState(lane: number, elapsedMs: number): LaneState {
  const delay = (lane / (LANES - 1)) * STAGGER_MS;
  const p = Math.min(1, Math.max(0, (elapsedMs - delay) / (ENTER_MS - delay)));
  const spin = smootherstep(p);
  return {
    angle: spin * Math.PI * 2,
    tilt: Math.sin(spin * Math.PI) * 0.24,
    roll: Math.sin(spin * Math.PI) * 0.28 * (lane % 2 ? -1 : 1),
    ease: settle(p),
  };
}

export const entranceDone = (elapsedMs: number) => elapsedMs >= ENTER_MS;

// Rotate (x,y,z) by the lane's yaw/tilt/roll, then project with perspective.
export function projectLane(x: number, y: number, z: number, s: LaneState, cam: number): [number, number, number] {
  const ca = Math.cos(s.angle), sa = Math.sin(s.angle);
  const X = x * ca + z * sa, Z1 = -x * sa + z * ca;
  const ct = Math.cos(s.tilt), st = Math.sin(s.tilt);
  const Y = y * ct - Z1 * st, depth = y * st + Z1 * ct;
  const cr = Math.cos(s.roll), sr = Math.sin(s.roll);
  const rx = X * cr - Y * sr, ry = X * sr + Y * cr;
  const k = Math.min(1.55, Math.max(0.68, cam / (cam + depth)));
  return [rx * k, ry * k, k];
}
