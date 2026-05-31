import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerOAuthRoutes } from "../src/api/oauth-routes";
import { db } from "../src/db";

async function buildApp() {
  const app = Fastify();
  await registerOAuthRoutes(app);
  return app;
}

beforeEach(() => db.exec("DELETE FROM oauth_clients"));

describe("oauth well-known + register", () => {
  it("serves protected-resource metadata", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).resource).toMatch(/\/mcp$/);
  });

  it("serves authorization-server metadata", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).authorization_endpoint).toMatch(/\/authorize$/);
  });

  it("registers a client via DCR", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/register",
      payload: { client_name: "Claude Code", redirect_uris: ["http://127.0.0.1:33418/cb"] },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.client_id).toMatch(/.+/);
    expect(body.token_endpoint_auth_method).toBe("none");
  });

  it("rejects DCR without redirect_uris", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/register", payload: { client_name: "x" } });
    expect(res.statusCode).toBe(400);
  });
});
