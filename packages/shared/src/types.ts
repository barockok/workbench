export interface Integration {
  name: string;
  version: string;
  auth: OAuthConfig | ApiKeyConfig | NoneConfig;
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
