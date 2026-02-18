# GitHub CI Workflow Design

**Date:** 2026-02-18
**Status:** Approved

## Context

The project has no CI pipeline. Linting and formatting are enforced locally via husky pre-commit hooks (lint-staged), and tests run via `npx jest --bail` on every commit. Coverage checks are opt-in (`npm run test:coverage`). There is no automated enforcement on PRs or pushes to `main`.

## Design

### Triggers

Run on:
- `push` to `main`
- `pull_request` targeting `main`

### Workflow structure

Single sequential job (`ci`) on `ubuntu-latest`. Tests run in ~0.5s — parallel jobs would add more startup overhead than they save.

### Node version

Pin to Node 22 LTS both in the workflow and in a new `.nvmrc` file at the repo root. Keeps local dev and CI in sync without requiring developers to remember the right version.

### Steps

| Step | Command | Notes |
|---|---|---|
| Checkout | `actions/checkout@v4` | |
| Setup Node | `actions/setup-node@v4` | Reads `.nvmrc`, enables npm dependency cache |
| Install | `npm ci` | Clean install from lockfile |
| Lint | `npm run lint` | ESLint on `src/**/*.ts` |
| Format check | `npx prettier --check 'src/**/*.ts'` | `--check` exits 1 if any file is out of format; `npm run format` uses `--write` and is not appropriate for CI |
| Test + coverage | `npm run test:coverage` | Runs full test suite and enforces per-file coverage thresholds in one pass |

### Files

- Create: `.github/workflows/ci.yml`
- Create: `.nvmrc` (contents: `22`)

## What This Does Not Include

- Build step (`npm run build`) — TypeScript type-checking is covered by ts-jest at test time; deploy is manual via clasp
- Notifications or status badges — out of scope for this iteration
- Caching beyond npm dependencies — not needed at this project size
