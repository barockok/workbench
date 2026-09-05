import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectPair } from "./ConnectPair";

describe("ConnectPair", () => {
  it("shows workbench and the integration as the two ends of the pair", () => {
    render(<ConnectPair logo={<img alt="Acme logo" src="/logos/acme.svg" />} label="Acme" />);
    expect(screen.getByText("workbench")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Acme logo" })).toBeInTheDocument();
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
