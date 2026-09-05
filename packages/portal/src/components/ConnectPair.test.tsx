import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectPair } from "./ConnectPair";

describe("ConnectPair", () => {
  it("shows workbench and the integration as the two ends of the pair", () => {
    const { container } = render(<ConnectPair logo={<img alt="Acme logo" src="/logos/acme.svg" />} label="Acme" />);
    expect(container.querySelector(".brand-mark")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Acme logo" })).toBeInTheDocument();
  });

  it("does not repeat the wordmark under our own end — the lockup above the card says it", () => {
    render(<ConnectPair logo={null} label="Acme" />);
    expect(screen.queryByText("workbench")).not.toBeInTheDocument();
  });

  it("puts the real workbench mark on our end of the pair", () => {
    const { container } = render(<ConnectPair logo={null} label="Acme" />);
    const mark = container.querySelector(".brand-mark");
    expect(mark).toHaveTextContent("w");
    // The mono "wb" placeholder matched nothing else in the product.
    expect(container.textContent).not.toContain("wb");
  });

  it("marks the pending state so the link between the two reads as not yet made", () => {
    const { container } = render(<ConnectPair logo={null} label="Acme" />);
    expect(container.querySelector(".connect-pair-link")).not.toHaveClass("is-connected");
  });

  it("marks the connected state", () => {
    const { container } = render(<ConnectPair connected logo={null} label="Acme" />);
    expect(container.querySelector(".connect-pair-link")).toHaveClass("is-connected");
  });

  it("describes the pairing for screen readers rather than leaving it to the glyph", () => {
    render(<ConnectPair connected logo={null} label="Acme" />);
    expect(screen.getByRole("img", { name: /connected to/i })).toBeInTheDocument();
  });
});
