# GitHub Actions Clasp Deployment Design

**Date:** 2026-02-19
**Status:** Approved

## Overview

Add a GitHub Actions CD workflow that automatically deploys the Apps Script add-on to the dev (Apps Script project) when code is merged to `develop`, and to prod when code is merged to `main`. Deployments are gated on the existing CI workflow passing.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Workflow file | Separate `deploy.yml` | Clean separation from CI concerns |
| Job structure | Single file, two jobs | One file to maintain; branch conditions skip the irrelevant job |
| CI gate | `workflow_run` trigger | Ensures CI passes before any deploy fires |
| Deploy trigger | Push only (merges) | `event == 'push'` condition prevents PR CI runs from triggering deploys |
| Authentication | WIF through a Service Account + `--adc` | No stored long-lived credentials; short-lived OIDC token exchange |
| GitHub auth action | `google-github-actions/auth@v3` | Google-maintained, pinned to v3 |
| clasp auth flag | `--adc` (experimental) | Only CI-compatible mechanism that avoids storing a refresh token |

## Chosen Approach: WIF + `--adc`

### How it works

GitHub Actions requests a short-lived OIDC token from GitHub's identity provider. `google-github-actions/auth@v3` exchanges that token for a GCP OAuth 2.0 access token by impersonating a service account (Workload Identity Federation through a Service Account). The resulting credentials are written to `GOOGLE_APPLICATION_CREDENTIALS`. `clasp push --adc` reads those credentials instead of `~/.clasprc.json`.

No credentials are stored in GitHub — every token is generated fresh per run and expires after ~1 hour.

### Why WIF through a Service Account (not Direct WIF)

`clasp push` calls the Apps Script API, which requires an OAuth 2.0 access token scoped to `https://www.googleapis.com/auth/script.projects`. Direct WIF cannot generate OAuth 2.0 access tokens — it produces only raw federated OIDC tokens with a 10-minute cap. Service account impersonation is required to obtain the correct token type.

### Caveats

- `--adc` is marked **experimental** in clasp v3 docs. It uses the standard GCP ADC mechanism, which is well-established, but clasp reserves the right to change the interface without a major version bump.
- The service account must be shared as Editor on both Apps Script projects (dev and prod). Service accounts cannot own scripts; they can only push to scripts they've been granted access to.

### One-time GCP + GitHub setup (manual, done once)

1. Enable the Apps Script API in your GCP project
2. Create a service account (e.g. `github-actions-clasp@<project>.iam.gserviceaccount.com`) — no JSON key needed
3. Share both Apps Script projects with the service account email as **Editor**
4. Create a Workload Identity Pool and OIDC Provider in GCP, with an attribute condition scoped to this repo and only `refs/heads/develop` and `refs/heads/main`:
   ```
   attribute.repository == "propublica/gas-ssi-toolkit" &&
   (attribute.ref == "refs/heads/develop" || attribute.ref == "refs/heads/main")
   ```
5. Grant the WIF provider permission to impersonate the service account (`roles/iam.workloadIdentityUser`)
6. Create two GitHub Environments in repo Settings → Environments: `dev` and `prod`
7. Add these variables to each environment (not secrets — these values are not sensitive):
   - `WIF_PROVIDER` — full provider resource name (e.g. `projects/123/locations/global/workloadIdentityPools/my-pool/providers/github`)
   - `WIF_SERVICE_ACCOUNT` — service account email

### Workflow file

**`.github/workflows/deploy.yml`**

