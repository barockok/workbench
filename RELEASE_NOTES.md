# a-workbench v0.16.0

_2026-06-19_

Headline: **Google Drive upload-from-URL — fetch any signed URL and pipe it directly into Drive, SSRF-safe.**

## Features

- **`google_drive_upload_from_url`** — new Google Drive tool that fetches a file from a signed or pre-authenticated URL (S3, GCS, CDN, etc.) and uploads it directly to Google Drive via multipart upload. No need to pass file content inline. MIME type is auto-detected from the `Content-Type` response header when not specified. Returns `{ id, name, mimeType }`. (`packages/plugins/google-drive/tools/drive.ts`)

## Security

- **SSRF guard on `google_drive_upload_from_url`**: enforces `https://` only and blocks all RFC-1918 (`10.x`, `172.16-31.x`, `192.168.x`), link-local (`169.254.x`, `fe80::`), loopback (`127.x`, `::1`), and ULA (`fc/fd`) addresses before fetching. Prevents prompt-injection attacks that could redirect the server to internal services or cloud IMDS endpoints. (`packages/plugins/google-drive/tools/drive.ts`)

## Tests

- 12 new test cases for `google_drive_upload_from_url`: success path, 403 failure, and 10 SSRF guard cases covering all blocked address families. (`packages/server/tests/google-drive-query.test.ts`)

## Upgrade notes

- Additive release — no breaking changes. Existing Google Drive connections work without reconnect.
