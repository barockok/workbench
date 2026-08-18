# browser_navigate accepts file:// URLs — filesystem read via agent prompt

## What happened

The `browser_navigate` tool used `z.string().url()` to validate the target URL.
Zod's built-in `.url()` accepts any syntactically valid URL — including `file://`
and other non-HTTP schemes — so an agent (or a malicious prompt) could navigate
to `file:///proc/self/environ` and read back the pod's full environment (secrets,
tokens, API keys) via `browser_read_text`.

## Root cause

No protocol allowlist in the schema or the handler. Chromium happily opens
`file://` URLs and exposes the file contents as page text.

## Fix

Added `.refine()` to the `browser_navigate` input schema to reject any URL
whose protocol is not `http:` or `https:`:

```ts
url: z.string().url().refine(
  (u) => /^https?:\/\//i.test(u),
  { message: "Only http and https URLs are allowed" }
)
```

The check lives at the schema layer so it fires before the handler runs and
returns a clear validation error to the caller.

## Protocols blocked

`file://`, `ftp://`, `data:`, `javascript:`, and any other non-HTTP(S) scheme.

## Test added

`browser-meta-tools.test.ts` — "browser_navigate schema rejects non-http(s) protocols"
covers `file://`, `ftp://`, `data:`, `javascript:` (expect throw) and `http://`,
`https://` (expect pass).
