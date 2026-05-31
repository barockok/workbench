export interface Integration {
  name: string;
  version: string;
  auth: OAuthConfig | ApiKeyConfig | CookieConfig | NoneConfig;
  // Optional presentation metadata (portal + agent UX). All backward-compatible.
  displayName?: string;
  description?: string;
  // Logo: either an https URL (used as-is) or a filename bundled in the plugin
  // dir (served via /api/integrations/:name/logo).
  logo?: string;
  categories?: string[];
}

export interface OAuthConfig {
  type: "oauth2";
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
}

export interface ApiKeyConfig {
  type: "apikey";
  headerName: string;
}

export interface CookieConfig {
  type: "cookie";
  loginUrl: string;
  targetDomain: string;
  cookieDomains?: string[];
}

export interface NoneConfig {
  type: "none";
}

export interface ToolDefinition {
  name: string;
  description: string;
  integration: string;
  inputSchema: unknown;
}

export interface Connection {
  userId: string;
  integration: string;
  connectedAt: number;
  scopes: string[];
}

export interface AuditEvent {
  user_id: string;
  integration?: string;
  tool?: string;
  action: "EXECUTE" | "CONNECT" | "DISCONNECT" | "REFRESH";
  success: boolean;
  error?: string;
  duration_ms?: number;
  timestamp: string;
}
