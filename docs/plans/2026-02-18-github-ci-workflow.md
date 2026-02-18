# GitHub CI Workflow Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a GitHub Actions CI workflow that runs lint, format check, and test+coverage on every push to `main` and every PR targeting `main`.

**Architecture:** Two new files — `.nvmrc` pins the Node version for local dev parity, `.github/workflows/ci.yml` defines a single sequential job that runs all checks. No existing files are modified.

**Tech Stack:** GitHub Actions, Node 22 LTS, ESLint, Prettier, Jest + Istanbul

**Design doc:** `docs/plans/2026-02-18-github-ci-workflow-design.md`

---

### Task 1: Add `.nvmrc`

**Files:**
- Create: `.nvmrc`

**Step 1: Create the file**

Create `/Users/aaronbrezel/Projects/gas-ssi-toolkit/.nvmrc` with exactly this content (one line, no trailing newline issues):

```
22
```

**Step 2: Verify**

```bash
cat /Users/aaronbrezel/Projects/gas-ssi-toolkit/.nvmrc
```

Expected output: `22`

**Step 3: Commit**

```bash
git -C /Users/aaronbrezel/Projects/gas-ssi-toolkit add .nvmrc
git -C /Users/aaronbrezel/Projects/gas-ssi-toolkit commit -m "chore: pin Node 22 LTS via .nvmrc

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

### Task 2: Create the CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create the directory and file**

Create `/Users/aaronbrezel/Projects/gas-ssi-toolkit/.github/workflows/ci.yml` with exactly this content:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  ci:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version-file: ".nvmrc"
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Lint
        run: npm run lint

      - name: Check formatting
        run: npx prettier --check 'src/**/*.ts'

      - name: Test with coverage
        run: npm run test:coverage
```

> **Why `npx prettier --check` and not `npm run format`?**
> `npm run format` uses `prettier --write`, which mutates files. In CI that would silently reformat and pass with a dirty working tree. `--check` exits with code 1 if any file is out of format without modifying anything.

> **Why `node-version-file: ".nvmrc"` instead of `node-version: "22"`?**
> Reading from `.nvmrc` means the workflow and local dev always use the same version automatically — one source of truth.

**Step 2: Validate the YAML parses correctly**

```bash
node -e "require('fs').readFileSync('/Users/aaronbrezel/Projects/gas-ssi-toolkit/.github/workflows/ci.yml', 'utf8'); console.log('File readable')"
```

Expected: `File readable`

Then do a quick visual check that the indentation looks correct (YAML is whitespace-sensitive):

```bash
cat /Users/aaronbrezel/Projects/gas-ssi-toolkit/.github/workflows/ci.yml
```

**Step 3: Run tests locally to confirm nothing is broken**

```bash
cd /Users/aaronbrezel/Projects/gas-ssi-toolkit && npm run test:coverage
```

Expected: 45 tests pass, no coverage threshold violations.

**Step 4: Commit**

```bash
git -C /Users/aaronbrezel/Projects/gas-ssi-toolkit add .github/workflows/ci.yml
git -C /Users/aaronbrezel/Projects/gas-ssi-toolkit commit -m "ci: add GitHub Actions workflow for lint, format, and test coverage

Runs on push to main and PRs targeting main. Single sequential job:
checkout → setup Node 22 → npm ci → lint → prettier check → test:coverage

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

**Step 5: Push and verify on GitHub**

```bash
git -C /Users/aaronbrezel/Projects/gas-ssi-toolkit push
```

Then open the repository on GitHub → Actions tab. You should see the workflow `CI` appear and run. Confirm all 6 steps (checkout, setup-node, install, lint, format check, test:coverage) pass green.

> If the workflow does not appear, check that the file is at exactly `.github/workflows/ci.yml` (two levels deep, not `.github/ci.yml`).

---

## Done

After Task 2 Step 5, every future PR to `main` will automatically run lint, format check, and test+coverage before merge.
