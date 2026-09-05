import type { ReactNode } from "react";

// A real table, not a stack of divs: screen readers announce row and column
// position, and the caption gives the table an accessible name without
// duplicating the Box header visually.
export function DataTable({
  caption,
  head,
  children,
}: {
  caption: string;
  head: ReactNode;
  children: ReactNode;
}) {
  return (
    <table className="ui-table">
      <caption className="ui-sr-only">{caption}</caption>
      <thead>{head}</thead>
      <tbody>{children}</tbody>
    </table>
  );
}
