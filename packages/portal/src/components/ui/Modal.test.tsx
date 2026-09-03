import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./Modal";

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={vi.fn()}>Body</Modal>);
    expect(screen.queryByText("Body")).not.toBeInTheDocument();
  });

  it("renders title, body, and footer when open", () => {
    render(
      <Modal open onClose={vi.fn()} title="Connect" footer={<button>Go</button>}>
        Body text
      </Modal>
    );
    expect(screen.getByText("Connect")).toBeInTheDocument();
    expect(screen.getByText("Body text")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>Body</Modal>);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on backdrop click but not on content click", () => {
    const onClose = vi.fn();
    render(<Modal open onClose={onClose}>Body text</Modal>);
    fireEvent.click(screen.getByText("Body text"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("presentation"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves focus into the content panel on open", () => {
    render(<Modal open onClose={vi.fn()}>Body</Modal>);
    expect(document.activeElement).toHaveClass("ui-modal");
  });
});
