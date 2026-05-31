import { describe, it, expect } from "vitest";
import { protectedResourceMetadata, authorizationServerMetadata } from "../src/auth/oauth-server/metadata";

describe("oauth metadata", () => {
  it("PRM points to this server as the auth server and lists the resource", () => {
    const prm = protectedResourceMetadata();
    expect(prm.resource).toMatch(/\/mcp$/);
    expect(prm.authorization_servers.length).toBe(1);
  });

  it("AS metadata advertises code grant + S256 + DCR + public clients", () => {
    const as = authorizationServerMetadata();
    expect(as.response_types_supported).toContain("code");
    expect(as.code_challenge_methods_supported).toContain("S256");
    expect(as.grant_types_supported).toEqual(expect.arrayContaining(["authorization_code", "refresh_token"]));
    expect(as.registration_endpoint).toMatch(/\/register$/);
    expect(as.token_endpoint_auth_methods_supported).toContain("none");
  });
});
