import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ConnectResult from "./ConnectResult";

vi.mock("../api", () => ({
  fetchIntegrations: vi.fn(),
}));

import { fetchIntegrations } from "../api";

const INTEGRATIONS = [
  { name: "acme", displayName: "Acme", version: "1.0.0", toolCount: 4, logo: "/logos/acme.svg" },
  { name: "demo-repo", displayName: "Demo Repo", version: "2.1.0", toolCount: 9 },
];

function renderPage(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/connected/:integration" element={<ConnectResult />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  vi.mocked(fetchIntegrations).mockResolvedValue({ integrations: INTEGRATIONS });
});

describe("ConnectResult", () => {
  it("names the integration and shows its logo on success", async () => {
    renderPage("/connected/acme?status=ok");
    await waitFor(() => expect(screen.getByRole("img", { name: /Acme logo/i })).toBeInTheDocument());
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });

  it("falls back to the raw name and the cog mark for an integration the registry doesn't know", async () => {
    renderPage("/connected/mystery?status=ok");
    await waitFor(() => expect(screen.getByText("mystery")).toBeInTheDocument());
    expect(screen.queryByRole("img", { name: /logo/i })).not.toBeInTheDocument();
    expect(document.querySelector(".integ-logo-fallback")).toBeInTheDocument();
  });

  it("tells the human the provider consent was declined", async () => {
    renderPage("/connected/acme?status=denied");
    await waitFor(() => expect(screen.getByText("Connection cancelled")).toBeInTheDocument());
    expect(screen.getByText(/nothing was saved/i)).toBeInTheDocument();
  });

  it("tells the human the link expired", async () => {
    renderPage("/connected/acme?status=expired");
    await waitFor(() => expect(screen.getByText("Connect link expired")).toBeInTheDocument());
  });

  it("reports a generic failure", async () => {
    renderPage("/connected/acme?status=failed");
    await waitFor(() => expect(screen.getByText("Connection failed")).toBeInTheDocument());
  });

  it("treats an unknown or missing status as a failure rather than a success", async () => {
    renderPage("/connected/acme");
    await waitFor(() => expect(screen.getByText("Connection failed")).toBeInTheDocument());
    expect(screen.queryByText("Connected")).not.toBeInTheDocument();
  });

  it("carries the workbench lockup, since the page sits outside the app shell", async () => {
    const { container } = renderPage("/connected/acme?status=ok");
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());
    expect(container.querySelector(".brand-lockup")).toBeInTheDocument();
  });

  it("tints the card green on success so the outcome reads before the words do", async () => {
    const { container } = renderPage("/connected/acme?status=ok");
    await waitFor(() => expect(screen.getByText("Connected")).toBeInTheDocument());
    expect(container.querySelector(".connect-result-card")).toHaveClass("is-ok");
  });

  it.each(["denied", "expired", "failed"])("leaves the %s card untinted", async (status) => {
    const { container } = renderPage(`/connected/acme?status=${status}`);
    await waitFor(() => expect(container.querySelector(".connect-result-card")).toBeInTheDocument());
    expect(container.querySelector(".connect-result-card")).not.toHaveClass("is-ok");
  });

  it("offers a way into the portal even when told to close the tab", async () => {
    sessionStorage.setItem("awb_connect_origin", "link");
    renderPage("/connected/acme?status=ok");
    const dash = await screen.findByRole("link", { name: /workbench/i });
    expect(dash).toHaveAttribute("href", "/");
  });

  it("offers the dashboard alongside the way back to the app", async () => {
    renderPage("/connected/acme?status=ok");
    expect(await screen.findByRole("link", { name: /back to acme/i })).toHaveAttribute("href", "/apps/acme");
    expect(screen.getByRole("link", { name: /workbench/i })).toHaveAttribute("href", "/");
  });

  it("tells an agent-initiated visitor to return to their agent, and clears the marker", async () => {
    sessionStorage.setItem("awb_connect_origin", "link");
    renderPage("/connected/acme?status=ok");
    await waitFor(() => expect(screen.getByText(/close this tab/i)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Acme/i })).not.toBeInTheDocument();
    expect(sessionStorage.getItem("awb_connect_origin")).toBeNull();
  });

  it("offers a way back into the portal when the visit did not come from a link", async () => {
    renderPage("/connected/acme?status=ok");
    const back = await screen.findByRole("link", { name: /back to acme/i });
    expect(back).toHaveAttribute("href", "/apps/acme");
    expect(screen.queryByText(/close this tab/i)).not.toBeInTheDocument();
  });

  it("still offers the way back when the connection failed", async () => {
    renderPage("/connected/acme?status=failed");
    const back = await screen.findByRole("link", { name: /back to acme/i });
    expect(back).toHaveAttribute("href", "/apps/acme");
  });
});
