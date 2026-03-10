#!/bin/bash
set -e

# Stable Marketplace deployment ID (from `clasp list-deployments`).
DEPLOYMENT_ID="AKfycbyHEzLuhBp8qVmSRgbhVJbAAeLfITuu-jybzHCR5AL9blr9mkTLO0YFSNlA7QifxGyacg"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
  echo "Error: release.sh must be run from main (currently on '$CURRENT_BRANCH')."
  echo "Merge your changes to main first, then run this script."
  echo "See the Code Lifecycle section of README.md for the full release process."
  exit 1
fi

echo "→ Deploying to HEAD..."
npm run deploy

echo "→ Creating version snapshot..."
VERSION=$(npx clasp create-version "$(date +%Y-%m-%d)" | grep -oE '[0-9]+' | tail -1)
echo "  Created version $VERSION"

echo "→ Repointing Marketplace deployment..."
npx clasp update-deployment "$DEPLOYMENT_ID" --versionNumber "$VERSION" --description "$(date +%Y-%m-%d)"

echo "✓ Released version $VERSION to deployment $DEPLOYMENT_ID"
