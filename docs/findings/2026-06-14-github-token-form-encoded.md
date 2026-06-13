# GitHub token exchange returns form-urlencoded → JSON parse error

**Date:** 2026-06-14
**Area:** `packages/server/src/auth/oauth.ts` — `exchangeCode()`

## Symptom

Connecting the GitHub plugin failed on the OAuth redirect/callback with an
"Unexpected token" error (JSON parse failure), not an HTTP error.

## Cause

GitHub's token endpoint (`https://github.com/login/oauth/access_token`)
defaults to a **form-urlencoded** response body when no `Accept` header is
sent:

```
access_token=gho_xxx&scope=repo&token_type=bearer
```

`exchangeCode()` called `response.json()` on that body → parse throws
"Unexpected token". The request succeeded (HTTP 200), so `response.ok` passed;
the failure surfaced only at JSON decode.

This bit GitHub specifically. Google and Atlassian token endpoints return JSON
regardless of `Accept`, so the missing header went unnoticed until a
form-encoded provider was added.

## Fix

Send `Accept: application/json` on the token POST. GitHub honors it and returns
JSON; the JSON-only providers ignore it harmlessly.

```ts
headers: {
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
},
```

## Notes / untested

- The refresh path (`context.ts` `refreshAccessToken()`) has the same missing
  `Accept` header but is not hit by GitHub: classic GitHub OAuth App tokens do
  not expire, so no refresh occurs. If GitHub App tokens or token expiration is
  enabled later, add `Accept: application/json` there too.
- Any future provider whose token endpoint defaults to form-encoded would have
  hit the same bug; the `Accept` header now covers them.
