# Releasing

## Deployment States

The SSI Toolkit uses a single Apps Script project with two deployment states:

**HEAD** is the active development surface. `npm run deploy` pushes your local build here. You can test HEAD changes using Apps Script's test deployments (Deploy → Test deployments in the script editor) without affecting users who have the add-on installed. 

**Versioned deployment** is what Marketplace-installed users run. It is a pinned snapshot that only changes when a human explicitly runs `scripts/release.sh` from `main`.

Container-bound Scripts use the **HEAD** by default. Once you've run `npm run deploy`—regardless of what branch you are in—you should see any changes immediately reflected in your attached Google Sheet.

## Branch Workflow

```
feature-branch → develop   (PR + code review)
develop        → main      (PR containing manual QA instructions = release gate)
main                       (run ./scripts/release.sh to publish)
```

## Release Process

1. Merge `develop` → `main` via PR, including manual QA instructions in the PR body.
2. Once merged, from `main`:

```zsh
./scripts/release.sh
```

This script builds the project, pushes to HEAD, snapshots it as a new immutable version, and repoints the Marketplace deployment. It enforces the `main` branch requirement and will exit with an error if run from any other branch.

> **Note:** `scripts/release.sh` is a human-only operation. It must never be run by automated tooling or CI.

## Note on Concurrent Development

This pipeline assumes a single developer. `npm run deploy` pushes to a shared HEAD — concurrent development will cause conflicts. This should be revisited before a second developer joins the project.
