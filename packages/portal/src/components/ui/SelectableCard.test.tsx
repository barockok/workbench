import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SelectableCard } from "./SelectableCard";

describe("SelectableCard", () => {
  it("renders title and description, calls onSelect on click", () => {
    const onSelect = vi.fn();
    render(<SelectableCard title="Plan A" description="Basic" onSelect={onSelect} />);
    expect(screen.getByText("Plan A")).toBeInTheDocument();
    expect(screen.getByText("Basic")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Plan A"));
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("applies the active class when active", () => {
    render(<SelectableCard title="Plan A" active onSelect={vi.fn()} />);
    expect(screen.getByText("Plan A").closest(".ui-selectable-card")).toHaveClass("ui-selectable-card-active");
  });

  it("does not fire onSelect when disabled", () => {
    const onSelect = vi.fn();
    render(<SelectableCard title="Plan A" disabled onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Plan A"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("fires onSelect on Enter key", () => {
    const onSelect = vi.fn();
    render(<SelectableCard title="Plan A" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByText("Plan A").closest(".ui-selectable-card")!, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
