# Relative PLUGINS_DIR breaks dynamic plugin import in container

**Date:** 2026-05-30
**Area:** `packages/server/src/plugins/loader.ts`

## Symptom

In the Docker image, every built-in plugin logged on boot:

```
Failed to load plugin slack: Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'plugins' imported from /app/server/plugins/loader.js
```

14 errors per boot. The server still listened and — crucially — all 14 integrations / 80 tools were still registered, so the failure was **cosmetic log spam, not a functional outage**. Caught while validating the release docker build locally (`docker build` + boot smoke test), not in dev.

## Root cause

`loadPlugins()` runs two passes:

1. **Built-in loop** — base path via `findPluginsBasePath()`, which uses `path.resolve(...)` → **absolute** path. Loads all 14 fine.
2. **Dynamic loop** — iterated `config.PLUGINS_DIR` (default `"./plugins"`, also set in `.env`) and passed `path.join(pluginsDir, dir, "manifest.ts")` straight to `import()`.

With a **relative** `pluginsDir`, the dynamic-loop path was relative too (e.g. `plugins/slack/manifest.ts`). Node's ESM resolver treats a relative-looking specifier with no leading `./` as a **bare package specifier** — it looked for a package named `plugins` and threw `ERR_MODULE_NOT_FOUND`.

Why only in the container:
- **Dev:** cwd is `packages/server`, so `./plugins` doesn't exist → dynamic loop is skipped entirely.
- **Container:** cwd is `/app` and `/app/plugins` exists (built-ins are copied there), so the dynamic loop ran over the *same* dirs the built-in loop already loaded — and failed on each.

Note: **vitest does not reproduce this** — it resolves dynamic imports through Vite's resolver, not Node's raw ESM resolver, so the relative path "works" under test. The authoritative reproduction is a real `tsx`/Node boot, i.e. the container.

## Fix

In the dynamic loop:
1. `path.resolve(config.PLUGINS_DIR)` before use, so `import()` always gets an absolute path.
2. Skip dirs whose name is already in `builtinPlugins` — in the image, `PLUGINS_DIR` and the built-in base dir are the same directory; the built-in loop already registered them.

`registry.register` is keyed by `integration.name` (idempotent), so the bug never inflated the integration count — but the redundant re-import was both wasteful and the source of the noise.

## Takeaway

`import()` needs an absolute path or a `./`-prefixed relative specifier. Resolve any config-supplied directory with `path.resolve` before handing it to a dynamic import. Validate release artifacts by booting the actual container — dev and vitest both masked this.
