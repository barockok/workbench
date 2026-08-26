# a-workbench v0.24.0

_2026-08-26_

Headline: **Curl proxy — transparent API access via short-lived session tokens.**

## Features

- **`curl_session` meta-tool + `/c/<integration>/<path>` proxy.** Agents can mint a 15-minute bearer token and hit any curl-proxy-enabled integration's REST API directly — GET/POST/PUT/PATCH/DELETE — with the real credential injected transparently server-side. Opt-in per integration via a manifest `proxy` flag; enabled on asana, bitbucket, confluence, jira, github, gitlab, all google-* plugins, newrelic, and slack. Dynamic base-URL resolvers handle integrations whose API host isn't static (jira/confluence instance URLs, self-hosted gitlab, newrelic US/EU region).
- **High-risk guardrail on `curl_session`'s description.** Because the token grants arbitrary-method access including destructive writes, the tool description now flags it as high-risk up front and instructs the calling agent to name the integration(s) and intended action and get explicit user approval before minting, instead of minting speculatively. Prompt-level guardrail only — no code-level approval gate yet.

## Commits

- `feat: curl proxy — transparent API access via short-lived session tokens` (ab80478)
- `feat(plugins): enable curl proxy on static-baseUrl integrations` (8556734)
- `feat(proxy): dynamic base URL resolvers for jira, confluence, gitlab, newrelic` (859b9c3)
- `feat(mcp): add high-risk guardrail to curl_session tool description` (59283af)

**Full diff:** https://github.com/barockok/workbench/compare/v0.23.3...v0.24.0
