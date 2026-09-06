import { describe, it, expect } from "vitest";
import { ENTER_MS, STAGGER_MS, LANES, smootherstep, settle, laneState, entranceDone, projectLane } from "../src/swarm/lanes";

describe("easings", () => {
  it("smootherstep and settle both run 0→1 and are monotonic", () => {
    let last = -1;
    for (let p = 0; p <= 1.0001; p += 0.05) { const v = settle(p); expect(v).toBeGreaterThanOrEqual(last - 1e-12); last = v; }
    expect(smootherstep(0)).toBe(0); expect(smootherstep(1)).toBe(1);
    expect(settle(0)).toBe(0); expect(settle(1)).toBeCloseTo(1);
  });
});

describe("laneState", () => {
  it("lane 0 starts immediately; the last lane waits STAGGER_MS", () => {
    expect(laneState(0, 1).ease).toBeGreaterThan(0);
    expect(laneState(LANES - 1, STAGGER_MS - 1).ease).toBe(0);
  });
  it("every lane completes exactly one orbit and lands flat by ENTER_MS", () => {
    for (let l = 0; l < LANES; l++) {
      const s = laneState(l, ENTER_MS);
      expect(s.ease).toBeCloseTo(1);
      expect(s.angle).toBeCloseTo(Math.PI * 2);
      expect(s.tilt).toBeCloseTo(0, 6);
      expect(s.roll).toBeCloseTo(0, 6);
    }
    expect(entranceDone(ENTER_MS)).toBe(true);
    expect(entranceDone(ENTER_MS - 1)).toBe(false);
  });
  it("alternates roll direction by lane parity mid-orbit", () => {
    const a = laneState(0, ENTER_MS / 2), b = laneState(1, ENTER_MS / 2);
    expect(Math.sign(a.roll)).toBe(1); expect(Math.sign(b.roll)).toBe(-1);
  });
});

describe("projectLane", () => {
  it("is the identity at the end of the orbit", () => {
    const s = laneState(3, ENTER_MS);
    const [px, py, k] = projectLane(10, -7, 0, s, 1000);
    expect(px).toBeCloseTo(10); expect(py).toBeCloseTo(-7); expect(k).toBeCloseTo(1);
  });
  it("clamps perspective to 0.68–1.55", () => {
    const s = laneState(0, ENTER_MS / 4);
    const [, , k] = projectLane(0, 0, 5000, s, 100);
    expect(k).toBeGreaterThanOrEqual(0.68); expect(k).toBeLessThanOrEqual(1.55);
  });
});
