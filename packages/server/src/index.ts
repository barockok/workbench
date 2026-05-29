import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import WebSocket from "ws";
import { config } from "./config";
import { handleMcpRequest } from "./mcp/server";
import { registerApiRoutes } from "./api/routes";
import { loadPlugins } from "./plugins/loader";
import { verifyApiKey } from "./auth/users";
import { verifySession } from "./auth/session";
import { getSessionCdpEndpoint } from "./auth/cookie";
import "./telemetry/tracing";

async function getUserIdFromAuth(auth?: string): Promise<string | null> {
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  try {
    const session = await verifySession(token);
    return session.userId;
  } catch {
    return verifyApiKey(token);
  }
}

async function main() {
  const app = Fastify({ logger: true });

  await app.register(fastifyWebsocket);
  await loadPlugins();
  await registerApiRoutes(app);

  // Proxy raw Chrome DevTools Protocol WebSocket from the browser to the
  // headed Chromium spawned by startCookieSession. Auth via signed `token`
  // query param (issued at session start, scoped to userId + sessionId).
  app.get<{
    Params: { integration: string };
    Querystring: { sessionId?: string; token?: string };
  }>(
    "/api/auth/cookie/:integration/cdp",
    { websocket: true },
    (conn, request) => {
      const browserWs = conn as unknown as WebSocket;
      const sessionId = request.query.sessionId ?? "";
      const cdpToken = request.query.token ?? "";
      const auth = request.headers.authorization;
      // For browser WS we can't set Authorization; the per-session token is
      // the actual gate. We still accept a Bearer if present (e.g. tests).
      void auth;

      // We don't know userId from the WS request; getSessionCdpEndpoint will
      // refuse if the token doesn't match. So we look up via session map
      // using both fields. Re-resolve userId from the session row.
      const target = (() => {
        // Use a permissive lookup: pull session, verify token only.
        // We re-use getSessionCdpEndpoint by passing the stored userId from
        // a getSessionOwner companion call.
        try {
          // dynamic import-ish — keep this scope local
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const { getSessionOwner } = require("./auth/cookie") as typeof import("./auth/cookie");
          const owner = getSessionOwner(sessionId);
          if (!owner) return null;
          return getSessionCdpEndpoint(sessionId, owner.userId, cdpToken);
        } catch {
          return null;
        }
      })();

      if (!target) {
        try { browserWs.close(4401, "Unauthorized"); } catch { /* noop */ }
        return;
      }

      // Chromium's CDP WebSocket gates Origin against --remote-allow-origins.
      // Send a known origin from our side and match it on the chromium args
      // (`http://127.0.0.1`). Without this the dial closes with 1006.
      const upstream = new WebSocket(target, {
        perMessageDeflate: false,
        origin: "http://127.0.0.1",
      });
      const browserClosed = () => {
        try { upstream.close(); } catch { /* noop */ }
      };
      const upstreamClosed = () => {
        try { browserWs.close(); } catch { /* noop */ }
      };

      // Buffer browser→upstream messages until upstream opens — fastify
      // already accepted the upgrade, so the browser can start sending CDP
      // commands before our outbound dial completes.
      const pending: string[] = [];
      let upstreamReady = false;

      // CDP frames are JSON text — chromium closes the socket (1006) if we
      // forward Buffer with the default binary opcode. Normalize to string
      // in both directions.
      const toText = (data: WebSocket.RawData): string => {
        if (typeof data === "string") return data;
        if (Buffer.isBuffer(data)) return data.toString("utf8");
        if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
        return Buffer.from(data as ArrayBuffer).toString("utf8");
      };

      browserWs.on("message", (data: WebSocket.RawData) => {
        const text = toText(data);
        if (upstreamReady && upstream.readyState === WebSocket.OPEN) {
          upstream.send(text);
        } else {
          pending.push(text);
        }
      });

      upstream.on("open", () => {
        upstreamReady = true;
        for (const msg of pending) upstream.send(msg);
        pending.length = 0;
      });

      upstream.on("message", (data: WebSocket.RawData) => {
        if (browserWs.readyState === WebSocket.OPEN) browserWs.send(toText(data));
      });

      upstream.on("close", upstreamClosed);
      upstream.on("error", upstreamClosed);
      browserWs.on("close", browserClosed);
      browserWs.on("error", browserClosed);
    }
  );

  app.post("/mcp", async (request, reply) => {
    const auth = request.headers.authorization;
    const userId = await getUserIdFromAuth(auth);
    if (!userId) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const body = request.body as Record<string, unknown>;
    const result = await handleMcpRequest(body, userId);
    // JSON-RPC notifications return null — no body, just 202 Accepted.
    if (result === null) {
      reply.status(202).send();
      return;
    }
    reply.send(result);
  });

  await app.listen({ port: parseInt(config.PORT), host: "0.0.0.0" });
  console.log(`Server running on port ${config.PORT}`);
}

main().catch(console.error);
