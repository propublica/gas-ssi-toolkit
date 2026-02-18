# Testing Coverage Design

**Date:** 2026-02-18
**Status:** Approved

## Context

The project uses Jest + ts-jest for unit testing. Coverage is collected via Istanbul (bundled with Jest). The `coverage/` directory is gitignored — it is a local build artifact, not committed source.

The existing `coverageThreshold` in `jest.config.cjs` is misconfigured: the thresholds (41% statements, 58% branches/functions, 42% lines) are set above the actual measured coverage (~25% statements, ~45% branches, ~35% functions). Because `npm test` runs `jest` without `--coverage`, these thresholds are **never enforced** — they are dead config.

## Testability Tiers

The codebase splits into two distinct testability tiers based on GAS coupling:

**Tier 1 — Testable (pure or injectable)**
| File | Description | Current coverage |
|---|---|---|
| `src/server/api.ts` | Gemini API calls; GAS globals passed as arguments | ~100% |
| `src/server/utils.ts` | Pure helpers; zero GAS dependencies | ~73% |
| `src/server/config.ts` | Constant object | 100% |
| `src/server/dialog.ts` | HTML template string | 100% |
| `src/server/drive.ts` | Drive/OCR operations; GAS globals mockable | ~75% (see note) |

**Tier 2 — GAS-entangled (accept the gap)**
| File | Description | Current coverage |
|---|---|---|
| `src/server/index.ts` | Four tool orchestrators + UI handlers; deeply coupled to `SpreadsheetApp.getUi().prompt()`, `getActiveRange()`, `toast()`, etc. | ~11% |

`index.ts` contains 154 of 217 total statements (~70% of the codebase by statement count). Fully testing it would require mocking deeply nested GAS UI interaction chains with little ROI. The two simplest entry points (`onOpen`, `openQuickstartDoc`) are already tested in `menu.test.ts`.

> **Note on `drive.ts` anomaly:** The `coverage/` directory generated today shows 0% functions for `drive.ts` despite a full `drive.test.ts` test file. This is because the report was generated from a partial test run — `drive.ts` was loaded as a side effect of importing `index.ts` in `menu.test.ts`, but its functions were never called in that partial run. True coverage from `npm run test:coverage` (full suite) is expected to be ~75%+.

## Design

### 1. `jest.config.cjs` — scope coverage and fix thresholds

Add `collectCoverageFrom` to:
- Include all `src/**/*.ts`
- Explicitly exclude `src/server/index.ts` with a comment documenting the rationale

Replace the global `coverageThreshold` with per-file thresholds targeting the Tier 1 files only:

| File | statements | branches | functions |
|---|---|---|---|
| `src/server/api.ts` | 95% | 90% | 100% |
| `src/server/utils.ts` | 80% | 85% | 80% |
| `src/server/drive.ts` | 65% | 60% | 100% |

Thresholds are set a few points below expected actual coverage to provide a buffer against minor fluctuations.

`config.ts` and `dialog.ts` are trivially covered whenever `index.ts` is imported in any test — no explicit thresholds needed.

### 2. `package.json` — add `test:coverage` script

Add:
```json
"test:coverage": "jest --coverage"
```

The existing `"test": "jest"` and pre-commit hook (`npx jest --bail`) are unchanged. Coverage collection remains opt-in and does not slow down the standard commit flow.

### 3. `__tests__/utils.test.ts` — add `getAllFilesRecursive` test

`getAllFilesRecursive` (lines 46–58 of `utils.ts`) is the only untested function in the Tier 1 files. It uses `DriveApp` folder iteration and recursion. Adding a test block covering:
- A flat folder with files (base case)
- A folder with one subfolder (recursive case)

...will push `utils.ts` from ~73% to ~90%+ statements, comfortably above the 80% threshold.

### 4. Verify before enforcing

Before finalizing thresholds, run `npm run test:coverage` to observe true numbers from the full test suite. Set final thresholds at observed values minus ~5 points.

## What This Does Not Include

- Coverage enforcement in the pre-commit hook (kept as `jest --bail` for commit speed)
- Tests for `index.ts` tool orchestrators — accepted as a structural gap
- CI pipeline setup — out of scope for this design

## Future Considerations

If a CI pipeline (GitHub Actions) is added, uploading `lcov.info` to a coverage reporting service (e.g. Codecov) would provide per-PR coverage diffs with no additional configuration beyond this design.
