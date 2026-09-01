---
title: Field notes
description: Production failures we hit, what actually caused them, and what we changed. One file per finding, written the day it was understood.
---

Field notes are not release notes and not design docs. Each one records a single
problem that cost real time to understand — the symptom as it presented, the
cause once it was found, and the change that resolved it.

They exist because most of these failures produce a symptom that looks like
something else. A container that boots with fourteen `ERR_MODULE_NOT_FOUND`
lines is not a missing dependency. A Slack call that returns HTTP 200 has not
necessarily succeeded. A Chromium that exits 21 saying the profile is in use "on
another computer" is not describing another computer.

If you are debugging, start with [Troubleshooting](../guides/troubleshooting.md) —
it maps symptoms to fixes. Come here when you want to know *why*.

## How to read them

Each note is dated by the day the finding was understood, not the day the code
changed. A note is a record of what was true then; where later work superseded
it, the note says so and links forward. Nothing here is deleted when it becomes
history — it is marked.

## Adding one

When you learn something non-obvious about this system, write it down the same
day, in `docs/findings/YYYY-MM-DD-<topic>.md`. One finding per file. Link it from
the code comment that would otherwise make no sense without it. The site picks up
new files automatically — there is no index to update by hand.

Keep it to the shape that makes these useful: what you observed, what you
believed was happening, what was actually happening, and how you proved it. A
theory you tested and disproved is worth writing down too — it stops the next
person from spending a day on it.
