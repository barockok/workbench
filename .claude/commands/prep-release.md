# /prep-release

Prepare a new release of a-workbench.

## Steps

1. **Document Review**
   - Read `docs/site/_content/` — check every page the release touches for
     outdated info, and verify any command you changed still runs
   - Rebuild the site (`node docs/site/build.mjs`) to check it still builds;
     the output in `docs/site/_site/` is not committed
   - Read `CHANGELOG.md` — the cumulative history; note last version at the top

2. **Determine Version**
   - Check git tags: `git describe --tags --abbrev=0`
   - If no tags, start at `v0.1.0`
   - Otherwise bump minor or patch based on changes

3. **Generate Release Notes**
   - Run: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
   - Categorize changes: Features, Fixes, Chores
   - Write this release's notes to `docs/releases/<tag>.md` (one file per release)
   - **Prepend** the same block to `CHANGELOG.md` (newest first; keep all prior versions below). Use a `---` separator between versions.

4. **Update Version**
   - Update `package.json` version
   - Update `packages/server/package.json` version
   - Update `packages/portal/package.json` version
   - Update `packages/shared/package.json` version

5. **Tag Release**
   ```bash
   git add -A
   git commit -m "release: vX.Y.Z"
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin main --tags
   ```

6. **Build + Push Docker**
   ```bash
   docker build -t a-workbench:vX.Y.Z .
   ```

7. **Report**
   - Show release notes
   - Confirm tag pushed
   - Remind to trigger GitHub Actions release workflow
