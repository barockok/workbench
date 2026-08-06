# Browser profiles grow without bound — nothing ever reclaims them

**Date:** 2026-08-06
**Symptom that started this:** cookie-auth connect felt slow.
**What it actually was:** the profile volume was 88% full and still climbing.

## The hypothesis that was wrong

The first theory was storage: profiles sit on a network-backed volume, and
`--disable-dev-shm-usage` (added 2026-05-31, see
[root chromium needs --no-sandbox](2026-05-31-root-chromium-no-sandbox.md))
pushes chromium's scratch I/O from `/dev/shm` onto that volume, so every launch
pays network-storage latency.

Measured on the running instance before changing anything:

| Probe | Result |
|---|---|
| filesystem type | `ext4` on a local block device — not a network mount |
| sequential write | 256 MB/s |
| small-file write | ~11 ms including fork/exec |

Storage speed was never the problem. Recorded here so the theory doesn't get
revived: the flag is fine, the volume is fine.

## What the same probe found instead

```
9.8G volume, 8.6G in browser profiles, 1.2G free
141 profiles, ~61 MB average
```

Per-profile breakdown of a representative 437 MB profile:

| Path | Size | Kind |
|---|---:|---|
| `Default/Cache` + `Default/Code Cache` | 392 MB | regenerable |
| `Safe Browsing` (profile root) | ~21 MB | regenerable, and identical in every profile |
| `IndexedDB` + `Local Storage` + `History` + `Cookies` | ~4 MB | **the reason the profile is persistent at all** |

Across 141 profiles the Safe Browsing blocklist alone accounted for 2.85 G —
one third of the volume — storing the same phishing list 141 times for a headless
browser nobody browses with.

Every profile had been touched within 60 days, so this is not a graveyard of
abandoned profiles that a staleness sweep would clear. It is the working set,
and it grew ~143 MB/day against 1.2 G of headroom.

## Root cause

Grep of every deletion path in the repo:

- `resetBrowserProfile()` (`auth/cookie.ts`) is the only function that deletes a
  persistent profile directory, and its only caller is a manual, user-triggered
  API route.
- `closeBrowserSession()` kills the process and drops the in-memory session. It
  does not touch disk.
- `reapIdleSessions()` only calls `closeBrowserSession()`.

Nothing automatically reclaims profile disk. It has been that way since profiles
became persistent.

### This is a regression of an already-fixed bug

[2026-05-30 abandoned cookie session leak](2026-05-30-abandoned-cookie-session-leak.md)
fixed a leak of `mkdtempSync` session directories by adding a reaper. The
architecture then moved from throwaway temp dirs to persistent per-user profiles
(`userProfileDir`) — and the reaper was never extended to cover them. The same
leak came back wearing different clothes: a disk leak instead of a process leak.

The lesson generalizes: when a resource changes lifetime from "per session" to
"per user", its cleanup path has to be re-derived, not inherited.

## Fix

Three layers, cheapest first:

1. **Don't download what we don't use.** `--disable-background-networking`
   (this is what pulls the Safe Browsing list and component updates),
   `--disable-component-update`, `--disable-client-side-phishing-detection`,
   `--disable-sync`, `--disable-breakpad`, plus `--disk-cache-size` to cap the
   HTTP cache. Stops ~2.9 G of the growth at the source.
2. **Trim on process exit.** When a chromium exits, delete the regenerable parts
   of its profile — caches, shader caches, Safe Browsing, crash dumps — and keep
   cookies, local storage, IndexedDB and history. Nobody gets logged out. Hooked
   on the process `exit` event rather than inside `closeBrowserSession` so a
   crashed or reaped browser is cleaned up on the same path.
3. **Sweep periodically.** `reapProfileDisk()` trims every profile that has no
   live session, and deletes whole profiles unused past
   `BROWSER_PROFILE_TTL_DAYS` (default 30, `0` disables). Deletion is the only
   destructive step — it logs that user out of every cookie-auth integration —
   so its default is deliberately far more conservative than the trim.

Profiles with a live session are skipped: chromium holds the user-data-dir open.

### Staleness must not be read from the directory mtime

Trimming a profile mutates its directory mtime, so a reaper that reads the
directory's own mtime keeps resetting the clock and never expires anything. The
sweep reads `Default/Cookies` / `Default/Preferences` instead — files chromium
writes when the profile is genuinely used and the trim never touches.

## Also added: per-stage spawn timings

The investigation started with "connect is slow" and no way to tell where the
time went. `spawnProfileChromium` now returns `prepareMs` / `devtoolsMs` /
`targetMs` / `totalMs` and logs them. A total is unactionable; the split
distinguishes chromium's own startup from our polling and from page load.

## Config

| Env | Default | Meaning |
|---|---|---|
| `BROWSER_PROFILE_TTL_DAYS` | `30` | delete a profile unused this long; `0` = never |
| `BROWSER_PROFILE_REAP_INTERVAL_SECONDS` | `3600` | sweep interval |
| `BROWSER_DISK_CACHE_MB` | `32` | per-profile HTTP cache cap |
| `BROWSER_PROFILES_DIR` | *(unset)* | **see below** |

## Deployment note — the latent failure this exposed

`BROWSER_PROFILES_DIR` was unset, so `profilesBaseDir()` falls back to
`dirname(DATABASE_URL)/browser-profiles`. Profiles therefore land on the same
volume as the SQLite token database — not by anyone's decision, just by default.
When that volume fills, SQLite writes fail and **every** connection breaks, for
reasons that have nothing to do with browsers.

Set `BROWSER_PROFILES_DIR` to a separate volume in any deployment where the
token database matters. The cleanup above buys headroom; separating the volumes
is what removes the shared-fate failure mode.
