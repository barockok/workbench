const API_URL = import.meta.env.VITE_API_URL || "";

function getHeaders(): HeadersInit {
  const token = localStorage.getItem("awb_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Auth header WITHOUT Content-Type — for bodyless requests. Fastify rejects a
// POST/DELETE that declares application/json but sends no body
// (FST_ERR_CTP_EMPTY_JSON_BODY).
function authHeaders(): HeadersInit {
  const token = localStorage.getItem("awb_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function fetchIntegrations() {
  const res = await fetch(`${API_URL}/api/integrations`, { headers: getHeaders() });
  if (res.status === 401) {
    localStorage.removeItem("awb_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

export interface InstanceConfig {
  label: string;
  placeholder?: string;
  default: string;
}

export interface ApiKeyField {
  key: string;
  label: string;
  description?: string;
  placeholder?: string;
  secret?: boolean;
  options?: string[];
  optional?: boolean;
  multiline?: boolean;
}

export interface IntegrationSummary {
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  categories?: string[];
  logo?: string;
  toolCount: number;
  configured?: boolean;
  authType?: string;
  // Present when the integration supports a self-hosted instance URL prompt.
  instance?: InstanceConfig;
  // Present for apikey integrations: the connect-time form field spec.
  apikeyFields?: ApiKeyField[];
}

export interface IntegrationDetail extends IntegrationSummary {
  authType: string;
  tools: { name: string; description: string }[];
}

export async function fetchIntegration(name: string): Promise<IntegrationDetail> {
  const res = await fetch(`${API_URL}/api/integrations/${name}`, { headers: getHeaders() });
  if (res.status === 401) {
    localStorage.removeItem("awb_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error("Failed to fetch integration");
  return res.json();
}

export async function fetchProviders(): Promise<{ providers: string[] }> {
  const res = await fetch(`${API_URL}/api/auth/providers`);
  if (!res.ok) return { providers: [] };
  return res.json();
}

export async function fetchAuthUrl(): Promise<{ url: string }> {
  const res = await fetch(`${API_URL}/api/auth/google`);
  if (!res.ok) throw new Error("SSO not configured");
  return res.json();
}

export async function fetchKeycloakAuthUrl(): Promise<{ url: string }> {
  const res = await fetch(`${API_URL}/api/auth/keycloak`);
  if (!res.ok) throw new Error("Keycloak SSO not configured");
  return res.json();
}

export async function fetchConnections() {
  const res = await fetch(`${API_URL}/api/connections`, { headers: getHeaders() });
  if (res.status === 401) {
    localStorage.removeItem("awb_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error("Failed to fetch connections");
  return res.json();
}

export async function disconnectIntegration(integration: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_URL}/api/connections/${integration}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || "Failed to disconnect");
  }
  return res.json();
}

export interface ConnectedAgent {
  client_id: string;
  client_name?: string;
  scopes: string[];
  connected_since: number;
  expires_at: number;
}

export async function fetchAgents(): Promise<{ agents: ConnectedAgent[] }> {
  const res = await fetch(`${API_URL}/api/agents`, { headers: getHeaders() });
  if (res.status === 401) {
    localStorage.removeItem("awb_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error("Failed to fetch agents");
  return res.json();
}

export async function revokeAgent(clientId: string): Promise<{ revoked: number }> {
  const res = await fetch(`${API_URL}/api/agents/${encodeURIComponent(clientId)}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || "Failed to revoke agent");
  }
  return res.json();
}

export type StartAuthResult =
  | {
      type: "cookie";
      status: "login_required";
      cdpProxyUrl: string;
      cdpToken: string;
      loginUrl: string;
    }
  | { type: "oauth2"; url: string }
  | { type: "apikey"; fields: ApiKeyField[] }
  | { type: "manual"; state: string };

export async function startIntegrationAuth(
  integration: string,
  instanceUrl?: string
): Promise<StartAuthResult> {
  const qs = instanceUrl ? `?instanceUrl=${encodeURIComponent(instanceUrl)}` : "";
  const res = await fetch(`${API_URL}/api/auth/${integration}${qs}`, { headers: getHeaders() });
  if (res.status === 401) {
    localStorage.removeItem("awb_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || "Failed to start integration auth");
  }
  const data = await res.json();
  if (data.type) return data as StartAuthResult;
  if (data.state) return { type: "manual", state: data.state };
  throw new Error("Unknown auth response");
}

/** @deprecated use startIntegrationAuth */
export const startCookieAuth = startIntegrationAuth;

// Submit the apikey connect form: the user-entered field values (credential +
// any config such as region) are stored server-side as the connection.
export async function submitApiKey(
  integration: string,
  values: Record<string, string>
): Promise<{ success: boolean }> {
  const res = await fetch(`${API_URL}/api/auth/apikey/${integration}`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ values }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error || "Failed to connect");
  }
  return res.json();
}

export async function captureCookies(integration: string): Promise<{ success: boolean; cookieCount: number }> {
  const res = await fetch(`${API_URL}/api/auth/cookie/${integration}/capture`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to capture cookies");
  return res.json();
}

export async function cancelCookieAuth(integration: string): Promise<void> {
  await fetch(`${API_URL}/api/auth/cookie/${integration}/cancel`, {
    method: "POST",
    headers: authHeaders(),
  });
}

export type RedeemResult =
  | { type: "cookie"; integration: string; loginUrl: string; cdpProxyUrl: string; sessionId: string; cdpToken: string }
  | { type: "oauth2"; url: string }
  | { type: "browser"; cdpProxyUrl: string; sessionId: string; cdpToken: string };

export type ConnectLinkCode =
  | "AUTH_REQUIRED" | "LINK_INVALID" | "LINK_CONSUMED" | "ACCOUNT_MISMATCH" | "UNKNOWN";

export class ConnectLinkError extends Error {
  code: ConnectLinkCode;
  integration?: string;
  constructor(code: ConnectLinkCode, integration?: string) {
    super(code);
    this.code = code;
    this.integration = integration;
  }
}

async function connectLinkError(res: Response): Promise<ConnectLinkError> {
  const body = await res.json().catch(() => ({}));
  const known: ConnectLinkCode[] = ["AUTH_REQUIRED", "LINK_INVALID", "LINK_CONSUMED", "ACCOUNT_MISMATCH"];
  const code = known.includes(body.error) ? (body.error as ConnectLinkCode) : "UNKNOWN";
  return new ConnectLinkError(code, body.integration);
}

export async function redeemConnectLink(token: string): Promise<RedeemResult> {
  const res = await fetch(`${API_URL}/api/connect/redeem`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw await connectLinkError(res);
  return res.json();
}

export async function connectCapture(token: string) {
  const res = await fetch(`${API_URL}/api/connect/capture`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw await connectLinkError(res);
  return res.json() as Promise<{ success: boolean; cookieCount: number }>;
}

// Export a cookie-auth session bundle (to move a working capture to another
// workbench whose egress IP the provider would block).
export async function exportSession(integration: string): Promise<{ integration: string; session: unknown }> {
  const res = await fetch(`${API_URL}/api/integrations/${integration}/session/export`, { headers: getHeaders() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Export failed");
  return res.json();
}

// Import a cookie-auth session bundle captured elsewhere.
export async function importSession(integration: string, session: unknown): Promise<{ success: boolean; cookieCount: number }> {
  const res = await fetch(`${API_URL}/api/integrations/${integration}/session/import`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ session }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Import failed");
  return res.json();
}

export async function getApiKeyStatus(): Promise<{ hasKey: boolean }> {
  const res = await fetch(`${API_URL}/api/keys`, { headers: getHeaders() });
  if (!res.ok) throw new Error("Failed to read key status");
  return res.json();
}

export async function mintApiKey(): Promise<{ apiKey: string }> {
  const res = await fetch(`${API_URL}/api/keys`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to mint key");
  return res.json();
}

export async function revealApiKey(): Promise<{ apiKey: string }> {
  const res = await fetch(`${API_URL}/api/keys/reveal`, { headers: getHeaders() });
  if (!res.ok) throw new Error("Failed to reveal key");
  return res.json();
}

export async function revokeApiKey(): Promise<{ success: boolean }> {
  const res = await fetch(`${API_URL}/api/keys`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to revoke key");
  return res.json();
}

export async function resetBrowserSession(): Promise<{ success: boolean }> {
  const res = await fetch(`${API_URL}/api/browser-session/reset`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).error || "Reset failed";
    throw new Error(msg);
  }
  return res.json();
}

// User-initiated browser live view. Optional url navigates the warm session
// there first. Returns a short-lived /browser?t= link to open in a new tab.
export async function openBrowserLiveUrl(url?: string): Promise<{ url: string }> {
  const res = await fetch(`${API_URL}/api/browser-session/live-url`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(url ? { url } : {}),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({}))).error || "Failed to open live view";
    throw new Error(msg);
  }
  return res.json();
}

export async function fetchMe() {
  const res = await fetch(`${API_URL}/api/auth/me`, { headers: getHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export async function logout() {
  await fetch(`${API_URL}/api/auth/logout`, {
    method: "POST",
    headers: getHeaders(),
  });
  localStorage.removeItem("awb_token");
}
