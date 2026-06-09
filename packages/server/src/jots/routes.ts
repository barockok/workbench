import fs from "node:fs";
import path from "node:path";
import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config";
import { jotsRoot } from "./dir";
import { isValidJotName, resolveInside, MANIFEST } from "./paths";
import { readManifest } from "./store";
import { contentType } from "./mime";
import { verifyPassword, makeToken, verifyToken, cookieName } from "./auth";

function secret(): string {
  return config.SESSION_SECRET;
}

function secureCookie(): boolean {
  return config.NODE_ENV === "production";
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function wantsHtml(req: FastifyRequest): boolean {
  const accept = (req.headers["accept"] as string) || "";
  if (req.headers["x-requested-with"]) return false;
  const dest = req.headers["sec-fetch-dest"] as string | undefined;
  if (dest && dest !== "document" && dest !== "iframe") return false;
  return accept.includes("text/html");
}

function unlockPage(jotName: string, error: boolean): string {
  const msg = error ? `<p class="err">Wrong password.</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Locked · ${jotName}</title>
<style>
  body{font-family:system-ui,sans-serif;background:#0e0e10;color:#eee;display:grid;place-items:center;height:100vh;margin:0}
  form{background:#1a1a1e;padding:2rem;border-radius:12px;width:min(320px,90vw);box-shadow:0 10px 40px #0008}
  h1{font-size:1rem;font-weight:600;margin:0 0 1rem}
  input{width:100%;box-sizing:border-box;padding:.6rem;border-radius:8px;border:1px solid #333;background:#0e0e10;color:#eee;margin-bottom:.8rem}
  button{width:100%;padding:.6rem;border:0;border-radius:8px;background:#5b8cff;color:#fff;font-weight:600;cursor:pointer}
  .err{color:#ff6b6b;font-size:.85rem;margin:.2rem 0 .8rem}
</style></head><body>
<form method="POST" action="/j/${jotName}/__auth">
  <h1>🔒 ${jotName}</h1>
  ${msg}
  <input type="password" name="password" placeholder="Password" autofocus required>
  <button type="submit">Unlock</button>
</form></body></html>`;
}

// Every jot response carries untrusted, user-uploaded content. The `sandbox`
// CSP directive forces the browser to treat it as a unique opaque origin, so
// jot JS cannot read app cookies/storage or make credentialed same-origin
// requests to /api or /mcp. allow-scripts + allow-forms keep jots and the
// unlock form working. Trade-off: a jot cannot fetch its own data files
// (opaque origin is cross-origin to itself); jots must be self-contained.
function setJotSecurityHeaders(reply: FastifyReply): void {
  reply.header("content-security-policy", "sandbox allow-scripts allow-forms");
  reply.header("x-content-type-options", "nosniff");
  reply.header("x-frame-options", "SAMEORIGIN");
  reply.header("cross-origin-resource-policy", "same-origin");
}

function streamFile(reply: FastifyReply, filePath: string): void {
  setJotSecurityHeaders(reply);
  reply.header("content-type", contentType(filePath));
  reply.send(fs.readFileSync(filePath));
}

export async function registerJotRoutes(app: FastifyInstance): Promise<void> {
  // Accept urlencoded bodies for the unlock form. Guard: another route group
  // (e.g. OAuth) may have registered this parser earlier in the boot order.
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) => done(null, body)
    );
  }

  // Bare /j/:name -> canonical trailing slash.
  app.get<{ Params: { name: string } }>("/j/:name", async (req, reply) => {
    if (!isValidJotName(req.params.name)) return reply.code(404).send("Not found");
    return reply.redirect(`/j/${req.params.name}/`, 301);
  });

  app.post<{ Params: { name: string } }>("/j/:name/__auth", async (req, reply) => {
    const { name } = req.params;
    if (!isValidJotName(name)) return reply.code(404).send("Not found");
    const manifest = readManifest(name);
    if (!manifest) return reply.code(404).send("Not found");
    if (manifest.access !== "password") return reply.redirect(`/j/${name}/`, 302);

    // Body shape depends on which urlencoded parser won registration: the jot
    // parser yields the raw string, but if the OAuth route group registered
    // first (boot order) it's already parsed into an object. Handle both, or
    // password jots never unlock under the real server.
    let pw = "";
    if (typeof req.body === "string") {
      pw = new URLSearchParams(req.body).get("password") || "";
    } else if (req.body && typeof req.body === "object") {
      const v = (req.body as Record<string, unknown>).password;
      pw = typeof v === "string" ? v : "";
    }
    if (!manifest.hash || !verifyPassword(pw, manifest.hash)) {
      setJotSecurityHeaders(reply);
      return reply.code(401).type("text/html; charset=utf-8").send(unlockPage(name, true));
    }
    const token = makeToken(secret(), name, manifest.hash);
    const attrs = [
      `${cookieName(name)}=${token}`,
      `Path=/j/${name}/`,
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=2592000",
    ];
    if (secureCookie()) attrs.push("Secure");
    return reply.header("set-cookie", attrs.join("; ")).redirect(`/j/${name}/`, 302);
  });

  app.get<{ Params: { name: string; "*": string } }>("/j/:name/*", async (req, reply) => {
    const { name } = req.params;
    const rest = req.params["*"] ?? "";
    if (!isValidJotName(name)) return reply.code(404).send("Not found");

    const manifest = readManifest(name);
    if (!manifest) return reply.code(404).send("Not found");

    if (manifest.access === "password") {
      const cookies = parseCookies(req.headers["cookie"]);
      const ok = verifyToken(secret(), name, manifest.hash ?? "", cookies[cookieName(name)]);
      if (!ok) {
        if (wantsHtml(req)) {
          setJotSecurityHeaders(reply);
          return reply.code(200).type("text/html; charset=utf-8").send(unlockPage(name, false));
        }
        return reply.code(401).send("Unauthorized");
      }
    }

    // Block manifest explicitly (404, not 403 — we don't reveal it exists).
    if (path.basename(rest).toLowerCase() === MANIFEST) return reply.code(404).send("Not found");

    const jotDir = path.join(jotsRoot(), name);
    const filePath = resolveInside(jotDir, rest);
    if (!filePath) return reply.code(403).send("Forbidden");

    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return reply.code(404).send("Not found");
    }
    if (stat.isDirectory()) {
      const idx = path.join(filePath, "index.html");
      if (!fs.existsSync(idx)) return reply.code(404).send("Not found");
      return streamFile(reply, idx);
    }
    return streamFile(reply, filePath);
  });
}
