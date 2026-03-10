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
npx clasp update-deployment "$DEPLOYMENT_ID" --versionNumber "$VERSION" --description "$TIMESTAMP"

echo "✓ Released version $VERSION to deployment $DEPLOYMENT_ID"
