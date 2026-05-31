import { config } from "../../config";

const BASE = config.SERVER_PUBLIC_URL;

export function protectedResourceMetadata() {
  return {
    resource: `${BASE}/mcp`,
    authorization_servers: [BASE],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  };
}

export function authorizationServerMetadata() {
  return {
    issuer: BASE,
    authorization_endpoint: `${BASE}/authorize`,
    token_endpoint: `${BASE}/token`,
    registration_endpoint: `${BASE}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  };
}
