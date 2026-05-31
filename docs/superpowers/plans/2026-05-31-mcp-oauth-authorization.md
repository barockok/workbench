# MCP OAuth 2.1 Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let MCP clients (Claude Code, etc.) authenticate to `/mcp` via the standard MCP OAuth 2.1 browser flow — on connect with no token they get a 401 that drives discovery → dynamic registration → browser authorization (gated by the existing Google SSO) → token → authorized `/mcp`. The existing `x-workbench-api-key` header keeps working for headless clients.

**Architecture:** a-workbench becomes both an OAuth 2.1 **Authorization Server** and **Resource Server** for the `/mcp` resource. Public clients only (no client secret), PKCE S256 required, Dynamic Client Registration (RFC 7591). Access tokens are short-lived `jose` JWTs (HS256, signed with `SESSION_SECRET`) with `aud = <SERVER_PUBLIC_URL>/mcp`; refresh tokens are opaque, hashed, rotated. The interactive user-auth step inside `/authorize` reuses the existing Google SSO by round-tripping the pending authorize request through the Google `state` record (`pending_auth.session_data`).

**Tech Stack:** Fastify 4, `jose`, `better-sqlite3`, TypeScript, Vitest. All new code under `packages/server/src`.

**Specs referenced:** MCP Authorization (OAuth 2.1), RFC 9728 (Protected Resource Metadata), RFC 8414 (Authorization Server Metadata), RFC 7591 (Dynamic Client Registration), RFC 7636 (PKCE), RFC 8707 (Resource Indicators).

---

## File Structure

- Create `packages/server/src/auth/oauth-server/clients.ts` — DCR client store (oauth_clients table).
- Create `packages/server/src/auth/oauth-server/codes.ts` — authorization-code store (oauth_auth_codes table, PKCE binding).
- Create `packages/server/src/auth/oauth-server/refresh.ts` — refresh-token store (oauth_refresh_tokens table).
- Create `packages/server/src/auth/oauth-server/tokens.ts` — access-token sign/verify (jose).
- Create `packages/server/src/auth/oauth-server/metadata.ts` — PRM + AS metadata document builders.
- Create `packages/server/src/api/oauth-routes.ts` — `registerOAuthRoutes(app)`: well-known, /register, /authorize, /token.
- Modify `packages/server/src/db.ts` — three new tables.
- Modify `packages/server/src/auth/google.ts` — let `buildAuthUrl` carry an opaque `returnTicket`.
- Modify `packages/server/src/api/routes.ts` — Google callback resumes a pending authorize.
- Modify `packages/server/src/index.ts` — register oauth routes; `/mcp` accepts OAuth Bearer; flip `WWW-Authenticate` to `Bearer` with `resource_metadata`.
- Modify `packages/server/src/config.ts` — `OAUTH_ACCESS_TOKEN_TTL_SECONDS` (default 3600).
- Tests alongside in `packages/server/tests/`.

**Convention reminder:** vitest runs serialized (`fileParallelism: false`) and shares the real SQLite file; every test file that touches a new table must `DELETE FROM <table>` in `beforeEach`.

---

## Task 1: OAuth tables (schema)

**Files:**
- Modify: `packages/server/src/db.ts` (append to the `db.exec(\`...\`)` block, before the migrations section)

- [ ] **Step 1: Add the three tables**

In `db.ts`, inside the existing `db.exec(\`...\`)` template (after the `audit_log` block, before the closing backtick), add:

```sql
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id TEXT PRIMARY KEY,
    client_name TEXT,
    redirect_uris TEXT NOT NULL,     -- JSON array
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS oauth_auth_codes (
    code TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    scope TEXT,
    resource TEXT,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    scope TEXT,
    expires_at INTEGER NOT NULL
  );
```

- [ ] **Step 2: Verify the server still boots and tables exist**

Run: `cd packages/server && NODE_ENV=test node --import tsx -e "import('./src/db.ts').then(({db})=>console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'oauth_%'\").all()))"`
Expected: prints the three `oauth_*` table names.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db.ts
git commit -m "feat(oauth): add oauth_clients/auth_codes/refresh_tokens tables"
```

---

## Task 2: Client store + Dynamic Client Registration storage

**Files:**
- Create: `packages/server/src/auth/oauth-server/clients.ts`
- Test: `packages/server/tests/oauth-clients.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { registerClient, getClient } from "../src/auth/oauth-server/clients";
import { db } from "../src/db";

beforeEach(() => db.exec("DELETE FROM oauth_clients"));

