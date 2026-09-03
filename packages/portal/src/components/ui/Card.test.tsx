import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("renders children with the base class", () => {
    render(<Card>Content</Card>);
    expect(screen.getByText("Content")).toHaveClass("ui-card");
  });

  it("adds ui-card-clickable and forwards onClick", () => {
    const onClick = vi.fn();
    render(<Card clickable onClick={onClick}>Click me</Card>);
    const el = screen.getByText("Click me");
    expect(el).toHaveClass("ui-card-clickable");
    fireEvent.click(el);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("adds ui-card-disabled when disabled", () => {
    render(<Card disabled>Off</Card>);
    expect(screen.getByText("Off")).toHaveClass("ui-card-disabled");
  });
});
