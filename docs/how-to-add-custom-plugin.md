# Adding a Custom (External) Plugin

This document covers shipping your own plugin **without** committing it to the a-workbench repo — the same shape the built-in plugins use, but loaded from a directory you control on the server. Use this for internal SaaS, private APIs, or anything you don't want upstreamed.

For the built-in plugin model (PR back to this repo, ships with the Docker image), see `architecture.md`.

---

## How loading works

`packages/server/src/plugins/loader.ts::loadPlugins`:

1. Loads the hardcoded **built-in** list (`google-*`, `atlassian-*`, `slack`, `github`, `asana`, `httpbin-cookie`) from `packages/plugins/`.
2. Then scans `config.PLUGINS_DIR` (default `./plugins`, override via the `PLUGINS_DIR` env var) and registers every direct subdirectory that has a valid `manifest.ts` + `tools/index.ts`.

The two paths are equivalent — same `registry.register({integration, tools})` call, same `ctx.http` injection, same OAuth refresh, same MCP exposure (`list_integrations`, `search_tools`, `execute_tool`). Built-in vs external is purely a deployment choice.

Failure isolation: an external plugin that throws on import logs `Failed to load plugin <name>` to stderr; the server keeps booting and other plugins still register.

---

## Minimum plugin layout

```
$PLUGINS_DIR/
└── my-internal-tool/          ← integration name (kebab-case)
    ├── manifest.ts
    └── tools/
        └── index.ts
```

Naming rule: the directory name **must** equal `manifest.default.name`. It's also the prefix the OAuth-creds resolver uses (`MY_INTERNAL_TOOL_CLIENT_ID/_SECRET` — kebab → upper snake).

### `manifest.ts` — OAuth 2.0 plugin

```ts
export default {
  name: "my-internal-tool",
  version: "1.0.0",
  auth: {
    type: "oauth2" as const,
    authorizationUrl: "https://internal.example.com/oauth/authorize",
    tokenUrl: "https://internal.example.com/oauth/token",
    scopes: ["read", "write", "offline_access"],
    // offline_access (or the provider's equivalent) gets you a refresh_token,
    // which ctx.getToken() then uses automatically.
  },
};
```

Required env vars on the server (per [the per-plugin OAuth convention](../packages/server/src/auth/plugin-oauth.ts)):

```bash
MY_INTERNAL_TOOL_CLIENT_ID=...
MY_INTERNAL_TOOL_CLIENT_SECRET=...
```

Redirect URI to register on the provider's OAuth app:
```
${SERVER_PUBLIC_URL}/api/auth/plugin/my-internal-tool/callback
```

### `manifest.ts` — Cookie auth plugin

```ts
export default {
  name: "my-internal-tool",
  version: "1.0.0",
  auth: {
    type: "cookie" as const,
    // The page chromium will navigate to when the user clicks Connect.
    loginUrl: "https://internal.example.com/login",
    // Cookies are captured only for these domains. Suffix-matched against
    // the cookie's `.domain` (with optional leading dot stripped); the
    // top-level domain is included automatically.
    targetDomain: "internal.example.com",
    cookieDomains: [".internal.example.com"],
  },
};
```

No env vars needed for cookie auth.

### Optional presentation metadata

`name`, `version`, and `auth` are the only required fields. Four optional fields control how the integration is presented in the portal and to agents (all backward-compatible):

```ts
export default {
  name: "my-internal-tool",
  version: "1.0.0",
  displayName: "My Internal Tool",          // human label (defaults to name)
  description: "Search and create items.",   // shown on the card + detail view
  logo: "logo.svg",                           // see below
  categories: ["internal", "productivity"],   // drives the portal category filter
  auth: { /* ... */ },
};
```

#### Logo

`logo` is a single string resolved two ways:

- **Bundled file** — a bare filename (e.g. `"logo.svg"`) referencing a file in the **same plugin directory**. The server serves it at `GET /api/integrations/<name>/logo` (content-type by extension; `.svg`/`.png`/`.jpg`/`.webp`). Works for built-in (baked into the image) and external (in `PLUGINS_DIR/<name>/`) plugins alike.
- **Remote URL** — a full `https://…` URL, used as-is by the portal. Easiest for external plugins that don't want to ship a file.

```
$PLUGINS_DIR/my-internal-tool/
├── manifest.ts
├── logo.svg          ← referenced by  logo: "logo.svg"
└── tools/index.ts
```

If `logo` is omitted (or the file is missing), the portal renders a generic cog mark — no error. Built-in logos live next to each manifest in `packages/plugins/<name>/logo.svg`.

### `tools/index.ts`

Each tool is a plain object with `name`, `description`, `integration`, `inputSchema` (Zod), and `handler(ctx, args)`. The loader filters by shape, so you can export as many as you want from this file.

