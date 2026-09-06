export interface Mask { size: number; data: Uint8ClampedArray }
export interface SamplePoint { mx: number; my: number; rim: boolean; shape: 0 | 1 | 2 | 3; group: 0 | 1 | 2 | 3 | 4 }

export function inside(mask: Mask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.size || y >= mask.size) return false;
  const k = ((y | 0) * mask.size + (x | 0)) * 4;
  return mask.data[k + 3] > 128 && mask.data[k] > 128; // opaque and white: stroke, not a hollow node's interior
}

// Rim: any of the four neighbours `reach` px away is outside the silhouette.
export function isRim(mask: Mask, x: number, y: number, reach = 2.5): boolean {
  return !(inside(mask, x - reach, y) && inside(mask, x + reach, y) && inside(mask, x, y - reach) && inside(mask, x, y + reach));
}

export interface SampleOptions {
  gap: number;
  rimGap?: number;                  // fraction of gap; rim packs denser. Default 0.62
  rnd: () => number;                // deterministic source so a resize re-samples identically
  nodeCentres: ReadonlyArray<readonly [number, number]>;  // mark units (32-grid); last entry is the hub
  nodeRadius2?: number;             // squared distance (mark units) within which a point is "at" a node. Default 20
}

const K = 30;             // candidates tried around an active point before it retires
const SEED_MISSES = 400;  // consecutive failed probes that call the mask saturated
const REACH = 1.3;        // candidates land within REACH × the point's radius; a tight
                          // annulus packs denser than Bridson's usual [r, 2r]

// Variable-radius Poisson-disc sampling, Bridson's active-list method. Random
// probes find a seed in each region of the mask; every accepted point then
// spawns candidates in the annulus around itself until it can place no more.
// Work is proportional to the points produced, not to the mask's area, so a
// hero-sized mask samples in milliseconds.
export function sampleMask(mask: Mask, opts: SampleOptions): SamplePoint[] {
  const { size } = mask, gap = opts.gap, rimGap = gap * (opts.rimGap ?? 0.62), r2 = opts.nodeRadius2 ?? 20;
  const cell = rimGap / Math.SQRT2, cols = Math.ceil(size / cell);
  const grid = new Int32Array(cols * cols).fill(-1);
  const pts: SamplePoint[] = [];
  const active: number[] = [];
  const reach = Math.ceil(gap / cell);
  const maxPoints = cols * cols;  // one point per grid cell is the hard ceiling

  // A rim candidate may sit as close as the rim gap to anything; a body
  // candidate keeps the full gap. Same pair rule the rejection sampler used.
  function fits(x: number, y: number, rim: boolean): boolean {
    const min = rim ? rimGap : gap, min2 = min * min;
    const gx = (x / cell) | 0, gy = (y / cell) | 0;
    for (let yy = Math.max(0, gy - reach); yy <= Math.min(cols - 1, gy + reach); yy++) {
      const row = yy * cols;
      for (let xx = Math.max(0, gx - reach); xx <= Math.min(cols - 1, gx + reach); xx++) {
        const j = grid[row + xx]; if (j < 0) continue;
        const p = pts[j], dx = p.mx - x, dy = p.my - y;
        if (dx * dx + dy * dy < min2) return false;
      }
    }
    return grid[gy * cols + gx] < 0;
  }

  function add(x: number, y: number, rim: boolean): void {
    const ux = x / size * 32, uy = y / size * 32;
    let group = 4, best = Infinity;
    opts.nodeCentres.forEach(([nx, ny], j) => { const d = (ux - nx) ** 2 + (uy - ny) ** 2; if (d < best) { best = d; group = j; } });
    const shape = (best < r2 && group < 4 ? group : (opts.rnd() * 4) | 0) as 0 | 1 | 2 | 3;
    grid[((y / cell) | 0) * cols + ((x / cell) | 0)] = pts.length;
    active.push(pts.length);
    pts.push({ mx: x, my: y, rim, shape, group: group as SamplePoint["group"] });
  }

  let misses = 0;
  while (misses < SEED_MISSES && pts.length < maxPoints) {
    const sx = opts.rnd() * size, sy = opts.rnd() * size;
    if (!inside(mask, sx, sy)) { misses++; continue; }
    const srim = isRim(mask, sx, sy);
    if (!fits(sx, sy, srim)) { misses++; continue; }
    misses = 0;
    add(sx, sy, srim);

    // Grow outwards from the seed until this region of the mask is full.
    while (active.length && pts.length < maxPoints) {
      const slot = (opts.rnd() * active.length) | 0;
      const p = pts[active[slot]];
      const r = p.rim ? rimGap : gap;
      let placed = false;
      for (let i = 0; i < K; i++) {
        // rimGap is the smallest distance any pair may sit at, so start there
        // and let fits() reject what is too close for a body point.
        const a = opts.rnd() * Math.PI * 2, d = rimGap + opts.rnd() * (REACH * r - rimGap);
        const x = p.mx + Math.cos(a) * d, y = p.my + Math.sin(a) * d;
        if (!inside(mask, x, y)) continue;
        const rim = isRim(mask, x, y);
        if (!fits(x, y, rim)) continue;
        add(x, y, rim);
        placed = true;
        break;
      }
      if (!placed) { active[slot] = active[active.length - 1]; active.pop(); }
    }
  }
  return pts;
}
