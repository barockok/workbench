import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DataTable } from "./DataTable";

describe("DataTable", () => {
  it("renders a table whose accessible name comes from a hidden caption", () => {
    render(
      <DataTable caption="Tool calls" head={<tr><th scope="col">Tool</th></tr>}>
        <tr><td>jira_search</td></tr>
      </DataTable>
    );
    expect(screen.getByRole("table", { name: "Tool calls" })).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toHaveClass("ui-sr-only");
    expect(screen.getByRole("cell", { name: "jira_search" })).toBeInTheDocument();
  });
});
