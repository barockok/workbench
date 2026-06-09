# a-workbench v0.8.2

_2026-06-09_

Headline: **Cookie-capture failures now say why** — when the capture Chromium can't start, the error names the real cause instead of an opaque DevTools timeout.

## Fixes
- **Surface the real reason a capture Chromium fails to launch.** Cookie-auth capture spawns a headless Chromium and polls its DevTools port; if Chromium died on startup the request previously failed with a generic `Failed to reach http://127.0.0.1:<port>/json/version: fetch failed` after a 4s timeout, with the cause discarded (`stdio: "ignore"`). The spawner now captures Chromium's stderr (last 4 KB), detects an early process `exit` (code/signal) and `spawn` errors, and fails fast with a concrete message — e.g. `chromium exited (signal SIGKILL) before DevTools came up. stderr: …` (OOM), namespace/seccomp errors, missing libs, or an unwritable profile dir. A failed launch also SIGKILLs the process so a half-alive Chromium can't leak.

## Notes
- Diagnostics only — no behavior change on the success path. This does not itself fix an environment that can't run Chromium (e.g. a too-tight pod memory limit, restrictive seccomp/`readOnlyRootFilesystem`, or an unwritable `BROWSER_PROFILES_DIR`); it makes that cause visible in the logs so it can be fixed in the deployment.
- Tests: 383 passing (380 server + 3 shared).