```ts
import { z } from "zod";

export const search = {
  name: "internal_search",
  description: "Full-text search the internal knowledge base",
  integration: "my-internal-tool",
  inputSchema: z.object({
    query: z.string(),
    limit: z.number().default(10),
  }),
  handler: async (ctx: any, args: any) => {
    const params = new URLSearchParams({ q: args.query, limit: String(args.limit) });
    const res = await ctx.http(`https://internal.example.com/api/search?${params}`);
    return res.json();
  },
};

export const createItem = {
  name: "internal_create_item",
  description: "Create a new item",
  integration: "my-internal-tool",
  inputSchema: z.object({
    title: z.string(),
    body: z.string().optional(),
  }),
  handler: async (ctx: any, args: any) => {
    const res = await ctx.http("https://internal.example.com/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return res.json();
  },
};
```

`ctx` is the same `ToolContext` the built-in plugins use:

| Member | What it does |
|---|---|
| `ctx.userId` | The portal-authenticated user (string). |
| `ctx.getToken()` | Returns a valid access token. Auto-refreshes when expiry is within 30s and a `refresh_token` is stored. |
| `ctx.http(url, init?)` | Wraps `fetch`. For oauth2 plugins it injects `Authorization: Bearer <token>` and auto-substitutes the literal `cloud-id` placeholder for Atlassian URLs. For cookie plugins it injects the captured `Cookie` header and refuses URLs whose host is not in the manifest's `cookieDomains`. |

Do **not** call `fetch` directly from a plugin handler — you'll skip auth, the cookie-domain allowlist, and the cloud-id resolver.

---

## Deployment

### Local / `npm run dev`

```bash
# .env
PLUGINS_DIR=/srv/awb-plugins         # or any path you like
MY_INTERNAL_TOOL_CLIENT_ID=...
MY_INTERNAL_TOOL_CLIENT_SECRET=...
```

```bash
mkdir -p /srv/awb-plugins/my-internal-tool/tools
# drop manifest.ts + tools/index.ts in place
npm run dev
```

Server log on boot:
```
Loaded plugin: my-internal-tool
```

### Docker / docker-compose

The image only ships the built-ins. Bind-mount your plugin directory in:

```yaml
# docker-compose.yml
services:
  a-workbench:
    image: a-workbench:latest
    volumes:
      - /srv/awb-plugins:/srv/awb-plugins:ro
    environment:
      - PLUGINS_DIR=/srv/awb-plugins
      - MY_INTERNAL_TOOL_CLIENT_ID=...
      - MY_INTERNAL_TOOL_CLIENT_SECRET=...
```

`:ro` keeps the server from ever mutating your plugin tree.

For Kubernetes the same shape applies — a `configMap` / `Secret` / persistent volume mounted at `PLUGINS_DIR`.

---

## End-to-end verification

After dropping the plugin in:

1. **Server log** shows `Loaded plugin: my-internal-tool`.
2. **Portal dashboard** lists the integration as a card and lets a user connect (OAuth redirect or cookie modal — same flow as built-ins).
3. **MCP**:
   ```bash
   curl -s -X POST $SERVER_PUBLIC_URL/mcp \
     -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
          "params":{"name":"search_tools","arguments":{"query":"internal"}}}'
   ```
   should return your tool definitions. Then call `execute_tool` with the new `integration` / `tool` pair.

---

## Gotchas

- **TypeScript only.** The loader does `import path/manifest.ts` and `import path/tools/index.ts`. In production the server runs under `tsx` (or you've pre-compiled and shipped JS); make sure the runtime your image uses can resolve `.ts` files. For pure `.js` plugins, drop in a small loader patch (or pre-build to `.js` and bind-mount the build output as `manifest.js` + `tools/index.js`).
- **The directory name is the contract.** It feeds the OAuth env-var prefix and the redirect URI. Don't rename it after registering the provider's OAuth app — you'll have to update the callback URL there.
- **No hot reload.** Restart the server (or `docker compose restart`) after changing plugin files.
- **Boot is not blocked on per-plugin failures.** Watch the server log — a typo in `manifest.ts` shows up as `Failed to load plugin <name>` and the integration silently goes missing from the dashboard.
- **Tests cover the framework, not your plugin.** Add your own tests next to your plugin if you need them; this repo's CI doesn't see them.
- **Cookie auth needs `loginUrl` reachable from the server's chromium.** If your internal service is only on a VPN, the a-workbench host needs that VPN too.
- **OAuth `refresh_token` requires the right scope.** Google issues it on `access_type=offline + prompt=consent` (handled automatically in `providerExtraParams`). Atlassian needs `offline_access` in the scope list. Other providers usually need an explicit `offline_access` or `read:user offline_access`.

---

## Reference

- Loader: `packages/server/src/plugins/loader.ts`
- Registry: `packages/server/src/plugins/registry.ts`
- Context (auth injection, cloudId resolver, refresh): `packages/server/src/plugins/context.ts`
- OAuth client lookup: `packages/server/src/auth/plugin-oauth.ts`
- Built-in plugin examples in `packages/plugins/` — copy the layout of any of them for a starting point.
