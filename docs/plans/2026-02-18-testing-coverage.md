# Testing Coverage Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Scope Jest coverage to the testable source tier, set meaningful per-file thresholds, add one missing test for `getAllFilesRecursive`, and expose coverage via a dedicated npm script.

**Architecture:** Three config changes (`jest.config.cjs`, `package.json`, `utils.test.ts`) with no new files. TDD order: set the aspirational threshold that forces utils.ts to fail, then add the test to make it pass.

**Tech Stack:** Jest 29, ts-jest, Istanbul (bundled with Jest), TypeScript 5

**Design doc:** `docs/plans/2026-02-18-testing-coverage-design.md`

---

### Task 1: Add `test:coverage` script and establish baseline

**Files:**
- Modify: `package.json:19`

**Step 1: Add the script**

In `package.json`, insert `"test:coverage"` after the `"test:watch"` line:

```json
"test": "jest",
"test:watch": "jest --watch",
"test:coverage": "jest --coverage",
```

**Step 2: Run the baseline**

```bash
npm run test:coverage
```

Expected: all 42 tests pass, then Jest prints a coverage table and **fails** on threshold violations (the existing thresholds in `jest.config.cjs` are higher than actual coverage). Note the actual measured percentages for `api.ts`, `utils.ts`, and `drive.ts` from the table — you will use these in Task 2.

> The numbers you want are in the `% Stmts`, `% Branch`, `% Funcs`, `% Lines` columns for each file.

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat(test): add test:coverage script"
```

---

### Task 2: Fix `jest.config.cjs` — scope coverage and per-file thresholds

**Files:**
- Modify: `jest.config.cjs`

**Step 1: Replace the entire file**

```js
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  moduleNameMapper: {
    "^@server/(.*)$": "<rootDir>/src/server/$1",
    "^@shared/(.*)$": "<rootDir>/src/shared/$1",
  },
  // Scope coverage to source files only.
  // src/server/index.ts is excluded: it is the GAS orchestration layer, deeply
  // coupled to SpreadsheetApp UI globals (prompts, dialogs, active ranges).
  // Testing it would require mocking deeply-nested GAS call chains with low ROI.
  // See docs/plans/2026-02-18-testing-coverage-design.md for full rationale.
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/server/index.ts",
  ],
  coverageThreshold: {
    // Thresholds are set ~5 points below observed coverage to allow minor
    // fluctuations without requiring constant threshold updates.
    // Observed from baseline run in Task 1; adjust these values if your
    // baseline differs from the targets below.
    "./src/server/api.ts": {
      statements: 95,
      branches: 90,
      functions: 100,
    },
    // utils.ts threshold is intentionally set above current coverage (~73%).
    // It requires the getAllFilesRecursive test added in Task 3 to pass.
    "./src/server/utils.ts": {
      statements: 80,
      branches: 85,
      functions: 80,
    },
    "./src/server/drive.ts": {
      statements: 65,
      branches: 60,
      functions: 100,
    },
  },
};
```

> **Adjust if needed:** If your baseline in Task 1 showed `api.ts` branches below 90% or `drive.ts` statements below 65%, lower those specific values by 5 points from your observed number before continuing.

**Step 2: Confirm the threshold causes a failure for utils.ts**

```bash
npm run test:coverage
```

Expected output includes something like:

```
Jest: "utils.ts" coverage threshold for statements (80%) not met: XX%
```

`api.ts` and `drive.ts` should pass. Only `utils.ts` should fail (because `getAllFilesRecursive` is not yet tested). If `drive.ts` also fails, lower its thresholds by 10 points and re-run.

**Do not commit yet.** Task 3 makes it green.

---

### Task 3: Add `getAllFilesRecursive` test to `utils.test.ts`

**Files:**
- Modify: `__tests__/utils.test.ts`

`getAllFilesRecursive` takes a `Folder` and a mutable array as arguments — no `globalThis` DriveApp mock is needed. We pass a plain object that satisfies the iterator shape.

**Step 1: Add the import**

At the top of `__tests__/utils.test.ts`, add `getAllFilesRecursive` to the existing import:

```ts
import {
  extractId,
  isValidDriveLink,
  createSeededRandom,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  getAIContext,
} from "../src/server/utils";
```

**Step 2: Add the test block**

Append to the bottom of `__tests__/utils.test.ts`:

```ts
describe("getAllFilesRecursive", () => {
  // Build a minimal iterator that satisfies folder.getFiles() / folder.getFolders()
  function makeFileIterator(urls: string[]) {
    let i = 0;
    return { hasNext: () => i < urls.length, next: () => ({ getUrl: () => urls[i++] }) };
  }

  function makeFolderIterator(folders: object[]) {
    let i = 0;
    return { hasNext: () => i < folders.length, next: () => folders[i++] };
  }

  function makeFolder(urls: string[], subfolders: object[] = []) {
    return {
      getFiles: () => makeFileIterator(urls),
      getFolders: () => makeFolderIterator(subfolders),
    };
  }

  it("collects file URLs from a flat folder", () => {
    const folder = makeFolder([
      "https://drive.google.com/file/d/abc",
      "https://drive.google.com/file/d/def",
    ]);
    const result: { url: string }[] = [];
    getAllFilesRecursive(folder as any, result);
    expect(result).toEqual([
      { url: "https://drive.google.com/file/d/abc" },
      { url: "https://drive.google.com/file/d/def" },
    ]);
  });

  it("recurses into subfolders", () => {
    const subfolder = makeFolder(["https://drive.google.com/file/d/xyz"]);
    const rootFolder = makeFolder(
      ["https://drive.google.com/file/d/abc"],
      [subfolder],
    );
    const result: { url: string }[] = [];
    getAllFilesRecursive(rootFolder as any, result);
    expect(result).toEqual([
      { url: "https://drive.google.com/file/d/abc" },
      { url: "https://drive.google.com/file/d/xyz" },
    ]);
  });

  it("returns an empty list for an empty folder", () => {
    const folder = makeFolder([]);
    const result: { url: string }[] = [];
    getAllFilesRecursive(folder as any, result);
    expect(result).toHaveLength(0);
  });
});
```

**Step 3: Verify tests pass**

```bash
npx jest __tests__/utils.test.ts
```

Expected: all tests in the file pass, including the 3 new ones.

**Step 4: Verify full suite + thresholds pass**

```bash
npm run test:coverage
```

Expected: 45 tests pass, coverage table prints, **no threshold violations**. If `utils.ts` statements are still below 80%, check that `getAllFilesRecursive` appears as covered (green) in `coverage/lcov-report/utils.ts.html`.

**Step 5: Commit**

```bash
git add jest.config.cjs __tests__/utils.test.ts
git commit -m "feat(test): scope coverage to testable tier, add getAllFilesRecursive tests

- Replace global coverageThreshold with per-file thresholds for api.ts,
  utils.ts, and drive.ts
- Exclude src/server/index.ts from coverage (GAS-entangled orchestration)
- Add three tests for getAllFilesRecursive covering flat, recursive, and
  empty folder cases"
```

---

## Done

After Task 3, `npm run test:coverage` is the canonical way to check coverage health. The pre-commit hook (`npx jest --bail`) is unchanged — no coverage overhead on every commit.
