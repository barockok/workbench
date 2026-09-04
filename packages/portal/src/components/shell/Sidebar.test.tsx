import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "./Sidebar";

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" }, token: "t", isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Sidebar />
    </MemoryRouter>
  );
}

describe("Sidebar", () => {
  it("is a labelled navigation landmark", () => {
    renderAt("/");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("lists every destination", () => {
    renderAt("/");
    for (const name of ["Home", "Apps", "Agents", "Activity", "Settings", "Help"]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("marks only the current route as the current page", () => {
    renderAt("/apps");
    expect(screen.getByRole("link", { name: "Apps" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
  });

  it("does not mark Home as current on a nested route", () => {
    renderAt("/activity");
    expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
  });

  it("shows the signed-in email", () => {
    renderAt("/");
    expect(screen.getByText("dev@example.com")).toBeInTheDocument();
  });

  it("opens Help in a new tab without leaking the referrer", () => {
    renderAt("/");
    const help = screen.getByRole("link", { name: "Help" });
    expect(help).toHaveAttribute("target", "_blank");
    expect(help).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });
});
