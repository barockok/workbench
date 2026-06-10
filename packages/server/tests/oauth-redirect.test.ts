import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { registerOAuthRedirectRoute, oauthRedirectPage } from "../src/api/oauth-redirect";

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify();
  await registerOAuthRedirectRoute(app);
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

describe("GET /oauth/callback", () => {
  it("returns 200 text/html with the copy UI", async () => {
    const res = await app.inject({ method: "GET", url: "/oauth/callback?code=abc&state=xyz" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    const body = res.body;
    // a readonly field to hold the URL + a copy button
    expect(body).toMatch(/id="url"/);
    expect(body).toMatch(/id="copy"/);
    // it reads the full location and assigns via .value (not innerHTML)
    expect(body).toContain("location.href");
    expect(body).toMatch(/\.value\s*=/);
  });

  it("sets hardening headers", async () => {
    const res = await app.inject({ method: "GET", url: "/oauth/callback" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'"
    );
    // can't be framed (clickjacking the Copy button); auth code never leaks via Referer
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("never sinks the URL through an HTML-parsing sink", () => {
    // The page must place the URL into the DOM via .value/textContent only, so a
    // crafted ?error=<script> in the redirect lands as inert text, never markup.
    const html = oauthRedirectPage();
    // no HTML-parsing sinks — match assignment/call usage, not prose
    expect(html).not.toMatch(/\.innerHTML\s*=/);
    expect(html).not.toMatch(/document\.write\s*\(/);
    expect(html).not.toMatch(/insertAdjacentHTML/);
    expect(html).not.toMatch(/\beval\s*\(/);
    expect(html).not.toMatch(/\bFunction\s*\(/);
    // and the URL is read from location and written to the field's value
    expect(html).toContain("location.href");
    expect(html).toMatch(/url\.value\s*=/);
  });
});
