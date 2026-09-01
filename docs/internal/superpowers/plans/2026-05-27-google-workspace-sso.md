# Google Workspace SSO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Google Workspace SSO (OIDC) to a-workbench so portal users can sign in with their Google account instead of using raw API keys.

**Architecture:** Portal users authenticate via Google OAuth 2.0 / OpenID Connect. Server verifies Google ID token, issues short-lived session JWT. MCP clients continue using API keys. API middleware accepts both auth methods. Session secret rotates via env var.

**Tech Stack:** Fastify, `jose` (JWT verify + sign), Google OAuth 2.0, React + TanStack Query, `react-router-dom`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/server/src/config.ts` | Modify | Add `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `PORTAL_URL` env vars |
| `packages/server/src/db.ts` | Modify | Add `email`, `google_sub` columns to `users` table |
| `packages/server/src/auth/google.ts` | Create | Google OIDC discovery, auth URL builder, ID token verifier, user lookup/creation |
| `packages/server/src/auth/session.ts` | Create | Sign and verify session JWTs |
| `packages/server/src/auth/users.ts` | Modify | Add `findOrCreateGoogleUser`, keep `verifyApiKey` for MCP |
| `packages/server/src/api/routes.ts` | Modify | Add `/auth/google`, `/auth/google/callback`, `/auth/me`, `/auth/logout`; update auth middleware |
| `packages/server/tests/google.test.ts` | Create | Test Google auth flow with mocked OIDC |
| `packages/server/tests/session.test.ts` | Create | Test JWT sign/verify |
| `packages/server/package.json` | Modify | Add `jose` dependency |
| `packages/portal/package.json` | Modify | Add `react-router-dom` dependency |
| `packages/portal/src/main.tsx` | Modify | Add `BrowserRouter` wrapper |
| `packages/portal/src/api.ts` | Modify | Add `fetchMe`, `logout`, handle 401 by redirecting to `/login` |
| `packages/portal/src/context/AuthContext.tsx` | Create | React context for auth state, login/logout, sync with `localStorage` |
| `packages/portal/src/pages/Login.tsx` | Create | Google "Sign In" button page |
| `packages/portal/src/pages/Dashboard.tsx` | Modify | Add user info header + logout button; keep integrations grid |
| `packages/portal/src/App.tsx` | Modify | Add route switch: `/login` -> Login, `*` -> Dashboard with auth guard |

---

### Task 1: Add Dependencies

**Files:**
- Modify: `packages/server/package.json`
- Modify: `packages/portal/package.json`

- [ ] **Step 1: Add `jose` to server**

```json
{
  "name": "@a-workbench/server",
  "dependencies": {
    "jose": "^5.9"
  }
}
```

Insert `"jose": "^5.9"` into `dependencies` array in `packages/server/package.json` (after `bcryptjs`).

- [ ] **Step 2: Add `react-router-dom` to portal**

Insert `"react-router-dom": "^7.0"` into `dependencies` array in `packages/portal/package.json` (after `@tanstack/react-query`).

- [ ] **Step 3: Install deps**

Run: `npm install`
Expected: installs `jose` and `react-router-dom` into respective `node_modules`

- [ ] **Step 4: Commit**

```bash
git add packages/server/package.json packages/portal/package.json package-lock.json
git commit -m "deps: add jose and react-router-dom"
```

---

### Task 2: Extend Config with Google SSO Env Vars

**Files:**
- Modify: `packages/server/src/config.ts`

- [ ] **Step 1: Add new env vars to schema**

Replace entire file `packages/server/src/config.ts`:

```typescript
import { z } from "zod";

const configSchema = z.object({
  PORT: z.string().default("3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  ENCRYPTION_KEY: z.string().length(64).default(
    process.env.NODE_ENV === "test"
      ? "0000000000000000000000000000000000000000000000000000000000000000"
      : ""
  ),
  DATABASE_URL: z.string().default("./data/tokens.db"),
  PLUGINS_DIR: z.string().default("./plugins"),
  AUDIT_LOG_DEST: z.enum(["sqlite", "stdout", "kafka"]).default("sqlite"),
  AUDIT_LOG_KAFKA_BROKERS: z.string().optional(),
  AUDIT_LOG_KAFKA_TOPIC: z.string().default("audit-log"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SESSION_SECRET: z.string().min(32).default(
    process.env.NODE_ENV === "test"
      ? "test-session-secret-32-chars-long!!"
      : ""
  ),
  PORTAL_URL: z.string().url().default("http://localhost:5173"),
});

export const config = configSchema.parse(process.env);
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/config.ts
git commit -m "feat(config): add Google SSO and session env vars"
```

