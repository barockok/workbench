# Slack file download: auth-walled URLs + Bearer host scoping

When adding `slack_download_file` (plus `slack_get_file_info`, `slack_get_permalink`,
`slack_join_channel`), two non-obvious things:

## 1. `files:read` scope + login-page-instead-of-403

Slack file attachments live at `url_private` / `url_private_download` (hosts
`slack.com` / `files.slack.com`). Downloading needs the **`files:read`** user
scope; the plugin previously shipped only `files:write`.

Gotcha: when the token can't see a file, Slack does **not** return 401/403 — it
returns **HTTP 200 with the HTML login page**. A naive `res.ok` check hands that
HTML back as if it were the file. `slack_download_file` guards on
`content-type: text/html` and returns `{ok:false, error:"not_authed_or_not_found"}`.

## 2. ctx.http OAuth branch has no host guard — scope the Bearer manually

`ctx.http` attaches the user's Bearer token. Unlike the **cookie** auth branch
(which restricts attachment to declared `cookieDomains` — see
[2026-05-31 cookie domain scoping](2026-05-31-cookie-domain-scoping.md)), the
**OAuth** branch sends the token to whatever URL it's given. `slack_download_file`
takes a caller-supplied URL, so without a guard an attacker-influenced arg would
exfiltrate the Slack token to any host (SSRF / token theft).

Mitigation in the tool:
- Validate the URL is `https:` and host ∈ {`slack.com`, `files.slack.com`,
  `*.slack.com`} **before** the credentialed request.
- Slack file URLs 302 to a **presigned CDN (S3)** that needs no auth. Follow
  redirects manually (`redirect:"manual"`, cap 5): use the credentialed
  `ctx.http` only while still on a Slack host; the moment a hop leaves Slack,
  switch to plain global `fetch` so the token is never redirected off-Slack.
- Reject non-https redirect targets.

Tests: `packages/server/tests/slack-download.test.ts`.

## Scope reconnect

Adding `files:read` + `channels:write` means **existing Slack connections must
reconnect** — old tokens lack the new scopes and will return `missing_scope`.