describe("oauth client store", () => {
  it("registers a public client and reads it back", () => {
    const c = registerClient({ client_name: "Claude Code", redirect_uris: ["http://127.0.0.1:33418/callback"] });
    expect(c.client_id).toMatch(/.+/);
    const got = getClient(c.client_id);
    expect(got?.redirect_uris).toEqual(["http://127.0.0.1:33418/callback"]);
  });

  it("requires at least one redirect_uri", () => {
    expect(() => registerClient({ redirect_uris: [] })).toThrow();
  });

  it("returns undefined for unknown client", () => {
    expect(getClient("nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/oauth-clients.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `clients.ts`**

```ts
import crypto from "crypto";
import { db } from "../../db";

export interface OAuthClient {
  client_id: string;
  client_name?: string;
  redirect_uris: string[];
}

export function registerClient(input: { client_name?: string; redirect_uris: string[] }): OAuthClient {
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
    throw new Error("redirect_uris must contain at least one URI");
  }
  const client_id = crypto.randomBytes(16).toString("hex");
  db.prepare(
    "INSERT INTO oauth_clients (client_id, client_name, redirect_uris) VALUES (?, ?, ?)"
  ).run(client_id, input.client_name ?? null, JSON.stringify(input.redirect_uris));
  return { client_id, client_name: input.client_name, redirect_uris: input.redirect_uris };
}

export function getClient(clientId: string): OAuthClient | undefined {
  const row = db
    .prepare("SELECT client_id, client_name, redirect_uris FROM oauth_clients WHERE client_id = ?")
    .get(clientId) as { client_id: string; client_name: string | null; redirect_uris: string } | undefined;
  if (!row) return undefined;
  return {
    client_id: row.client_id,
    client_name: row.client_name ?? undefined,
    redirect_uris: JSON.parse(row.redirect_uris),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix packages/server -- tests/oauth-clients.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/oauth-server/clients.ts packages/server/tests/oauth-clients.test.ts
git commit -m "feat(oauth): client store for dynamic registration"
```

---

## Task 3: Access-token sign/verify

**Files:**
- Create: `packages/server/src/auth/oauth-server/tokens.ts`
- Test: `packages/server/tests/oauth-tokens.test.ts`
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: Add the TTL config**

In `config.ts`, inside `configSchema`, after `CONNECT_TTL_SECONDS`:

```ts
  OAUTH_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { signAccessToken, verifyAccessToken } from "../src/auth/oauth-server/tokens";

describe("oauth access tokens", () => {
  it("signs and verifies, returning the subject + scope", async () => {
    const tok = await signAccessToken({ userId: "u1", scope: "mcp", clientId: "c1" });
    const claims = await verifyAccessToken(tok);
    expect(claims.userId).toBe("u1");
    expect(claims.scope).toBe("mcp");
  });

  it("rejects a garbage token", async () => {
    await expect(verifyAccessToken("not-a-jwt")).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/oauth-tokens.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `tokens.ts`**

`aud` is the MCP resource URL so tokens can't be replayed against other audiences. `iss` is the server origin.

```ts
import { SignJWT, jwtVerify } from "jose";
import { config } from "../../config";

const secret = new TextEncoder().encode(config.SESSION_SECRET);
const ISSUER = config.SERVER_PUBLIC_URL;
const RESOURCE = `${config.SERVER_PUBLIC_URL}/mcp`;

export interface AccessTokenClaims {
  userId: string;
  scope: string;
  clientId: string;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  return new SignJWT({ scope: claims.scope, client_id: claims.clientId, token_type: "oauth" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt()
    .setExpirationTime(`${config.OAUTH_ACCESS_TOKEN_TTL_SECONDS}s`)
    .setAudience(RESOURCE)
    .setIssuer(ISSUER)
    .sign(secret);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, secret, {
    clockTolerance: 5,
    audience: RESOURCE,
    issuer: ISSUER,
  });
  if (payload.token_type !== "oauth" || typeof payload.sub !== "string") {
    throw new Error("Not an OAuth access token");
  }
  return {
    userId: payload.sub,
    scope: typeof payload.scope === "string" ? payload.scope : "",
    clientId: typeof payload.client_id === "string" ? payload.client_id : "",
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --prefix packages/server -- tests/oauth-tokens.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/auth/oauth-server/tokens.ts packages/server/tests/oauth-tokens.test.ts packages/server/src/config.ts
git commit -m "feat(oauth): access-token sign/verify (jose, aud=/mcp)"
```

---

## Task 4: Authorization-code store (PKCE)

**Files:**
- Create: `packages/server/src/auth/oauth-server/codes.ts`
- Test: `packages/server/tests/oauth-codes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { issueCode, consumeCode } from "../src/auth/oauth-server/codes";
import { db } from "../src/db";

beforeEach(() => db.exec("DELETE FROM oauth_auth_codes"));

function challenge(verifier: string) {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

describe("oauth auth codes", () => {
  it("issues then consumes once with correct PKCE verifier", () => {
    const code = issueCode({
      clientId: "c1", userId: "u1", redirectUri: "http://127.0.0.1/cb",
      codeChallenge: challenge("verifier123"), scope: "mcp", resource: "http://x/mcp",
    });
    const ok = consumeCode(code, { clientId: "c1", redirectUri: "http://127.0.0.1/cb", codeVerifier: "verifier123" });
    expect(ok?.userId).toBe("u1");
    // second consume fails (single-use)
    expect(consumeCode(code, { clientId: "c1", redirectUri: "http://127.0.0.1/cb", codeVerifier: "verifier123" })).toBeNull();
  });

  it("rejects a wrong PKCE verifier", () => {
    const code = issueCode({
      clientId: "c1", userId: "u1", redirectUri: "http://127.0.0.1/cb",
      codeChallenge: challenge("right"), scope: "mcp", resource: "http://x/mcp",
    });
    expect(consumeCode(code, { clientId: "c1", redirectUri: "http://127.0.0.1/cb", codeVerifier: "wrong" })).toBeNull();
  });

  it("rejects a redirect_uri mismatch", () => {
    const code = issueCode({
      clientId: "c1", userId: "u1", redirectUri: "http://127.0.0.1/cb",
      codeChallenge: challenge("v"), scope: "mcp", resource: "http://x/mcp",
    });
    expect(consumeCode(code, { clientId: "c1", redirectUri: "http://evil/cb", codeVerifier: "v" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/oauth-codes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `codes.ts`**

```ts
import crypto from "crypto";
import { db } from "../../db";

const CODE_TTL_SECONDS = 60;

export interface IssueCodeInput {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string; // S256, base64url
  scope: string;
  resource: string;
}

export function issueCode(input: IssueCodeInput): string {
  const code = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO oauth_auth_codes (code, client_id, user_id, redirect_uri, code_challenge, scope, resource, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(code, input.clientId, input.userId, input.redirectUri, input.codeChallenge, input.scope, input.resource, now + CODE_TTL_SECONDS);
  db.prepare("DELETE FROM oauth_auth_codes WHERE expires_at < ?").run(now);
  return code;
}

export interface ConsumeCodeInput {
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}

export interface ConsumedCode {
  userId: string;
  scope: string;
  resource: string;
}

export function consumeCode(code: string, input: ConsumeCodeInput): ConsumedCode | null {
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare("SELECT * FROM oauth_auth_codes WHERE code = ? AND expires_at > ?")
    .get(code, now) as
    | { client_id: string; user_id: string; redirect_uri: string; code_challenge: string; scope: string; resource: string }
    | undefined;
  // Single-use: delete on any lookup hit, success or not.
  if (row) db.prepare("DELETE FROM oauth_auth_codes WHERE code = ?").run(code);
  if (!row) return null;
  if (row.client_id !== input.clientId) return null;
  if (row.redirect_uri !== input.redirectUri) return null;
  const computed = crypto.createHash("sha256").update(input.codeVerifier).digest("base64url");
  // constant-time compare
  const a = Buffer.from(computed);
  const b = Buffer.from(row.code_challenge);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { userId: row.user_id, scope: row.scope, resource: row.resource };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix packages/server -- tests/oauth-codes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/oauth-server/codes.ts packages/server/tests/oauth-codes.test.ts
git commit -m "feat(oauth): single-use PKCE auth-code store"
```

---

## Task 5: Refresh-token store (rotating)

**Files:**
- Create: `packages/server/src/auth/oauth-server/refresh.ts`
- Test: `packages/server/tests/oauth-refresh.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { issueRefreshToken, rotateRefreshToken } from "../src/auth/oauth-server/refresh";
import { db } from "../src/db";

beforeEach(() => db.exec("DELETE FROM oauth_refresh_tokens"));

describe("oauth refresh tokens", () => {
  it("issues then rotates: old token invalid, new token valid", () => {
    const t1 = issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    const r = rotateRefreshToken(t1, "c1");
    expect(r?.userId).toBe("u1");
    expect(r?.newToken).toBeTruthy();
    // old token no longer rotates
    expect(rotateRefreshToken(t1, "c1")).toBeNull();
    // new token rotates
    expect(rotateRefreshToken(r!.newToken, "c1")?.userId).toBe("u1");
  });

  it("rejects rotation with a mismatched client", () => {
    const t1 = issueRefreshToken({ clientId: "c1", userId: "u1", scope: "mcp" });
    expect(rotateRefreshToken(t1, "other")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/oauth-refresh.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `refresh.ts`**

```ts
import crypto from "crypto";
import { db } from "../../db";

const REFRESH_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function hash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function issueRefreshToken(input: { clientId: string; userId: string; scope: string }): string {
  const token = crypto.randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    "INSERT INTO oauth_refresh_tokens (token_hash, client_id, user_id, scope, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(hash(token), input.clientId, input.userId, input.scope, now + REFRESH_TTL_SECONDS);
  return token;
}

export interface Rotated {
  userId: string;
  scope: string;
  newToken: string;
}

export function rotateRefreshToken(token: string, clientId: string): Rotated | null {
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare("SELECT client_id, user_id, scope FROM oauth_refresh_tokens WHERE token_hash = ? AND expires_at > ?")
    .get(hash(token), now) as { client_id: string; user_id: string; scope: string } | undefined;
  if (!row) return null;
  // Always invalidate the presented token (rotation).
  db.prepare("DELETE FROM oauth_refresh_tokens WHERE token_hash = ?").run(hash(token));
  if (row.client_id !== clientId) return null;
  const newToken = issueRefreshToken({ clientId, userId: row.user_id, scope: row.scope });
  return { userId: row.user_id, scope: row.scope, newToken };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix packages/server -- tests/oauth-refresh.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/oauth-server/refresh.ts packages/server/tests/oauth-refresh.test.ts
git commit -m "feat(oauth): rotating refresh-token store"
```

---

## Task 6: Metadata documents (PRM + AS)

**Files:**
- Create: `packages/server/src/auth/oauth-server/metadata.ts`
- Test: `packages/server/tests/oauth-metadata.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { protectedResourceMetadata, authorizationServerMetadata } from "../src/auth/oauth-server/metadata";

describe("oauth metadata", () => {
  it("PRM points to this server as the auth server and lists the resource", () => {
    const prm = protectedResourceMetadata();
    expect(prm.resource).toMatch(/\/mcp$/);
    expect(prm.authorization_servers.length).toBe(1);
  });

  it("AS metadata advertises code grant + S256 + DCR + public clients", () => {
    const as = authorizationServerMetadata();
    expect(as.response_types_supported).toContain("code");
    expect(as.code_challenge_methods_supported).toContain("S256");
    expect(as.grant_types_supported).toEqual(expect.arrayContaining(["authorization_code", "refresh_token"]));
    expect(as.registration_endpoint).toMatch(/\/register$/);
    expect(as.token_endpoint_auth_methods_supported).toContain("none");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/oauth-metadata.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `metadata.ts`**

```ts
import { config } from "../../config";

const BASE = config.SERVER_PUBLIC_URL;

export function protectedResourceMetadata() {
  return {
    resource: `${BASE}/mcp`,
    authorization_servers: [BASE],
    bearer_methods_supported: ["header"],
    scopes_supported: ["mcp"],
  };
}

export function authorizationServerMetadata() {
  return {
    issuer: BASE,
    authorization_endpoint: `${BASE}/authorize`,
    token_endpoint: `${BASE}/token`,
    registration_endpoint: `${BASE}/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["mcp"],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix packages/server -- tests/oauth-metadata.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/oauth-server/metadata.ts packages/server/tests/oauth-metadata.test.ts
git commit -m "feat(oauth): PRM + AS metadata documents"
```

---

## Task 7: OAuth routes — well-known + /register

**Files:**
- Create: `packages/server/src/api/oauth-routes.ts`
- Test: `packages/server/tests/oauth-routes.test.ts`
- Modify: `packages/server/src/index.ts` (register the routes)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import Fastify from "fastify";
import { registerOAuthRoutes } from "../src/api/oauth-routes";
import { db } from "../src/db";

async function buildApp() {
  const app = Fastify();
  await registerOAuthRoutes(app);
  return app;
}

beforeEach(() => db.exec("DELETE FROM oauth_clients"));

describe("oauth well-known + register", () => {
  it("serves protected-resource metadata", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).resource).toMatch(/\/mcp$/);
  });

  it("serves authorization-server metadata", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server" });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).authorization_endpoint).toMatch(/\/authorize$/);
  });

  it("registers a client via DCR", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/register",
      payload: { client_name: "Claude Code", redirect_uris: ["http://127.0.0.1:33418/cb"] },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.client_id).toMatch(/.+/);
    expect(body.token_endpoint_auth_method).toBe("none");
  });

  it("rejects DCR without redirect_uris", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/register", payload: { client_name: "x" } });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/oauth-routes.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the well-known + /register handlers in `oauth-routes.ts`**

```ts
import { FastifyInstance } from "fastify";
import { protectedResourceMetadata, authorizationServerMetadata } from "../auth/oauth-server/metadata";
import { registerClient } from "../auth/oauth-server/clients";

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/.well-known/oauth-protected-resource", async () => protectedResourceMetadata());
  app.get("/.well-known/oauth-authorization-server", async () => authorizationServerMetadata());

  // Dynamic Client Registration (RFC 7591) — public clients only.
  app.post("/register", async (request, reply) => {
    const body = (request.body ?? {}) as { client_name?: string; redirect_uris?: string[] };
    if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return reply.status(400).send({ error: "invalid_client_metadata", error_description: "redirect_uris required" });
    }
    const client = registerClient({ client_name: body.client_name, redirect_uris: body.redirect_uris });
    return reply.status(201).send({
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  // /authorize and /token are added in Tasks 8 and 9.
}
```

- [ ] **Step 4: Register in `index.ts`**

Add the import near the other route imports:

```ts
import { registerOAuthRoutes } from "./api/oauth-routes";
```

And call it right after `await registerApiRoutes(app);`:

```ts
  await registerOAuthRoutes(app);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --prefix packages/server -- tests/oauth-routes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/api/oauth-routes.ts packages/server/tests/oauth-routes.test.ts packages/server/src/index.ts
git commit -m "feat(oauth): well-known metadata + dynamic client registration endpoints"
```

---

## Task 8: `/authorize` — validate + start login, and Google-SSO resumption

This is the interactive step. `/authorize` validates the request, then needs an authenticated user. Since the browser nav can't read the portal's `localStorage` JWT, `/authorize` round-trips through Google SSO: it stashes the validated authorize request in `pending_auth.session_data` under a ticket, kicks off Google SSO carrying that ticket, and the Google callback (Task 8b) resumes by minting an auth code and redirecting to the client.

**Files:**
- Modify: `packages/server/src/auth/google.ts` (let `buildAuthUrl` accept a `returnTicket`)
- Modify: `packages/server/src/api/oauth-routes.ts` (add `GET /authorize`)
- Modify: `packages/server/src/api/routes.ts` (Google callback resumption)
- Test: `packages/server/tests/oauth-authorize.test.ts`

### Task 8a: `buildAuthUrl` carries a return ticket

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/config", () => ({
  config: {
    GOOGLE_CLIENT_ID: "gid", GOOGLE_CLIENT_SECRET: "gsecret",
    PORTAL_URL: "http://localhost:5173", SERVER_PUBLIC_URL: "http://localhost:3000",
    SESSION_SECRET: "test-session-secret-32-chars-long!!", NODE_ENV: "test",
  },
}));

import { buildAuthUrl } from "../src/auth/google";

describe("buildAuthUrl returnTicket", () => {
  it("encodes the ticket into the OAuth state", () => {
    const url = new URL(buildAuthUrl("ticket-abc"));
    const state = url.searchParams.get("state")!;
    expect(state).toContain("ticket-abc");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/oauth-authorize.test.ts -t returnTicket`
Expected: FAIL — `buildAuthUrl` takes no argument / state has no ticket.

- [ ] **Step 3: Modify `google.ts`**

Read the current `buildAuthUrl` (around line 44-69). Change its signature and the `state` it stores so the ticket survives the round-trip. Replace the `createAuthState(...)` line and the signature:

```ts
// before: export function buildAuthUrl(): string {
export function buildAuthUrl(returnTicket?: string): string {
```

and where `state` is created:

```ts
  // Encode an optional return ticket (e.g. a pending OAuth /authorize request)
  // into the state so the callback can resume the right flow.
  const baseState = createAuthState(crypto.randomUUID(), "google-sso");
  const state = returnTicket ? `${baseState}.${returnTicket}` : baseState;
```

> Note: `verifyAuthState` in the callback must therefore split on the first `.`; do that in Task 8b. The `nonceMap` keying uses `state` as-is — keep using the full `state` string as the nonce key (it already does).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test --prefix packages/server -- tests/oauth-authorize.test.ts -t returnTicket`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/google.ts packages/server/tests/oauth-authorize.test.ts
git commit -m "feat(oauth): buildAuthUrl carries a return ticket through google state"
```

### Task 8b: `/authorize` handler + pending-request store

- [ ] **Step 1: Write the failing test (validation + redirect to Google)**

Append to `tests/oauth-authorize.test.ts`. The test exercises `registerOAuthRoutes` with a registered client and asserts an unauthenticated `/authorize` 302s to Google and persists a pending request.

```ts
import Fastify from "fastify";
import { registerOAuthRoutes } from "../src/api/oauth-routes";
import { registerClient } from "../src/auth/oauth-server/clients";
import { db } from "../src/db";

describe("/authorize", () => {
  it("302s to Google SSO and stores the pending request", async () => {
    db.exec("DELETE FROM oauth_clients");
    db.exec("DELETE FROM pending_auth");
    const c = registerClient({ redirect_uris: ["http://127.0.0.1:33418/cb"] });
    const app = Fastify();
    await registerOAuthRoutes(app);
    const qs = new URLSearchParams({
      response_type: "code", client_id: c.client_id, redirect_uri: "http://127.0.0.1:33418/cb",
      code_challenge: "abc", code_challenge_method: "S256", scope: "mcp", state: "xyz",
    });
    const res = await app.inject({ method: "GET", url: `/authorize?${qs}` });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toContain("accounts.google.com");
  });

  it("400s on an unregistered client", async () => {
    const app = Fastify();
    await registerOAuthRoutes(app);
    const qs = new URLSearchParams({
      response_type: "code", client_id: "nope", redirect_uri: "http://127.0.0.1/cb",
      code_challenge: "abc", code_challenge_method: "S256",
    });
    const res = await app.inject({ method: "GET", url: `/authorize?${qs}` });
    expect(res.statusCode).toBe(400);
  });

  it("400s when redirect_uri is not registered for the client", async () => {
    db.exec("DELETE FROM oauth_clients");
    const c = registerClient({ redirect_uris: ["http://127.0.0.1:33418/cb"] });
    const app = Fastify();
    await registerOAuthRoutes(app);
    const qs = new URLSearchParams({
      response_type: "code", client_id: c.client_id, redirect_uri: "http://evil/cb",
      code_challenge: "abc", code_challenge_method: "S256",
    });
    const res = await app.inject({ method: "GET", url: `/authorize?${qs}` });
    expect(res.statusCode).toBe(400);
  });
});
```

This test imports the real `config` (no mock) for the route file; keep it in a separate `describe`. To avoid the earlier `vi.mock("../src/config")` affecting it, put the `/authorize` describe block in its **own file** `tests/oauth-authorize-routes.test.ts` instead of appending. (The `buildAuthUrl` test needs the mock; the route test needs real config with a real Google client id. Set `GOOGLE_CLIENT_ID` via env in the test: `process.env.GOOGLE_CLIENT_ID ||= "test-gid"` at the top, before importing config — or mock config here too with a Google id.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/oauth-authorize-routes.test.ts`
Expected: FAIL — `/authorize` returns 404 (no handler).

- [ ] **Step 3: Add a pending-authorize store + `/authorize` handler**

Add to `oauth-routes.ts` a small helper that stores the validated request in `pending_auth` (reusing its `session_data` column) under a random ticket, then add the handler. Import at top:

```ts
import crypto from "crypto";
import { config } from "../config";
import { db } from "../db";
import { getClient } from "../auth/oauth-server/clients";
import { buildAuthUrl } from "../auth/google";
```

Helper + handler (inside `registerOAuthRoutes`, before the closing brace):

```ts
  app.get("/authorize", async (request, reply) => {
    const q = request.query as Record<string, string>;
    const client = q.client_id ? getClient(q.client_id) : undefined;
    if (!client) return reply.status(400).send({ error: "invalid_request", error_description: "unknown client_id" });
    if (q.response_type !== "code") return reply.status(400).send({ error: "unsupported_response_type" });
    if (!client.redirect_uris.includes(q.redirect_uri)) {
      return reply.status(400).send({ error: "invalid_request", error_description: "redirect_uri not registered" });
    }
    if (!q.code_challenge || q.code_challenge_method !== "S256") {
      return reply.status(400).send({ error: "invalid_request", error_description: "PKCE S256 required" });
    }

    // Stash the validated request under a ticket; resume after Google SSO.
    const ticket = crypto.randomBytes(16).toString("hex");
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      "INSERT INTO pending_auth (state, user_id, integration, expires_at, session_data) VALUES (?, ?, ?, ?, ?)"
    ).run(
      ticket, "", "__oauth_authorize__", now + 600,
      JSON.stringify({
        clientId: client.client_id,
        redirectUri: q.redirect_uri,
        codeChallenge: q.code_challenge,
        scope: q.scope || "mcp",
        state: q.state || "",
        resource: q.resource || `${config.SERVER_PUBLIC_URL}/mcp`,
      })
    );

    return reply.redirect(buildAuthUrl(ticket));
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix packages/server -- tests/oauth-authorize-routes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/oauth-routes.ts packages/server/tests/oauth-authorize-routes.test.ts
git commit -m "feat(oauth): /authorize validates request + starts SSO with a resume ticket"
```

### Task 8c: Google callback resumes the authorize request

**Files:**
- Modify: `packages/server/src/api/routes.ts` (the `GET /api/auth/google/callback` handler, ~line 53)
- Create: `packages/server/src/auth/oauth-server/resume.ts` (resume helper, so it's unit-testable)
- Test: `packages/server/tests/oauth-resume.test.ts`

- [ ] **Step 1: Write the failing test for the resume helper**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import { db } from "../src/db";
import { resumeAuthorize } from "../src/auth/oauth-server/resume";
import { consumeCode } from "../src/auth/oauth-server/codes";

beforeEach(() => { db.exec("DELETE FROM pending_auth"); db.exec("DELETE FROM oauth_auth_codes"); });

describe("resumeAuthorize", () => {
  it("turns a ticket + userId into a redirect URL carrying a usable code", () => {
    const ticket = "tkt1";
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT INTO pending_auth (state, user_id, integration, expires_at, session_data) VALUES (?,?,?,?,?)")
      .run(ticket, "", "__oauth_authorize__", now + 600, JSON.stringify({
        clientId: "c1", redirectUri: "http://127.0.0.1/cb",
        codeChallenge: crypto.createHash("sha256").update("v").digest("base64url"),
        scope: "mcp", state: "st", resource: "http://x/mcp",
      }));
    const url = resumeAuthorize(ticket, "user-9");
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1\/cb\?/);
    const code = new URL(url!).searchParams.get("code")!;
    expect(new URL(url!).searchParams.get("state")).toBe("st");
    const consumed = consumeCode(code, { clientId: "c1", redirectUri: "http://127.0.0.1/cb", codeVerifier: "v" });
    expect(consumed?.userId).toBe("user-9");
  });

  it("returns null for a non-oauth or missing ticket", () => {
    expect(resumeAuthorize("missing", "u")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/oauth-resume.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `resume.ts`**

```ts
import { db } from "../../db";
import { issueCode } from "./codes";

// Given a resume ticket (stored by /authorize) and the now-authenticated user,
// mint an auth code and return the client redirect URL. null if no such ticket.
export function resumeAuthorize(ticket: string, userId: string): string | null {
  const now = Math.floor(Date.now() / 1000);
  const row = db
    .prepare("SELECT session_data FROM pending_auth WHERE state = ? AND integration = '__oauth_authorize__' AND expires_at > ?")
    .get(ticket, now) as { session_data: string } | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM pending_auth WHERE state = ?").run(ticket);
  const r = JSON.parse(row.session_data) as {
    clientId: string; redirectUri: string; codeChallenge: string; scope: string; state: string; resource: string;
  };
  const code = issueCode({
    clientId: r.clientId, userId, redirectUri: r.redirectUri,
    codeChallenge: r.codeChallenge, scope: r.scope, resource: r.resource,
  });
  const url = new URL(r.redirectUri);
  url.searchParams.set("code", code);
  if (r.state) url.searchParams.set("state", r.state);
  return url.toString();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix packages/server -- tests/oauth-resume.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire the callback to resume**

In `routes.ts`, the Google callback currently (Task references ~line 62-68) does:

```ts
      const { userId, email } = await handleCallback(code, state);
      const token = await signSession({ userId, email });
      const redirect = new URL(config.PORTAL_URL);
      redirect.hash = `token=${token}`;
      return reply.redirect(redirect.toString());
```

`handleCallback` calls `verifyAuthState(state)`. Because Task 8a appended `.<ticket>` to the state, split it before verifying and resume if a ticket is present. Replace the block with:

```ts
      // state may be "<baseState>.<oauthTicket>" when SSO was started by /authorize.
      const dot = state.indexOf(".");
      const baseState = dot === -1 ? state : state.slice(0, dot);
      const oauthTicket = dot === -1 ? null : state.slice(dot + 1);

      const { userId, email } = await handleCallback(code, baseState);

      if (oauthTicket) {
        const { resumeAuthorize } = await import("../auth/oauth-server/resume");
        const redirectUrl = resumeAuthorize(oauthTicket, userId);
        if (redirectUrl) return reply.redirect(redirectUrl);
        // fall through to portal login if the ticket expired
      }

      const token = await signSession({ userId, email });
      const redirect = new URL(config.PORTAL_URL);
      redirect.hash = `token=${token}`;
      return reply.redirect(redirect.toString());
```

> `handleCallback` must verify the **base** state (the value it actually stored via `createAuthState`). The nonce map in `google.ts` is keyed by the full `state` string; `handleCallback`'s nonce lookup uses the full callback `state`, so leave the nonce handling untouched and only split for `verifyAuthState`. If `handleCallback` reads the nonce by the full state internally, confirm it still receives the full `state` — pass the full `state` to `handleCallback` and split only for the `verifyAuthState` call inside it. **Read `handleCallback` before editing** and adjust: the safest change is to make `handleCallback` accept `(code, fullState)` and split internally for `verifyAuthState` while keeping the full state for nonce lookup.

- [ ] **Step 6: Run the full server suite**

Run: `npm test --prefix packages/server`
Expected: all green (existing google/oauth-state tests still pass).

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/auth/oauth-server/resume.ts packages/server/src/api/routes.ts packages/server/tests/oauth-resume.test.ts
git commit -m "feat(oauth): google callback resumes /authorize, mints auth code"
```

---

## Task 9: `POST /token` — code + refresh grants

**Files:**
- Modify: `packages/server/src/api/oauth-routes.ts`
- Test: `packages/server/tests/oauth-token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import crypto from "crypto";
import Fastify from "fastify";
import { registerOAuthRoutes } from "../src/api/oauth-routes";
import { registerClient } from "../src/auth/oauth-server/clients";
import { issueCode } from "../src/auth/oauth-server/codes";
import { verifyAccessToken } from "../src/auth/oauth-server/tokens";
import { db } from "../src/db";

beforeEach(() => {
  db.exec("DELETE FROM oauth_clients");
  db.exec("DELETE FROM oauth_auth_codes");
  db.exec("DELETE FROM oauth_refresh_tokens");
});

async function app() { const a = Fastify(); await registerOAuthRoutes(a); return a; }

describe("POST /token", () => {
  it("exchanges a PKCE code for access + refresh tokens", async () => {
    const c = registerClient({ redirect_uris: ["http://127.0.0.1/cb"] });
    const code = issueCode({
      clientId: c.client_id, userId: "u1", redirectUri: "http://127.0.0.1/cb",
      codeChallenge: crypto.createHash("sha256").update("verifier").digest("base64url"),
      scope: "mcp", resource: "http://x/mcp",
    });
    const a = await app();
    const res = await a.inject({
      method: "POST", url: "/token",
      payload: new URLSearchParams({
        grant_type: "authorization_code", code, client_id: c.client_id,
        redirect_uri: "http://127.0.0.1/cb", code_verifier: "verifier",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token_type).toBe("Bearer");
    expect(body.refresh_token).toBeTruthy();
    expect((await verifyAccessToken(body.access_token)).userId).toBe("u1");
  });

  it("rejects a bad PKCE verifier", async () => {
    const c = registerClient({ redirect_uris: ["http://127.0.0.1/cb"] });
    const code = issueCode({
      clientId: c.client_id, userId: "u1", redirectUri: "http://127.0.0.1/cb",
      codeChallenge: crypto.createHash("sha256").update("right").digest("base64url"),
      scope: "mcp", resource: "http://x/mcp",
    });
    const a = await app();
    const res = await a.inject({
      method: "POST", url: "/token",
      payload: new URLSearchParams({
        grant_type: "authorization_code", code, client_id: c.client_id,
        redirect_uri: "http://127.0.0.1/cb", code_verifier: "wrong",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("refreshes with a refresh_token", async () => {
    const c = registerClient({ redirect_uris: ["http://127.0.0.1/cb"] });
    const code = issueCode({
      clientId: c.client_id, userId: "u1", redirectUri: "http://127.0.0.1/cb",
      codeChallenge: crypto.createHash("sha256").update("v").digest("base64url"),
      scope: "mcp", resource: "http://x/mcp",
    });
    const a = await app();
    const first = JSON.parse((await a.inject({
      method: "POST", url: "/token",
      payload: new URLSearchParams({
        grant_type: "authorization_code", code, client_id: c.client_id,
        redirect_uri: "http://127.0.0.1/cb", code_verifier: "v",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    })).body);
    const res = await a.inject({
      method: "POST", url: "/token",
      payload: new URLSearchParams({
        grant_type: "refresh_token", refresh_token: first.refresh_token, client_id: c.client_id,
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).access_token).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/oauth-token.test.ts`
Expected: FAIL — `/token` 404.

- [ ] **Step 3: Implement `POST /token`**

Fastify parses `application/x-www-form-urlencoded` into an object only if a parser is registered. Register one in `registerOAuthRoutes` (guard against double-registration) and add the handler. Add imports:

```ts
import { consumeCode } from "../auth/oauth-server/codes";
import { issueRefreshToken, rotateRefreshToken } from "../auth/oauth-server/refresh";
import { signAccessToken } from "../auth/oauth-server/tokens";
import { config } from "../config";
```

At the top of `registerOAuthRoutes`, before defining routes:

```ts
  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) => {
        try { done(null, Object.fromEntries(new URLSearchParams(body as string))); }
        catch (e) { done(e as Error); }
      }
    );
  }
```

Handler:

```ts
  app.post("/token", async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, string>;
    const ttl = config.OAUTH_ACCESS_TOKEN_TTL_SECONDS;

    if (b.grant_type === "authorization_code") {
      const consumed = consumeCode(b.code, {
        clientId: b.client_id, redirectUri: b.redirect_uri, codeVerifier: b.code_verifier,
      });
      if (!consumed) return reply.status(400).send({ error: "invalid_grant" });
      const access_token = await signAccessToken({ userId: consumed.userId, scope: consumed.scope, clientId: b.client_id });
      const refresh_token = issueRefreshToken({ clientId: b.client_id, userId: consumed.userId, scope: consumed.scope });
      return reply.send({ access_token, token_type: "Bearer", expires_in: ttl, refresh_token, scope: consumed.scope });
    }

    if (b.grant_type === "refresh_token") {
      const rot = rotateRefreshToken(b.refresh_token, b.client_id);
      if (!rot) return reply.status(400).send({ error: "invalid_grant" });
      const access_token = await signAccessToken({ userId: rot.userId, scope: rot.scope, clientId: b.client_id });
      return reply.send({ access_token, token_type: "Bearer", expires_in: ttl, refresh_token: rot.newToken, scope: rot.scope });
    }

    return reply.status(400).send({ error: "unsupported_grant_type" });
  });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix packages/server -- tests/oauth-token.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/api/oauth-routes.ts packages/server/tests/oauth-token.test.ts
git commit -m "feat(oauth): /token authorization_code + refresh_token grants"
```

---

## Task 10: `/mcp` accepts OAuth Bearer + Bearer challenge

**Files:**
- Modify: `packages/server/src/index.ts` (`/mcp` handler + `getUserIdFromAuth`)
- Test: `packages/server/tests/mcp-oauth-auth.test.ts`

- [ ] **Step 1: Write the failing test**

`getUserIdFromAuth` should accept an OAuth access token via Bearer (in addition to the session JWT).

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/config", () => ({
  config: { SESSION_SECRET: "test-session-secret-32-chars-long!!", SERVER_PUBLIC_URL: "http://localhost:3000", OAUTH_ACCESS_TOKEN_TTL_SECONDS: 3600, NODE_ENV: "test" },
}));

import { signAccessToken } from "../src/auth/oauth-server/tokens";
import { resolveMcpUser } from "../src/auth/oauth-server/resolve";

describe("resolveMcpUser", () => {
  it("accepts an OAuth access token via Bearer", async () => {
    const tok = await signAccessToken({ userId: "u-oauth", scope: "mcp", clientId: "c1" });
    expect(await resolveMcpUser({ authorization: `Bearer ${tok}` })).toBe("u-oauth");
  });

  it("returns null for no auth", async () => {
    expect(await resolveMcpUser({})).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test --prefix packages/server -- tests/mcp-oauth-auth.test.ts`
Expected: FAIL — `resolveMcpUser` module not found.

- [ ] **Step 3: Extract the `/mcp` auth into a testable resolver `auth/oauth-server/resolve.ts`**

```ts
import { verifyApiKey } from "../users";
import { verifySession } from "../session";
import { verifyAccessToken } from "./tokens";

// Resolve the /mcp caller: API key header, then OAuth Bearer, then session JWT.
export async function resolveMcpUser(headers: {
  authorization?: string;
  "x-workbench-api-key"?: string;
}): Promise<string | null> {
  const apiKey = headers["x-workbench-api-key"];
  if (apiKey) {
    const u = verifyApiKey(apiKey);
    if (u) return u;
  }
  const auth = headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7);
    try {
      return (await verifyAccessToken(token)).userId; // OAuth access token
    } catch {
      try {
        return (await verifySession(token)).userId;   // portal session JWT
      } catch {
        return null;
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Use it in `index.ts` `/mcp` and flip the challenge to Bearer**

Replace the `apiKey`/`getUserIdFromAuth` block in the `/mcp` handler with:

```ts
    const userId = await resolveMcpUser(request.headers as Record<string, string>);
    if (!userId) {
      const body = request.body as { id?: string | number | null } | undefined;
      reply.header(
        "WWW-Authenticate",
        `Bearer realm="a-workbench", resource_metadata="${config.SERVER_PUBLIC_URL}/.well-known/oauth-protected-resource"`
      );
      return reply.status(401).send({
        jsonrpc: "2.0",
        id: body?.id ?? null,
        error: { code: -32001, message: "Unauthorized", data: { resource_metadata: `${config.SERVER_PUBLIC_URL}/.well-known/oauth-protected-resource` } },
      });
    }
```

Add the import at the top of `index.ts`:

```ts
import { resolveMcpUser } from "./auth/oauth-server/resolve";
```

`config` is already imported. Leave `getUserIdFromAuth` for the WS path (it stays session-only).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --prefix packages/server -- tests/mcp-oauth-auth.test.ts && npm test --prefix packages/server`
Expected: new tests PASS; full suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/auth/oauth-server/resolve.ts packages/server/src/index.ts packages/server/tests/mcp-oauth-auth.test.ts
git commit -m "feat(oauth): /mcp accepts OAuth Bearer; Bearer challenge with resource_metadata"
```

---

## Task 11: End-to-end smoke + docs

**Files:**
- Modify: `docs/how-to-use.md`
- Modify: `docs/architecture.md`
- Create: `docs/findings/2026-05-31-mcp-oauth.md`

- [ ] **Step 1: Manual end-to-end smoke (real server)**

Run the server (`PORT=3000 node --import tsx --env-file=../../.env src/index.ts` from `packages/server`, with `GOOGLE_CLIENT_ID/_SECRET` set) and verify discovery + 401 challenge:

```bash
curl -s http://localhost:3000/.well-known/oauth-protected-resource | jq .
curl -s http://localhost:3000/.well-known/oauth-authorization-server | jq .
# 401 now advertises Bearer + resource_metadata:
curl -s -D - -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' http://localhost:3000/mcp | grep -i www-authenticate
# DCR:
curl -s -X POST http://localhost:3000/register -H 'content-type: application/json' \
  -d '{"client_name":"cli","redirect_uris":["http://127.0.0.1:33418/cb"]}' | jq .
```

Expected: PRM lists `resource` + `authorization_servers`; the `/mcp` 401 carries `WWW-Authenticate: Bearer ... resource_metadata=...`; `/register` returns a `client_id`.

- [ ] **Step 2: Real client check (Claude Code)**

Configure an MCP server in Claude Code pointing at `http://localhost:3000/mcp` with **no** API key. On connect it should: fetch PRM/AS metadata, register, open the browser to `/authorize`, complete Google SSO, and land authorized. Confirm `tools/list` returns tools afterward. (If the client caches a failed registration, remove and re-add the server.)

- [ ] **Step 3: Docs**

In `how-to-use.md`, under the API-key section, add an "OAuth (browser) login" subsection: clients that support MCP OAuth need only the URL `http://localhost:3000/mcp` — no key; on first connect a browser opens for Google SSO. Note `OAUTH_ACCESS_TOKEN_TTL_SECONDS` in the env table. In `architecture.md`, add a short "MCP authorization" note (resource server + auth server, PKCE, DCR). Write `docs/findings/2026-05-31-mcp-oauth.md` capturing the state-ticket resumption trick and the two-token model (API key vs OAuth Bearer).

- [ ] **Step 4: Commit**

```bash
git add docs/how-to-use.md docs/architecture.md docs/findings/2026-05-31-mcp-oauth.md
git commit -m "docs: MCP OAuth browser flow + findings"
```

---

## Self-Review notes

- **Spec coverage:** PRM (Task 6/7), AS metadata (6/7), DCR (2/7), PKCE auth code (4), `/authorize` with SSO gating (8a–8c), `/token` code+refresh (9), resource-server Bearer acceptance + Bearer challenge (10), discovery/smoke (11). API-key path preserved in Task 10's resolver.
- **Type consistency:** `issueCode`/`consumeCode`, `issueRefreshToken`/`rotateRefreshToken`, `signAccessToken`/`verifyAccessToken`, `registerClient`/`getClient`, `resumeAuthorize`, `resolveMcpUser` names are used identically across tasks.
- **Known integration risk (call out at execution):** Task 8a/8c change the Google `state` shape. Before editing, **read `handleCallback` and the `nonceMap` usage in `google.ts`** — ensure the nonce is still looked up by the value actually stored, and `verifyAuthState` receives the base state. If `handleCallback` currently takes `(code, state)` and uses `state` for both nonce and `verifyAuthState`, refactor it to split internally rather than at the call site. This is the one task most likely to need a fix loop.
- **Security:** public clients (no secret) — security rests on PKCE S256 + exact `redirect_uri` match (enforced in `/authorize` and `consumeCode`); access tokens scoped by `aud=/mcp`; refresh tokens hashed + rotated; auth codes single-use 60s.
- **DB/test hygiene:** every new test file deletes its tables in `beforeEach`; suite runs serialized. Tests currently share the real `./data/tokens.db` — a separate cleanup item (point `DATABASE_URL` at a temp file for tests) is noted below.

## Out of scope (follow-ups)
- Point tests at a temp `DATABASE_URL` so `npm test` stops wiping the dev DB.
- Consent screen (currently auto-approves once SSO'd, since it's the user's own workbench).
- Token revocation endpoint (RFC 7009) and `/authorize` `error` redirects (vs JSON 400) for spec-strict clients.
