---
title: Slack
description: Connect Slack so an agent can post, search, read history, and handle files as the connecting user.
---

The Slack integration acts **as the person who connected it**, not as a bot. Messages it posts show that user's name. `slack_search_all` searches what that user can see. Channel history covers the private channels and DMs that user belongs to. This is a deliberate choice, because several of these tools have no bot-token equivalent, and it drives the whole app setup.

## At a glance

| | |
|---|---|
| Plugin id | `slack` |
| Auth | OAuth 2.0, **user token** |
| Tools | 18 |
| Authorization URL | `https://slack.com/oauth/v2/authorize` |
| Token URL | `https://slack.com/api/oauth.v2.access` |
| Proxy base | `https://slack.com/api` |

The server sends the manifest's scopes in the `user_scope` parameter, and reads the resulting token from `authed_user.access_token` in the response.

## Set up the OAuth app

> [!NOTE] The console steps are Slack's UI, not this server's
> Menu names, labels, and page URLs below come from Slack's console and change
> without notice. If what you see differs, follow [Slack's own documentation](https://api.slack.com/authentication/oauth-v2) — the values this server needs (the callback URL and the scopes in the tables
> below) are unaffected.

:::steps
### Create the app

[api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**. Name it and pick a development workspace.

### Add the redirect URL

**OAuth & Permissions** → **Redirect URLs** → **Add New Redirect URL**:

```
https://<your-workbench-host>/api/auth/plugin/slack/callback
```

For local development add `http://localhost:3000/api/auth/plugin/slack/callback`. Save URLs.

### Add all 16 scopes under User Token Scopes

On the same page, scroll to **Scopes**. There are two boxes. Put every scope from the table below in **User Token Scopes**. Leave **Bot Token Scopes** empty.

### Copy the credentials

**Settings → Basic Information → App Credentials**: Client ID, and Client Secret via *Show*.

### Distribute, if others will connect

**Settings → Manage Distribution** → work through the checklist → **Activate Public Distribution**. Until then only your development workspace can install.
:::

> [!WARNING] Bot Token Scopes is the wrong box
> This is the failure that costs the most time. The manifest's scopes are sent as `user_scope`, so every scope below belongs in the console's **User Token Scopes** list. Put them in the bot list instead, and the two sets do not match. The install then fails. The error Slack returns does not name which box is at fault. [Slack's OAuth documentation](https://api.slack.com/authentication/oauth-v2) covers the bot/user token split.

## Scopes

All 16 are user scopes.

| Scope | What it is for |
|---|---|
| `chat:write` | Post, edit, and delete messages as the user |
| `channels:read` | List public channels |
| `channels:write` | Join a public channel |
| `groups:read` | List private channels the user belongs to |
| `im:read` | List direct-message conversations |
| `mpim:read` | List group direct messages |
| `channels:history` | Read public channel history |
| `groups:history` | Read private channel history |
| `im:history` | Read direct-message history |
| `mpim:history` | Read group direct-message history |
| `reactions:write` | Add and remove reaction emoji |
| `users:read` | List users and read profiles |
| `users:read.email` | Read email addresses — needed to look a user up by email |
| `files:write` | Upload files |
| `files:read` | Read file metadata and download file contents |
| `search:read` | Search messages and files |

The manifest pairs `users:read.email` with `users:read`. It requests `search:read` as a user scope, which is one of the reasons this integration uses a user token. Slack defines what each scope grants, and which are available as bot rather than user scopes. See [Slack's scope reference](https://api.slack.com/scopes).

## Server configuration

```bash
SLACK_CLIENT_ID=...
SLACK_CLIENT_SECRET=...
```

## Connect

Portal: Connections → **Connect** on the Slack card → approve in Slack.

Agent:

```
connect({ integration: "slack" })
wait_for_connection({ connectionId })
```

## Tools

| Tool | Purpose |
|---|---|
| `slack_send_message` | Post to a channel, or reply in a thread with `threadTs` |
| `slack_update_message` | Edit an existing message by channel and `ts` |
| `slack_delete_message` | Permanently delete a message — irreversible |
| `slack_send_dm` | Send a direct message to a user |
| `slack_list_channels` | List channels |
| `slack_join_channel` | Join a public channel so its history is readable |
| `slack_get_channel_history` | Read a channel's messages |
| `slack_get_thread_replies` | Read the replies in a thread |
| `slack_get_permalink` | Get a shareable permalink for a message |
| `slack_add_reaction` | Add a reaction emoji |
| `slack_remove_reaction` | Remove a reaction you added |
| `slack_search_all` | Search messages and files across the workspace |
| `slack_lookup_user` | Exact-email lookup returning a slim user |
| `slack_find_users` | Fuzzy find by name or email, falling back to substring match |
| `slack_list_users` | Page through workspace members, bots and deactivated included |
| `slack_upload_file` | Upload a file to a channel |
| `slack_get_file_info` | File metadata, including the download URL |
| `slack_download_file` | Download a file by its private URL |

## Notes and gotchas

> [!WARNING] `slack_download_file` guards its own credential
> Slack file URLs redirect to a presigned CDN host. The tool checks that the URL is https on `slack.com`, `files.slack.com`, or a `*.slack.com` subdomain **before** it attaches the token. It then follows the redirect chain itself, at most five requests in total, so at most four redirects. It drops the bearer the moment the host stops being Slack, so the token cannot be redirected off-platform. It rejects non-https redirects outright.
>
> It also treats a `text/html` response as `not_authed_or_not_found` rather than returning the bytes. Slack answers an unauthorized file request with **200 and a login page**, not a 403. A status-code check alone would therefore hand you a login page as if it were your file. If you see that error, the usual cause is a missing `files:read` grant.

`slack_delete_message` is marked destructive in its own description and cannot be undone. Keep the `ts` from `slack_send_message` if you may later edit or delete what you posted.

Slack's Web API answers errors with HTTP 200 and `{ "ok": false, "error": "..." }`. The server relies on this when it handles the token exchange, and the tools pass the envelope straight through. A tool result that looks successful but carries `ok:false` is a failure. Read the `error` field.

Reading a channel the user has not joined commonly returns `not_in_channel` — `slack_join_channel` fixes it for public channels.

`slack_upload_file` uses Slack's external upload flow: `files.getUploadURLExternal`, then `files.completeUploadExternal`. It does not use `files.upload`, which was not usable from a newly created app when the integration was built. See [Slack's file-upload documentation](https://api.slack.com/messaging/files) for the current state of those methods.

Adding a scope after users have connected requires each of them to reconnect. Slack does not upgrade an existing grant.