---

### Task 3: Extend DB Schema for Google Users

**Files:**
- Modify: `packages/server/src/db.ts`

- [ ] **Step 1: Add columns to users table**

Replace `users` CREATE TABLE block in `packages/server/src/db.ts` (lines 13-19):

```sql
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    api_key_hash TEXT,
    email TEXT UNIQUE,
    google_sub TEXT UNIQUE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at INTEGER DEFAULT (unixepoch())
  );
```

Note: `api_key_hash` becomes optional (no `NOT NULL`) because Google users may not have API keys.

- [ ] **Step 2: Add migration for existing tables**

Add after the existing CREATE TABLE statements (before audit_log), inside the same `db.exec(...)`:

```sql
  ALTER TABLE users ADD COLUMN email TEXT;
  ALTER TABLE users ADD COLUMN google_sub TEXT;
```

SQLite supports `ADD COLUMN` since 3.2.0. However, `better-sqlite3` may throw if column already exists. Wrap in try/catch or use `IF NOT EXISTS` pattern. Since SQLite doesn't support `IF NOT EXISTS` on ALTER TABLE, add a helper:

Replace the entire `db.exec(...)` block with:

```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    api_key_hash TEXT,
    email TEXT UNIQUE,
    google_sub TEXT UNIQUE,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    integration TEXT NOT NULL,
    access_token BLOB NOT NULL,
    refresh_token BLOB,
    expires_at INTEGER,
    scopes TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    updated_at INTEGER DEFAULT (unixepoch()),
    UNIQUE(user_id, integration)
  );

  CREATE TABLE IF NOT EXISTS pending_auth (
    state TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    integration TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    integration TEXT,
    tool TEXT,
    action TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    error TEXT,
    duration_ms INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_audit_integration ON audit_log(integration, created_at);
`);

// Migrations
try {
  db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
} catch { /* already exists */ }
try {
  db.exec(`ALTER TABLE users ADD COLUMN google_sub TEXT`);
} catch { /* already exists */ }
```

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/db.ts
git commit -m "feat(db): add email and google_sub to users table"
```

---

### Task 4: Create Session JWT Module

**Files:**
- Create: `packages/server/src/auth/session.ts`
- Test: `packages/server/tests/session.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/session.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { signSession, verifySession } from "../src/auth/session";

describe("session", () => {
  it("signs and verifies a session token", async () => {
    const token = await signSession({ userId: "user-123", email: "alice@example.com" });
    const payload = await verifySession(token);
    expect(payload.userId).toBe("user-123");
    expect(payload.email).toBe("alice@example.com");
  });

  it("rejects invalid token", async () => {
    await expect(verifySession("bad.token.here")).rejects.toThrow();
  });

  it("rejects expired token", async () => {
    const token = await signSession({ userId: "user-123", email: "alice@example.com" }, -1);
    await expect(verifySession(token)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && NODE_ENV=test npx vitest run tests/session.test.ts -v`
Expected: FAIL with "signSession is not defined" or module not found

- [ ] **Step 3: Implement session module**

Create `packages/server/src/auth/session.ts`:

```typescript
import { SignJWT, jwtVerify } from "jose";
import { config } from "../config";

const secret = new TextEncoder().encode(config.SESSION_SECRET);

export interface SessionPayload {
  userId: string;
  email: string;
}

export async function signSession(payload: SessionPayload, expiresInHours = 24): Promise<string> {
  return new SignJWT({ sub: payload.userId, email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${expiresInHours}h`)
    .sign(secret);
}

