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
