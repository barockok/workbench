# a-workbench v0.19.1

_2026-08-03_

Headline: **Bitbucket PR author reviewer bug fix — silent failure when author included in reviewers.**

## Fixes

- **Bitbucket `create_pr` author-as-reviewer bug** — When calling `bitbucket_create_pr` with the PR author's UUID in the `reviewers` array, Bitbucket API fails silently returning `{"reviewers":[]}`. Added validation to filter out PR author from reviewers list before sending to API. (`packages/plugins/atlassian-bitbucket/tools/index.ts`)
- **Documented "upsert" behavior** — `bitbucket_create_pr` updates existing PRs when the same `sourceBranch` is used instead of creating duplicates. Updated tool description to document this behavior.

## Tests

- New unit tests for author validation logic (filter author UUID, handle braces format, warn on exclusion). (`packages/server/tests/bitbucket-tools.test.ts`)

**Full diff:** https://github.com/barockok/workbench/compare/v0.19.0...v0.19.1

---

# a-workbench v0.19.0

_2026-07-27_

Headline: **Keycloak OIDC joins Google as a configurable SSO provider, plus new Bitbucket reviewer tools.**

## Features

- **Keycloak OIDC auth provider** — operators can now wire Keycloak as an SSO option alongside (or instead of) Google. Set `KEYCLOAK_ISSUER_URL`, `KEYCLOAK_CLIENT_ID`, and `KEYCLOAK_CLIENT_SECRET` to enable it. The login page calls `/api/auth/providers` at runtime and renders only the buttons for configured providers — no code changes needed to add or remove providers. Standard OIDC discovery, JWKS token verification, and `keycloak_sub` user upsert. (`packages/server/src/auth/keycloak.ts`, `packages/server/src/api/routes.ts`, `packages/portal/src/pages/Login.tsx`)

- **Bitbucket: reviewer tools** — two new Bitbucket tools:
  - `bitbucket_get_users` — list workspace members and default reviewers for a repo.
  - `bitbucket_create_pull_request` now accepts an optional `reviewers` field to pre-assign reviewers at creation time.
  (`packages/plugins/atlassian-bitbucket/tools/index.ts`)

## Internal

- **Commit-msg hook** — `.githooks/commit-msg` blocks AI co-authorship trailers (`Co-Authored-By: Claude`, `Generated with`, etc.) from landing in commits. Enable once per clone: `git config core.hooksPath .githooks`.
- **Public release hardening** — added `LICENSE` (MIT), `SECURITY.md` (GitHub Security Advisories as the sole vuln-report channel), and `CONTRIBUTING.md`. Scrubbed personal PII and internal references from docs and test fixtures. Added public-repo hygiene guard to `CLAUDE.md`. Removed internal `staging-dir/` staging reports.
- **Test coverage** — extended Bitbucket tool tests to cover `get_users` and the reviewer option on PR creation.

## Commits

- `feat(auth): add Keycloak OIDC provider` (dc82bdf)
- `chore: add tool get users and default reviewer` (e2f1735)
- `chore: add reviewer opt when creating pr` (ec130f6)
- `chore: add commit-msg hook blocking AI co-authorship` (ffcca84)
- `docs: add LICENSE, SECURITY.md, CONTRIBUTING.md for public release` (b79f742)
- `chore: scrub personal PII and internal refs for public release` (53f8098)

**Full diff:** https://github.com/barockok/workbench/compare/v0.18.0...v0.19.0
