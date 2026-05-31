import { jwtVerify, createRemoteJWKSet } from "jose";
import { config } from "../config";
import { db } from "../db";
import crypto from "crypto";
import { createAuthState, verifyAuthState } from "./oauth";

const GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration";

interface GoogleTokens {
  id_token: string;
  access_token: string;
  expires_in: number;
}

interface GoogleIdToken {
  sub: string;
  email: string;
  email_verified?: boolean;
  picture?: string;
  name?: string;
}

let jwksUri: string | null = null;

// Nonce storage keyed by state, with automatic expiry (10 minutes)
const nonceMap = new Map<string, { nonce: string; expiresAt: number }>();

function pruneExpiredNonces(): void {
  const now = Date.now();
  for (const [state, entry] of nonceMap) {
    if (entry.expiresAt < now) nonceMap.delete(state);
  }
}

// The Google SSO callback route is served by *this server*, so the redirect URI
// must use SERVER_PUBLIC_URL (not PORTAL_URL — the portal may live on a separate
// origin). The auth-request and token-exchange redirect_uri must be byte-equal,
// so both read from this single helper.
function getGoogleCallbackUrl(): string {
  return `${config.SERVER_PUBLIC_URL}/api/auth/google/callback`;
}

async function getJwksUri(): Promise<string> {
  if (jwksUri) return jwksUri;
  const res = await fetch(GOOGLE_DISCOVERY);
  if (!res.ok) throw new Error("Failed to fetch Google OIDC discovery");
  const data = await res.json();
  jwksUri = data.jwks_uri as string;
  return jwksUri;
}

export function buildAuthUrl(returnTicket?: string): string {
  if (!config.GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID not configured");
  }

  // Prune expired nonces before inserting a new one
  pruneExpiredNonces();

  // Encode an optional return ticket (e.g. a pending OAuth /authorize request)
  // into the state so the callback can resume the right flow.
  const baseState = createAuthState(crypto.randomUUID(), "google-sso");
  const state = returnTicket ? `${baseState}.${returnTicket}` : baseState;

  // Generate nonce and store it keyed by state
  const nonce = crypto.randomBytes(16).toString("hex");
  nonceMap.set(state, { nonce, expiresAt: Date.now() + 10 * 60 * 1000 });

  const redirectUri = getGoogleCallbackUrl();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("access_type", "online");
  return url.toString();
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth not configured");
  }
  const redirectUri = getGoogleCallbackUrl();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.GOOGLE_CLIENT_ID,
      client_secret: config.GOOGLE_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${err}`);
  }
  return res.json();
}

export async function verifyGoogleIdToken(idToken: string, expectedNonce?: string): Promise<GoogleIdToken> {
  const uri = await getJwksUri();
  const JWKS = createRemoteJWKSet(new URL(uri));
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: config.GOOGLE_CLIENT_ID,
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
    picture: payload.picture as string | undefined,
    name: payload.name as string | undefined,
  };
}

export async function handleCallback(code: string, state: string): Promise<{ userId: string; email: string }> {
  // Verify state to prevent CSRF
  const authState = verifyAuthState(state);
  if (!authState || authState.integration !== "google-sso") {
    throw new Error("Invalid state");
  }

  // Look up and consume nonce to prevent ID token replay
  const nonceEntry = nonceMap.get(state);
  if (!nonceEntry || nonceEntry.expiresAt < Date.now()) {
    throw new Error("Invalid or expired nonce");
  }
  nonceMap.delete(state);

  const tokens = await exchangeCodeForTokens(code);
  const googleUser = await verifyGoogleIdToken(tokens.id_token, nonceEntry.nonce);

  if (!googleUser.email_verified) {
    throw new Error("Email not verified");
  }

  let user = db.prepare("SELECT id, email, google_sub FROM users WHERE google_sub = ?").get(googleUser.sub) as
    | { id: string; email: string; google_sub: string }
    | undefined;

  if (!user) {
    // Check by email for account linking
    user = db.prepare("SELECT id, email, google_sub FROM users WHERE email = ?").get(googleUser.email) as
      | { id: string; email: string; google_sub: string }
      | undefined;

    if (user) {
      // Link existing user
      db.prepare("UPDATE users SET google_sub = ? WHERE id = ?").run(googleUser.sub, user.id);
    } else {
      // Create new user
      const id = crypto.randomUUID();
      db.prepare("INSERT INTO users (id, email, google_sub) VALUES (?, ?, ?)").run(
        id,
        googleUser.email,
        googleUser.sub
      );
      user = { id, email: googleUser.email, google_sub: googleUser.sub };
    }
  }

  return { userId: user.id, email: user.email };
}
