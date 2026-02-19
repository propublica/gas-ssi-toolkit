# GitHub Actions Clasp Deployment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `deploy.yml` GitHub Actions workflow that deploys the Apps Script add-on to dev on merge to `develop` and to prod on merge to `main`, gated on CI passing, authenticated via Workload Identity Federation.

**Architecture:** A separate `deploy.yml` triggers via `workflow_run` after the existing CI workflow succeeds on a push (not a PR). Each environment job uses `google-github-actions/auth@v3` to exchange a GitHub OIDC token for a short-lived GCP access token via service account impersonation, then runs `clasp push --adc`. No credentials are stored in GitHub.

**Tech Stack:** GitHub Actions, Google Cloud Workload Identity Federation, `google-github-actions/auth@v3`, `@google/clasp@3.x`, `gcloud` CLI (for GCP setup only)

**Design doc:** `docs/plans/2026-02-19-github-actions-clasp-deploy-design.md` — includes full rationale and a documented fallback approach (custom OAuth + `.clasprc.json`) if `--adc` proves unreliable.

---

## Prerequisites

Tasks 1–5 are one-time manual setup outside of CI. They do not involve writing code. Complete them in order before Task 6.

You will need:
- `gcloud` CLI installed and authenticated as a GCP project owner
- Access to the Google Apps Script editor for both dev and prod script projects
- Admin access to the GitHub repository

---

### Task 1: Gather GCP project information

**Why:** The WIF setup commands require your GCP project ID and project number. Apps Script projects are linked to a GCP project — find out which one.

**Step 1: Find your GCP project ID**

