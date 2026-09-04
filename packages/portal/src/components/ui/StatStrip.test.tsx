import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatStrip } from "./StatStrip";

describe("StatStrip", () => {
  it("renders a label and value per stat", () => {
    render(<StatStrip stats={[{ label: "Tool calls", value: "1,284" }, { label: "Success rate", value: "97%" }]} />);
    expect(screen.getByText("Tool calls")).toHaveClass("ui-stat-label");
    expect(screen.getByText("1,284")).toHaveClass("ui-stat-value");
    expect(screen.getByText("97%")).toBeInTheDocument();
  });

  it("renders a note only when one is given", () => {
    const { rerender, container } = render(<StatStrip stats={[{ label: "A", value: "1" }]} />);
    expect(container.querySelector(".ui-stat-note")).toBeNull();
    rerender(<StatStrip stats={[{ label: "A", value: "1" }]} note="Activity is not stored." />);
    expect(screen.getByText("Activity is not stored.")).toHaveClass("ui-stat-note");
  });
});
