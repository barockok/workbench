import { getWarmCdpEndpoint } from "./browser-session";

export interface CdpAuthFrame {
  sessionId?: string;
  cdpToken?: string;
}

// Resolve the page-WS endpoint an authenticated CDP-proxy client may attach to,
// or null if the auth frame is not authorized. `portalUserId` is the userId
// proven by the portal session bearer (or null if none).
//
// A portal session is the only credential accepted here. Connect links used to
// authorize this socket, which made a leaked link a live handle on someone
// else's browser; the /connect and /browser pages now require a session, so
// nothing needs that path any more. `expectedIntegration` is retained for the
// caller's route pinning and is unused in the authorization decision.
export async function authorizeCdpFrame(
  frame: CdpAuthFrame,
  portalUserId: string | null,
  _expectedIntegration: string
): Promise<string | null> {
  if (!portalUserId || portalUserId !== frame.sessionId) return null;
  return getWarmCdpEndpoint(portalUserId, frame.cdpToken ?? "");
}
