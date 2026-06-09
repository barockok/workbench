# a-workbench v0.8.1

_2026-06-09_

Headline: **Password jots actually unlock now** — fixes a v0.8.0 bug where every password was rejected, and hardens per-jot authorization.

## Fixes
- **Password jots were impossible to unlock.** A content-type-parser collision (boot order: the OAuth route group registers the `application/x-www-form-urlencoded` parser first, yielding an object) meant the jot unlock handler read `req.body` as a string that was never there, so the submitted password was always empty and every attempt returned "Wrong password". The `__auth` handler now reads the password from either body shape (raw string or parsed object).

## Security
- **Unlock cookies are now bound to the jot's current password.** The per-jot cookie token is `HMAC(secret, name + passwordHash)` instead of `HMAC(secret, name)`. Rotating a jot's password (re-deploy with a new password) immediately invalidates every previously issued unlock cookie. Per-jot isolation is unchanged and reaffirmed: opening multiple password jots in one browser keeps each authorized only by its own password (distinct `Path`-scoped, name+hash-bound cookies).

## Notes
- Tests: 383 passing (380 server + 3 shared). New coverage: object-body unlock (regression), password-rotation invalidation, two-jots-one-session independence.
