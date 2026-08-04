# Bitbucket PR Author Cannot Be Added as Reviewer

**Date:** 2026-08-03
**Status:** fixed 2026-08-03 — `bitbucket_create_pr` now filters out PR author from reviewers list.
**Scope:** `packages/plugins/atlassian-bitbucket/tools/index.ts`

## The Problem

When calling `bitbucket_create_pr` with the PR author's UUID in the `reviewers` array, the Bitbucket API fails silently — returning `{"reviewers":[]}` with no error message or HTTP error status.

## Investigation

Tested with various reviewer combinations against a real Bitbucket repository:

| Attempt | Format | Reviewers | Result |
|---------|--------|-----------|--------|
| 1 | WITH braces `{uuid}` | 7 (including author) | ❌ Failed |
| 2 | WITHOUT braces `uuid` | 7 (including author) | ❌ Failed |
| 3 | WITHOUT braces `uuid` | 1 (excluding author) | ✅ Success |
| 4 | WITHOUT braces `uuid` | 5 (excluding author) | ✅ Success |
| 5 | WITHOUT braces `uuid` | 6 (excluding author) | ✅ Success |
| 6 | WITH braces `{uuid}` | 6 (excluding author) | ✅ Success |

Confirmed that:
1. Both UUID formats work (with `{uuid}` braces and without)
2. The **only** issue is including the PR author in the reviewers list
3. Bitbucket's `POST /pullrequests` endpoint silently rejects the entire request

## Additional Finding: Upsert Behavior

`bitbucket_create_pr` has "upsert" behavior — if an open PR already exists from the same `sourceBranch`, the tool updates that PR instead of creating a duplicate. This is useful for adding reviewers to existing PRs, but is not obvious from the tool name.

## Fix

1. **Author validation:** Filter out the PR author from reviewers list before sending to API
2. **Documentation:** Updated tool description to document both the author limitation and upsert behavior
3. **Warning logging:** Console warning when author is excluded from reviewers

## Bitbucket API Behavior

- `GET /2.0/user` returns current authenticated user with `uuid` field (with braces)
- `POST /2.0/repositories/{workspace}/{repo_slug}/pullrequests` rejects requests where `reviewers` array contains the author's UUID
- No error message is returned — just `{"reviewers":[]}` in the response
