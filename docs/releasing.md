# Releasing

## Deployment States

The SSI Toolkit's canonical Apps Script project has two deployment states:

**HEAD** is the active development surface. `npm run deploy` pushes your local build here. You can test HEAD changes using Apps Script's test deployments (Deploy → Test deployments in the script editor) without affecting users who have the add-on installed. 

**Versioned deployment** is what Marketplace-installed users run. It is a pinned snapshot that only changes when a human explicitly runs `scripts/release.sh` from `main`.

Container-bound Scripts use the **HEAD** by default. Once you've run `npm run deploy`—regardless of what branch you are in—you should see any changes immediately reflected in your attached Google Sheet.

## Template Sheet

In addition to the canonical project above, `release.sh` also pushes `dist/` to a second, separate Apps Script project — the one bound to the public-facing template Google Sheet used for [self-serve onboarding](../README.md#get-your-own-copy). Unlike the canonical project, this target has no versioned-deployment step: it's a container-bound script, so it always runs whatever was last pushed to HEAD.

This requires a local `.clasp.template.json` (gitignored, same shape as `.clasp.json`) pointing at the template project's script ID:

```zsh
cat > .clasp.template.json << 'EOF'
{
  "scriptId": "<template-script-id>",
  "rootDir": "./dist"
}
EOF
```

Only whoever runs `release.sh` needs this file locally — `release.sh` fails fast with a clear error if it's missing, rather than silently skipping the template deploy.

## Branch Workflow

```
feature-branch → develop   (PR + code review)
develop        → main      (PR containing manual QA instructions = release gate)
main                       (run ./scripts/release.sh to publish)
main           → develop   (back-merge PR, opened automatically by release.sh — see below)
```

## Release Process

1. Merge `develop` → `main` via PR, including manual QA instructions in the PR body.
2. Once merged, from `main`:

```zsh
./scripts/release.sh
```

This script builds the project, pushes to HEAD, snapshots it as a new immutable version, and repoints the Marketplace deployment. It enforces the `main` branch requirement and will exit with an error if run from any other branch.

> **Note:** `scripts/release.sh` is a human-only operation. It must never be run by automated tooling or CI.

After the release completes, `release.sh` walks through two more steps — a back-merge and a version bump — described below. Both open PRs for you to review and merge; the script never merges anything itself, since `main` and `develop` both require PR review.

## Back-Merge (main → develop)

`release.sh` automatically opens a PR from `main` into `develop` (or reports that there's nothing to sync, if they already match) and pauses, waiting for you to merge it in GitHub before continuing. This exists so the version-bump PR that follows lands as a clean, single-line diff — if the bump were cut from `main` before `develop` had caught up, its PR would also carry forward everything else `main` has that `develop` doesn't yet.

## Version Number

`package.json`'s `version` field (`N.0.0`, where `N` is the release/Apps Script version number) is the single source of truth for the version shown in the sidebar footer. The build injects it into `dist/Sidebar.html` at compile time — nothing else needs to be hand-edited.

Because clasp only assigns a version number *after* a release deploys, the version can't be bumped to `N` until release `N` is already live — bumping then would mean release `N`'s own sidebar still shows `N-1`. Instead, once the back-merge above is done, `release.sh` prompts to bump to `N+1`, giving that bump a full development cycle to land on `develop` before release `N+1` actually ships. If you accept the prompt, it opens a small PR (`chore/bump-version-vN+1`) against `develop` — review and merge it before the next release.

## Note on Concurrent Development

This pipeline assumes a single developer. `npm run deploy` pushes to a shared HEAD — concurrent development will cause conflicts. This should be revisited before a second developer joins the project.
