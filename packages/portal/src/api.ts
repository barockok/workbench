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

export interface IntegrationSummary {
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  categories?: string[];
  logo?: string;
  toolCount: number;
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

export async function fetchAuthUrl(): Promise<{ url: string }> {
  const res = await fetch(`${API_URL}/api/auth/google`);
  if (!res.ok) throw new Error("SSO not configured");
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

export type StartAuthResult =
  | {
      type: "cookie";
      sessionId: string;
      cdpProxyUrl: string;
      cdpToken: string;
      loginUrl: string;
    }
  | { type: "oauth2"; url: string }
  | { type: "manual"; state: string };

export async function startIntegrationAuth(integration: string): Promise<StartAuthResult> {
  const res = await fetch(`${API_URL}/api/auth/${integration}`, { headers: getHeaders() });
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

export async function captureCookies(integration: string, sessionId: string): Promise<{ success: boolean; cookieCount: number }> {
  const res = await fetch(`${API_URL}/api/auth/cookie/${integration}/capture`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) throw new Error("Failed to capture cookies");
  return res.json();
}

export async function cancelCookieAuth(integration: string, sessionId: string): Promise<void> {
  await fetch(`${API_URL}/api/auth/cookie/${integration}/cancel`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ sessionId }),
  });
}

export async function connectSession(jwt: string) {
  const res = await fetch(`${API_URL}/api/connect/session`, {
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Link invalid");
  return res.json() as Promise<{
    integration: string;
    loginUrl: string;
    cdpProxyUrl: string;
    sessionId: string;
    cdpToken: string;
  }>;
}

export async function connectCapture(jwt: string) {
  const res = await fetch(`${API_URL}/api/connect/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) throw new Error((await res.json()).error ?? "Capture failed");
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
