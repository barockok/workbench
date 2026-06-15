# Triggering CI: GitHub Actions, GitLab Pipelines, Bitbucket Pipelines

Added trigger/poll/rerun/cancel tools across the three git providers. Per-provider
quirks worth noting:

## GitHub Actions
- **Trigger**: `POST /repos/{o}/{r}/actions/workflows/{workflow}/dispatches`,
  `{ref, inputs}`. `workflow` is the file name (`ci.yml`) or numeric id.
  - The workflow file MUST declare `on: workflow_dispatch` — otherwise **422**.
  - Returns **204 No Content with no body** → no run id. Caller must poll
    `github_list_workflow_runs` (filter `event=workflow_dispatch` / branch) to
    find the created run, then `github_get_workflow_run`.
- **Rerun**: `runs/{id}/rerun` (all) or `runs/{id}/rerun-failed-jobs`; success = **201**.
- **Cancel**: `runs/{id}/cancel`; success = **202**.
- **Scope**: `repo` (already granted) covers Actions write for OAuth — no manifest change.

## GitLab Pipelines
- **Trigger**: `POST /projects/:id/pipeline`, `{ref, variables}`.
  - `variables` is a **`[{key, value}]` array**, not an object — the tool maps the
    caller's `{K: V}` object into that shape.
  - Needs a `.gitlab-ci.yml` on that ref or **400**.
- **Retry**: `pipelines/:id/retry` · **Cancel**: `pipelines/:id/cancel` — both return the pipeline.
- **Scope**: `api` (already granted) covers it — no manifest change.

## Bitbucket Pipelines
- **Trigger**: `POST /repositories/{ws}/{repo}/pipelines/` (note trailing slash),
  body `{target: {ref_type:"branch", type:"pipeline_ref_target", ref_name}}`.
  Custom pipeline → add `target.selector = {type:"custom", pattern}`.
  - Variables go at the **body root** (NOT under `target`): `variables: [{key, value, secured}]`.
    The tool maps `{KEY: value}` + a `secured` name-list into that shape.
  - Requires **Pipelines enabled** on the repo.
- **Get**: `pipelines/{uuid}` · **Stop**: `pipelines/{uuid}/stopPipeline` (204).
- State nests under `state.name` / `state.result.name` / `state.stage.name` —
  slimmed to `{state, result}`.
- **Scope**: needs **`pipeline` + `pipeline:write`** — **added to manifest**, so
  existing Bitbucket connections must **reconnect** to pick them up.

Tests: `packages/server/tests/ci-trigger.test.ts`.
