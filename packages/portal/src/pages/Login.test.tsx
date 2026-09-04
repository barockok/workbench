import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Login from "./Login";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: null, token: null, isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("../api", () => ({
  fetchProviders: vi.fn(async () => ({ providers: ["google", "keycloak"] })),
  fetchAuthUrl: vi.fn(),
  fetchKeycloakAuthUrl: vi.fn(),
}));

// Block body, not an expression body — `tsc` rejects the value `vi.clearAllMocks()`
// returns as a hook callback's return type.
beforeEach(() => {
  vi.clearAllMocks();
});

describe("Login", () => {
  it("offers each configured provider", async () => {
    render(<Login />);
    expect(await screen.findByRole("button", { name: /Continue with Google/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue with Keycloak/ })).toBeInTheDocument();
  });

  it("states nothing it cannot know", async () => {
    const { container } = render(<Login />);
    await waitFor(() => screen.getByRole("button", { name: /Continue with Google/ }));
    const text = container.textContent ?? "";
    // The old panel asserted a tool count, a plugin count and a node status,
    // none of which this page has any way to know before sign-in.
    expect(text).not.toMatch(/TOOLS|PLUGINS|NODE|online/);
    expect(text).not.toContain("//");
  });

  it("explains when no provider is configured", async () => {
    const { fetchProviders } = await import("../api");
    vi.mocked(fetchProviders).mockResolvedValue({ providers: [] });
    render(<Login />);
    expect(await screen.findByText("No auth provider configured")).toBeInTheDocument();
  });
});
