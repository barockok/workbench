import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "./Badge";

describe("Badge", () => {
  it("renders children with the default neutral variant", () => {
    render(<Badge>Live</Badge>);
    expect(screen.getByText("Live")).toHaveClass("ui-badge", "ui-badge-neutral");
  });

  it("applies the requested variant", () => {
    render(<Badge variant="green">Connected</Badge>);
    expect(screen.getByText("Connected")).toHaveClass("ui-badge-green");
  });
});
