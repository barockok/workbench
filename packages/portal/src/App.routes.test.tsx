import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Outlet } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "./components/shell/AppShell";
import Apps from "./pages/Apps";
import Agents from "./pages/Agents";
import Activity from "./pages/Activity";
import Settings from "./pages/Settings";

vi.mock("./context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" }, token: "t", isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

vi.mock("./api", () => ({
  fetchIntegrations: vi.fn(async () => ({ integrations: [] })),
  fetchConnections: vi.fn(async () => ({ connections: [] })),
  fetchAgents: vi.fn(async () => ({ agents: [] })),
  fetchActivity: vi.fn(async () => ({ stored: true, events: [], next_cursor: null })),
  fetchStats: vi.fn(async () => ({ stored: true, window_days: 30, tool_calls: 0, success_rate: null, most_used_integration: null })),
  getApiKeyStatus: vi.fn(async () => ({ hasKey: false })),
  startIntegrationAuth: vi.fn(),
  disconnectIntegration: vi.fn(),
  revokeAgent: vi.fn(),
  mintApiKey: vi.fn(),
  revealApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
}));

vi.mock("./components/CookieAuthPopup", () => ({ default: () => null }));
vi.mock("./components/ApiKeyAuthModal", () => ({ default: () => null }));

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<AppShell><Outlet /></AppShell>}>
            <Route path="/apps" element={<Apps />} />
            <Route path="/agents" element={<Agents />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("shell routing", () => {
  it.each([
    ["/apps", "Apps"],
    ["/agents", "Agents"],
    ["/activity", "Activity"],
    ["/settings", "Settings"],
  ])("renders %s with its page title", async (path, title) => {
    renderAt(path);
    expect(await screen.findByRole("heading", { level: 1, name: title })).toBeInTheDocument();
  });

  it("keeps the sidebar mounted on every page", () => {
    renderAt("/apps");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });
});
