// The workbench mark: a "w" drawn as a wire between five nodes. Four hollow
// endpoint shapes are tools — circle, square, triangle, diamond — and the one
// filled node at the centre peak is the endpoint the agent talks to.
export const MARK = {
  viewBox: 32,
  wire: "M5 8 L10 24 L16 12 L22 24 L27 8",
  wireWidth: 4.2,
  nodeWidth: 1.8,
  hub: { cx: 16, cy: 12, r: 3.7 },
  nodes: [
    { shape: "circle", cx: 5, cy: 8, r: 3 },
    { shape: "square", x: 24, y: 5, size: 6, rx: 0.9 },
    { shape: "triangle", points: "10,20.4 13.3,26.8 6.7,26.8" },
    { shape: "diamond", points: "22,20.2 25.8,24 22,27.8 18.2,24" },
  ],
  // Node centres in mark units, used by the swarm to assign shapes by region.
  nodeCentres: [[5, 8], [27, 8], [10, 24], [22, 24], [16, 12]] as ReadonlyArray<readonly [number, number]>,
} as const;

export type MarkVariant = "full" | "small" | "knockout";

export interface MarkOptions {
  /** Stroke and hub colour. Defaults to currentColor. */
  color?: string;
  /** Fill for the hollow nodes so the wire visibly stops at each edge. Defaults to none. */
  surface?: string;
  /** full: nodes + hub. small: wire + hub (≤20px). knockout: white mark on an accent tile. */
  variant?: MarkVariant;
  /** Rendered width/height in px. Omit for a scalable element. */
  size?: number;
  /** Accessible name. Omit to mark the element decorative. */
  title?: string;
}

function nodeElements(surface: string): string {
  return MARK.nodes
    .map((n) => {
      switch (n.shape) {
        case "circle": return `<circle cx="${n.cx}" cy="${n.cy}" r="${n.r}" fill="${surface}"/>`;
        case "square": return `<rect x="${n.x}" y="${n.y}" width="${n.size}" height="${n.size}" rx="${n.rx}" fill="${surface}"/>`;
        default: return `<polygon points="${n.points}" fill="${surface}"/>`;
      }
    })
    .join("");
}

export function markSvg(opts: MarkOptions = {}): string {
  const variant = opts.variant ?? "full";
  const knockout = variant === "knockout";
  const color = knockout ? "#ffffff" : (opts.color ?? "currentColor");
  const tile = opts.color ?? "#853291";
  const surface = knockout ? tile : (opts.surface ?? "none");
  const dims = opts.size ? ` width="${opts.size}" height="${opts.size}"` : "";
  const a11y = opts.title ? ` role="img" aria-label="${opts.title}"` : ` aria-hidden="true"`;
  const parts: string[] = [];
  if (knockout) parts.push(`<rect x="0" y="0" width="32" height="32" rx="7" fill="${tile}"/>`);
  parts.push(`<path d="${MARK.wire}" fill="none" stroke="${color}" stroke-width="${MARK.wireWidth}" stroke-linecap="round" stroke-linejoin="round"/>`);
  if (variant !== "small") {
    parts.push(`<g fill="none" stroke="${color}" stroke-width="${MARK.nodeWidth}" stroke-linejoin="round">${nodeElements(surface)}</g>`);
  }
  parts.push(`<circle cx="${MARK.hub.cx}" cy="${MARK.hub.cy}" r="${MARK.hub.r}" fill="${color}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK.viewBox} ${MARK.viewBox}"${dims}${a11y}>${parts.join("")}</svg>`;
}
