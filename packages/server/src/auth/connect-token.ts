import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";

const secret = new TextEncoder().encode(config.SESSION_SECRET);
const AUDIENCE = "a-workbench-connect";
const ISSUER = "a-workbench";

export interface ConnectTokenPayload {
  connectionId: string;
  userId: string;
  integration: string;
  sessionId: string;
}

export async function signConnectToken(
  payload: ConnectTokenPayload,
  expiresInSeconds: number
): Promise<string> {
  return new SignJWT({
    connectionId: payload.connectionId,
    sub: payload.userId,
    integration: payload.integration,
    sessionId: payload.sessionId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInSeconds}s`)
    .setAudience(AUDIENCE)
    .setIssuer(ISSUER)
    .sign(secret);
}

export async function verifyConnectToken(token: string): Promise<ConnectTokenPayload> {
  const { payload } = await jwtVerify(token, secret, {
    clockTolerance: 0,
    audience: AUDIENCE,
    issuer: ISSUER,
  });
  if (
    typeof payload.connectionId !== "string" ||
    typeof payload.sub !== "string" ||
    typeof payload.integration !== "string" ||
    typeof payload.sessionId !== "string"
  ) {
    throw new Error("Invalid connect token payload");
  }
  return {
    connectionId: payload.connectionId,
    userId: payload.sub,
    integration: payload.integration,
    sessionId: payload.sessionId,
  };
}
