import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Agents from "./Agents";

vi.mock("../api", () => ({
  fetchAgents: vi.fn(),
  revokeAgent: vi.fn(),
  getApiKeyStatus: vi.fn(),
}));

import { fetchAgents, revokeAgent, getApiKeyStatus } from "../api";

const NOW = Math.floor(Date.now() / 1000);

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Agents />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getApiKeyStatus).mockResolvedValue({ hasKey: true });
  vi.mocked(fetchAgents).mockResolvedValue({
    agents: [
      { client_id: "cli-1", client_name: "Test Agent", scopes: ["mcp"], connected_since: NOW - 7200, expires_at: NOW + 3600 },
      { client_id: "cli-2", scopes: [], connected_since: NOW - 60, expires_at: NOW + 3600 },
    ],
  });
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});

describe("Agents", () => {
  it("shows the MCP endpoint and a client config block", async () => {
    renderPage();
    expect(await screen.findByText(`${window.location.origin}/mcp`)).toBeInTheDocument();
    expect(screen.getByText(/"mcpServers"/)).toBeInTheDocument();
  });

  it("reports that a key exists and links to settings rather than managing it here", async () => {
    renderPage();
    expect(await screen.findByText("Key active")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage API key" })).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("button", { name: /Generate/ })).toBeNull();
  });

  it("says when no key exists yet", async () => {
    vi.mocked(getApiKeyStatus).mockResolvedValue({ hasKey: false });
    renderPage();
    expect(await screen.findByText("No key")).toBeInTheDocument();
  });

  it("lists connected agents with their id and connection age", async () => {
    renderPage();
    expect(await screen.findByText("Test Agent")).toBeInTheDocument();
    expect(screen.getByText("cli-1")).toBeInTheDocument();
    expect(screen.getByText("2h ago")).toBeInTheDocument();
  });

  it("falls back to the client id when an agent has no name", async () => {
    renderPage();
    await screen.findByText("Test Agent");
    // cli-2 has no client_name: its id stands in for the name cell too.
    expect(screen.getAllByText("cli-2").length).toBeGreaterThanOrEqual(1);
  });

  it("confirms before revoking, explaining that a live session may outlast it", async () => {
    vi.mocked(revokeAgent).mockResolvedValue({ revoked: 1 });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "Revoke Test Agent" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/access token/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(revokeAgent).toHaveBeenCalledWith("cli-1"));
  });

  it("says so when no agents are connected", async () => {
    vi.mocked(fetchAgents).mockResolvedValue({ agents: [] });
    renderPage();
    expect(await screen.findByText("No agents connected.")).toBeInTheDocument();
  });

  it("surfaces a revoke failure", async () => {
    vi.mocked(revokeAgent).mockRejectedValue(new Error("Revoke failed"));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Revoke Test Agent" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    expect(await screen.findByText("Revoke failed")).toBeInTheDocument();
  });
});
