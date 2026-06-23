# Security Policy

a-workbench brokers per-user OAuth tokens and other credentials for third-party
SaaS tools. Security issues are taken seriously. Please follow responsible
disclosure.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

Report privately through **GitHub Security Advisories** — use the
**"Report a vulnerability"** button under the repository's **Security** tab.
This opens a private channel visible only to the maintainers.

Please include:

- A description of the issue and its impact
- Steps to reproduce (proof-of-concept if possible)
- Affected version / commit
- Any suggested remediation

You can expect an initial acknowledgement within **5 business days**. We will
keep you informed as we investigate and coordinate a fix and disclosure
timeline with you.

## Supported Versions

Only the latest released version on the `main` branch receives security fixes.

## Security Model

Notes for operators and contributors on how the system handles sensitive data:

- **Token encryption** — OAuth access/refresh tokens are encrypted at rest with
  AES-256-GCM (random IV + auth tag) before being stored in SQLite. The key is
  supplied via the `ENCRYPTION_KEY` environment variable (64 hex chars).
- **Session/JWT signing** — session, refresh, and connect tokens are signed with
  `SESSION_SECRET`. Use a random 32+ character value.
- **Passwords** — local-account passwords are hashed with scrypt and a random
  per-user salt.
- **Secrets via environment only** — no credentials are committed; all secrets
  are read from environment variables. See `.env.example` for the full list.
- **SSRF surface** — tools that fetch user-supplied URLs (e.g. self-hosted
  instance OAuth, drive upload-from-url) validate hosts and reject RFC-1918 /
  internal addresses.

## Operator Responsibilities

- Protect the `ENCRYPTION_KEY` and `SESSION_SECRET`. Loss of `ENCRYPTION_KEY`
  makes stored tokens unrecoverable; disclosure makes them decryptable.
- Keep the SQLite database file (`data/tokens.db`) on trusted storage with
  restricted filesystem permissions.
- Rotate OAuth client secrets and the encryption key per your organization's
  policy.
- Run behind TLS in production.