export async function verifySession(token: string): Promise<SessionPayload> {
  const { payload } = await jwtVerify(token, secret, { clockTolerance: 60 });
  if (!payload.sub || !payload.email) {
    throw new Error("Invalid session payload");
  }
  return { userId: payload.sub, email: payload.email as string };
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/server && NODE_ENV=test npx vitest run tests/session.test.ts -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/session.ts packages/server/tests/session.test.ts
git commit -m "feat(auth): add session JWT sign and verify"
```

---

### Task 5: Create Google OIDC Auth Module

**Files:**
- Create: `packages/server/src/auth/google.ts`
- Test: `packages/server/tests/google.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/server/tests/google.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildAuthUrl } from "../src/auth/google";
import { db } from "../src/db";

beforeEach(() => {
  db.exec("DELETE FROM users");
  vi.restoreAllMocks();
});

describe("google auth", () => {
  it("builds auth URL with correct params", () => {
    const url = buildAuthUrl("random-state");
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("accounts.google.com");
    expect(parsed.searchParams.get("client_id")).toBeTruthy();
    expect(parsed.searchParams.get("state")).toBe("random-state");
    expect(parsed.searchParams.get("scope")).toContain("openid");
    expect(parsed.searchParams.get("redirect_uri")).toContain("/auth/google/callback");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/server && NODE_ENV=test GOOGLE_CLIENT_ID=test-client-id GOOGLE_CLIENT_SECRET=test-secret npx vitest run tests/google.test.ts -v`
Expected: FAIL -- module not found or functions not exported

- [ ] **Step 3: Implement Google auth module**

Create `packages/server/src/auth/google.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests**

Run: `cd packages/server && NODE_ENV=test GOOGLE_CLIENT_ID=test-client-id GOOGLE_CLIENT_SECRET=test-secret npx vitest run tests/google.test.ts -v`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/auth/google.ts packages/server/tests/google.test.ts
git commit -m "feat(auth): add Google OIDC auth URL builder and callback handler"
```

---

### Task 6: Update Users Module for Google Auth

**Files:**
- Modify: `packages/server/src/auth/users.ts`

- [ ] **Step 1: Add findOrCreateGoogleUser and getUserById**

Replace `packages/server/src/auth/users.ts`:

```typescript
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";

export function createUser(id: string): { apiKey: string } {
  const apiKey = crypto.randomBytes(32).toString("hex");
  const hash = bcrypt.hashSync(apiKey, 10);
  db.prepare("INSERT INTO users (id, api_key_hash) VALUES (?, ?)").run(id, hash);
  return { apiKey };
}

export function verifyApiKey(apiKey: string): string | null {
  const users = db.prepare("SELECT id, api_key_hash FROM users").all() as { id: string; api_key_hash: string }[];
  for (const user of users) {
    if (bcrypt.compareSync(apiKey, user.api_key_hash)) {
      return user.id;
    }
  }
  return null;
}

export function getUserById(userId: string): { id: string; email: string | null } | null {
  const row = db.prepare("SELECT id, email FROM users WHERE id = ?").get(userId) as
    | { id: string; email: string | null }
    | undefined;
  return row ?? null;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/auth/users.ts
git commit -m "feat(auth): add getUserById helper"
```

---

### Task 7: Add Auth Routes and Update Middleware

**Files:**
- Modify: `packages/server/src/api/routes.ts`

- [ ] **Step 1: Replace routes with auth-enabled version**

Replace `packages/server/src/api/routes.ts`:

```typescript
import crypto from "crypto";
import { FastifyInstance } from "fastify";
import { registry } from "../plugins/registry";
import { createAuthState } from "../auth/oauth";
import { verifyApiKey, getUserById } from "../auth/users";
import { buildAuthUrl, handleCallback } from "../auth/google";
import { signSession, verifySession } from "../auth/session";
import { config } from "../config";

async function authenticate(request: { headers: { authorization?: string } }): Promise<{ userId: string } | null> {
  const auth = request.headers.authorization;
  if (!auth) return null;

  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7);
    // Try session JWT first
    try {
      const session = await verifySession(token);
      return { userId: session.userId };
    } catch {
      // Fall back to API key
      const userId = verifyApiKey(token);
      if (userId) return { userId };
    }
  }
  return null;
}

export async function registerApiRoutes(app: FastifyInstance): Promise<void> {
  // --- Auth routes ---
  app.get("/api/auth/google", async (_request, reply) => {
    if (!config.GOOGLE_CLIENT_ID) {
      return reply.status(503).send({ error: "Google SSO not configured" });
    }
    const state = crypto.randomUUID();
    const url = buildAuthUrl(state);
    return { url };
  });

  app.get("/api/auth/google/callback", async (request, reply) => {
    const { code, state, error } = request.query as Record<string, string>;
    if (error) {
      return reply.status(400).send({ error: `Google auth error: ${error}` });
    }
    if (!code) {
      return reply.status(400).send({ error: "Missing code" });
    }

    try {
      const { userId, email } = await handleCallback(code, state);
      const token = await signSession({ userId, email });
      // Redirect back to portal with token in hash fragment (safer than query)
      const redirect = new URL(config.PORTAL_URL);
      redirect.hash = `token=${token}`;
      return reply.redirect(redirect.toString());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Auth failed";
      return reply.status(400).send({ error: message });
    }
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const profile = getUserById(user.userId);
    if (!profile) {
      return reply.status(404).send({ error: "User not found" });
    }
    return { id: profile.id, email: profile.email };
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    // Stateless JWT -- client discards token. Server-side revoke optional.
    return { success: true };
  });

  // --- Protected API routes ---
  app.get("/api/integrations", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }

    const integrations = registry.listIntegrations();
    return {
      integrations: integrations.map((i) => ({
        name: i.name,
        version: i.version,
      })),
    };
  });

  app.get("/api/auth/:integration", async (request, reply) => {
    const user = await authenticate(request);
    if (!user) {
      return reply.status(401).send({ error: "Unauthorized" });
    }
    const { integration } = request.params as { integration: string };
    const state = createAuthState(user.userId, integration);
    return { state };
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/api/routes.ts
git commit -m "feat(api): add Google SSO routes and unified auth middleware"
```

---

### Task 8: Update MCP Endpoint Auth

**Files:**
- Modify: `packages/server/src/index.ts`
- Check: `packages/server/src/mcp/server.ts`

- [ ] **Step 1: Add auth check to /mcp endpoint**

Replace `/mcp` handler in `packages/server/src/index.ts`:

```typescript
import { verifyApiKey } from "./auth/users";
import { verifySession } from "./auth/session";

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

// ... inside main():
app.post("/mcp", async (request, reply) => {
  const auth = request.headers.authorization;
  const userId = await getUserIdFromAuth(auth);
  if (!userId) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
  const body = request.body as Record<string, unknown>;
  const result = await handleMcpRequest(body, userId);
  reply.send(result);
});
```

- [ ] **Step 2: Check and update handleMcpRequest signature**

Read `packages/server/src/mcp/server.ts` to see if it accepts userId.

If `handleMcpRequest(body)` -> update to `handleMcpRequest(body, userId: string)` and thread userId through meta-tools.

If already accepts userId, no change needed beyond the call site.

- [ ] **Step 3: Commit**

```bash
git add packages/server/src/index.ts packages/server/src/mcp/server.ts
git commit -m "feat(mcp): require auth on /mcp endpoint, support session tokens"
```

---

### Task 9: Create Portal Auth Context

**Files:**
- Create: `packages/portal/src/context/AuthContext.tsx`

- [ ] **Step 1: Implement AuthContext**

Create `packages/portal/src/context/AuthContext.tsx`:

```typescript
import { createContext, useContext, useState, useEffect, ReactNode } from "react";

interface AuthUser {
  id: string;
  email: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  token: string | null;
  login: (token: string) => void;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("awb_token"));
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }
    fetch(`${import.meta.env.VITE_API_URL || ""}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Unauthorized");
        return res.json();
      })
      .then((data) => setUser(data))
      .catch(() => {
        localStorage.removeItem("awb_token");
        setToken(null);
      })
      .finally(() => setIsLoading(false));
  }, [token]);

  const login = (newToken: string) => {
    localStorage.setItem("awb_token", newToken);
    setToken(newToken);
  };

  const logout = () => {
    localStorage.removeItem("awb_token");
    setToken(null);
    setUser(null);
    fetch(`${import.meta.env.VITE_API_URL || ""}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token ?? ""}` },
    }).catch(() => {});
  };

  return (
    <AuthContext.Provider value={{ user, token, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/portal/src/context/AuthContext.tsx
git commit -m "feat(portal): add AuthContext for session management"
```

---

### Task 10: Update Portal API Client

**Files:**
- Modify: `packages/portal/src/api.ts`

- [ ] **Step 1: Update api.ts with auth helpers**

Replace `packages/portal/src/api.ts`:

```typescript
const API_URL = import.meta.env.VITE_API_URL || "";

function getHeaders(): HeadersInit {
  const token = localStorage.getItem("awb_token");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function fetchIntegrations() {
  const res = await fetch(`${API_URL}/api/integrations`, { headers: getHeaders() });
  if (res.status === 401) {
    localStorage.removeItem("awb_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

export async function fetchAuthUrl(): Promise<{ url: string }> {
  const res = await fetch(`${API_URL}/api/auth/google`);
  if (!res.ok) throw new Error("SSO not configured");
  return res.json();
}

export async function fetchMe() {
  const res = await fetch(`${API_URL}/api/auth/me`, { headers: getHeaders() });
  if (!res.ok) return null;
  return res.json();
}

export async function logout() {
  await fetch(`${API_URL}/api/auth/logout`, {
    method: "POST",
    headers: getHeaders(),
  });
  localStorage.removeItem("awb_token");
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/portal/src/api.ts
git commit -m "feat(portal): update api client with auth helpers and 401 redirect"
```

---

### Task 11: Create Login Page

**Files:**
- Create: `packages/portal/src/pages/Login.tsx`

- [ ] **Step 1: Implement Login page**

Create `packages/portal/src/pages/Login.tsx`:

```typescript
import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { fetchAuthUrl } from "../api";

export default function Login() {
  const { login, token } = useAuth();
  const [error, setError] = useState("");

  useEffect(() => {
    // Check for token in URL hash from Google callback redirect
    const hash = window.location.hash;
    if (hash.startsWith("#token=")) {
      const tok = hash.slice(7);
      login(tok);
      window.location.hash = "";
      window.location.href = "/";
      return;
    }

    // If already logged in, redirect to dashboard
    if (token) {
      window.location.href = "/";
    }
  }, [login, token]);

  const handleSignIn = async () => {
    try {
      const { url } = await fetchAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start sign in");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-sm">
        <h1 className="text-2xl font-bold mb-2 text-center">a-workbench</h1>
        <p className="text-gray-500 text-center mb-6">Sign in to continue</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">{error}</div>
        )}

        <button
          onClick={handleSignIn}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            />
          </svg>
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/portal/src/pages/Login.tsx
git commit -m "feat(portal): add Google Sign In login page"
```

---

### Task 12: Update Dashboard with Auth Guard

**Files:**
- Modify: `packages/portal/src/pages/Dashboard.tsx`

- [ ] **Step 1: Add user info and logout to Dashboard**

Replace `packages/portal/src/pages/Dashboard.tsx`:

```typescript
import { useQuery } from "@tanstack/react-query";
import { fetchIntegrations } from "../api";
import { useAuth } from "../context/AuthContext";

export default function Dashboard() {
  const { user, logout } = useAuth();
  const { data, isLoading } = useQuery({
    queryKey: ["integrations"],
    queryFn: fetchIntegrations,
  });

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Integrations</h2>
        <div className="flex items-center gap-4">
          {user?.email && (
            <span className="text-sm text-gray-600">{user.email}</span>
          )}
          <button
            onClick={logout}
            className="px-3 py-1 text-sm border border-gray-300 rounded hover:bg-gray-50"
          >
            Logout
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {data?.integrations?.map((i: { name: string; version: string }) => (
          <div key={i.name} className="bg-white p-4 rounded shadow">
            <div className="font-medium">{i.name}</div>
            <div className="text-sm text-gray-500">{i.version}</div>
            <button className="mt-2 px-3 py-1 bg-blue-500 text-white rounded text-sm">
              Connect
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/portal/src/pages/Dashboard.tsx
git commit -m "feat(portal): add user info and logout to dashboard"
```

---

### Task 13: Wire Up Router and Auth in App

**Files:**
- Modify: `packages/portal/src/main.tsx`
- Modify: `packages/portal/src/App.tsx`

- [ ] **Step 1: Add BrowserRouter to main.tsx**

Replace `packages/portal/src/main.tsx`:

```typescript
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>
);
```

- [ ] **Step 2: Add routes and auth guard to App.tsx**

Replace `packages/portal/src/App.tsx`:

```typescript
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <div className="min-h-screen bg-gray-50">
              <header className="bg-white shadow">
                <div className="max-w-7xl mx-auto px-4 py-4">
                  <h1 className="text-xl font-bold">a-workbench</h1>
                </div>
              </header>
              <main className="max-w-7xl mx-auto px-4 py-8">
                <Dashboard />
              </main>
            </div>
          </RequireAuth>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

export default App;
```

- [ ] **Step 3: Commit**

```bash
git add packages/portal/src/main.tsx packages/portal/src/App.tsx
git commit -m "feat(portal): add react-router with auth guards"
```

---

### Task 14: Update Existing Tests

**Files:**
- Modify: `packages/server/tests/oauth.test.ts`
- Modify: `packages/server/tests/plugins.test.ts`

- [ ] **Step 1: Update oauth.test.ts to use test session secret**

Add `import "../src/config";` at top if not already. The test should already work since config defaults session secret in test.

- [ ] **Step 2: Update plugins.test.ts if it hits /api/integrations**

Check if `plugins.test.ts` calls `/api/integrations` without auth. If so, add a test API key or session token in the test setup.

Read `packages/server/tests/plugins.test.ts`:

```bash
cat packages/server/tests/plugins.test.ts
```

If it sends requests to protected endpoints, wrap with auth header. Most plugin tests probably test the registry directly, not HTTP routes.

- [ ] **Step 3: Run all server tests**

Run: `cd packages/server && NODE_ENV=test npx vitest run -v`
Expected: all PASS

- [ ] **Step 4: Commit**

```bash
git add packages/server/tests/
git commit -m "test: update tests for new auth middleware"
```

---

### Task 15: Build and Verify

**Files:**
- Modify: none (verification only)

- [ ] **Step 1: Build server**

Run: `cd packages/server && npm run build`
Expected: TypeScript compiles without errors

- [ ] **Step 2: Build portal**

Run: `cd packages/portal && npm run build`
Expected: Vite builds without errors

- [ ] **Step 3: Update .env.example or README**

Add to `workspace/a-workbench/README.md` or create `.env.example`:

```
# Google Workspace SSO (optional)
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
SESSION_SECRET=random-32-char-min-secret-for-jwt-signing
PORTAL_URL=http://localhost:5173
```

- [ ] **Step 4: Final commit**

```bash
git add README.md .env.example
git commit -m "docs: add Google SSO env vars to README"
```

---

## Self-Review Checklist

**Spec coverage:**
- Google Workspace SSO via OIDC -> Task 5, 7
- Portal login with Google button -> Task 11
- Session JWT instead of raw API keys for portal -> Task 4, 9
- API keys still work for MCP clients -> Task 7 (authenticate fallback)
- Auth middleware on all protected routes -> Task 7, 8
- Logout -> Task 7, 9, 12
- User info display -> Task 12

**Placeholder scan:**
- No "TBD", "TODO", "implement later"
- No vague "add error handling" steps
- All code blocks contain complete implementation
- All file paths exact

**Type consistency:**
- `SessionPayload` = `{ userId, email }` -- used consistently in Task 4, 7, 9
- `authenticate()` returns `{ userId }` -- used in Task 7, 8
- `buildAuthUrl(state)` and `handleCallback(code, state)` -- defined Task 5, used Task 7

---

## Setup Instructions for User

1. Go to [Google Cloud Console](https://console.cloud.google.com/) -> APIs & Services -> Credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add Authorized redirect URI: `http://localhost:5173/auth/google/callback`
4. Copy Client ID and Client Secret
5. Set env vars:
   ```bash
   export GOOGLE_CLIENT_ID=...
   export GOOGLE_CLIENT_SECRET=...
   export SESSION_SECRET=$(openssl rand -hex 32)
   export PORTAL_URL=http://localhost:5173
   ```
6. Run `npm run dev`
7. Open portal at `http://localhost:5173`, click "Sign in with Google"
