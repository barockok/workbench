#!/usr/bin/env bash
# Promote a release candidate to its stable release.
#
#   scripts/promote-rc.sh v0.24.0-rc.2 [--dry-run]
#
# Strips the -rc.N suffix, bumps package.json to the stable version, commits,
# tags, and pushes — which triggers .github/workflows/release.yml for a normal
# (non-prerelease) GitHub release. Docker `latest` only moves on stable.
set -euo pipefail

RC_TAG="${1:?usage: promote-rc.sh vX.Y.Z-rc.N [--dry-run]}"
DRY_RUN=0
[ "${2:-}" = "--dry-run" ] && DRY_RUN=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '\033[2mdry-run:\033[0m %s\n' "$*"; else "$@"; fi
}

# --- validate the RC tag ------------------------------------------------------
[[ "$RC_TAG" =~ ^v([0-9]+\.[0-9]+\.[0-9]+)-rc\.([0-9]+)$ ]] \
  || die "'$RC_TAG' is not a vX.Y.Z-rc.N tag"
STABLE_VERSION="${BASH_REMATCH[1]}"
STABLE_TAG="v${STABLE_VERSION}"
NOTES="docs/releases/${STABLE_TAG}.md"

# Not --quiet: a rejected tag update is the most likely failure here, and the
# reason is only in git's own output. This repo's history was rewritten with
# filter-repo when it was published, so a clone made before that has tags
# pointing at pre-rewrite commits and this fetch fails with "would clobber
# existing tag" — which, silenced, looks exactly like the script dying for no
# reason.
if ! git fetch --tags origin; then
  die "git fetch --tags failed (see above).
  If it reported 'would clobber existing tag', your local tags point at
  pre-rewrite commits. Take origin as the source of truth and retry:
      git fetch --tags --force origin"
fi

git rev-parse -q --verify "refs/tags/${RC_TAG}" >/dev/null \
  || die "$RC_TAG does not exist — cut the RC first"
! git rev-parse -q --verify "refs/tags/${STABLE_TAG}" >/dev/null \
  || die "$STABLE_TAG already exists — nothing to promote"

# --- validate the working tree ------------------------------------------------
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "main" ] || die "on '$BRANCH' — promote from main"
[ -z "$(git status --porcelain --untracked-files=no)" ] \
  || die "working tree has uncommitted changes — commit or stash first"
git merge-base --is-ancestor "$RC_TAG" HEAD \
  || die "$RC_TAG is not an ancestor of HEAD — main has diverged from the RC"
[ -f "$NOTES" ] || die "missing $NOTES — release.yml needs hand-written notes"

# --- report what soaked -------------------------------------------------------
DRIFT="$(git log --oneline "${RC_TAG}..HEAD")"
if [ -n "$DRIFT" ]; then
  say "commits landed since ${RC_TAG} (these ship untested by the RC build):"
  printf '%s\n' "$DRIFT" | sed 's/^/    /'
else
  say "HEAD == ${RC_TAG} — promoting exactly what soaked"
fi

# --- bump, commit, tag, push --------------------------------------------------
CURRENT="$(grep -m1 '"version"' package.json | sed -E 's/.*"version": *"([^"]+)".*/\1/')"
say "promoting ${RC_TAG} -> ${STABLE_TAG} (package.json: ${CURRENT} -> ${STABLE_VERSION})"

if [ "$CURRENT" != "$STABLE_VERSION" ]; then
  run sed -i.bak -E "s/(\"version\": *\")[^\"]+(\")/\1${STABLE_VERSION}\2/" package.json
  run rm -f package.json.bak
  run git add package.json
  run git commit -m "chore(release): promote ${RC_TAG} to ${STABLE_TAG}"
fi

run git tag "$STABLE_TAG"

if [ "$DRY_RUN" = 1 ]; then
  printf '\033[2mdry-run:\033[0m git push origin main && git push origin %s\n' "$STABLE_TAG"
  say "dry run complete — nothing pushed"
  exit 0
fi

read -r -p "push main + ${STABLE_TAG} to origin? [y/N] " confirm
case "$confirm" in
  y|Y) ;;
  *) git tag -d "$STABLE_TAG"; die "aborted — local tag removed (version bump commit kept)" ;;
esac

git push origin main
git push origin "$STABLE_TAG"
say "pushed — release.yml is building ${STABLE_TAG}"
