import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Box, BoxRow } from "./Box";

describe("Box", () => {
  it("renders children without a header when no title or action is given", () => {
    render(<Box><BoxRow>only row</BoxRow></Box>);
    expect(screen.getByText("only row")).toHaveClass("ui-box-row");
    expect(screen.queryByRole("heading")).toBeNull();
  });

  it("renders the title as a heading and the action beside it", () => {
    render(
      <Box title="Recent activity" action={<a href="/activity">View all</a>}>
        <BoxRow>a row</BoxRow>
      </Box>
    );
    expect(screen.getByRole("heading", { name: "Recent activity" })).toHaveClass("ui-box-title");
    expect(screen.getByRole("link", { name: "View all" })).toBeInTheDocument();
  });

  it("appends a caller className to the box element", () => {
    const { container } = render(<Box className="extra">body</Box>);
    expect(container.querySelector(".ui-box")).toHaveClass("extra");
  });
});
