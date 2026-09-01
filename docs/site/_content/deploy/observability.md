---
title: Observability
description: The Prometheus metrics endpoint and the metrics it emits, OpenTelemetry tracing, and the audit log destinations.
---

Three separate mechanisms: Prometheus metrics on `/metrics`, OpenTelemetry spans,
and an audit log of tool executions. Metrics and the audit log work out of the
box. Tracing needs an exporter you configure yourself.

## Metrics

```bash
curl http://localhost:3000/metrics
```

`GET /metrics` serves a Prometheus text exposition from a dedicated registry. It
includes `collectDefaultMetrics` — Node process, GC, and heap gauges — plus four
custom metrics.

| Metric | Type | Labels | Buckets |
|---|---|---|---|
| `workbench_http_requests_total` | Counter | `method`, `route`, `status` | — |
| `workbench_http_request_duration_seconds` | Histogram | `method`, `route`, `status` | 0.005 → 5, 10 buckets |
| `workbench_tool_executions_total` | Counter | `integration`, `tool`, `success` | — |
| `workbench_tool_execution_duration_seconds` | Histogram | `integration`, `tool`, `success` | 0.05 → 30, 9 buckets |

The two tool metrics are the interesting ones — the per-integration, per-tool
success rate and latency of the handlers agents run:

```promql
sum by (integration) (rate(workbench_tool_executions_total{success="false"}[5m]))

histogram_quantile(0.95,
  sum by (le, integration) (rate(workbench_tool_execution_duration_seconds_bucket[5m])))
```

> [!WARNING] Both tool metrics cover handler execution only
> They are incremented around the handler call, after the connection check and
> argument validation. A call rejected with `NOT_CONNECTED`, or one whose
> arguments fail schema validation, returns before either metric is touched — so
> neither appears in `workbench_tool_executions_total{success="false"}`. Both are
> audit-logged, so query the audit log for those.

HTTP metrics are recorded in request/response hooks, labelled by the matched route
pattern where one exists and the raw URL otherwise. `/metrics` excludes itself, so
scraping does not inflate its own counters.

> [!WARNING] `/metrics` is unauthenticated, and its `route` label is unbounded
> There is no auth on the endpoint. Route labels expose which routes exist and
> tool labels expose which integrations are in use. Worse, an unmatched request
> has no route pattern, so the hook falls back to the raw `request.url` — every
> distinct 404 URL becomes its own label value and its own time series, and a
> scanner hitting random paths grows the registry without limit until the process
> runs out of memory. Keep the endpoint on an internal network or block it at the
> reverse proxy, and rate-limit or drop unmatched paths in front of the server.

There is no log-level setting. The Fastify logger is constructed inline with a
redaction list and nothing else — no `LOG_LEVEL` variable exists in the config
schema or is read from the environment, so the logger runs at Fastify's default
level and the only way to change it is to edit the source.

Because there is no `/health`, `/healthz`, or `/readyz` route anywhere in the
server, and the image declares no `HEALTHCHECK`, `/metrics` is also the only HTTP
endpoint available for an orchestrator liveness probe. A TCP check on the listen
port is the alternative.

## Tracing

OpenTelemetry is initialized for its side effect at server startup. It registers a
`NodeTracerProvider` with an `HttpInstrumentation`, under the service name
`workbench`, and the server code wraps operations in spans through a `withSpan`
helper that sets OK/ERROR status and records exceptions.

The entire setup is wrapped in try/catch and loaded with `require()` rather than
`import`, so a partially installed or version-mismatched OTel dependency logs
`[telemetry] disabled: …` and the server still boots. If you expect traces and see
that line, that is where to look.

> [!NOTE] No exporter is configured in the repository
> The SDK is started with `traceExporter: undefined`. Spans are produced but
> nothing ships them anywhere by default, and there is no OTLP endpoint setting in
> the config schema. Export is configured entirely through the standard `OTEL_*`
> environment variables the SDK reads on its own.

To point it at a collector, set the standard variables on the process:

```bash
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
```

One caveat when correlating: the resource's `service.version` is hardcoded to
`0.1.0` and does not track the release version, so do not group dashboards by it.

## Audit log

Every tool execution is recorded as an audit event with a timestamp, user, tool,
integration, action, success flag, error message, and duration. `AUDIT_LOG_DEST`
selects where it goes.

| Value | Behaviour |
|---|---|
| `sqlite` (default) | `INSERT` into the `audit_log` table through the shared database adapter |
| `stdout` | One JSON line per event on stdout |
| `kafka` | **Not implemented.** Logs "Kafka not implemented, falling back to stdout" to stderr and prints the JSON line |

Despite the name, `sqlite` writes to whichever backend `DATABASE_URL` selects —
including PostgreSQL. The `success` column is bound as a real boolean, because
PostgreSQL rejects `1`/`0` for `BOOLEAN`. `created_at` is unix seconds. Two
indexes support querying: `(user_id, created_at)` and `(integration, created_at)`.

> [!WARNING] Kafka is declared but not connected
> `AUDIT_LOG_KAFKA_BROKERS` and `AUDIT_LOG_KAFKA_TOPIC` are declared in the config
> schema — so setting them is accepted and validated — but no code anywhere reads
> either variable, and the Kafka destination writes to stdout. If you need events
> in Kafka, use `AUDIT_LOG_DEST=stdout` and ship them from your log pipeline.

For shipping to a log aggregator, `stdout` is the destination to use. Note that
Fastify's own request log redacts `Authorization`, `x-workbench-api-key`,
`?token=`, and `?cdpToken=`, but deliberately does not redact `req.url`.
