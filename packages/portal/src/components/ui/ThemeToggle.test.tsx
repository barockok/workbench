import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "./ThemeToggle";

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it("toggles data-theme from light to dark on click", () => {
    document.documentElement.dataset.theme = "light";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists the choice to localStorage", () => {
    document.documentElement.dataset.theme = "light";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(localStorage.getItem("wb-theme")).toBe("dark");
  });

  it("toggles dark back to light", () => {
    document.documentElement.dataset.theme = "dark";
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button", { name: /theme/i }));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
