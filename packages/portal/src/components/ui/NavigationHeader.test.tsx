import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NavigationHeader } from "./NavigationHeader";

describe("NavigationHeader", () => {
  it("renders the title", () => {
    render(<NavigationHeader title="workbench" />);
    expect(screen.getByText("workbench")).toBeInTheDocument();
  });

  it("renders a back button and fires onBack when provided", () => {
    const onBack = vi.fn();
    render(<NavigationHeader title="Detail" onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("omits the back button when onBack is not provided", () => {
    render(<NavigationHeader title="Home" />);
    expect(screen.queryByRole("button", { name: /back/i })).not.toBeInTheDocument();
  });

  it("renders trailing content", () => {
    render(<NavigationHeader title="Home" trailing={<span>Sign out</span>} />);
    expect(screen.getByText("Sign out")).toBeInTheDocument();
  });
});
