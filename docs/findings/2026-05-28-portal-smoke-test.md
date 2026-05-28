# Portal smoke test — 2026-05-28

Smoke test via playwright-cli (chrome extension), Google SSO with `<tester>@<workspace>`.

## Setup

- Server: local `tsx` on `:3000`, NOT docker (PID 30607, cwd `packages/server`)
- Portal: vite on `:5173`
- sample-oauth: docker, `:3002`
- API key minted for direct REST: created via `createUser()` after loading server's `ENCRYPTION_KEY` + `SESSION_SECRET` from `ps eww`.

## Verified working

- `/api/auth/google` → returns Google consent URL
- Google SSO flow → callback succeeds, server signs JWT (verified in 302 `location:` header)
- After token injected to `localStorage.awb_token`: `/api/auth/me` returns `{email: "<tester>@<workspace>"}`, dashboard renders 14 integrations
- MCP `tools/list` → 5 meta-tools
- `/api/integrations`, `/api/connections` → all 14 plugins listed

## Bug 1: OAuth callback drops JWT (CRITICAL)

**Symptom:** After Google consent, user bounces back to `/login`. Token never stored.

**Root cause:** `packages/server/src/auth/google.ts` callback redirects to `/#token=...`. `App.tsx` `RequireAuth` sees no user → `<Navigate to="/login" replace />`. React Router `<Navigate>` does not preserve URL fragment, so token is lost before `Login.tsx`'s `useEffect` can parse `window.location.hash`.

**Trace:**
1. Req 51: `GET /api/auth/google/callback` → `302 location: http://localhost:5173/#token=eyJ...`
2. Req 52: `GET /` → SPA loads, hash present
3. App routes `/` → `RequireAuth` → `Navigate("/login")` → hash dropped
4. `Login.tsx` runs on `/login` with empty hash → no token stored

**Fix options:**
- Backend: redirect to `/login#token=...` instead of `/#token=...`.
- Frontend: parse hash in `AuthContext` on mount (route-agnostic) rather than only in `Login.tsx`.

Recommend frontend fix — survives any landing path.

**File refs:**
- `packages/server/src/auth/google.ts` — redirect target
- `packages/portal/src/pages/Login.tsx:10-14` — hash parser
- `packages/portal/src/App.tsx:8` — RequireAuth Navigate

## Bug 2: Portal ships with no CSS (CRITICAL)

**Symptom:** Dashboard renders content but completely unstyled (raw stacked text + native buttons). Tailwind classes in JSX are dead text.

**Root cause:** No CSS imported anywhere.
- `packages/portal/index.html` — no `<link rel="stylesheet">`
- `packages/portal/src/main.tsx` — no `import "./index.css"`
- No `src/*.css` files exist
- `document.styleSheets.length === 0` in browser

**Fix:** Add `src/index.css` with `@tailwind base; @tailwind components; @tailwind utilities;` and import in `main.tsx`. Verify `tailwind.config.*` + `postcss.config.*` exist.

## Reproducer (manual)

```bash
# server (env from running process if needed)
cd packages/server && npm run dev

# portal
cd packages/portal && npm run dev

# attach via playwright
playwright-cli attach --extension=chrome
playwright-cli -s=chrome goto http://localhost:5173/
# click Sign in with Google, pick <tester>@<workspace>
# observe: bounces to /login with empty hash
```

## Workaround used in smoke test

After successful Google callback, copied JWT from 302 `location:` header, injected via:
```
playwright-cli -s=chrome localstorage-set awb_token "<jwt>"
playwright-cli -s=chrome goto http://localhost:5173/
```
Dashboard loads, user identified as `<tester>@<workspace>`, all 14 integrations enumerated.
