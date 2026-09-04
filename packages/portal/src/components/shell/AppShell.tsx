import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="wb-shell">
      <Sidebar />
      <main className="wb-content">{children}</main>
    </div>
  );
}
