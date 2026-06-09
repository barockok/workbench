# a-workbench v0.7.0

_2026-06-08_

Headline: **API keys are retrievable again** — minted keys are no longer shown only once. Plus friendlier cookie import and a clearer integration registry.

## Features
- **Revealable API keys.** The MCP access key is now stored encrypted (reversibly) alongside its bcrypt hash, so it can be retrieved after minting instead of shown once. New `GET /api/keys/reveal` (session-auth) and a **Reveal key** button in the portal.
- **Bare-array cookie import.** `POST /api/integrations/:integration/session/import` now accepts a raw cookie array — at the body root (`[...]`) or under `session` — and auto-wraps it into a `{ cookies }` bundle. The existing `{ session: { cookies } }` shape still works.
- **Integration registry sort + gating.** The list reports a `configured` flag per integration (cookie → always; oauth2 → only when client creds are present; otherwise false). The dashboard sorts **live > available > not configured**, and not-configured cards are dimmed and unclickable.

## Notes
- Security tradeoff: the API key is now recoverable from the DB if `ENCRYPTION_KEY` leaks. Consistent with how cookies and OAuth tokens are already stored for this self-hosted, owner-only tool.
- Docs updated: `how-to-use.md` (Reveal key), `how-to-onboard.md` (key retrievable).
- Tests: 325 passing.
