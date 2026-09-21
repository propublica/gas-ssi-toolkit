# Releasing

This release process updates three distribution points at once: the public template Google Sheet used for [self-serve onboarding](../README.md#get-your-own-copy), a canonical Apps Script project backing a Google Workspace Marketplace listing, and this public GitHub repository, which any external organization can clone to build their own independent copy.

## Release Process

1. Merge `develop` → `main` via PR, including manual QA instructions in the PR body — this is also the moment the public GitHub repository (the third distribution point) updates.

2. From `main`, run:

   ```zsh
   ./scripts/release.sh
   ```

   It enforces the `main` branch requirement and exits with an error if run from anywhere else. This is a human-only operation — it must never be run by automated tooling or CI.

3. **Confirm the release.** The script warns that this updates the add-on for everyone who has it installed; type `y` to continue.

4. The script then runs its checks automatically, with no input needed — it verifies `main` is in sync with `origin/main`, CI has passed, the working tree is clean, and `.clasp.template.json` exists (any failure prints an `Error:` and aborts here) — and pushes: `→ Deploying to HEAD...` and `→ Deploying to template container-bound project...` push the build to both projects, then `→ Creating version snapshot...` and `→ Repointing Apps Script deployment...` snapshot and repoint the canonical project alone.

5. **Update the Marketplace SDK App Configuration.** Repointing the deployment in the previous step doesn't by itself publish the update to Marketplace-installed users — the script pauses here for that manual step. Follow [Marketplace SDK App Configuration](#marketplace-sdk-app-configuration) below, then press Enter to let the script continue.

6. The script tags the release and opens a GitHub release automatically: `→ Creating GitHub release...`.

7. **Merge the back-merge PR.** `→ Opening back-merge PR...` opens a PR merging `main` into `develop` (or reports there's nothing to sync) and pauses for you to merge it in GitHub.

8. **Confirm the version bump.** The script offers to open a PR bumping `package.json`'s version to `N+1`, so the sidebar footer and version file are ready to read correctly by the time the next release ships.

## Marketplace SDK App Configuration

1. Navigate to `https://console.cloud.google.com/apis/api/appsmarket-component.googleapis.com/googleapps_sdk?project=<projectId>`.
2. Under **App Configuration → App Integrations → Sheets add-on**, update **Sheets add-on script version** to the version number the script printed after `→ Creating version snapshot...`, then click **Save**.
