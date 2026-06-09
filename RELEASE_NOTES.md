# a-workbench v0.9.1

_2026-06-09_

Headline: **Jot uploads now require a root `index.html`** — a deploy that would silently serve nothing is rejected up front.

## Features
- **`deploy_jot` rejects an upload with no root `index.html`.** A jot is served at `/j/<name>/`, which resolves to the root `index.html`; an archive lacking one used to publish a jot that silently 404s. The upload route now returns **400 `{ error: "NO_INDEX" }`** when the extracted root has no `index.html`, leaving any existing jot untouched. The `deploy_jot` tool description and the how-to-use docs state the requirement.

## Notes
- Enforcement is scoped to the upload route, so the internal `deployJot` seed helper (and jots that are intentionally served only at explicit sub-paths in tests) are unaffected.
- Tests: 410 passing (407 server + 3 shared).
