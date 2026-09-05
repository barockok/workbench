import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrandMark, BrandLockup } from "./BrandMark";

describe("BrandMark", () => {
  it("is the lowercase w the docs site and favicon already use", () => {
    const { container } = render(<BrandMark />);
    const mark = container.querySelector(".brand-mark");
    expect(mark).toHaveTextContent("w");
  });

  it("scales the glyph with the tile so it can sit in a 24px topbar or a 56px pair", () => {
    const { container } = render(<BrandMark size={56} />);
    const mark = container.querySelector(".brand-mark") as HTMLElement;
    expect(mark.style.width).toBe("56px");
    expect(mark.style.height).toBe("56px");
  });

  it("is decorative — the wordmark beside it carries the name", () => {
    const { container } = render(<BrandMark />);
    expect(container.querySelector(".brand-mark")).toHaveAttribute("aria-hidden");
  });
});

describe("BrandLockup", () => {
  it("pairs the mark with the wordmark", () => {
    const { container } = render(<BrandLockup />);
    expect(container.querySelector(".brand-mark")).toBeInTheDocument();
    expect(screen.getByText("workbench")).toBeInTheDocument();
  });
});
