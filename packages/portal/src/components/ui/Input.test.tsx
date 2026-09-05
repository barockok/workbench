import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input, Select } from "./Input";

describe("Input", () => {
  it("renders with default state and forwards value/onChange", () => {
    const onChange = vi.fn();
    render(<Input placeholder="Amount" value="10" onChange={onChange} />);
    const el = screen.getByPlaceholderText("Amount");
    expect(el).toHaveClass("ui-input", "ui-input-default");
    fireEvent.change(el, { target: { value: "20" } });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("applies the error state class", () => {
    render(<Input placeholder="Email" state="error" />);
    expect(screen.getByPlaceholderText("Email")).toHaveClass("ui-input-error");
  });
});

describe("Select", () => {
  it("renders options and forwards onChange", () => {
    const onChange = vi.fn();
    render(
      <Select value="a" onChange={onChange} aria-label="Pick">
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>
    );
    const el = screen.getByLabelText("Pick");
    expect(el).toHaveClass("ui-input", "ui-input-default");
    fireEvent.change(el, { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledOnce();
  });
});
