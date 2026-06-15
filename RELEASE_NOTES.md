# a-workbench v0.15.0

_2026-06-15_

Headline: **Connected Agents — see and revoke the agents connected to your Workbench, right from the dashboard.**

## Features

- **Connected Agents panel.** The portal dashboard now lists every agent (OAuth client) connected to your Workbench and lets you revoke any of them in one click. Revoking drops the agent's refresh tokens, so it can no longer mint new access tokens — the connection is cut at the next refresh.
  - New API: `GET /api/agents` (list connected agents) and `DELETE /api/agents/:id` (revoke), backed by a `listAgents` / `revokeAgent` module in the OAuth server. (`packages/server/src/api/routes.ts`, `packages/server/src/auth/oauth-server/agents.ts`)
  - Dashboard UI: an `AgentsPanel` wired into the portal dashboard with its API helpers. (`packages/portal/src/components/AgentsPanel.tsx`, `packages/portal/src/api.ts`, `packages/portal/src/pages/Dashboard.tsx`)
- **Refresh tokens now track `created_at`**, so the panel can show when each agent first connected. (`packages/server/src/auth/oauth-server/refresh.ts`, `packages/server/src/db.ts`)

## Fixes

- Dropped an unused `db.transaction` wrapper (untyped in better-sqlite3, unused elsewhere). (`packages/server`)

## Tests

- New `packages/server/tests/agents.test.ts` covering list + revoke.

## Upgrade notes

- Additive release — no scope changes, no breaking API changes. Existing connections keep working; the Connected Agents panel appears on the dashboard after upgrade.
