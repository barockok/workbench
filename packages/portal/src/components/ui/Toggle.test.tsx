import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "./Toggle";

describe("Toggle", () => {
  it("renders unchecked and calls onChange(true) on click", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Remember me" />);
    const el = screen.getByRole("checkbox", { name: "Remember me" });
    expect(el).not.toBeChecked();
    fireEvent.click(el);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders checked and calls onChange(false) on click", () => {
    const onChange = vi.fn();
    render(<Toggle checked onChange={onChange} label="Remember me" />);
    const el = screen.getByRole("checkbox", { name: "Remember me" });
    expect(el).toBeChecked();
    fireEvent.click(el);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("does not fire onChange when disabled", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="Off" disabled />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Off" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
