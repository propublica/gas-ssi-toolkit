# Dev Environment Audit — Design Document

**Date:** 2026-02-18
**Branch:** dev-env-updates
**Status:** Approved

## Background

This project was initially scaffolded using Gemini CLI and the Conductor extension. This design document captures the results of a post-hoc audit of the decisions made during that process and a remediation plan for the gaps found.

## Audit Findings

### Build Pipeline — Sound

The Rollup + IIFE + footer stubs pattern is correct for Google Apps Script. GAS has no module system at runtime, so inlining all dependencies into a single file and re-exposing entry points as true globals is the right approach. TypeScript config is also correct: ES2019 target matches the GAS V8 runtime, strict mode is enabled, `moduleResolution: "Bundler"` is appropriate for Rollup.

Minor gap: `appsscript.json` is copied via a raw shell `cp` in the build script — brittle on Windows but non-urgent.

Note: A future migration to GitHub Actions for build and deploy is desired but deferred.

### Developer Tooling — Mostly sound, two concrete issues

The ESLint + Prettier + Husky + lint-staged chain is the right default setup. Two issues:

1. **Dual ESLint configs.** Both `.eslintrc.json` (legacy) and `eslint.config.mjs` (flat config) exist. ESLint 9 ignores the legacy file entirely — it is dead weight.
2. **Pre-commit hook does not run tests.** Only lint-staged runs on commit. The currently-failing test in `menu.test.ts` was committed undetected as a result.
3. **`_e` lint error in `drive.ts`.** The `no-unused-vars` rule does not honor the underscore prefix convention for caught errors by default. Needs `caughtErrorsIgnorePattern: "^_"` in the ESLint config.

### Testing Strategy — Architecture right, execution has gaps

The Jest + ts-jest + globalThis mock pattern is the correct approach for testing GAS TypeScript. Pure utilities in `utils.ts` and `api.ts` are well-tested. The gaps:

1. **One failing test.** `menu.test.ts` expects `google.script.host.close()` in `openQuickstartDoc`'s HTML output. The implementation is the bug — without the close call, a 30×30 invisible modal is left open in the user's sheet.
2. **Zero tests for the four main tools.** `importDriveLinks`, `extractTextFromSelection`, `sampleRowsToEvaluation`, and `runBatchAI` have no tests. Overall statement coverage is ~25%.
3. **`drive.ts` has ~9.5% coverage.** The OCR-via-temp-Doc-conversion logic is the most complex in the project and is entirely untested.
4. **No coverage thresholds enforced.** Nothing prevents coverage from regressing.

### Code Organization — Module split is good, index.ts has a structural issue

The separation into `api.ts`, `drive.ts`, `utils.ts`, `config.ts`, `dialog.ts`, and `types.ts` is correct. The dependency direction is clean. The issue is that `index.ts` interleaves UI calls, business logic, and sheet I/O in each tool function, increasing the mock surface area needed to test them.

The preferred fix is to extract the pure business logic from each tool into standalone helper functions — either in `index.ts` itself or in new dedicated modules. These helpers take plain data in and return plain data out, with no GAS dependencies. The existing GAS-coupled orchestrator functions in `index.ts` then become thin wrappers that handle UI and sheet I/O and delegate to the pure helpers. Tests target the helpers directly, with minimal or no mocking needed.

For example, the Fisher-Yates shuffle in `sampleRowsToEvaluation` and the row-filtering logic in `runBatchAI` are already pure — they just need to be extracted into named functions.

Error handling is also inconsistent across modules (`api.ts` throws, `drive.ts` returns error strings, `index.ts` uses `ui.alert()` and cell writes), making failure behavior harder to predict. This is deferred as it is the most invasive change with no user-visible impact.

## Remediation Approach

**Approach A — Quick wins first, tests second.** Selected.

### Phase 1: Dev Environment Fixes (fast, independent)

Fix all tooling and environment issues as a batch:

1. Delete `.eslintrc.json`
2. Add `caughtErrorsIgnorePattern: "^_"` to ESLint config to fix `drive.ts` lint error
3. Fix `openQuickstartDoc` implementation to include `google.script.host.close()`
4. Add `jest --bail` to `.husky/pre-commit` so tests run on every commit
5. Add `coverageThreshold` to `jest.config.cjs` (set to current passing baseline, to be raised as coverage improves)

### Phase 2: Business Logic Extraction + Tests

Extract pure business logic from `index.ts` tool functions into standalone helpers, then write tests against the helpers. The GAS-coupled orchestrators in `index.ts` become thin wrappers.

6. Extract and test logic from `drive.ts` — `checkDriveService` and `extractTextUniversal` (three branches: Google Doc, PDF/image OCR, unsupported type)
7. Extract helpers from `importDriveLinks` (folder scanning, output formatting) and write tests
8. Extract helpers from `extractTextFromSelection` (row filtering, truncation logic) and write tests
9. Extract helpers from `sampleRowsToEvaluation` (shuffle + slice) and write tests
10. Extract helpers from `runBatchAI` (row processing, skip logic) and write tests

### Deferred

- Error handling consistency refactor — no user-visible impact, most invasive change
- GitHub Actions CI/CD pipeline — desired future state, not part of this effort
- `appsscript.json` Rollup copy plugin — minor quality-of-life improvement
