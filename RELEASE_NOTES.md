# a-workbench v0.9.2

_2026-06-09_

Headline: **Browser capture survives pod rollouts** — a stale Chromium profile lock left by a dead pod no longer blocks the next one.

## Fixes
- **Clear stale Chromium `Singleton*` locks before launch.** Chromium guards a `--user-data-dir` with `SingletonLock` (a `<host>-<pid>` symlink), `SingletonSocket`, and `SingletonCookie`. When the profile lives on a persistent/shared volume and a pod dies uncleanly (OOM, SIGKILL, rolling deploy), those files survive and name a host that no longer exists — so the next pod's Chromium exits with code 21 (`profile appears to be in use … on another computer`) before DevTools comes up, surfacing as a 500 on capture / warm-browser launch. `spawnProfileChromium` now removes the three `Singleton*` files immediately before spawn; since same-process sessions are already serialized via `activeProfiles`, any lock present is stale by definition.

## Notes
- This fixes the stale-after-death case only. It does **not** make two *live* replicas driving one user's profile concurrently safe — clearing a lock held by a running peer can corrupt the profile. If `a-workbench` scales past one replica, partition the profile volume per pod (or sticky-route per user). See `docs/findings/2026-06-09-chromium-singleton-lock-stale.md`.
- Tests: 412 passing (409 server + 3 shared).
