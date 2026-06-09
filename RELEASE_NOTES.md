# a-workbench v0.8.0

_2026-06-09_

Headline: **Disconnect what you connect** — drop an integration's stored credentials straight from the portal. Plus a browser-use integration card, built-in jot scratchpad deploys, and a `whoami` MCP tool.

## Features
- **Disconnect connected apps.** New `DELETE /api/connections/:integration` (session-auth, scoped to your own user) removes stored credentials — the OAuth token for oauth2 integrations, the captured cookies for cookie integrations. The portal exposes a **Disconnect** button on each connected card and in the integration detail modal, with a confirm dialog. The built-in browser is guarded (400) and unknown integrations 404. Cookie integrations keep their warm browser profile — clear that separately with **Clear session**.
- **Browser-use as an integration card.** The built-in warm-Chromium browser now surfaces in the registry as a first-class, always-on integration card instead of a separate panel.
- **Jot scratchpad deploys.** `deploy_jot` / `list_jots` / `delete_jot` publish a static web artifact as a public/password-gated site at `/j/<name>/`. Global namespace, creator-locked writes, account-less viewing; jot pages are sandboxed (CSP opaque origin) so they can't reach app cookies/APIs.
- **`whoami` MCP tool.** Returns the current authenticated user (id + email) — identity only, not connected integrations.

## Notes
- Docs updated: `how-to-use.md` (Disconnecting an integration; browser tools), `architecture.md` (meta-tools: `whoami`, jot tools).
- Disconnect is per-user and scoped server-side to the authenticated session — a user cannot drop another user's connection.
- Tests: 380 passing (377 server + 3 shared).
