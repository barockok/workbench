import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Settings from "./Settings";

const logout = vi.fn();

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" }, token: "t", isLoading: false, login: vi.fn(), logout }),
}));

vi.mock("../api", () => ({
  getApiKeyStatus: vi.fn(async () => ({ hasKey: false })),
  mintApiKey: vi.fn(async () => ({ apiKey: "tok-abc" })),
  revealApiKey: vi.fn(async () => ({ apiKey: "tok-abc" })),
  revokeApiKey: vi.fn(async () => ({ success: true })),
}));

import { mintApiKey } from "../api";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Settings />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Settings", () => {
  it("titles the page and names its sections", async () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "API key" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Help" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account" })).toBeInTheDocument();
  });

  it("mints a key from here", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Generate key" }));
    await waitFor(() => expect(mintApiKey).toHaveBeenCalled());
  });

  it("shows the signed-in email and signs out", () => {
    renderPage();
    expect(screen.getByText("dev@example.com")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("offers a theme toggle", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "Toggle theme" })).toBeInTheDocument();
  });

  it("opens the help link in a new tab without leaking the referrer", () => {
    renderPage();
    const help = screen.getByRole("link", { name: "Docs & source on GitHub" });
    expect(help).toHaveAttribute("target", "_blank");
    expect(help).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });
});
