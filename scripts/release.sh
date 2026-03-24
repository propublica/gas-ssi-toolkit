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

echo "✓ Released version $VERSION to deployment $DEPLOYMENT_ID (tagged $TAG)"
