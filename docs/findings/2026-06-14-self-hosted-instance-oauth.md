# 2026-06-14 — Per-connection instance URL for self-hosted OAuth (GitLab)

## Problem

GitHub/Bitbucket plugins hardcode one API base and one pair of OAuth URLs in the
manifest. That breaks for products that run on per-customer hosts — GitLab can be
gitlab.com **or** any self-hosted origin (`https://gitlab.acme.com:8443`). The
authorize URL, token URL, refresh URL, and REST base all depend on a value only
the user knows at connect time. Nothing in the platform carried per-connection
configuration.

## Mechanism added

A small, backward-compatible "instance" capability threaded end-to-end:

1. **Manifest** (`shared/src/types.ts`): `OAuthConfig.instance?` = `{ label,
   placeholder, default }`. Presence means "prompt for an instance origin". The
   manifest's `authorizationUrl`/`tokenUrl` are the **cloud default**; for a
   custom instance the server keeps their *path* and swaps in the user's origin.

2. **Per-connection config** (`db.ts`): new `connections.config` TEXT (JSON,
   plaintext — no secrets) and `pending_auth.config` to carry it through the
   handshake. Both added as idempotent `ALTER TABLE` migrations.

3. **Resolution** (`auth/plugin-oauth.ts`):
   - `normalizeInstanceUrl()` — reduce user input to a bare http(s) origin.
   - `resolveOAuthUrls(auth, configJson)` — return authorize/token URLs, origin-
     swapped when `instance` + config are present, else the static URLs.
   `buildPluginAuthUrl(userId, integration, instanceUrl?)` validates + stores
   `{instanceUrl}` in the auth state; the callback reads it back, exchanges
   against the instance token URL, and persists it on the connection.

4. **Refresh** (`plugins/context.ts`): `refreshAccessToken` resolves the token
   URL via `resolveOAuthUrls(integ.auth, data.config)` so rotation hits the right
   host. `TokenData.config` is preserved across re-stores (and `storeToken` uses
   `COALESCE` so a config-less refresh never wipes it).

5. **Tools**: `ctx.getConfig()` exposes the parsed config. GitLab tools build
   `${getConfig().instanceUrl || "https://gitlab.com"}/api/v4`.

6. **Portal**: `/api/integrations` exposes `instance`; `Dashboard.handleConnect`
   prompts (prefilled with `default`) and passes `?instanceUrl=` to
   `/api/auth/:integration`.

## Security: the instance origin receives the client secret

The user-entered origin is where the server POSTs the token exchange — which
carries the shared `GITLAB_CLIENT_SECRET`. Unrestricted, any authenticated user
could set `instanceUrl=https://attacker.com` and exfiltrate the secret (or SSRF
an internal host). Controls in `plugin-oauth.ts`:

- `normalizeInstanceUrl` — https only (no plaintext secret), reject `user:pass@`
  userinfo, block private/loopback/link-local IP literals (incl. 169.254.169.254
  cloud metadata).
- `isInstanceAllowed(integration, default, origin)` — origin must equal the
  manifest cloud default **or** appear in `<PREFIX>_ALLOWED_INSTANCES`
  (`GITLAB_ALLOWED_INSTANCES`). With no env allowlist, only the cloud default is
  permitted. Enforced in `buildPluginAuthUrl` (the only path that writes config).
- Refresh/callback re-derive URLs from the stored config, which was validated at
  connect time — they don't trust fresh user input.

The IP-literal block is best-effort (no DNS resolution, so DNS-rebinding to an
internal IP via an allowlisted name is still possible); the allowlist is the real
containment. Don't allowlist a host you don't control.

## Gotchas

- The single `GITLAB_CLIENT_ID/SECRET` pair is shared across all instances a
  deployment talks to — fine for gitlab.com or one controlled self-hosted target,
  not for many unrelated instances. Keying creds by instance would need
  `getPluginOAuthCreds` work.
- GitLab projects are addressed by URL-encoded `namespace/path` **or** numeric id;
  `encodeURIComponent` handles both. MRs/issues use per-project `iid`, not global id.
- Global blob (code) search needs Advanced Search on self-hosted — scope to a
  project instead.
