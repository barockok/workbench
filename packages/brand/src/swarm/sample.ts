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

// Poisson-ish sampling: random candidates rejected when a neighbour sits closer
// than the gap, tracked in a grid whose cell is gap/√2 so one point fits a cell.
// Runs until the mask is saturated (a long streak of rejected candidates), not a
// fixed try count, so it packs consistently across mask sizes and gaps.
export function sampleMask(mask: Mask, opts: SampleOptions): SamplePoint[] {
  const { size } = mask, gap = opts.gap, rimGap = gap * (opts.rimGap ?? 0.62), r2 = opts.nodeRadius2 ?? 20;
  const cell = rimGap / Math.SQRT2, cols = Math.ceil(size / cell);
  const grid = new Int32Array(cols * cols).fill(-1);
  const pts: SamplePoint[] = [];
  const maxTries = size * size * 200; // hard cap so a pathological mask can't spin forever
  const maxMisses = Math.max(2000, cols * cols * 20); // consecutive rejections that call it saturated
  let misses = 0;
  for (let i = 0; i < maxTries && misses < maxMisses; i++) {
    const x = opts.rnd() * size, y = opts.rnd() * size;
    if (!inside(mask, x, y)) { misses++; continue; }
    const rim = isRim(mask, x, y);
    const need = rim ? rimGap : gap;
    const gx = (x / cell) | 0, gy = (y / cell) | 0;
    const reach = Math.ceil(gap / cell);
    let ok = true;
    for (let yy = Math.max(0, gy - reach); yy <= Math.min(cols - 1, gy + reach) && ok; yy++) {
      for (let xx = Math.max(0, gx - reach); xx <= Math.min(cols - 1, gx + reach); xx++) {
        const j = grid[yy * cols + xx]; if (j < 0) continue;
        const p = pts[j], dx = p.mx - x, dy = p.my - y;
        const min = rim && p.rim ? rimGap : need;
        if (dx * dx + dy * dy < min * min) { ok = false; break; }
      }
    }
    if (!ok || grid[gy * cols + gx] >= 0) { misses++; continue; }
    misses = 0;
    const ux = x / size * 32, uy = y / size * 32;
    let group = 4, best = Infinity;
    opts.nodeCentres.forEach(([nx, ny], j) => { const d = (ux - nx) ** 2 + (uy - ny) ** 2; if (d < best) { best = d; group = j; } });
    const shape = (best < r2 && group < 4 ? group : (opts.rnd() * 4) | 0) as 0 | 1 | 2 | 3;
    grid[gy * cols + gx] = pts.length;
    pts.push({ mx: x, my: y, rim, shape, group: group as SamplePoint["group"] });
  }
  return pts;
}
