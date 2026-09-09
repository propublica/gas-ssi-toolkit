#!/bin/bash
set -e

# Stable Marketplace deployment ID (from `clasp list-deployments`).
DEPLOYMENT_ID="AKfycbx1DUg1j_MW2KNDFsfqhHaW5D7ngPaweMr4GZ8LGkINJF_5HbugCrnaDNqZ7Xeg2KIDGA"

echo "⚠️  This will update the SSI Toolkit for everyone who has it installed."
read -p "Are you sure you want to release? (y/N) " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "Release cancelled."
  exit 0
fi

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Error: release.sh must be run from main (currently on '$CURRENT_BRANCH')."
  echo "Merge your changes to main first, checkout that branch, then run this script."
  echo "See the Code Lifecycle section of README.md for the full release process."
  exit 1
fi

echo "→ Verifying main is up to date with origin..."
git fetch origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" != "$REMOTE" ]; then
  echo "Error: local main is not in sync with origin/main."
  echo "Run 'git pull origin main' and try again."
  exit 1
fi

# `gh run list` returns all CI workflow runs for the current commit on main.
# We require every run to have concluded with "success" — a failure, cancellation,
# or still-in-progress run blocks the release.
COMMIT_SHA=$(git rev-parse HEAD)
CI_CONCLUSIONS=$(gh run list --branch main --commit "$COMMIT_SHA" --json conclusion --jq '.[].conclusion')
if echo "$CI_CONCLUSIONS" | grep -qv "^success$"; then
  echo "Error: one or more CI workflows have not passed for commit $COMMIT_SHA."
  echo "Conclusions: $(echo "$CI_CONCLUSIONS" | tr '\n' ' ')"
  echo "Wait for all checks to pass before releasing."
  exit 1
fi

# `git diff --quiet` exits non-zero if there are unstaged changes to tracked files.
# `git diff --cached --quiet` exits non-zero if there are staged (but uncommitted) changes.
# Together they catch any dirty working tree state.
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Error: working tree has uncommitted changes."
  echo "Commit or stash them before releasing."
  exit 1
fi

echo "→ Deploying to HEAD..."
npm run deploy

# Push the same freshly-built dist/ to the public template Sheet's separate
# Apps Script project. Unlike the canonical project below, this target has no
# versioned-deployment concept to repoint — a container-bound script always
# runs whatever's at HEAD, so a push is the whole job.
#
# clasp reads a single .clasp.json from the current directory, so we swap it
# in and back out around the push. The swap is guarded so a failed push still
# restores your original .clasp.json rather than leaving it pointed at the
# template project (which would make the *next* `npm run deploy` you run
# silently push to the wrong place).
if [ ! -f .clasp.template.json ]; then
  echo "Error: .clasp.template.json not found."
  echo "This holds the template Sheet's script ID and is required to keep it in sync."
  echo "See the 'Template Sheet' section of docs/releasing.md for how to create it."
  exit 1
fi

echo "→ Deploying to template container-bound project..."
cp .clasp.json .clasp.json.bak
cp .clasp.template.json .clasp.json
if ! npx clasp push; then
  mv .clasp.json.bak .clasp.json
  echo "Error: template deploy failed; restored your original .clasp.json."
  exit 1
fi
mv .clasp.json.bak .clasp.json

TIMESTAMP=$(date +%Y-%m-%d\ %H:%M:%S)

echo "→ Creating version snapshot..."
VERSION_OUTPUT=$(npx clasp create-version "$TIMESTAMP" 2>&1)
echo "  $VERSION_OUTPUT"
VERSION=$(echo "$VERSION_OUTPUT" | grep -oE '[0-9]+' | tail -1)
if [ -z "$VERSION" ]; then
  echo "Error: could not parse version number from clasp output."
  exit 1
fi

echo "→ Repointing Marketplace deployment..."
npx clasp update-deployment "$DEPLOYMENT_ID" --versionNumber "$VERSION" --description "$TIMESTAMP ($COMMIT_SHA)"

# Create an annotated git tag so there's a permanent record in git history of
# exactly what commit was released and when. Push it to origin so it's visible
# to all collaborators and can be referenced in GitHub's releases UI.
TAG="v$VERSION"
git tag -a "$TAG" -m "Release $TAG — deployed $TIMESTAMP"
git push origin "$TAG"

echo "→ Creating GitHub release..."
gh release create "$TAG" --generate-notes --title "$TAG"

echo "✓ Released version $VERSION to deployment $DEPLOYMENT_ID (tagged $TAG)"

# Sync main back into develop before bumping the version, so the version-bump
# PR below stays a clean, single-line diff instead of also carrying forward
# whatever else has landed only on main. This only opens the PR — merging it
# still requires human review (main and develop both require it), so we pause
# here rather than merging it ourselves.
echo "→ Opening back-merge PR (main → develop) to keep branches in sync..."
if BACKMERGE_PR_URL=$(gh pr create --base develop --head main \
  --title "chore: sync main back into develop after v$VERSION" \
  --body "Back-merges main into develop after releasing v$VERSION, so develop reflects everything that shipped." 2>&1); then
  echo "✓ Opened back-merge PR: $BACKMERGE_PR_URL"
  read -p "Merge that PR in GitHub, then press Enter here to continue (or Ctrl+C to stop and handle the version bump manually later)... "
else
  echo "  No back-merge needed (main and develop already match): $BACKMERGE_PR_URL"
fi

# The sidebar footer and package.json version are meant to already read "vN" by
# the time release N ships — which only works if we bump to N+1 right after
# release N completes, so the bump has a full development cycle to land before
# the next release. See docs/releasing.md.
NEXT_VERSION=$((VERSION + 1))
read -p "Bump internal version to v$NEXT_VERSION for the next release cycle? (y/N) " BUMP_CONFIRM
if [ "$BUMP_CONFIRM" = "y" ] || [ "$BUMP_CONFIRM" = "Y" ]; then
  BUMP_BRANCH="chore/bump-version-v$NEXT_VERSION"
  echo "→ Bumping version to $NEXT_VERSION.0.0..."
  git checkout -b "$BUMP_BRANCH"
  # --no-git-tag-version: npm's default vX.Y.Z tag would collide with this
  # script's own release tags (e.g. v8).
  npm version --no-git-tag-version "$NEXT_VERSION.0.0"
  git add package.json package-lock.json
  git commit -m "chore: bump version to v$NEXT_VERSION"
  git push origin "$BUMP_BRANCH"
  PR_URL=$(gh pr create --base develop --title "chore: bump version to v$NEXT_VERSION" \
    --body "Prepares the sidebar and package.json version for the next release cycle (v$NEXT_VERSION), following release of v$VERSION.")
  echo "✓ Opened bump PR: $PR_URL"
  git checkout main
else
  echo "Skipped version bump. Remember to bump package.json to $NEXT_VERSION.0.0 before v$NEXT_VERSION ships."
fi
