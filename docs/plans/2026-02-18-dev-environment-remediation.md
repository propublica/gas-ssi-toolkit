# Dev Environment Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all developer tooling gaps identified in the audit and add comprehensive test coverage for untested modules.

**Architecture:** Two phases — Phase 1 cleans up tooling so the environment is healthy and enforcing before any new code is written. Phase 2 extracts pure business logic from `index.ts` orchestrators into testable helpers, then writes tests for those helpers and for `drive.ts`. Phase 2 follows strict TDD: write failing test, verify it fails, implement, verify it passes, commit.

**Tech Stack:** TypeScript, Jest + ts-jest, ESLint (flat config), Husky, Rollup, Google Apps Script V8

---

## Phase 1: Dev Environment Fixes

---

### Task 1: Remove dead ESLint config and fix `drive.ts` lint error

**Files:**
- Delete: `.eslintrc.json`
- Modify: `eslint.config.mjs`

**Step 1: Delete the legacy config**

```bash
rm .eslintrc.json
```

**Step 2: Add `caughtErrorsIgnorePattern` to the ESLint rule**

In `eslint.config.mjs`, the `@typescript-eslint/no-unused-vars` rule currently only has `argsIgnorePattern`. The `_e` in `drive.ts`'s catch block is a *caught error*, which is governed by a separate option. Update the rule:

```js
// eslint.config.mjs — update this rule block:
"@typescript-eslint/no-unused-vars": ["error", {
    argsIgnorePattern: "^_",
    caughtErrorsIgnorePattern: "^_",
}],
```

**Step 3: Verify lint passes**

```bash
npm run lint
```

Expected: no errors or warnings about `_e`.

**Step 4: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore(lint): remove dead .eslintrc.json and fix caughtErrorsIgnorePattern"
```

---

### Task 2: Fix the `openQuickstartDoc` implementation

**Context:** The test in `__tests__/menu.test.ts` line 74–83 expects:
1. The HTML string to contain `google.script.host.close();` after `window.open(...)`.
2. `.setWidth(10)` and `.setHeight(10)`.

The current implementation omits `google.script.host.close()` (leaving an invisible 30×30 modal open in the sheet forever) and uses 30×30. The test is correct; the implementation is the bug.

**Files:**
- Modify: `src/server/index.ts`

**Step 1: Run the currently-failing test to confirm it fails**

```bash
npx jest __tests__/menu.test.ts -t "should open the quickstart document"
```

Expected: FAIL

**Step 2: Fix the implementation**

In `src/server/index.ts`, update `openQuickstartDoc` (around line 41–46):

```ts
export function openQuickstartDoc(): void {
  const url =
    "https://docs.google.com/document/d/1BQJzBHiE6L0hvU6NMD0jaQE71VWRpWH-vNQu3UtGjBA/edit?usp=sharing";
  const htmlOutput = HtmlService.createHtmlOutput(
    `<script>window.open('${url}', '_blank');google.script.host.close();</script>`,
  )
    .setWidth(10)
    .setHeight(10);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "Opening Quickstart Guide");
}
```

**Step 3: Run the test again to confirm it passes**

```bash
npx jest __tests__/menu.test.ts
```

Expected: all tests PASS

**Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "fix(menu): add google.script.host.close() to openQuickstartDoc and correct dimensions"
```

---

### Task 3: Add `jest --bail` to the pre-commit hook

**Context:** `.husky/pre-commit` currently contains only `npx lint-staged`. The failing test was committed undetected because tests never ran. Add `jest --bail` so a broken test blocks the commit.

**Files:**
- Modify: `.husky/pre-commit`

**Step 1: Update the hook**

Replace the entire file contents with:

```sh
npx jest --bail
npx lint-staged
```

The `--bail` flag stops Jest after the first test suite failure, keeping pre-commit fast.

**Step 2: Verify the hook works by making a test fail temporarily**

Add a deliberate failing assertion anywhere in `__tests__/utils.test.ts`, then try to commit:

```bash
git add .husky/pre-commit
git commit -m "test hook"
```

Expected: commit blocked with Jest failure output.

**Step 3: Revert the deliberate failure, then commit the hook change**

```bash
# Undo the deliberate failure in utils.test.ts (do not stage it)
git checkout -- __tests__/utils.test.ts
git add .husky/pre-commit
git commit -m "chore(hooks): run jest --bail on pre-commit"
```