```yaml
name: Deploy

on:
  workflow_run:
    # Gate on CI passing — this workflow only fires after lint/typecheck/format/test succeeds
    workflows: ["Lint/Typecheck/Format/Test"]
    types: [completed]
    # Only watch these branches — PRs from feature branches don't trigger this
    branches: [develop, main]

# Required for google-github-actions/auth to request an OIDC token from GitHub
permissions:
  id-token: write
  contents: read

jobs:
  deploy-dev:
    # Three conditions must all be true:
    # 1. CI passed (not cancelled or failed)
    # 2. This was a push (merge), not a PR CI run
    # 3. The push was to develop specifically
    if: >
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_branch == 'develop'
    runs-on: ubuntu-latest
    # Scopes WIF_PROVIDER and WIF_SERVICE_ACCOUNT vars to the dev environment
    environment: dev

    steps:
      # Check out the exact commit that triggered CI — not just the branch HEAD
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      # Exchange GitHub's OIDC token for a short-lived GCP access token
      # via Workload Identity Federation. Sets GOOGLE_APPLICATION_CREDENTIALS.
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ vars.WIF_PROVIDER }}
          service_account: ${{ vars.WIF_SERVICE_ACCOUNT }}

      # Build + copy .clasp.dev.json + push using ADC credentials from the step above.
      # --adc tells clasp to use GOOGLE_APPLICATION_CREDENTIALS instead of ~/.clasprc.json.
      # Note: deploy:dev npm script omitted here because it calls clasp push without --adc.
      - name: Deploy to dev
        run: npm run build && cp .clasp.dev.json .clasp.json && clasp push --adc

  deploy-prod:
    # Same gate logic, but only fires on pushes to main
    if: >
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push' &&
      github.event.workflow_run.head_branch == 'main'
    runs-on: ubuntu-latest
    environment: prod

    steps:
      # Check out the exact commit that triggered CI — not just the branch HEAD
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.workflow_run.head_sha }}

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      # Exchange GitHub's OIDC token for a short-lived GCP access token
      # via Workload Identity Federation. Sets GOOGLE_APPLICATION_CREDENTIALS.
      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ vars.WIF_PROVIDER }}
          service_account: ${{ vars.WIF_SERVICE_ACCOUNT }}

      # Build + copy .clasp.prod.json + push using ADC credentials from the step above.
      - name: Deploy to prod
        run: npm run build && cp .clasp.prod.json .clasp.json && clasp push --adc
```

---

## Fallback Approach: Custom OAuth Client + `.clasprc.json` Secret

Use this approach if `--adc` proves unreliable (e.g. breaks on a clasp version bump).

### How it works

Create a custom GCP OAuth Desktop Application client. Run `clasp login --creds <downloaded-json>` once locally — this opens a browser, you authenticate as a dedicated deploy Google account, and clasp writes `~/.clasprc.json` containing a long-lived OAuth refresh token. Store that file's contents as a GitHub environment secret. In CI, decode and write it to `~/.clasprc.json` before running `clasp push` (no `--adc` flag needed).

### Trade-offs vs. WIF + `--adc`

| | WIF + `--adc` | Custom OAuth + `.clasprc.json` |
|---|---|---|
| Stored credential | None | Refresh token (long-lived) |
| Experimental risk | Yes (`--adc`) | None |
| GCP setup complexity | Higher (WIF pool + provider) | Lower (just an OAuth client) |
| If credential leaks | N/A — ephemeral | Revoke token manually |
| Tied to user account | No (service account) | Yes — whoever authenticated |

### One-time setup

1. Create a GCP OAuth Desktop Application client; enable the same APIs as the main approach
2. Run `clasp login --creds <downloaded-json>` locally using a dedicated deploy Google account (not a personal account)
3. Base64-encode `~/.clasprc.json`: `base64 -i ~/.clasprc.json`
4. Store the base64 string as a GitHub environment secret: `CLASPRC_JSON` (add to both `dev` and `prod` environments)
5. Share both Apps Script projects with the deploy account as **Editor**

### Workflow differences

Replace the `Authenticate to Google Cloud` step and the `--adc` flag with:

```yaml
- name: Write clasp credentials
  run: |
    echo "${{ secrets.CLASPRC_JSON }}" | base64 --decode > ~/.clasprc.json

- name: Deploy to dev
  run: npm run deploy:dev
```

The existing `deploy:dev` and `deploy:prod` npm scripts work as-is since `clasp push` reads `~/.clasprc.json` by default.
