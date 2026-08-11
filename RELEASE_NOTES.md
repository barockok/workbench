# a-workbench v0.23.0

_2026-08-11_

Headline: **Prometheus metrics, cluster mode, and improved observability.**

## Features

- **`GET /metrics` — Prometheus scrape endpoint.** `prom-client` registry with default Node.js process metrics plus four custom metric families:
  - `workbench_http_requests_total{method, route, status}`
  - `workbench_http_request_duration_seconds{method, route, status}` (5ms–5s buckets)
  - `workbench_tool_executions_total{integration, tool, success}`
  - `workbench_tool_execution_duration_seconds{integration, tool, success}` (50ms–30s buckets)

  Scrape at `GET /metrics` — no auth required (ops endpoint, protect at the network layer).

- **Cluster mode via `CLUSTER_ENABLED`.** Set `CLUSTER_ENABLED=true` to fork `os.availableParallelism()` worker processes and use all available CPU cores. The server refuses to start in cluster mode with a SQLite `DATABASE_URL` — requires PostgreSQL. Workers auto-restart on crash.

  ```env
  CLUSTER_ENABLED=true
  DATABASE_URL=postgres://user:pass@host:5432/workbench
  ```

## Fixes

- **Request URLs no longer redacted in access logs.** `req.url` was censored as a precaution against tokens-in-URLs, a pattern that was already removed. Hiding routes made request tracing impossible with no remaining security benefit.

- **Structured tool execution log lines.** Every `execute_tool` / `execute_tools` call now emits a JSON log line with `user_id`, `integration`, `tool`, `success`, and `duration_ms`. Uses pino level conventions (30 = info, 50 = error).

## Commits

- `feat(metrics): add Prometheus /metrics endpoint` (7ef2651)
- `feat(cluster): CLUSTER_WORKERS env to fork N worker processes` (24a0a2a)
- `refactor(cluster): CLUSTER_ENABLED flag, workers = availableParallelism()` (e24476f)
- `fix(logging): unredact req.url, add structured tool execution logs` (a4994e6)

**Full diff:** https://github.com/barockok/workbench/compare/v0.22.0...v0.23.0