---

### Task 4: Add coverage thresholds

**Context:** No thresholds exist, so coverage can regress silently. We add thresholds now at the current passing baseline. They will be raised incrementally as Phase 2 adds coverage.

**Files:**
- Modify: `jest.config.cjs`

**Step 1: Get the current passing baseline**

```bash
npm test -- --coverage --coverageReporters=text-summary
```

Note the output. After the Phase 1 fixes, expect approximately:
- Statements: ~27%
- Branches: ~45%
- Functions: ~35%
- Lines: ~28%

**Step 2: Add thresholds to `jest.config.cjs`**

Set each threshold 2 points below the measured baseline to give a small buffer. Example (adjust to match actual output):

```js
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/__tests__"],
  moduleNameMapper: {
    "^@server/(.*)$": "<rootDir>/src/server/$1",
    "^@shared/(.*)$": "<rootDir>/src/shared/$1",
  },
  coverageThreshold: {
    global: {
      statements: 25,
      branches: 43,
      functions: 33,
      lines: 26,
    },
  },
};
```

**Step 3: Verify coverage passes thresholds**

```bash
npm test -- --coverage
```

Expected: PASS with coverage summary showing all thresholds met.

**Step 4: Commit**

```bash
git add jest.config.cjs
git commit -m "chore(test): add coverage thresholds at current baseline"
```

---

## Phase 2: Business Logic Extraction + Tests

**Pattern for all Phase 2 tasks:**

GAS globals must be attached to `globalThis` *before* the module is imported, because `import` statements execute immediately. The mock pattern from `api.test.ts` is your template. For modules that use `MimeType` and `DocumentApp`, those must also be mocked on `globalThis`.

---

### Task 5: Test `drive.ts`

**Files:**
- Create: `__tests__/drive.test.ts`

**Step 1: Write the failing tests**

Create `__tests__/drive.test.ts`:

```ts
/**
 * Tests for src/server/drive.ts
 */

// ── Mock globals BEFORE imports ────────────────────────────────

const mockAlert = jest.fn();
const mockUi = {
  alert: mockAlert,
  ButtonSet: { OK: "OK" },
};

// Drive.Files as a plain object — accessing it won't throw
(globalThis as any).Drive = {
  Files: {},
};

(globalThis as any).DriveApp = {
  getFileById: jest.fn(),
};

(globalThis as any).DocumentApp = {
  openById: jest.fn(),
};

(globalThis as any).MimeType = {
  GOOGLE_DOCS: "application/vnd.google-apps.document",
  PDF: "application/pdf",
};

// ── Import after mocks ─────────────────────────────────────────

import { checkDriveService, extractTextUniversal } from "../src/server/drive";

// ── Tests ──────────────────────────────────────────────────────

describe("checkDriveService", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns true when Drive.Files is accessible", () => {
    (globalThis as any).Drive = { Files: {} };
    expect(checkDriveService(mockUi as any)).toBe(true);
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("returns false and shows alert when Drive.Files throws", () => {
    (globalThis as any).Drive = {
      get Files() {
        throw new Error("Not enabled");
      },
    };
    expect(checkDriveService(mockUi as any)).toBe(false);
    expect(mockAlert).toHaveBeenCalledTimes(1);
  });
});

describe("extractTextUniversal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as any).Drive = { Files: {} };
  });

  it("reads text directly from a Google Doc", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => MimeType.GOOGLE_DOCS,
    });
    (DocumentApp.openById as jest.Mock).mockReturnValue({
      getBody: () => ({ getText: () => "doc body text" }),
    });

    expect(extractTextUniversal("docId123")).toBe("doc body text");
  });

  it("performs OCR and returns text for a PDF", () => {
    const mockBlob = {};
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => MimeType.PDF,
      getName: () => "report.pdf",
      getBlob: () => mockBlob,
    });
    (globalThis as any).Drive = {
      Files: {
        create: jest.fn().mockReturnValue({ id: "tempDocId" }),
        remove: jest.fn(),
      },
    };
    (DocumentApp.openById as jest.Mock).mockReturnValue({
      getBody: () => ({ getText: () => "ocr text from pdf" }),
    });

    expect(extractTextUniversal("pdfId123")).toBe("ocr text from pdf");
    expect((Drive.Files as any).remove).toHaveBeenCalledWith("tempDocId");
  });

  it("returns skip message for unsupported file types", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/zip",
    });

    expect(extractTextUniversal("zipId123")).toBe("[Skipped: Unsupported Type]");
  });

  it("returns error string when an exception is thrown", () => {
    (DriveApp.getFileById as jest.Mock).mockImplementation(() => {
      throw new Error("File not found");
    });

    expect(extractTextUniversal("badId")).toBe("[Error: File not found]");
  });

  it("performs OCR for image files", () => {
    const mockBlob = {};
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "image/png",
      getName: () => "scan.png",
      getBlob: () => mockBlob,
    });
    (globalThis as any).Drive = {
      Files: {
        create: jest.fn().mockReturnValue({ id: "tempImgDocId" }),
        remove: jest.fn(),
      },
    };
    (DocumentApp.openById as jest.Mock).mockReturnValue({
      getBody: () => ({ getText: () => "ocr text from image" }),
    });

    expect(extractTextUniversal("imgId123")).toBe("ocr text from image");
  });
});
```

