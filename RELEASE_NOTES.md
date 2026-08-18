# a-workbench v0.23.3

_2026-08-18_

Headline: **Security fix — `browser_navigate` now rejects non-HTTP(S) URLs.**

## Security

- **`browser_navigate`: block `file://` and other non-HTTP(S) protocols.** The tool previously accepted any syntactically valid URL, including `file://`. An agent or malicious prompt could navigate to `file:///proc/self/environ` and read the pod's environment (secrets, tokens, API keys) via `browser_read_text`. A Zod `.refine()` now allowlists only `http:` and `https:` — any other scheme (`file://`, `ftp://`, `data:`, `javascript:`, etc.) is rejected before the handler runs.

## Commits

- `security: block non-http(s) protocols in browser_navigate` (9fdf1fa)

**Full diff:** https://github.com/barockok/workbench/compare/v0.23.2...v0.23.3
