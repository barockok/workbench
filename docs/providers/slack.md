# Slack — OAuth Credential Setup

Plugin: `packages/plugins/slack`
Auth type: OAuth 2.0 (v2 — bot tokens + user tokens via `xoxp`)
Last verified against official docs: 2026-05-27

Scopes used (from `manifest.ts`):
`chat:write`, `channels:read`, `groups:read`, `im:read`, `mpim:read`, `files:write`, `users:read.email`

---

## 1. Create the Slack app

1. Open https://api.slack.com/apps → **Create New App** → **From scratch**
2. App name: `a-workbench`
3. Pick the workspace to develop in (you can distribute later)
4. **Create App**

> For multi-workspace use, plan to enable **Public Distribution** (Settings → Manage Distribution). Until then, only your dev workspace can install.

## 2. Configure OAuth & Permissions

Left sidebar → **OAuth & Permissions**.

### Redirect URLs
**Add New Redirect URL**:
```
https://<your-a-workbench-host>/api/auth/slack/callback
```
Local dev:
```
http://localhost:3000/api/auth/slack/callback
```
**Save URLs**.

### Bot Token Scopes

Add each scope from the plugin manifest:

| Scope | Purpose |
|---|---|
| `chat:write` | Post messages as the bot |
| `channels:read` | List public channels |
| `groups:read` | List private channels the bot is in |
| `im:read` | List DM conversations |
| `mpim:read` | List multi-person DM conversations |
| `files:write` | Upload files |
| `users:read.email` | Read user email addresses (sensitive — counts toward review) |

> `users:read.email` requires `users:read` as a baseline — Slack auto-suggests this when you add it.

### User Token Scopes
Leave empty unless your tools need to act as the installing user (acting as the bot is preferred).

## 3. Grab credentials

Settings → **Basic Information** → **App Credentials**:

- **Client ID**
- **Client Secret** — click *Show*
- **Signing Secret** — needed only if you wire Slack Events/Slash commands later

```bash
SLACK_CLIENT_ID=1234567890.1234567890
SLACK_CLIENT_SECRET=abc123...
```

## 4. Install to the dev workspace

OAuth & Permissions → **Install to <Workspace>** → grant. Returns a bot token `xoxb-…`. The plugin captures this automatically via the callback — no need to copy by hand for normal flows.

## 5. Distribution (multi-workspace)

When ready for external installs:
1. Settings → **Manage Distribution** → review checklist (redirect URLs use HTTPS, no hardcoded info, etc.)
2. Click **Activate Public Distribution**
3. Optionally submit to Slack Marketplace (extra review).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `bad_redirect_uri` | URL not in **Redirect URLs** list, or scheme mismatch (Slack requires HTTPS in production) |
| `invalid_scope` | Scope name typo or scope requires another scope (e.g. `users:read.email` needs `users:read`) |
| Bot can't post to private channel | Bot must be invited (`/invite @your-bot`) — `groups:read` only lists, doesn't grant write |
| `not_in_channel` | Same — invite the bot |
| `missing_scope` after upgrade | Re-install the app; scope additions require fresh install/consent |

## References

- Slack apps overview — https://docs.slack.dev/quickstart
- OAuth v2 flow — https://docs.slack.dev/authentication/installing-with-oauth
- Scope reference — https://docs.slack.dev/reference/scopes
- Distribution checklist — https://docs.slack.dev/distribution/public-distribution
