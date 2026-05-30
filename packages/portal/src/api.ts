const API_URL = import.meta.env.VITE_API_URL || "";

function getHeaders(): HeadersInit {
  const token = localStorage.getItem("awb_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
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
