import { jwtVerify, createRemoteJWKSet } from "jose";
import { config } from "../config";
import { db } from "../db";
import crypto from "crypto";
import { createAuthState, verifyAuthState } from "./oauth";

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  issuer: string;
}

interface KeycloakTokens {
  id_token: string;
  access_token: string;
  expires_in: number;
}

interface KeycloakIdToken {
  sub: string;
  email: string;
  email_verified?: boolean;
  preferred_username?: string;
  name?: string;
}

let discovery: OidcDiscovery | null = null;

async function getDiscovery(): Promise<OidcDiscovery> {
  if (discovery) return discovery;
  const url = `${config.KEYCLOAK_ISSUER_URL}/.well-known/openid-configuration`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch Keycloak OIDC discovery");
  discovery = await res.json() as OidcDiscovery;
  return discovery;
}

function getKeycloakCallbackUrl(): string {
  return `${config.SERVER_PUBLIC_URL}/api/auth/keycloak/callback`;
}

const nonceMap = new Map<string, { nonce: string; expiresAt: number }>();

function pruneExpiredNonces(): void {
  const now = Date.now();
  for (const [state, entry] of nonceMap) {
    if (entry.expiresAt < now) nonceMap.delete(state);
  }
}

export function isKeycloakConfigured(): boolean {
  return !!(config.KEYCLOAK_ISSUER_URL && config.KEYCLOAK_CLIENT_ID && config.KEYCLOAK_CLIENT_SECRET);
}

export async function buildAuthUrl(returnTicket?: string): Promise<string> {
  if (!isKeycloakConfigured()) throw new Error("Keycloak not configured");
  const d = await getDiscovery();
  pruneExpiredNonces();
  const baseState = createAuthState(crypto.randomUUID(), "keycloak-sso");
  const state = returnTicket ? `${baseState}.${returnTicket}` : baseState;
  const nonce = crypto.randomBytes(16).toString("hex");
  nonceMap.set(state, { nonce, expiresAt: Date.now() + 10 * 60 * 1000 });
  const url = new URL(d.authorization_endpoint);
  url.searchParams.set("client_id", config.KEYCLOAK_CLIENT_ID!);
  url.searchParams.set("redirect_uri", getKeycloakCallbackUrl());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  return url.toString();
}

async function exchangeCodeForTokens(code: string): Promise<KeycloakTokens> {
  const d = await getDiscovery();
  const res = await fetch(d.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.KEYCLOAK_CLIENT_ID!,
      client_secret: config.KEYCLOAK_CLIENT_SECRET!,
      code,
      redirect_uri: getKeycloakCallbackUrl(),
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${err}`);
  }
  return res.json();
}

async function verifyIdToken(idToken: string, expectedNonce?: string): Promise<KeycloakIdToken> {
  const d = await getDiscovery();
  const JWKS = createRemoteJWKSet(new URL(d.jwks_uri));
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: d.issuer,
    audience: config.KEYCLOAK_CLIENT_ID,
    clockTolerance: 60,
  });
  if (!payload.sub || !payload.email) {
    throw new Error("Invalid ID token payload");
  }
  if (expectedNonce !== undefined && payload.nonce !== expectedNonce) {
    throw new Error("Invalid nonce");
  }
  return {
    sub: payload.sub,
    email: payload.email as string,
    email_verified: payload.email_verified as boolean | undefined,
    preferred_username: payload.preferred_username as string | undefined,
    name: payload.name as string | undefined,
  };
}

export async function handleCallback(code: string, state: string): Promise<{ userId: string; email: string }> {
  const base = state.includes(".") ? state.slice(0, state.indexOf(".")) : state;
  const authState = verifyAuthState(base);
  if (!authState || authState.integration !== "keycloak-sso") {
    throw new Error("Invalid state");
  }
  const nonceEntry = nonceMap.get(state);
  if (!nonceEntry || nonceEntry.expiresAt < Date.now()) {
    throw new Error("Invalid or expired nonce");
  }
  nonceMap.delete(state);
  const tokens = await exchangeCodeForTokens(code);
  const kcUser = await verifyIdToken(tokens.id_token, nonceEntry.nonce);
  if (kcUser.email_verified === false) {
    throw new Error("Email not verified");
  }
  let user = db.prepare("SELECT id, email, keycloak_sub FROM users WHERE keycloak_sub = ?").get(kcUser.sub) as
    | { id: string; email: string; keycloak_sub: string }
    | undefined;
  if (!user) {
    user = db.prepare("SELECT id, email, keycloak_sub FROM users WHERE email = ?").get(kcUser.email) as
      | { id: string; email: string; keycloak_sub: string }
      | undefined;
    if (user) {
      db.prepare("UPDATE users SET keycloak_sub = ? WHERE id = ?").run(kcUser.sub, user.id);
    } else {
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO users (id, email, keycloak_sub) VALUES (?, ?, ?)").run(id, kcUser.email, kcUser.sub);
      user = { id, email: kcUser.email, keycloak_sub: kcUser.sub };
    }
  }
  return { userId: user.id, email: user.email };
}
