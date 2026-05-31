import { describe, it, expect, beforeEach } from "vitest";
import { registerClient, getClient } from "../src/auth/oauth-server/clients";
import { db } from "../src/db";

beforeEach(() => db.exec("DELETE FROM oauth_clients"));

describe("oauth client store", () => {
  it("registers a public client and reads it back", () => {
    const c = registerClient({ client_name: "Claude Code", redirect_uris: ["http://127.0.0.1:33418/callback"] });
    expect(c.client_id).toMatch(/.+/);
    const got = getClient(c.client_id);
    expect(got?.redirect_uris).toEqual(["http://127.0.0.1:33418/callback"]);
  });

  it("requires at least one redirect_uri", () => {
    expect(() => registerClient({ redirect_uris: [] })).toThrow();
  });

  it("returns undefined for unknown client", () => {
    expect(getClient("nope")).toBeUndefined();
  });
});
