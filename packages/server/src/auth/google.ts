import { jwtVerify, createRemoteJWKSet } from "jose";
import { config } from "../config";
import { db } from "../db";
import crypto from "crypto";

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

async function getJwksUri(): Promise<string> {
  if (jwksUri) return jwksUri;
  const res = await fetch(GOOGLE_DISCOVERY);
  if (!res.ok) throw new Error("Failed to fetch Google OIDC discovery");
  const data = await res.json();
  jwksUri = data.jwks_uri;
  return jwksUri;
}

export function buildAuthUrl(state: string): string {
  if (!config.GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_CLIENT_ID not configured");
  }
  const redirectUri = `${config.PORTAL_URL}/auth/google/callback`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.GOOGLE_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "online");
  return url.toString();
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth not configured");
  }
  const redirectUri = `${config.PORTAL_URL}/auth/google/callback`;
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

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdToken> {
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
  return {
    sub: payload.sub,
    email: payload.email as string,
    email_verified: payload.email_verified as boolean | undefined,
    picture: payload.picture as string | undefined,
    name: payload.name as string | undefined,
  };
}

export async function handleCallback(code: string, _state: string): Promise<{ userId: string; email: string }> {
  const tokens = await exchangeCodeForTokens(code);
  const googleUser = await verifyGoogleIdToken(tokens.id_token);

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
