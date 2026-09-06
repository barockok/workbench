import { describe, it, expect } from "vitest";
import { MARK, markSvg } from "../src/mark.js";

describe("markSvg", () => {
  it("draws the wire, four hollow nodes and a filled hub in the full variant", () => {
    const svg = markSvg({ color: "#853291", surface: "#ffffff" });
    expect(svg).toContain(`d="${MARK.wire}"`);
    expect(svg).toContain('stroke-width="4.2"');
    expect(svg).toContain('stroke-width="1.8"');
    expect(svg).toContain('<circle cx="5" cy="8" r="3"');
    expect(svg).toContain('<rect x="24" y="5" width="6" height="6" rx="0.9"');
    expect(svg).toContain('points="10,20.4 13.3,26.8 6.7,26.8"');
    expect(svg).toContain('points="22,20.2 25.8,24 22,27.8 18.2,24"');
    expect(svg).toContain('<circle cx="16" cy="12" r="3.7" fill="#853291"');
    expect(svg).toContain('fill="#ffffff"'); // hollow nodes are filled with the surface
  });

  it("small variant keeps only the wire and the hub", () => {
    const svg = markSvg({ variant: "small" });
    expect(svg).toContain(MARK.wire);
    expect(svg).toContain('r="3.7"');
    expect(svg).not.toContain("<rect");
    expect(svg).not.toContain("points=");
  });

  it("knockout variant is a white mark on an accent tile", () => {
    const svg = markSvg({ variant: "knockout", color: "#853291" });
    expect(svg).toContain('<rect x="0" y="0" width="32" height="32" rx="7" fill="#853291"');
    expect(svg).toContain('stroke="#ffffff"');
  });

  it("uses currentColor when no colour is given so CSS can theme it", () => {
    expect(markSvg()).toContain('stroke="currentColor"');
  });

  it("sizes the root element and marks it decorative", () => {
    const svg = markSvg({ size: 24 });
    expect(svg).toMatch(/^<svg [^>]*width="24" height="24"/);
    expect(svg).toContain('aria-hidden="true"');
  });
});