Open the [Google Cloud Console](https://console.cloud.google.com). The project ID appears in the top-left project selector (format: `my-project-id`). If you have multiple projects, check which one the Apps Script projects are linked to: open each script in the [Apps Script editor](https://script.google.com), go to **Project Settings → Google Cloud Platform (GCP) Project** and note the project number shown there.

**Step 2: Get the project number from the project ID**

```bash
gcloud projects describe <PROJECT_ID> --format="value(projectNumber)"
```

Save both values — you'll need them throughout this plan. Replace `<PROJECT_ID>` and `<PROJECT_NUMBER>` with your actual values in every command below.

**Step 3: Confirm the GitHub repo name**

```bash
git remote get-url origin
```

Expected output: `https://github.com/propublica/gas-ssi-toolkit.git` (or SSH equivalent). Note the `owner/repo` slug — used in the WIF attribute condition.

---

### Task 2: Enable required APIs and create service account

**Step 1: Set your project**

```bash
gcloud config set project <PROJECT_ID>
```

**Step 2: Enable the Apps Script API**

```bash
gcloud services enable script.googleapis.com
```

Expected: `Operation "operations/..." finished successfully.`

**Step 3: Create the service account**

```bash
gcloud iam service-accounts create "github-actions-clasp" \
  --display-name="GitHub Actions Clasp Deploy"
```

Expected: `Created service account [github-actions-clasp].`

The service account email will be: `github-actions-clasp@<PROJECT_ID>.iam.gserviceaccount.com` — save this.

---

### Task 3: Create Workload Identity Pool and OIDC Provider

**Why:** This is the GCP-side trust configuration. It tells GCP: "trust OIDC tokens from GitHub Actions, but only from the `propublica/gas-ssi-toolkit` repo pushing to `develop` or `main`."

**Step 1: Create the Workload Identity Pool**

```bash
gcloud iam workload-identity-pools create "github-actions" \
  --location="global" \
  --display-name="GitHub Actions"
```

Expected: `Created workload identity pool [github-actions].`

**Step 2: Create the OIDC Provider**

Replace `propublica/gas-ssi-toolkit` with your actual `owner/repo` slug if different.

```bash
gcloud iam workload-identity-pools providers create-oidc "github" \
  --location="global" \
  --workload-identity-pool="github-actions" \
  --display-name="GitHub" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
  --attribute-condition="attribute.repository=='propublica/gas-ssi-toolkit' && (attribute.ref=='refs/heads/develop' || attribute.ref=='refs/heads/main')" \
  --issuer-uri="https://token.actions.githubusercontent.com"
```

Expected: `Created workload identity pool provider [github].`

**Step 3: Grant the WIF provider permission to impersonate the service account**

```bash
gcloud iam service-accounts add-iam-policy-binding \
  "github-actions-clasp@<PROJECT_ID>.iam.gserviceaccount.com" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-actions/attribute.repository/propublica/gas-ssi-toolkit"
```

Expected: `Updated IAM policy for service account [github-actions-clasp@...].`

**Step 4: Note the WIF provider resource name**

You'll need this as the `WIF_PROVIDER` variable in GitHub. Its format is:

```
projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-actions/providers/github
```

Verify it:
```bash
gcloud iam workload-identity-pools providers describe "github" \
  --workload-identity-pool="github-actions" \
  --location="global" \
  --format="value(name)"
```

---

### Task 4: Grant service account editor access to both Apps Script projects

**Why:** Service accounts cannot own Apps Script scripts. They can only push to scripts they've been explicitly shared with. This must be done for both dev and prod.

**Step 1: Share the dev Apps Script project**

Open the dev script in the [Apps Script editor](https://script.google.com) (script ID: `1x1qwECFShOjQ-HaHslRjURQmWji08Xw4w_NTQOfMsC4H5TYcw0Flpsi6`).

Go to **Project Settings** (gear icon, left sidebar) and note the GCP project number shown — confirm it matches your project.

Then go to the script's **Share** settings (top right). Add `github-actions-clasp@<PROJECT_ID>.iam.gserviceaccount.com` with **Editor** role.

**Step 2: Share the prod Apps Script project**

Repeat for the prod script (script ID: `1bxxBbNIGH4B5MAi9FOedadRPf_ycnSFAXxiZ_ZLMsZqiUFOY90qyNxhx`).

---

### Task 5: Configure GitHub Environments and variables

**Why:** Environment-scoped variables (not repo-level) ensure each deploy job only has access to its own environment's config. This also enables adding a manual approval gate on prod in the future.

**Step 1: Create the `dev` environment**

In the GitHub repo, go to **Settings → Environments → New environment**. Name it `dev`. No protection rules needed.

Add these two variables (not secrets):
- `WIF_PROVIDER` → `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-actions/providers/github`
- `WIF_SERVICE_ACCOUNT` → `github-actions-clasp@<PROJECT_ID>.iam.gserviceaccount.com`

**Step 2: Create the `prod` environment**

Repeat. Name it `prod`. Add the same two variables with the same values (both environments use the same service account, which has access to both script projects).

Optional: Under **Deployment protection rules**, enable **Required reviewers** for prod and add yourself — this adds a manual approval gate before any prod deploy fires.

---

### Task 6: Create the deploy workflow file

This is the only code task. No tests to write — GitHub Actions YAML has no unit test framework. Validation happens via `actionlint` (Step 2) and an end-to-end run (Task 7).

**Files:**
- Create: `.github/workflows/deploy.yml`

**Step 1: Create the workflow file**

Create `.github/workflows/deploy.yml` with this exact content:

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
      # Note: the existing deploy:dev npm script calls clasp push without --adc,
      # so we inline the commands here instead.
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

**Step 2: Validate YAML syntax with actionlint**

`actionlint` is a static linter for GitHub Actions workflows. Install and run it locally before pushing:

```bash
# macOS
brew install actionlint

# Run against the new file
actionlint .github/workflows/deploy.yml
```

Expected: no errors. If actionlint flags anything, fix it before continuing.

**Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "feat: add deploy workflow with WIF authentication"
```

---

### Task 7: End-to-end verification

**Step 1: Push to `develop` and verify the deploy-dev job fires**

```bash
git push origin develop
```

In the GitHub repo, go to **Actions**. You should see:
1. The "Lint/Typecheck/Format/Test" workflow run first
2. After it completes, the "Deploy" workflow appears — only `deploy-dev` runs; `deploy-prod` is skipped

**Step 2: Verify the `deploy-dev` job succeeds**

Click into the Deploy workflow run → `deploy-dev` job. Check each step. The `Authenticate to Google Cloud` step should show a successful token exchange. The `Deploy to dev` step should show `clasp push` output confirming files were pushed.

**Step 3: Confirm the script updated in Apps Script**

Open the dev Apps Script project (`1x1qwECFShOjQ-HaHslRjURQmWji08Xw4w_NTQOfMsC4H5TYcw0Flpsi6`) in the editor and verify the code matches the pushed commit.

**Step 4: Verify PRs do NOT trigger a deploy**

Open a PR targeting `develop`. Confirm that after CI runs, the Deploy workflow does NOT appear (or if it does appear, both jobs show as skipped). This confirms the `event == 'push'` guard is working.

**Step 5: Test prod deploy (when ready)**

Merge a PR to `main` and repeat Steps 1–3 for the prod script.

---

## Fallback

If `clasp push --adc` fails due to the experimental flag, switch to the custom OAuth + `.clasprc.json` approach documented in `docs/plans/2026-02-19-github-actions-clasp-deploy-design.md` under "Fallback Approach." The workflow diff is minimal — replace the `Authenticate to Google Cloud` step with a secret decode step and drop the `--adc` flag.
