---
title: Gmail, Drive, Docs & more
description: Scopes and complete tool lists for each of the seven google-* plugins.
---

Seven plugins, 39 tools between them, each connected independently. Operator setup — Cloud project, consent screen, and the seven OAuth clients — is on [Google setup & scopes](google.md). This page is the per-plugin breakdown.

| Plugin | Tools | Proxy base |
|---|---|---|
| `google-gmail` | 8 | `https://gmail.googleapis.com/gmail/v1` |
| `google-drive` | 8 | `https://www.googleapis.com/drive/v3` |
| `google-calendar` | 7 | `https://www.googleapis.com/calendar/v3` |
| `google-docs` | 5 | `https://docs.googleapis.com/v1` |
| `google-sheets` | 5 | `https://sheets.googleapis.com/v4` |
| `google-slides` | 5 | `https://slides.googleapis.com/v1` |
| `google-gemini` | 1 | `https://generativelanguage.googleapis.com/v1beta` |

## Gmail

**Scope:** `https://www.googleapis.com/auth/gmail.modify`

| Tool | Purpose |
|---|---|
| `google_gmail_list` | Scan a mailbox: sender, subject, date, and snippet per row |
| `google_gmail_get` | One message in full, with a decoded plain-text body and its `messageIdHeader` |
| `google_gmail_send` | Send an email, or reply inside an existing thread |
| `google_gmail_draft` | Create a draft in the Drafts folder without sending |
| `google_gmail_modify` | Change labels: mark read or unread, archive, add or remove label ids |
| `google_gmail_labels` | List system and user label ids |
| `google_gmail_threads` | List conversation threads with snippets and a page token |
| `google_gmail_profile` | The connected account's address and message counts |

Replying in-thread needs both the thread id and the original `Message-ID` header, which is why `google_gmail_get` returns `messageIdHeader` separately from the message id. `gmail.modify` does not permit permanent deletion.

## Google Drive

**Scope:** `https://www.googleapis.com/auth/drive`

| Tool | Purpose |
|---|---|
| `google_drive_list` | List files, optionally filtered with a raw Drive `q` query |
| `google_drive_search` | Keyword search over file names and full document text, safely escaped |
| `google_drive_upload` | Upload a file |
| `google_drive_upload_from_url` | Fetch from a signed URL and upload straight to Drive |
| `google_drive_download` | Download a file's contents |
| `google_drive_create_folder` | Create a folder |
| `google_drive_trash` | Move a file to trash |
| `google_drive_permissions` | Update a file's sharing permissions |

> [!WARNING] `google_drive_upload_from_url` blocks private addresses by hostname string only
> It requires https, then rejects `localhost` and the private ranges — `127.*`, `10.*`, `172.16-31.*`, `192.168.*`, `169.254.*`, `0.0.0.0`, and IPv6 `::1`, `fc`, `fd`, `fe80`. That check runs against the hostname text, so a public DNS name that resolves to a private address is not caught. Treat the URL argument as attacker-influenced when an agent picks it up from untrusted content.

`google_drive_list` forwards its `query` to Drive verbatim, so a malformed query surfaces as a Drive error. `google_drive_search` escapes what you give it and is the safer default.

## Google Calendar

**Scope:** `https://www.googleapis.com/auth/calendar`

| Tool | Purpose |
|---|---|
| `google_calendar_list_calendars` | The user's calendars, with the ids the other tools take |
| `google_calendar_list_events` | Events on a calendar as slim rows |
| `google_calendar_get_event` | One event in detail, description truncated to 1000 characters |
| `google_calendar_create_event` | Create an event |
| `google_calendar_update_event` | PATCH an event — only the fields you pass change |
| `google_calendar_delete_event` | Delete an event permanently |
| `google_calendar_freebusy` | Find busy intervals across calendars between two times |

Every tool defaults to the `primary` calendar. Call `google_calendar_freebusy` before you create an event, to avoid double-booking. Prefer `google_calendar_update_event` over delete-and-recreate when only the time or the details change, because a delete notifies attendees.

## Google Docs

**Scopes:** `https://www.googleapis.com/auth/documents`, `https://www.googleapis.com/auth/drive.file`

| Tool | Purpose |
|---|---|
| `google_docs_search` | Find Docs through Drive |
| `google_docs_get` | The document's full structural JSON |
| `google_docs_get_plaintext` | The document as plain text |
| `google_docs_create` | Create a new document |
| `google_docs_batch_update` | Insert text, delete content, apply formatting |

Read with `google_docs_get_plaintext` unless you need the structure — the full document JSON is large, and edits go through `google_docs_batch_update` regardless.

## Google Sheets

**Scopes:** `https://www.googleapis.com/auth/spreadsheets`, `https://www.googleapis.com/auth/drive.file`

| Tool | Purpose |
|---|---|
| `google_sheets_search` | Find spreadsheets by name through Drive |
| `google_sheets_read` | Read a range as a 2D array of strings |
| `google_sheets_write` | Overwrite an exact range (PUT semantics) |
| `google_sheets_append` | Append rows to the end of a table or log |
| `google_sheets_create` | Create an empty spreadsheet, optionally with named tabs |

> [!WARNING] `google_sheets_write` replaces, it does not add
> Writing to `Sheet1!A1:C10` overwrites whatever is in those cells. To add rows to a log or table without touching existing data, use `google_sheets_append` with a column range such as `Sheet1!A:C`. Sheets finds the table and inserts after it.

## Google Slides

**Scopes:** `https://www.googleapis.com/auth/presentations`, `https://www.googleapis.com/auth/drive.file`

| Tool | Purpose |
|---|---|
| `google_slides_search` | Find presentations through Drive |
| `google_slides_get` | A presentation's structure |
| `google_slides_create` | Create an empty presentation |
| `google_slides_batch_update` | Insert text, create or delete slides |
| `google_slides_create_from_markdown` | Build a deck from Markdown |

`google_slides_create_from_markdown` splits slides on `---` and handles tables, bullets, and quotes. `|||` makes a two-column layout. It is far less work than assembling the same deck through `google_slides_batch_update`.

## Google Gemini

**Scope:** `https://www.googleapis.com/auth/generative-language.retriever`

| Tool | Purpose |
|---|---|
| `google_gemini_generate` | Generate content from a prompt; `model` defaults to `gemini-1.5-flash` |

Google quota-limits the Generative Language API independently of the other Google plugins. See [the Gemini API rate-limit documentation](https://ai.google.dev/gemini-api/docs/rate-limits).
