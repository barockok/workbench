import { getWarmCdpEndpoint } from "./browser-session";
import { verifyConnectToken } from "./connect-token";

export interface CdpAuthFrame {
  sessionId?: string;
  cdpToken?: string;
  bearer?: string;
}

// Resolve the page-WS endpoint an authenticated CDP-proxy client may attach to,
// or null if the auth frame is not authorized. `portalUserId` is the userId
// proven by the portal session bearer (or null if none). `expectedIntegration`
// is the integration a connect JWT must be scoped to ("__browser__" for the
// browser-session proxy, the route :integration for the cookie proxy).
//
// The connect-JWT branch requires the token to verify AND be bound to exactly
// this session: matching integration + sessionId + cdpToken. The integration
// pin is the cross-proxy replay guard — a token minted for the browser-session
// proxy ("__browser__") can't be replayed against a cookie proxy, and vice
// versa. The final sessionId === authedUserId check enforces that the warm
// session (keyed by userId) belongs to the proven caller.
export async function authorizeCdpFrame(
  frame: CdpAuthFrame,
  portalUserId: string | null,
  expectedIntegration: string
): Promise<string | null> {
  let authedUserId: string | null = portalUserId;
  if (!authedUserId && frame.bearer) {
    try {
      const payload = await verifyConnectToken(frame.bearer);
      if (
        payload.integration === expectedIntegration &&
        payload.sessionId === frame.sessionId &&
        payload.cdpToken === frame.cdpToken
      ) {
        authedUserId = payload.userId;
      }
    } catch {
      // Not a valid connect JWT — treat as not authed.
    }
  }
  if (!authedUserId || authedUserId !== frame.sessionId) return null;
  return getWarmCdpEndpoint(authedUserId, frame.cdpToken ?? "");
}
