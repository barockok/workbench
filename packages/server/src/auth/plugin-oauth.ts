import { config } from "../config";
import { registry } from "../plugins/registry";
import { createAuthState, verifyAuthState, exchangeCode } from "./oauth";
import { storeToken } from "./tokens";

interface ClientCreds {
  clientId: string;
  clientSecret: string;
}

/**
 * Per-integration OAuth client credentials.
 *
 * Today only Google plugin is wired. Lookup falls back to the SSO client
 * if the plugin-specific pair is unset — this is allowed but logged as a
 * warning at startup, since SSO and plugin grants live on the same OAuth
 * app and share consent screen scope lists.
 *
 * To add a new provider: extend the switch with its env var pair.
 */
/**
 * Each plugin owns its own OAuth client — no sharing, no fallback.
 *
 * Env var naming convention:
 *   plugin name `google-gmail` → `GOOGLE_GMAIL_CLIENT_ID` / `_SECRET`
 *   plugin name `atlassian-jira` → `ATLASSIAN_JIRA_CLIENT_ID` / `_SECRET`
 *
 * Transform: kebab → upper snake.
 */
export function envVarPrefix(integration: string): string {
  return integration.replace(/-/g, "_").toUpperCase();
}

export function getPluginOAuthCreds(integration: string): ClientCreds | null {
  const prefix = envVarPrefix(integration);
  const id = process.env[`${prefix}_CLIENT_ID`];
  const secret = process.env[`${prefix}_CLIENT_SECRET`];
  if (!id || !secret) return null;
  return { clientId: id, clientSecret: secret };
}

export function getPluginCallbackUrl(integration: string): string {
  return `${config.SERVER_PUBLIC_URL}/api/auth/plugin/${integration}/callback`;
}

/**
 * Provider-specific authorization URL parameters.
 * Google needs access_type=offline + prompt=consent to issue refresh tokens.
 */
function providerExtraParams(integration: string): Record<string, string> {
  // Google needs access_type=offline + prompt=consent for refresh tokens.
  if (integration.startsWith("google-")) {
    return {
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    };
  }
  return {};
}

export function buildPluginAuthUrl(userId: string, integration: string): string {
  const integ = registry.getIntegration(integration);
  if (!integ) throw new Error(`Integration not found: ${integration}`);
  if (integ.auth.type !== "oauth2") {
    throw new Error(`Integration ${integration} is not oauth2`);
  }

  const creds = getPluginOAuthCreds(integration);
  if (!creds) {
    throw new Error(`OAuth client not configured for ${integration}`);
  }

  const state = createAuthState(userId, integration);
  const url = new URL(integ.auth.authorizationUrl);
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", getPluginCallbackUrl(integration));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", integ.auth.scopes.join(" "));
  url.searchParams.set("state", state);
  for (const [k, v] of Object.entries(providerExtraParams(integration))) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

export async function handlePluginCallback(
  integration: string,
  code: string,
  state: string
): Promise<{ userId: string }> {
  const authState = verifyAuthState(state);
  if (!authState || authState.integration !== integration) {
    throw new Error("Invalid state");
  }

  const integ = registry.getIntegration(integration);
  if (!integ || integ.auth.type !== "oauth2") {
    throw new Error("Integration not configured for OAuth");
  }

  const creds = getPluginOAuthCreds(integration);
  if (!creds) {
    throw new Error(`OAuth client not configured for ${integration}`);
  }

  const tokens = await exchangeCode(
    integ.auth.tokenUrl,
    creds.clientId,
    creds.clientSecret,
    code,
    getPluginCallbackUrl(integration)
  );

  const expiresAt = tokens.expires_in
    ? Math.floor(Date.now() / 1000) + tokens.expires_in
    : undefined;

  storeToken(authState.userId, integration, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt,
    scopes: integ.auth.scopes.join(" "),
  });

  return { userId: authState.userId };
}
