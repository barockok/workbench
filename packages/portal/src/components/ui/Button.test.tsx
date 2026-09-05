import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./Button";

describe("Button", () => {
  it("renders children and defaults to primary/md", () => {
    render(<Button>Connect</Button>);
    const btn = screen.getByRole("button", { name: "Connect" });
    expect(btn).toHaveClass("ui-button", "ui-button-primary", "ui-button-md");
  });

  it("applies the requested variant and size", () => {
    render(<Button variant="danger" size="lg">Disconnect</Button>);
    const btn = screen.getByRole("button", { name: "Disconnect" });
    expect(btn).toHaveClass("ui-button-danger", "ui-button-lg");
  });

  it("forwards onClick and disabled", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick} disabled>Go</Button>);
    const btn = screen.getByRole("button", { name: "Go" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });
});
