import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { FastifyInstance } from "fastify";

let tmp: string;

vi.mock("../../src/jots/dir", () => ({ jotsRoot: () => tmp }));
vi.mock("../../src/config", () => ({
  config: { JOTS_MAX_BYTES: 1_000_000, SERVER_PUBLIC_URL: "https://wb.test", SESSION_SECRET: "test-secret-32-chars-long-xxxxxx", NODE_ENV: "test" },
}));

import { registerJotRoutes } from "../../src/jots/routes";
import { deployJot, readManifest } from "../../src/jots/store";
import { hashPassword, makeToken, cookieName } from "../../src/jots/auth";

let app: FastifyInstance;

beforeEach(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jots-routes-"));
  app = Fastify();
  await registerJotRoutes(app);
  await app.ready();
});
afterEach(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("jots/routes", () => {
  it("serves a public jot", async () => {
    deployJot({ name: "pub", owner: "u1", access: "public", files: [{ path: "index.html", content: "<h1>hi</h1>" }] });
    const res = await app.inject({ method: "GET", url: "/j/pub/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("hi");
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("404s an unknown jot and an invalid name", async () => {
    expect((await app.inject({ method: "GET", url: "/j/nope/" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/j/Bad/" })).statusCode).toBe(404);
  });

  it("never serves the manifest", async () => {
    deployJot({ name: "pub", owner: "u1", access: "public", files: [{ path: "index.html", content: "x" }] });
    expect((await app.inject({ method: "GET", url: "/j/pub/jot.json" })).statusCode).toBe(404);
  });

  it("blocks traversal", async () => {
    deployJot({ name: "pub", owner: "u1", access: "public", files: [{ path: "index.html", content: "x" }] });
    const res = await app.inject({ method: "GET", url: "/j/pub/..%2f..%2fetc%2fpasswd" });
    expect([403, 404]).toContain(res.statusCode);
  });

  it("shows the unlock page for an HTML request to a password jot", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "index.html", content: "secret" }] });
    const res = await app.inject({ method: "GET", url: "/j/sec/", headers: { accept: "text/html" } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("Unlock");
    expect(res.body).not.toContain("secret");
  });

  it("401s a non-HTML request to a locked password jot", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "data.json", content: "{}" }] });
    const res = await app.inject({ method: "GET", url: "/j/sec/data.json", headers: { accept: "application/json" } });
    expect(res.statusCode).toBe(401);
  });

  it("unlocks with the right password and sets a scoped cookie", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "index.html", content: "secret" }] });
    const bad = await app.inject({ method: "POST", url: "/j/sec/__auth", payload: "password=nope", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/j/sec/__auth", payload: "password=pw", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(ok.statusCode).toBe(302);
    const setCookie = String(ok.headers["set-cookie"]);
    expect(setCookie).toContain("jot_sec=");
    expect(setCookie).toContain("Path=/j/sec/");
  });

  it("serves a password jot when a valid cookie is present", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "index.html", content: "secret" }] });
    const hash = readManifest("sec")!.hash!;
    const token = makeToken("test-secret-32-chars-long-xxxxxx", "sec", hash);
    const res = await app.inject({ method: "GET", url: "/j/sec/", headers: { cookie: `${cookieName("sec")}=${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("secret");
  });

  it("rejects a cookie minted for a different jot", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "index.html", content: "secret" }] });
    const hash = readManifest("sec")!.hash!;
    const wrong = makeToken("test-secret-32-chars-long-xxxxxx", "other", hash);
    const res = await app.inject({ method: "GET", url: "/j/sec/", headers: { accept: "application/json", cookie: `jot_sec=${wrong}` } });
    expect(res.statusCode).toBe(401);
  });

  it("invalidates an unlock cookie after the jot password is rotated", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("old"), files: [{ path: "index.html", content: "secret" }] });
    const oldHash = readManifest("sec")!.hash!;
    const token = makeToken("test-secret-32-chars-long-xxxxxx", "sec", oldHash);
    // Cookie works under the original password.
    let res = await app.inject({ method: "GET", url: "/j/sec/", headers: { cookie: `${cookieName("sec")}=${token}` } });
    expect(res.statusCode).toBe(200);
    // Owner re-deploys with a new password → old cookie must stop working.
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("new"), files: [{ path: "index.html", content: "secret" }] });
    res = await app.inject({ method: "GET", url: "/j/sec/", headers: { accept: "application/json", cookie: `${cookieName("sec")}=${token}` } });
    expect(res.statusCode).toBe(401);
  });

  it("keeps two password jots independently authorized in one session", async () => {
    deployJot({ name: "alpha", owner: "u1", access: "password", passwordHash: hashPassword("a"), files: [{ path: "index.html", content: "ALPHA" }] });
    deployJot({ name: "beta", owner: "u1", access: "password", passwordHash: hashPassword("b"), files: [{ path: "index.html", content: "BETA" }] });
    const tAlpha = makeToken("test-secret-32-chars-long-xxxxxx", "alpha", readManifest("alpha")!.hash!);
    // Both cookies present (same browser). Each is Path-scoped + name+hash bound.
    const bothCookies = `${cookieName("alpha")}=${tAlpha}`;
    // alpha authorized.
    const a = await app.inject({ method: "GET", url: "/j/alpha/", headers: { cookie: bothCookies } });
    expect(a.statusCode).toBe(200);
    expect(a.body).toContain("ALPHA");
    // beta still locked — alpha's cookie does nothing for beta.
    const b = await app.inject({ method: "GET", url: "/j/beta/", headers: { accept: "application/json", cookie: bothCookies } });
    expect(b.statusCode).toBe(401);
  });

  it("redirects /j/:name to /j/:name/", async () => {
    deployJot({ name: "pub", owner: "u1", access: "public", files: [{ path: "index.html", content: "x" }] });
    const res = await app.inject({ method: "GET", url: "/j/pub" });
    expect(res.statusCode).toBe(301);
    expect(res.headers["location"]).toBe("/j/pub/");
  });

  it("sets sandbox CSP + hardening headers on served jots", async () => {
    deployJot({ name: "pub", owner: "u1", access: "public", files: [{ path: "index.html", content: "<h1>hi</h1>" }] });
    const res = await app.inject({ method: "GET", url: "/j/pub/" });
    expect(res.headers["content-security-policy"]).toBe("sandbox allow-scripts allow-forms");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it("sets sandbox CSP on the unlock page too", async () => {
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "index.html", content: "secret" }] });
    const res = await app.inject({ method: "GET", url: "/j/sec/", headers: { accept: "text/html" } });
    expect(res.headers["content-security-policy"]).toContain("sandbox");
  });

  it("does not throw when a urlencoded parser is already registered (boot order)", async () => {
    const a = Fastify();
    a.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_r, b, d) => d(null, b));
    await expect(registerJotRoutes(a)).resolves.not.toThrow();
    await a.close();
  });

  it("unlocks when an OAuth-style object body parser won registration (boot order)", async () => {
    // Mirror the real boot order: the OAuth route group registers a urlencoded
    // parser that yields an OBJECT, so the jot string parser is skipped and
    // __auth sees req.body as an object — password jots must still unlock.
    const a = Fastify();
    a.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_r, b, d) => d(null, Object.fromEntries(new URLSearchParams(b as string)))
    );
    await registerJotRoutes(a);
    await a.ready();
    deployJot({ name: "sec", owner: "u1", access: "password", passwordHash: hashPassword("pw"), files: [{ path: "index.html", content: "secret" }] });
    const bad = await a.inject({ method: "POST", url: "/j/sec/__auth", payload: "password=nope", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(bad.statusCode).toBe(401);
    const ok = await a.inject({ method: "POST", url: "/j/sec/__auth", payload: "password=pw", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(ok.statusCode).toBe(302);
    expect(String(ok.headers["set-cookie"])).toContain("jot_sec=");
    await a.close();
  });
});
