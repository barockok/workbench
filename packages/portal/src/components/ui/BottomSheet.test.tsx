import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BottomSheet } from "./BottomSheet";

describe("BottomSheet", () => {
  it("renders nothing when closed", () => {
    render(<BottomSheet open={false} onClose={vi.fn()}>Body</BottomSheet>);
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("renders content when open", () => {
    render(<BottomSheet open onClose={vi.fn()} title="Sheet">Body</BottomSheet>);
    expect(screen.getByText("Sheet")).toBeInTheDocument();
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<BottomSheet open onClose={onClose}>Body</BottomSheet>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on backdrop click but not content click", () => {
    const onClose = vi.fn();
    render(<BottomSheet open onClose={onClose}>Body text</BottomSheet>);
    fireEvent.click(screen.getByText("Body text"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
