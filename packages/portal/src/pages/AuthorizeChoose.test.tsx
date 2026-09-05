import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AuthorizeChoose from "./AuthorizeChoose";

vi.mock("../api", () => ({
  SERVER_URL: "http://localhost:3000",
  fetchProviders: vi.fn(),
  fetchAuthUrl: vi.fn(),
  fetchKeycloakAuthUrl: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: null, token: null, isLoading: false, login: vi.fn(), logout: vi.fn() }),
}));

import { fetchProviders } from "../api";

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/authorize/choose" element={<AuthorizeChoose />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchProviders).mockResolvedValue({ providers: ["google"] });
});

describe("AuthorizeChoose", () => {
  it("centres the card instead of leaving it in the empty half of the login grid", async () => {
    const { container } = renderPage("/authorize/choose?ticket=tkt-1");
    await screen.findByRole("heading", { name: "Approve agent access" });
    // .login-shell is a two-column grid whose first column holds the login
    // artwork — which this page never renders, so the card sat off to one side.
    expect(container.querySelector(".login-shell")).toBeNull();
    expect(container.querySelector(".page-center")).toBeInTheDocument();
  });

  it("centres the invalid-link message too", () => {
    const { container } = renderPage("/authorize/choose");
    expect(screen.getByText(/Missing or invalid link/i)).toBeInTheDocument();
    expect(container.querySelector(".login-shell")).toBeNull();
    expect(container.querySelector(".page-center")).toBeInTheDocument();
  });

  it("carries the workbench lockup, which the login artwork used to provide", async () => {
    const { container } = renderPage("/authorize/choose?ticket=tkt-1");
    await screen.findByRole("heading", { name: "Approve agent access" });
    expect(container.querySelector(".brand-lockup")).toBeInTheDocument();
  });

  it("still offers the provider it was given", async () => {
    renderPage("/authorize/choose?ticket=tkt-1");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Continue with Google/i })).toBeInTheDocument()
    );
  });
});
