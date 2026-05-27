# /prep-release

Prepare a new release of a-workbench.

## Steps

1. **Document Review**
   - Read `docs/architecture.md` — check for outdated info
   - Read `docs/how-to-use.md` — verify commands still work
   - Read `docs/how-to-onboard.md` — check for stale setup steps
   - Read `CHANGELOG.md` — if exists, note last version

2. **Determine Version**
   - Check git tags: `git describe --tags --abbrev=0`
   - If no tags, start at `v0.1.0`
   - Otherwise bump minor or patch based on changes

3. **Generate Release Notes**
   - Run: `git log $(git describe --tags --abbrev=0)..HEAD --oneline`
   - Categorize changes: Features, Fixes, Chores
   - Write to `RELEASE_NOTES.md`

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
