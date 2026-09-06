import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandMark, BrandLockup } from "./BrandMark";

describe("BrandMark", () => {
  it("is the Node W from the brand package, not a letter", () => {
    const { container } = render(<BrandMark />);
    const mark = container.querySelector(".brand-mark")!;
    expect(mark.querySelector("svg")).not.toBeNull();
    expect(mark.textContent).toBe("");
    expect(mark.innerHTML).toContain("M5 8 L10 24 L16 12 L22 24 L27 8");
  });

  it("uses currentColor so the accent token themes it", () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector(".brand-mark svg")!.outerHTML).toContain('stroke="currentColor"');
  });

  it("drops the node shapes at 20px and below", () => {
    const { container } = render(<BrandMark size={20} />);
    expect(container.querySelector(".brand-mark svg")!.outerHTML).not.toContain("<rect");
    const big = render(<BrandMark size={56} />);
    expect(big.container.querySelector(".brand-mark svg")!.outerHTML).toContain("<rect");
  });

  it("sizes the root svg", () => {
    const { container } = render(<BrandMark size={56} />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "56");
  });

  it("is decorative — the wordmark beside it carries the name", () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });
});

describe("BrandLockup", () => {
  it("pairs the mark with the wordmark", () => {
    const { container } = render(<BrandLockup />);
    expect(container.querySelector(".brand-mark svg")).toBeInTheDocument();
    expect(screen.getByText("workbench")).toBeInTheDocument();
  });
  it("compact uses the 20px mark", () => {
    const { container } = render(<BrandLockup compact />);
    expect(container.querySelector("svg")).toHaveAttribute("width", "20");
  });
});
