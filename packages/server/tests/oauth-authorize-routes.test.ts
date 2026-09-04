import { describe, it, expect, beforeEach, vi } from "vitest";
import Fastify from "fastify";

vi.mock("../src/config", () => ({
  config: {
    GOOGLE_CLIENT_ID: "test-gid", GOOGLE_CLIENT_SECRET: "test-gsecret",
    PORTAL_URL: "http://localhost:5173", SERVER_PUBLIC_URL: "http://localhost:3000",
    SESSION_SECRET: "test-session-secret-32-chars-long!!", NODE_ENV: "test",
    DATABASE_URL: "./data/tokens.db", OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600,
  },
}));

import { registerOAuthRoutes } from "../src/api/oauth-routes";
import { registerClient } from "../src/auth/oauth-server/clients";
import { db } from "../src/db";

beforeEach(async () => {
  await db.exec("DELETE FROM oauth_clients");
  await db.exec("DELETE FROM pending_auth");
});

async function app() { const a = Fastify(); await registerOAuthRoutes(a); return a; }

describe("/authorize", () => {
  it("302s to the portal's provider-choice landing page and stores the pending request", async () => {
    const c = await registerClient({ redirect_uris: ["http://127.0.0.1:33418/cb"] });
    const a = await app();
    const qs = new URLSearchParams({
      response_type: "code", client_id: c.client_id, redirect_uri: "http://127.0.0.1:33418/cb",
      code_challenge: "abc", code_challenge_method: "S256", scope: "mcp", state: "xyz",
    });
    const res = await a.inject({ method: "GET", url: `/authorize?${qs}` });
    expect(res.statusCode).toBe(302);
    const location = new URL(res.headers.location as string);
    expect(location.origin + location.pathname).toBe("http://localhost:5173/authorize/choose");
    // a pending authorize row was stored, and its ticket is the one handed to the browser
    const row = await db.get<{ state: string }>(
      "SELECT state FROM pending_auth WHERE integration = '__oauth_authorize__'"
    );
    expect(row?.state).toBe(location.searchParams.get("ticket"));
  });

  it("still sets the login-CSRF binding cookie on the way to the choice page", async () => {
    const c = await registerClient({ redirect_uris: ["http://127.0.0.1:33418/cb"] });
    const a = await app();
    const qs = new URLSearchParams({
      response_type: "code", client_id: c.client_id, redirect_uri: "http://127.0.0.1:33418/cb",
      code_challenge: "abc", code_challenge_method: "S256",
    });
    const res = await a.inject({ method: "GET", url: `/authorize?${qs}` });
    expect(res.headers["set-cookie"]).toMatch(/^awb_oauth_binding=/);
  });

  it("400s on an unregistered client", async () => {
    const a = await app();
    const qs = new URLSearchParams({
      response_type: "code", client_id: "nope", redirect_uri: "http://127.0.0.1/cb",
      code_challenge: "abc", code_challenge_method: "S256",
    });
    const res = await a.inject({ method: "GET", url: `/authorize?${qs}` });
    expect(res.statusCode).toBe(400);
  });

  it("400s when redirect_uri is not registered for the client", async () => {
    const c = await registerClient({ redirect_uris: ["http://127.0.0.1:33418/cb"] });
    const a = await app();
    const qs = new URLSearchParams({
      response_type: "code", client_id: c.client_id, redirect_uri: "http://evil/cb",
      code_challenge: "abc", code_challenge_method: "S256",
    });
    const res = await a.inject({ method: "GET", url: `/authorize?${qs}` });
    expect(res.statusCode).toBe(400);
  });

  it("400s without PKCE S256", async () => {
    const c = await registerClient({ redirect_uris: ["http://127.0.0.1:33418/cb"] });
    const a = await app();
    const qs = new URLSearchParams({
      response_type: "code", client_id: c.client_id, redirect_uri: "http://127.0.0.1:33418/cb",
    });
    const res = await a.inject({ method: "GET", url: `/authorize?${qs}` });
    expect(res.statusCode).toBe(400);
  });
});
