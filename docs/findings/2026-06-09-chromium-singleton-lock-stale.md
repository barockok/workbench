# Stale Chromium SingletonLock blocks capture after pod rollout

**Date:** 2026-06-09

## Symptom

Cookie-auth capture / warm browser launch fails with HTTP 500. Server log:

```
chromium exited (code 21) before DevTools came up. stderr:
ERROR:chrome/browser/process_singleton_posix.cc:363 The profile appears to be
in use by another Chromium process (424) on another computer
(a-workbench-555977d5dd-k8f84). Chromium has locked the profile so that it
doesn't get corrupted.
```

Note the hostname in the error (`...555977d5dd-k8f84`) differs from the pod
hitting the error (`...ddbd58996-...`) — a **different deployment hash**, i.e. a
pod that no longer exists.

## Cause

Chromium guards a `--user-data-dir` against concurrent use with three files in
the profile root: `SingletonLock` (a symlink encoding `<hostname>-<pid>`),
`SingletonSocket`, `SingletonCookie`. On startup it reads `SingletonLock`; if it
names a different host it assumes another machine owns the profile and bails
(exit 21).

The profile dir lives on a persistent/shared volume (k8s PVC at
`BROWSER_PROFILES_DIR`). When a pod dies uncleanly — OOM, SIGKILL, or a rolling
deploy — it never removes its singleton files. The next pod mounts the same
volume, finds a lock naming the dead pod's host, and refuses to start.

The in-process `activeProfiles` Set only serializes sessions **within one
process** — it cannot see a lock left by a since-dead pod, so it provides no
protection here.

## Fix

`clearStaleSingletonLocks(userDataDir)` in `profile-chromium.ts`, called right
before spawn. It `rmSync(..., { force: true })`s the three Singleton* files
(ENOENT-safe). Because we already serialize same-process sessions, any lock
present at spawn time is stale by definition, so clearing it is safe — chromium
recreates its own.

## Caveat — true multi-replica concurrency

This fixes the stale-after-death case. It does **not** make it safe for two
*live* replicas to drive the same user's profile at once — clearing a lock held
by a genuinely-running peer could corrupt the profile. If the deployment scales
`a-workbench` beyond one replica, the profile volume must be partitioned per pod
(or sessions routed stickily per user), not shared.
