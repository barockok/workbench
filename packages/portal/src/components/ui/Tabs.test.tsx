import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "./Tabs";

const ITEMS = [
  { id: "all", label: "All", count: 12 },
  { id: "connected", label: "Connected", count: 3 },
  { id: "available", label: "Available", count: 9 },
];

describe("Tabs", () => {
  it("marks only the selected tab as selected", () => {
    render(<Tabs items={ITEMS} value="connected" onChange={() => {}} label="Filter apps" />);
    expect(screen.getByRole("tab", { name: /Connected/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "false");
  });

  it("renders each count beside its label", () => {
    render(<Tabs items={ITEMS} value="all" onChange={() => {}} label="Filter apps" />);
    expect(screen.getByRole("tab", { name: /All/ })).toHaveTextContent("12");
  });

  it("reports the clicked tab", () => {
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} value="all" onChange={onChange} label="Filter apps" />);
    fireEvent.click(screen.getByRole("tab", { name: /Available/ }));
    expect(onChange).toHaveBeenCalledWith("available");
  });

  it("moves selection with the arrow keys, wrapping at the ends", () => {
    const onChange = vi.fn();
    render(<Tabs items={ITEMS} value="available" onChange={onChange} label="Filter apps" />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("all");
  });

  it("keeps only the selected tab in the tab order", () => {
    render(<Tabs items={ITEMS} value="all" onChange={() => {}} label="Filter apps" />);
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: /Connected/ })).toHaveAttribute("tabindex", "-1");
  });
});
