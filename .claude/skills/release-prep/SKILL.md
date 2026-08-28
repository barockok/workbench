---
name: release-prep
description: Use when cutting a new workbench release, bumping version, or writing release notes. Triggers on phrases like "prep the release", "cut a release", "ship a version", or when version tag work needed.
---

# Release Prep — a-workbench

## Overview

Workbench release workflow. Granular commits, hand-written release notes, automated verification. Follows `docs/releases/<tag>.md` convention from `CLAUDE.md`.

Two paths:

- **Direct** — bump, tag `vX.Y.Z`, push. For patches and low-risk minors.
- **Release candidate** — tag `vX.Y.Z-rc.N` first, soak, then promote to `vX.Y.Z`. Use for anything touching Docker image, DB schema, auth, or proxy.

Both run the same `release.yml`; the RC path just publishes as a GitHub *pre-release* (auto-detected from the `-` in the tag) so `latest` Docker tag never moves to an RC.

## When to Use

- User asks to prep/cut/ship a release
- Version bump needed
- Release notes need writing
- Post-merge release verification needed

## Quick Reference

| Step | Command / Action |
|---|---|
| Find last tag | `git describe --tags --abbrev=0` |
| Diff commits | `git log <tag>..HEAD --oneline` |
| Check changed files | `git diff --stat <tag>..HEAD` |
| Type check | `npm run typecheck:tests -w @a-workbench/server` |
| Run tests | `npm run test` / `npm run test:coverage -w @a-workbench/server` |
| Promote an RC | `scripts/promote-rc.sh vX.Y.Z-rc.N [--dry-run]` |

## Release Workflow

### 1. Diff since last tag

```bash
git describe --tags --abbrev=0
git log <tag>..HEAD --oneline --no-decorate
git diff --stat <tag>..HEAD
```

### 2. Determine version (semver)

- **Major** (`X.0.0`): breaking schema/config/API change
- **Minor** (`x.Y.0`): new features, non-breaking additions
- **Patch** (`x.y.Z`): bugfixes only

Default to minor if any `feat:` commits since last tag. Patch only if all `fix:`, `docs:`, `test:`, `chore:`.

### 3. Bump version

Edit `package.json` `"version"` field. Commit separately:

```
chore(release): bump version to X.Y.Z
```

### 4. Write release notes

Create `docs/releases/vX.Y.Z.md`. Structure:

```markdown
## vX.Y.Z — <one-line summary>

<paragraph describing theme/motivation>

### Features

- **Area: feature name.** Description. Link to files if non-obvious.

### Fixes

- **Area: fix description.** What was broken, what changed.

### Commits

- `type(scope): subject` (short-sha)
- ...

**Full diff:** https://github.com/barockok/workbench/compare/vPREV...vX.Y.Z
```

Rules:
- Hand-written, not git-log dump
- Group by category (Features / Fixes)
- Explain *why* not just *what*
- Link findings docs when relevant
- List key commits at bottom

Commit separately:

```
docs(release): vX.Y.Z release notes
```

### 5. Tag and push

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

`release.yml` verifies `tag == package.json` version and fails fast on drift.

### 6. Verify build

```bash
npm run build
npm run test
```

Zero failures required.

## Release Candidate Workflow

Use when the change touches Docker image, DB schema, auth, or proxy — anywhere a bad stable tag is expensive to walk back.

### 1. Cut the RC

Write `docs/releases/vX.Y.Z.md` **first** — under the *stable* name. `promote-rc.sh` requires it, and the RC build reuses it.

```bash
# package.json version must be the full RC string, tag and all
sed -i.bak -E 's/("version": *")[^"]+(")/\1X.Y.Z-rc.1\2/' package.json && rm -f package.json.bak
git commit -am "chore(release): vX.Y.Z-rc.1"
git tag vX.Y.Z-rc.1
git push origin main && git push origin vX.Y.Z-rc.1
```

`release.yml` then: verifies tag == package.json, runs tests, builds Docker image (without moving `latest`), and publishes a GitHub **pre-release**.

The tag and `package.json` MUST agree — workflow fails fast on mismatch rather than shipping a misversioned image.

### 2. Soak

Pull the RC explicitly (it is never `latest`):

```bash
docker pull ghcr.io/barockok/workbench:vX.Y.Z-rc.1
```

Check version. Run against a real workbench. Found a bug? Fix on main, cut `-rc.2`. Don't patch an RC tag in place.

### 3. Promote

```bash
scripts/promote-rc.sh vX.Y.Z-rc.2 --dry-run   # inspect first
scripts/promote-rc.sh vX.Y.Z-rc.2
```

The script refuses unless: tag is `vX.Y.Z-rc.N`, RC exists, stable does *not*, you are on clean `main`, RC is ancestor of HEAD, and `docs/releases/vX.Y.Z.md` exists. It prints commits landed after RC — those ship **unsoaked**, so re-cut an RC if non-trivial. Then bumps `package.json`, commits, tags, pushes on confirmation.

## Release Note Anti-Patterns

| Bad | Good |
|---|---|
| "Various bugfixes" | Specific feature names with context |
| Raw git log dump | Hand-written categories with why |
| One commit per bullet | Group related commits under feature heading |
| Skip commit list | Include key commits for traceability |

## Example

See `docs/releases/v0.24.0.md` for complete example.
