#!/bin/bash
set -e

# The stable Marketplace deployment ID.
# One-time setup: run `clasp list-deployments`, copy the non-@HEAD deployment ID, paste here.
DEPLOYMENT_ID="<paste-deployment-id-here>"

if [ "$DEPLOYMENT_ID" = "<paste-deployment-id-here>" ]; then
  echo "Error: DEPLOYMENT_ID not set. Run 'clasp list-deployments', copy the deployment ID, and update this script."
  exit 1
fi

echo "→ Deploying to HEAD..."
npm run deploy

echo "→ Creating version snapshot..."
VERSION=$(clasp create-version "$(date +%Y-%m-%d)" | grep -oE '[0-9]+' | tail -1)
echo "  Created version $VERSION"

echo "→ Repointing Marketplace deployment..."
clasp update-deployment "$DEPLOYMENT_ID" --versionNumber "$VERSION" --description "$(date +%Y-%m-%d)"

echo "✓ Released version $VERSION to deployment $DEPLOYMENT_ID"
