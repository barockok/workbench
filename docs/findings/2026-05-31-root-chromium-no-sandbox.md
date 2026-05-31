# Cookie-auth capture fails in container — chromium as root needs `--no-sandbox`

**Date:** 2026-05-31
**Area:** `packages/server/src/auth/cookie.ts` (`startCookieSession`)

## Symptom

In the Docker image, clicking **Connect** on any cookie-auth integration (httpbin, and external plugins like ng-mis / superset) failed. Server log:

```
Failed to reach http://127.0.0.1:<port>/json/version: TypeError: fetch failed
    at pollJson (/app/server/auth/cookie.js:57)
    at async startCookieSession (/app/server/auth/cookie.js:112)
    at async Object.<anonymous> (/app/server/api/routes.js:220)
```

`startCookieSession` spawns headless chromium with `--remote-debugging-port`, then polls `/json/version` until the DevTools endpoint comes up. The fetch failed because **chromium never started**.

## Root cause

The container runs as **root** (`USER` is not set in the Dockerfile, so PID 1 / the node process is uid 0). Chromium's zygote refuses to launch as root unless `--no-sandbox` is passed:

```
ERROR:zygote_host_impl_linux.cc] Running as root without --no-sandbox is not supported. See https://crbug.com/638180.
```

The spawn args in `cookie.ts` had no `--no-sandbox`, so chromium exited immediately, the CDP port never opened, and `pollJson` timed out with `fetch failed`. This broke **all** cookie auth in the published image — not just locally.

## Verification

Launching the baked chromium binary inside the container reproduced it exactly:

- without `--no-sandbox` → `Running as root without --no-sandbox is not supported`, process dies.
- with `--no-sandbox --disable-dev-shm-usage` → process stays alive, `/json/version` returns `Chrome/148...`.

Then calling the real compiled `startCookieSession` returned a valid `{ sessionId, cdpUrl: ws://127.0.0.1:.../devtools/page/... }`.

## Fix

Add to the chromium spawn args in `cookie.ts`:

- `--no-sandbox` — required because the container is root. Harmless when not root.
- `--disable-dev-shm-usage` — containers have a small default `/dev/shm`; without this chromium can crash under memory pressure when rendering.

## Takeaway

Server-side headless chromium in a rootful container always needs `--no-sandbox`. Local dev on macOS hid this — the dev user isn't root, so chromium launched fine and tests (which don't spawn the capture browser) never exercised it. The bug only surfaced by actually clicking Connect against the Docker image. Smoke-test the cookie-capture path **in the container**, not just on the host.

Longer term, consider running the container as a non-root user (drop the `--no-sandbox` requirement) — but that needs the chromium sandbox's kernel capabilities, which many container runtimes restrict, so `--no-sandbox` is the pragmatic default.