**Step 2: Run to verify they fail**

```bash
npx jest __tests__/drive.test.ts
```

Expected: FAIL (module not yet tested — some tests may pass but the OCR cleanup test should fail)

**Step 3: Run again — these tests exercise existing code, so most should pass immediately**

The tests don't require any implementation changes; they are pure coverage additions against existing logic. If any tests fail, inspect the failure and adjust the mock to match the actual code path in `drive.ts`.

**Step 4: Verify all pass**

```bash
npx jest __tests__/drive.test.ts
```

Expected: all PASS

**Step 5: Commit**

```bash
git add __tests__/drive.test.ts
git commit -m "test(drive): add coverage for checkDriveService and extractTextUniversal"
```

---

### Task 6: Extract `sampleRows` helper and test it

**Context:** The Fisher-Yates shuffle + slice inside `sampleRowsToEvaluation` is pure logic with no GAS dependencies. Extract it to `utils.ts` so it can be tested directly. `sampleRowsToEvaluation` will call the extracted helper.

**Files:**
- Modify: `src/server/utils.ts`
- Modify: `src/server/index.ts`
- Modify: `__tests__/utils.test.ts`

**Step 1: Write the failing test first**

Add to the bottom of `__tests__/utils.test.ts`:

```ts
import { sampleRows } from "../src/server/utils";

describe("sampleRows", () => {
  const data = [["a"], ["b"], ["c"], ["d"], ["e"]];

  it("returns the correct number of rows", () => {
    expect(sampleRows(data, 3, 42)).toHaveLength(3);
  });

  it("produces reproducible output for the same seed", () => {
    const first = sampleRows(data, 3, 42);
    const second = sampleRows(data, 3, 42);
    expect(first).toEqual(second);
  });

  it("produces different output for different seeds", () => {
    const first = sampleRows(data, 3, 42);
    const second = sampleRows(data, 3, 99);
    expect(first).not.toEqual(second);
  });

  it("returns all rows when sampleSize equals data length", () => {
    const result = sampleRows(data, 5, 42);
    expect(result).toHaveLength(5);
    // All original rows should be present (order may differ)
    expect(result).toEqual(expect.arrayContaining(data));
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx jest __tests__/utils.test.ts -t "sampleRows"
```

Expected: FAIL — `sampleRows` is not exported from `utils.ts` yet.

**Step 3: Add `sampleRows` to `utils.ts`**

Add at the bottom of `src/server/utils.ts`:

```ts
/**
 * Sample `sampleSize` rows from `data` using a seeded Fisher-Yates shuffle.
 * Reproducible: same seed always produces the same selection.
 */
export function sampleRows(data: unknown[][], sampleSize: number, seed: number): unknown[][] {
  const seededRandom = createSeededRandom(seed);
  const indices = data.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, sampleSize).map((index) => data[index]);
}
```

**Step 4: Update `sampleRowsToEvaluation` in `index.ts` to use the helper**

Replace the inline shuffle block in `sampleRowsToEvaluation` (lines ~218–225):

