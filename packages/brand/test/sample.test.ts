import { describe, it, expect } from "vitest";
import { inside, isRim, sampleMask, type Mask } from "../src/swarm/sample";
import { MARK } from "../src/mark";

// A 100×100 mask with a solid white square from (20,20) to (80,80).
function squareMask(): Mask {
  const size = 100, data = new Uint8ClampedArray(size * size * 4);
  for (let y = 20; y < 80; y++) for (let x = 20; x < 80; x++) { const k = (y * size + x) * 4; data[k] = data[k + 1] = data[k + 2] = 255; data[k + 3] = 255; }
  return { size, data };
}
function lcg(seed = 1) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }; }

describe("inside", () => {
  it("is true only for opaque white pixels", () => {
    const m = squareMask();
    expect(inside(m, 50, 50)).toBe(true);
    expect(inside(m, 10, 10)).toBe(false);
    expect(inside(m, -1, 50)).toBe(false);
  });
});

describe("isRim", () => {
  it("is true within 2.5px of the silhouette edge and false deeper in", () => {
    const m = squareMask();
    expect(isRim(m, 21, 50)).toBe(true);
    expect(isRim(m, 50, 50)).toBe(false);
  });
});

describe("sampleMask", () => {
  it("returns only points inside the mask, no two closer than the gap", () => {
    const pts = sampleMask(squareMask(), { gap: 4, rnd: lcg(), nodeCentres: MARK.nodeCentres });
    expect(pts.length).toBeGreaterThan(100);
    for (const p of pts) expect(inside(squareMask(), p.mx, p.my)).toBe(true);
    for (let i = 0; i < 200; i++) for (let j = i + 1; j < 200; j++) {
      const a = pts[i], b = pts[j];
      const d = Math.hypot(a.mx - b.mx, a.my - b.my);
      // body–body pairs keep the full gap; any pair involving a rim point may sit at the rim gap (0.62×)
      expect(d).toBeGreaterThanOrEqual((a.rim || b.rim ? 4 * 0.62 : 4) - 1e-9);
    }
  });

  it("marks rim points and packs them denser than the body", () => {
    const pts = sampleMask(squareMask(), { gap: 4, rnd: lcg(), nodeCentres: MARK.nodeCentres });
    const rim = pts.filter((p) => p.rim), body = pts.filter((p) => !p.rim);
    expect(rim.length).toBeGreaterThan(0);
    for (const p of rim) expect(isRim(squareMask(), p.mx, p.my)).toBe(true);
    expect(body.length).toBeGreaterThan(rim.length); // a filled square is mostly interior
  });

  it("assigns a pure shape near a node and any of the four elsewhere", () => {
    const pts = sampleMask(squareMask(), { gap: 4, rnd: lcg(), nodeCentres: MARK.nodeCentres });
    // (5,8) in mark units is (15.6, 25) here: near the circle node → shape 0
    const nearCircle = pts.filter((p) => Math.hypot(p.mx / 100 * 32 - 5, p.my / 100 * 32 - 8) < 2);
    for (const p of nearCircle) { expect(p.group).toBe(0); expect(p.shape).toBe(0); }
    expect(new Set(pts.map((p) => p.shape)).size).toBe(4);
  });

  it("is deterministic for the same rnd", () => {
    const a = sampleMask(squareMask(), { gap: 4, rnd: lcg(9), nodeCentres: MARK.nodeCentres });
    const b = sampleMask(squareMask(), { gap: 4, rnd: lcg(9), nodeCentres: MARK.nodeCentres });
    expect(a).toEqual(b);
  });
});
