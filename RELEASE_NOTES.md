# a-workbench v0.12.0

_2026-06-12_

Headline: **Browser & jots become registry plugins** — the MCP tool list shrinks from 20 to 8.

## Breaking
- **`browser_*` and jot tools are no longer top-level MCP tools.** The 9 `browser_*` tools and `deploy_jot`/`list_jots`/`delete_jot` moved into the registry as internal plugins, reached the same way as every integration tool: `search_tools` → `execute_tool("browser_navigate", {url})`. MCP clients with hardcoded top-level calls must switch to the dispatch path. `tools/list` now exposes only the 8 dispatch/auth meta-tools.

## Changes
- **Internal plugins, deliberately not `PLUGINS_DIR`.** The new `browser`/`jots` plugins live in server source because their handlers reach into `browser-session` and the jots store — capabilities that must stay out of the plugin `ToolContext` (a third-party plugin must never drive the user's logged-in capture browser or touch the jots filesystem). The loader refuses `PLUGINS_DIR` dirs named `browser`/`jots` so a disk plugin can't shadow them.
- **Auth type `"none"` now means built-in/always-on** (was: dead "manual, not connectable"): configured and connected everywhere, connect returns "already connected", disconnect returns 400, and the execute gate skips the token check.
- **Browser/jot calls gain the `execute_tool` path benefits**: arg validation with Zod defaults applied, plus per-call audit logging — neither happened for meta-tools.
- **`tools/call` hoists the `_mcpImage` sentinel one level deep**, since `browser_screenshot`'s image now arrives wrapped in `execute_tool`'s `{ result }` envelope (screenshots still render as real MCP image blocks).
- **Portal**: integration list now carries `authType`; the "Built-in · always on" card state and hidden connect footer key off `authType === "none"` instead of hardcoding the browser name. Jots now shows as a normal integration card. The synthetic `browser-integration.ts` descriptor is deleted.

## Notes
- Tests: 441 passing (2 new regression tests: none-auth connection gate bypass, nested image hoist). CI clean on PR #32.
