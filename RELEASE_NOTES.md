# a-workbench v0.13.1

_2026-06-14_

Headline: **GitHub OAuth connect fixed** — patch release.

## Fixes
- **GitHub OAuth connect failed with "Unexpected token"**: GitHub's token endpoint returns a form-urlencoded body by default (`access_token=...&scope=...&token_type=bearer`), so `exchangeCode()`'s `response.json()` threw on the callback. The token POST now sends `Accept: application/json`, which GitHub honors to return JSON; JSON-only providers (Google, Atlassian) ignore it harmlessly. See `docs/findings/2026-06-14-github-token-form-encoded.md`.