```ts
// Before:
const seededRandom = createSeededRandom(seed);
const indices = allData.map((_, i) => i);
for (let i = indices.length - 1; i > 0; i--) {
  const j = Math.floor(seededRandom() * (i + 1));
  [indices[i], indices[j]] = [indices[j], indices[i]];
}
const selectedRows = indices.slice(0, sampleSize).map((index) => allData[index]);

// After:
const selectedRows = sampleRows(allData, sampleSize, seed);
```

Also update the import at the top of `index.ts` to include `sampleRows`:

```ts
import { extractId, isValidDriveLink, createSeededRandom, getAllFilesRecursive, sampleRows } from "./utils";
```

(Remove `createSeededRandom` from the import if it's no longer used directly in `index.ts`.)

**Step 5: Run all tests**

```bash
npm test
```

Expected: all PASS

**Step 6: Commit**

```bash
git add src/server/utils.ts src/server/index.ts __tests__/utils.test.ts
git commit -m "refactor(sampling): extract sampleRows into utils and add tests"
```

---

### Task 7: Extract `truncateText` helper and test it

**Context:** The truncation logic in `extractTextFromSelection` (`text.substring(0, 49000) + "... [TRUNCATED]"`) is a pure helper. Extract to `utils.ts`.

**Files:**
- Modify: `src/server/utils.ts`
- Modify: `src/server/index.ts`
- Modify: `__tests__/utils.test.ts`

**Step 1: Write the failing test**

Add to `__tests__/utils.test.ts`:

```ts
import { truncateText } from "../src/server/utils";

describe("truncateText", () => {
  it("returns short text unchanged", () => {
    expect(truncateText("hello", 100)).toBe("hello");
  });

  it("returns text at exact limit unchanged", () => {
    const text = "a".repeat(100);
    expect(truncateText(text, 100)).toBe(text);
  });

  it("truncates text over the limit and appends suffix", () => {
    const text = "a".repeat(101);
    const result = truncateText(text, 100);
    expect(result).toBe("a".repeat(100) + "... [TRUNCATED]");
  });
});
```

**Step 2: Run to verify it fails**

```bash
npx jest __tests__/utils.test.ts -t "truncateText"
```

Expected: FAIL

**Step 3: Add `truncateText` to `utils.ts`**

```ts
/**
 * Truncate text to maxLength characters, appending a suffix if truncated.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "... [TRUNCATED]";
}
```

**Step 4: Update `extractTextFromSelection` in `index.ts` to use the helper**

Replace (around line 152):

```ts
// Before:
let text = extractTextUniversal(fileId);
if (text.length > 49000) text = text.substring(0, 49000) + "... [TRUNCATED]";

// After:
const text = truncateText(extractTextUniversal(fileId), 49000);
```

Update the import in `index.ts` to include `truncateText`.

**Step 5: Run all tests**

```bash
npm test
```

Expected: all PASS

**Step 6: Commit**

```bash
git add src/server/utils.ts src/server/index.ts __tests__/utils.test.ts
git commit -m "refactor(extraction): extract truncateText into utils and add tests"
```

---

### Task 8: Extract `getAIContext` helper and test it

**Context:** The skip/proceed logic inside `runBatchAI` — checking whether a row has valid text or a valid Drive link for a given mode — is pure logic with no GAS dependencies. Extract to `utils.ts` as `getAIContext`.

**Files:**
- Modify: `src/server/utils.ts`
- Modify: `src/server/index.ts`
- Modify: `__tests__/utils.test.ts`

**Step 1: Write the failing tests**

Add to `__tests__/utils.test.ts`:

```ts
import { getAIContext } from "../src/server/utils";
import type { ColumnMap } from "../src/shared/types";

describe("getAIContext", () => {
  const baseMap: ColumnMap = {
    source_drive: 0,
    source_text: 1,
    sys_prompt: 2,
    user_prompt: 3,
    output: 4,
  };

  describe("TEXT mode", () => {
    it("returns textContext when source text is valid", () => {
      const row = ["https://drive.google.com/file/d/abc", "This is valid text for the AI", "", "", ""];
      expect(getAIContext(row, baseMap, "TEXT")).toEqual({ textContext: "This is valid text for the AI" });
    });

    it("returns null when source text is too short (≤5 chars)", () => {
      const row = ["", "hi", "", "", ""];
      expect(getAIContext(row, baseMap, "TEXT")).toBeNull();
    });

    it("returns null when source text contains 'Error'", () => {
      const row = ["", "[Error: something went wrong]", "", "", ""];
      expect(getAIContext(row, baseMap, "TEXT")).toBeNull();
    });

    it("returns null when source_text column is missing (index -1)", () => {
      const mapNoText = { ...baseMap, source_text: -1 };
      const row = ["", "some text", "", "", ""];
      expect(getAIContext(row, mapNoText, "TEXT")).toBeNull();
    });
  });

  describe("FILE mode", () => {
    it("returns fileId when a valid Drive link is present", () => {
      const row = ["https://drive.google.com/file/d/abc123defgh456ijklm789nop", "", "", "", ""];
      const result = getAIContext(row, baseMap, "FILE");
      expect(result).toEqual({ fileId: "abc123defgh456ijklm789nop" });
    });

    it("returns null when Drive link is invalid", () => {
      const row = ["not-a-drive-link", "", "", "", ""];
      expect(getAIContext(row, baseMap, "FILE")).toBeNull();
    });
  });
});
```

**Step 2: Run to verify they fail**

```bash
npx jest __tests__/utils.test.ts -t "getAIContext"
```

Expected: FAIL

**Step 3: Add `getAIContext` to `utils.ts`**

```ts
import type { AIContext, ColumnMap, AIMode } from "../shared/types";

/**
 * Determine the AI context for a row, or return null to skip the row.
 * Pure function — no GAS dependencies.
 */
export function getAIContext(
  row: unknown[],
  map: ColumnMap,
  mode: AIMode,
): AIContext | null {
  if (mode === "TEXT") {
    const txt = map.source_text > -1 ? (row[map.source_text] as string) : "";
    if (txt && txt.length > 5 && !txt.includes("Error")) {
      return { textContext: txt };
    }
    return null;
  }
  if (mode === "FILE") {
    const link = row[map.source_drive] as string;
    if (isValidDriveLink(link)) {
      return { fileId: extractId(link) };
    }
    return null;
  }
  return null;
}
```

**Step 4: Update `runBatchAI` in `index.ts` to use the helper**

Replace the `if (mode === "TEXT") { ... } else if (mode === "FILE") { ... }` block:

```ts
// Before (the full if/else block building result):
if (mode === "TEXT") {
  const txt = map.source_text > -1 ? (row[map.source_text] as string) : "";
  if (txt && txt.length > 5 && !txt.includes("Error")) {
    result = callGeminiAPI(apiKey, row[map.sys_prompt] as string, usrPrompt, {
      textContext: txt,
    });
  } else {
    result = "[Skipped: No valid text]";
  }
} else if (mode === "FILE") {
  const link = row[map.source_drive] as string;
  if (isValidDriveLink(link)) {
    result = callGeminiAPI(apiKey, row[map.sys_prompt] as string, usrPrompt, {
      fileId: extractId(link),
    });
  } else {
    result = "[Skipped: No valid Drive Link]";
  }
}

// After:
const context = getAIContext(row, map, mode);
if (context) {
  result = callGeminiAPI(apiKey, row[map.sys_prompt] as string, usrPrompt, context);
} else {
  result = mode === "TEXT" ? "[Skipped: No valid text]" : "[Skipped: No valid Drive Link]";
}
```

Update the import in `index.ts` to include `getAIContext`.

**Step 5: Run all tests**

```bash
npm test
```

Expected: all PASS

**Step 6: Raise coverage thresholds**

After Phase 2 is complete, run coverage again and update the thresholds in `jest.config.cjs` to match the new baseline:

```bash
npm test -- --coverage --coverageReporters=text-summary
```

Update `coverageThreshold` in `jest.config.cjs` to the new numbers (minus 2 points buffer).

**Step 7: Commit**

```bash
git add src/server/utils.ts src/server/index.ts __tests__/utils.test.ts jest.config.cjs
git commit -m "refactor(ai): extract getAIContext into utils, add tests, raise coverage thresholds"
```

---

## Post-Plan Checklist

After all tasks are complete:

- [ ] `npm test` passes with zero failures
- [ ] `npm run lint` passes with zero errors
- [ ] Coverage meets thresholds (run `npm test -- --coverage`)
- [ ] Pre-commit hook blocks on test failure (verify manually)
- [ ] No `.eslintrc.json` in repo root
