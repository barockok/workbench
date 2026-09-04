import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Home from "./Home";

vi.mock("../api", () => ({
  fetchStats: vi.fn(),
  fetchActivity: vi.fn(),
  fetchIntegrations: vi.fn(),
  fetchConnections: vi.fn(),
}));

import { fetchStats, fetchActivity, fetchIntegrations, fetchConnections } from "../api";

const NOW = Math.floor(Date.now() / 1000);

const INTEGRATIONS = [
  { name: "acme", displayName: "Acme", version: "1.0.0", toolCount: 4 },
  { name: "demo-repo", displayName: "Demo Repo", version: "1.0.0", toolCount: 9 },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Home />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchIntegrations).mockResolvedValue({ integrations: INTEGRATIONS });
  vi.mocked(fetchConnections).mockResolvedValue({ connections: [{ name: "acme", connected: true }] });
  vi.mocked(fetchStats).mockResolvedValue({
    stored: true, window_days: 30, tool_calls: 1284, success_rate: 0.97, most_used_integration: "acme",
  });
  vi.mocked(fetchActivity).mockResolvedValue({
    stored: true,
    events: [{ id: 1, integration: "acme", tool: "acme_search", action: "EXECUTE", success: true, error: null, duration_ms: 412, created_at: NOW }],
    next_cursor: null,
  });
});

describe("Home", () => {
  // Read a stat by its label rather than by its value: "Acme" and "1" both
  // appear elsewhere on this page, so a bare getByText would be ambiguous or,
  // worse, pass against the wrong element.
  function statValue(label: string): string {
    const cell = screen.getByText(label).closest(".ui-stat");
    return cell?.querySelector(".ui-stat-value")?.textContent ?? "";
  }

  it("shows the four headline numbers", async () => {
    renderPage();
    await screen.findByText("1,284");
    expect(statValue("Tool calls (30d)")).toBe("1,284");
    expect(statValue("Success rate (30d)")).toBe("97%");
    expect(statValue("Most used app")).toBe("Acme");
  });

  it("counts connected apps from the connections endpoint", async () => {
    renderPage();
    // Wait for the connected app itself, not the always-present label — the
    // label renders before /api/connections and /api/integrations resolve,
    // so waiting on it would read the pre-load default instead of "1".
    await screen.findByRole("link", { name: "Acme" });
    expect(statValue("Connected apps")).toBe("1");
  });

  it("lists connected apps and links to the registry", async () => {
    renderPage();
    expect(await screen.findByText("4 tools")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse all" })).toHaveAttribute("href", "/apps");
  });

  it("invites the human to connect something when nothing is connected", async () => {
    vi.mocked(fetchConnections).mockResolvedValue({ connections: [] });
    renderPage();
    expect(await screen.findByText("No apps connected yet.")).toBeInTheDocument();
  });

  it("shows the MCP endpoint and points at the agents page", async () => {
    renderPage();
    expect(await screen.findByText(`${window.location.origin}/mcp`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up an agent" })).toHaveAttribute("href", "/agents");
  });

  it("shows recent activity with a link to the full log", async () => {
    renderPage();
    expect(await screen.findByText("acme_search")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all" })).toHaveAttribute("href", "/activity");
  });

  it("dashes out the activity-derived numbers when nothing is stored", async () => {
    vi.mocked(fetchStats).mockResolvedValue({
      stored: false, window_days: 30, tool_calls: 0, success_rate: null, most_used_integration: null,
    });
    vi.mocked(fetchActivity).mockResolvedValue({ stored: false, events: [], next_cursor: null });
    renderPage();

    // Wait for the unstored note itself, not the always-present label — the
    // label renders before /api/stats resolves, so waiting on it would read
    // the pre-load default instead of the settled "stored: false" state.
    await screen.findAllByText(/somewhere other than its database/);
    // The three activity-derived cells go blank; the connected count does not,
    // because it comes from /api/connections rather than the audit log.
    expect(statValue("Tool calls (30d)")).toBe("—");
    expect(statValue("Success rate (30d)")).toBe("—");
    expect(statValue("Most used app")).toBe("—");
    expect(statValue("Connected apps")).toBe("1");
    expect(screen.getAllByText(/somewhere other than its database/).length).toBeGreaterThan(0);
  });

  it("reports a null success rate as a dash rather than 0%", async () => {
    vi.mocked(fetchStats).mockResolvedValue({
      stored: true, window_days: 30, tool_calls: 0, success_rate: null, most_used_integration: null,
    });
    renderPage();
    await screen.findByText("Success rate (30d)");
    expect(statValue("Success rate (30d)")).toBe("—");
    expect(statValue("Tool calls (30d)")).toBe("0");
  });
});
