import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders the message", () => {
    render(<EmptyState message="No apps connected yet" />);
    expect(screen.getByText("No apps connected yet")).toHaveClass("ui-empty-msg");
  });

  it("renders an action when given one", () => {
    render(<EmptyState message="Nothing here" action={<a href="/apps">Browse apps</a>} />);
    expect(screen.getByRole("link", { name: "Browse apps" })).toBeInTheDocument();
  });
});
