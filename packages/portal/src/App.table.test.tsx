import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

// No session: this is what proves which routes are gated and which are not.
vi.mock("./context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({ user: null, token: null, isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("./api", () => ({
  fetchProviders: vi.fn(async () => ({ providers: [] })),
  fetchAuthUrl: vi.fn(),
  fetchKeycloakAuthUrl: vi.fn(),
  SERVER_URL: "",
}));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  sessionStorage.clear();
});

describe("the real route table", () => {
  it("leaves /authorize/choose ungated — an agent-initiated flow must not bounce to /login", async () => {
    renderAt("/authorize/choose?ticket=abc123");
    // The page renders its own signed-out picker rather than redirecting.
    expect(await screen.findByText(/Approve agent access/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
  });

  it("gates every shell route behind a session", async () => {
    for (const path of ["/", "/apps", "/apps/acme", "/agents", "/activity", "/settings"]) {
      const { unmount } = renderAt(path);
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
      unmount();
    }
  });

  it("gates the full-bleed routes too", async () => {
    for (const path of ["/connect/acme", "/browser"]) {
      const { unmount } = renderAt(path);
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
      unmount();
    }
  });

  it("remembers where an unauthenticated visitor was headed", async () => {
    renderAt("/apps/acme");
    await screen.findByRole("heading", { name: "Sign in" });
    expect(sessionStorage.getItem("awb_return_to")).toBe("/apps/acme");
  });

  it("sends an unknown path home rather than rendering nothing", async () => {
    renderAt("/no-such-page");
    // Unauthenticated, so the redirect lands on the login page — the point is
    // that it redirects at all instead of rendering a blank route.
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
