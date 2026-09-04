import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useConnectFlow } from "./useConnectFlow";
import type { IntegrationSummary } from "../api";

vi.mock("../api", () => ({
  startIntegrationAuth: vi.fn(),
  disconnectIntegration: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "dev@example.com" }, token: "t", isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

// The two auth popups mount heavyweight browser machinery; stand them in.
vi.mock("../components/CookieAuthPopup", () => ({ default: () => <div>cookie popup</div> }));
vi.mock("../components/ApiKeyAuthModal", () => ({ default: () => <div>api key modal</div> }));

import { startIntegrationAuth, disconnectIntegration } from "../api";

const OAUTH: IntegrationSummary = { name: "acme", version: "1.0.0", toolCount: 3, authType: "oauth2" };
const SELF_HOSTED: IntegrationSummary = {
  ...OAUTH,
  name: "demo-repo",
  instance: { label: "Instance URL", default: "https://example.com" },
};

function Harness({ integration }: { integration: IntegrationSummary }) {
  const { connect, disconnect, error, dialogs } = useConnectFlow();
  return (
    <div>
      <button onClick={() => connect(integration)}>do connect</button>
      <button onClick={() => disconnect(integration.name)}>do disconnect</button>
      {error && <p>err: {error}</p>}
      {dialogs}
    </div>
  );
}

function renderHarness(integration: IntegrationSummary) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Harness integration={integration} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useConnectFlow", () => {
  it("sends an oauth2 integration straight to its authorization URL", async () => {
    vi.mocked(startIntegrationAuth).mockResolvedValue({ type: "oauth2", url: "https://example.com/authorize" });
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { href: "", assign }, writable: true });

    renderHarness(OAUTH);
    fireEvent.click(screen.getByText("do connect"));

    await waitFor(() => expect(startIntegrationAuth).toHaveBeenCalledWith("acme", undefined));
  });

  it("asks for an instance URL first when the integration declares one", async () => {
    renderHarness(SELF_HOSTED);
    fireEvent.click(screen.getByText("do connect"));

    expect(await screen.findByLabelText("Instance URL")).toHaveValue("https://example.com");
    expect(startIntegrationAuth).not.toHaveBeenCalled();

    vi.mocked(startIntegrationAuth).mockResolvedValue({ type: "oauth2", url: "https://example.com/authorize" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() =>
      expect(startIntegrationAuth).toHaveBeenCalledWith("demo-repo", "https://example.com")
    );
  });

  it("confirms before disconnecting, and does nothing if the human cancels", async () => {
    renderHarness(OAUTH);
    fireEvent.click(screen.getByText("do disconnect"));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(disconnectIntegration).not.toHaveBeenCalled();
  });

  it("disconnects once confirmed", async () => {
    vi.mocked(disconnectIntegration).mockResolvedValue({ success: true });
    renderHarness(OAUTH);
    fireEvent.click(screen.getByText("do disconnect"));

    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(disconnectIntegration).toHaveBeenCalledWith("acme"));
  });

  it("surfaces a failure instead of swallowing it", async () => {
    vi.mocked(startIntegrationAuth).mockRejectedValue(new Error("Connect failed"));
    renderHarness(OAUTH);
    fireEvent.click(screen.getByText("do connect"));
    expect(await screen.findByText("err: Connect failed")).toBeInTheDocument();
  });
});
