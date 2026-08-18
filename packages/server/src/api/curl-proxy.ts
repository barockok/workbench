import type { FastifyInstance } from "fastify";
import { Readable } from "node:stream";
import { verifyCurlToken } from "../auth/curl-session";
import { createContext } from "../plugins/context";
import { registry } from "../plugins/registry";

// Headers that must not be forwarded between client ↔ proxy ↔ upstream.
const REQUEST_HOP_BY_HOP = new Set([
  "host",
  "connection",
  "transfer-encoding",
  "te",
  "trailer",
  "keep-alive",
  "proxy-authorization",
  "authorization", // stripped — proxy injects the real credential
  "upgrade",
  "content-length", // recomputed from the forwarded body
]);

const RESPONSE_HOP_BY_HOP = new Set([
  "connection",
  "transfer-encoding",
  "te",
  "trailer",
  "keep-alive",
  "upgrade",
]);

export async function registerCurlProxy(app: FastifyInstance): Promise<void> {
  await app.register(async (scope) => {
    // Parse every content-type as a raw buffer so the proxy can forward the
    // exact bytes without re-serialising. Scoped to this plugin only.
    scope.addContentTypeParser(/.*/, { parseAs: "buffer" }, (_req, body, done) => {
      done(null, body);
    });

    scope.route({
      method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
      url: "/c/:integration/*",
      handler: async (request, reply) => {
        // 1. Verify the curl session JWT.
        const authHeader = (request.headers.authorization ?? "") as string;
        if (!authHeader.startsWith("Bearer ")) {
          return reply.code(401).send({ error: "Authorization: Bearer <curl-session-token> required" });
        }
        let session: { userId: string; integrations: string[] };
        try {
          session = await verifyCurlToken(authHeader.slice(7));
        } catch {
          return reply.code(401).send({ error: "Invalid or expired curl session token" });
        }

        const params = request.params as { integration: string; "*": string };
        const integration = params.integration;
        const tail = params["*"] ?? "";

        // 2. Integration must be in the session.
        if (!session.integrations.includes(integration)) {
          return reply.code(403).send({ error: `Integration "${integration}" is not in this curl session` });
        }

        // 3. Integration must have the proxy enabled.
        const integ = registry.getIntegration(integration);
        if (!integ?.proxy) {
          return reply.code(400).send({ error: `Integration "${integration}" does not support curl proxy` });
        }

        // 4. Build the target URL, preserving the original query string.
        const base = integ.proxy.baseUrl.replace(/\/$/, "");
        const rawUrl = request.url; // e.g. "/c/github/repos/owner/repo?page=2"
        const qIdx = rawUrl.indexOf("?");
        const qs = qIdx >= 0 ? rawUrl.slice(qIdx) : "";
        const targetUrl = tail ? `${base}/${tail}${qs}` : `${base}${qs}`;

        // 5. Build the forwarded header set (strip hop-by-hop + auth).
        const forwardHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(request.headers)) {
          if (REQUEST_HOP_BY_HOP.has(key.toLowerCase())) continue;
          if (Array.isArray(value)) {
            forwardHeaders[key] = value.join(", ");
          } else if (value !== undefined) {
            forwardHeaders[key] = value;
          }
        }

        // 6. Forward the request. createContext handles token refresh and
        //    injects the real credential (oauth2 Bearer / apikey / cookie).
        const ctx = await createContext(session.userId, integration);
        const hasBody = !["GET", "HEAD", "OPTIONS"].includes(request.method);
        const rawBody = request.body as Buffer | undefined;

        let upstream: Response;
        try {
          upstream = await ctx.http(targetUrl, {
            method: request.method,
            headers: forwardHeaders,
            body: hasBody && rawBody?.length ? (rawBody as unknown as BodyInit) : undefined,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return reply.code(502).send({ error: `Upstream request failed: ${msg}` });
        }

        // 7. Forward the response (stream body, no buffering).
        reply.code(upstream.status);
        for (const [key, value] of upstream.headers) {
          if (!RESPONSE_HOP_BY_HOP.has(key.toLowerCase())) {
            reply.header(key, value);
          }
        }
        if (upstream.body) {
          // Convert WHATWG ReadableStream → Node.js Readable so Fastify can pipe it.
          return reply.send(Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]));
        }
        return reply.send("");
      },
    });
  });
}
