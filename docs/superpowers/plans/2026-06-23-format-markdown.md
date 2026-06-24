# Format Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "📝 Format Markdown" SSI Toolkit menu item that converts markdown syntax in a user-selected cell range to Google Sheets rich text in-place.

**Architecture:** Export the existing private `parseMarkdown()` from `rich-text.ts` and extend it + `TextRange` to support three new formatting features (strikethrough, inline code, multi-level heading sizes). A new `formatMarkdownSelection()` server function in `index.ts` reads the active selection, runs `parseMarkdown` + the existing `toCellValue` renderer (extended for the new fields), and writes `setRichTextValue()` back to each cell. Wired to the menu via `onOpen()` and a rollup footer stub — no sidebar panel required.

**Tech Stack:** TypeScript, Google Apps Script (`SpreadsheetApp`), Rollup IIFE bundle, Jest + ts-jest

## Global Constraints

- Apps Script runtime is V8 — tsconfig targets ES2019; no Node built-ins at runtime
- `src/server/rich-text.ts` must remain GAS-free (no `SpreadsheetApp` calls) for testability
- `toCellValue` and all GAS-coupled code live in `src/server/index.ts`, which is excluded from unit-test coverage
- Named exports only; no default exports
- Run `npm test` after every task; run `npm run typecheck` before committing Task 2

---

## File Map

| File | Role | Change |
|---|---|---|
| `src/server/rich-text.ts` | Pure markdown parser + CellContent model | Export `parseMarkdown`; add 3 fields to `TextRange`; extend `processInline` for `~~` and backtick; add `headingDepth` for font sizes |
| `src/server/index.ts` | GAS entry point + renderer | Extend `toCellValue`; import + call `parseMarkdown`; add `formatMarkdownSelection()`; update `onOpen()` |
| `rollup.config.js` | Footer stubs for GAS discovery | Add one stub for `formatMarkdownSelection` |
| `__tests__/rich-text.test.ts` | Unit tests for the parser | Add 6 new tests; update 1 existing heading test that will break |

---

## Task 1: Extend `TextRange` + `parseMarkdown` — TDD

**Files:**
- Modify: `src/server/rich-text.ts`
- Test: `__tests__/rich-text.test.ts`

**Interfaces:**
- Produces: `parseMarkdown(text: string): CellContent` (exported)
- Produces: `TextRange` extended with `strikethrough?: boolean`, `fontFamily?: string`, `fontSize?: number`

---

- [ ] **Step 1: Add the import for `parseMarkdown` in the test file and write 6 failing tests**

In `__tests__/rich-text.test.ts`, update the import block at the top of the file:

```typescript
import {
  buildRichInferenceCellContent,
  buildRichGroundingCellContent,
  parseMarkdown,
} from "../src/server/rich-text";
```

Then add a new `describe` block at the bottom of the file (after the `buildRichGroundingCellContent` block):

```typescript
// ============================================================
// parseMarkdown — extended features
// ============================================================

describe("parseMarkdown — extended features", () => {
  it("wraps ~~text~~ as a strikethrough range", () => {
    const result = parseMarkdown("before ~~struck~~ after");
    expect(result.text).toBe("before struck after");
    expect(result.ranges).toContainEqual({ startIndex: 7, endIndex: 13, strikethrough: true });
  });

  it("wraps `code` as a Courier New font-family range", () => {
    const result = parseMarkdown("run `npm test` now");
    expect(result.text).toBe("run npm test now");
    expect(result.ranges).toContainEqual({ startIndex: 4, endIndex: 12, fontFamily: "Courier New" });
  });

  it("applies fontSize 18 and bold to h1", () => {
    const result = parseMarkdown("# Title");
    expect(result.text).toBe("Title");
    expect(result.ranges).toContainEqual({ startIndex: 0, endIndex: 5, bold: true, fontSize: 18 });
  });

  it("applies fontSize 16 and bold to h2", () => {
    const result = parseMarkdown("## Section");
    expect(result.text).toBe("Section");
    expect(result.ranges).toContainEqual({ startIndex: 0, endIndex: 7, bold: true, fontSize: 16 });
  });

  it("applies fontSize 14 and bold to h3", () => {
    const result = parseMarkdown("### Sub");
    expect(result.text).toBe("Sub");
    expect(result.ranges).toContainEqual({ startIndex: 0, endIndex: 3, bold: true, fontSize: 14 });
  });

  it("applies bold only (no fontSize) to h4 and deeper", () => {
    const result = parseMarkdown("#### Deep");
    expect(result.text).toBe("Deep");
    const headingRange = result.ranges.find((r) => r.bold);
    expect(headingRange).toBeDefined();
    expect(headingRange?.fontSize).toBeUndefined();
  });
});
```

- [ ] **Step 2: Update the existing h2 test that will break**

The existing test at line ~56 asserts the heading range has no `fontSize`. After our change h2 gains `fontSize: 16`. Update that assertion:

Find this block in `__tests__/rich-text.test.ts`:
```typescript
it("strips ## heading prefix and produces a bold range", () => {
  const result = buildRichInferenceCellContent(
    makeResponse({ text: "## Section Title\nBody text." }),
  );
  expect(result.text).toBe("Section Title\nBody text.");
  expect(result.ranges[0]).toEqual({ startIndex: 0, endIndex: 13, bold: true });
});
```

Replace the final assertion with:
```typescript
  expect(result.ranges[0]).toEqual({ startIndex: 0, endIndex: 13, bold: true, fontSize: 16 });
```

- [ ] **Step 3: Run tests to confirm the 7 affected tests fail**

```bash
npx jest __tests__/rich-text.test.ts --no-coverage
```

Expected: 7 failures — the 6 new tests (`parseMarkdown` not exported yet / new features not implemented) plus the updated h2 test.

- [ ] **Step 4: Export `parseMarkdown` and extend `TextRange` in `rich-text.ts`**

In `src/server/rich-text.ts`, update the `TextRange` interface (around line 20):

```typescript
export interface TextRange {
  startIndex: number;
  endIndex: number;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  fontFamily?: string;
  fontSize?: number;
  url?: string;
}
```

Change `function processInline` to `export function processInline` — no, keep `processInline` private. Instead, change `function parseMarkdown` to `export function parseMarkdown`.

- [ ] **Step 5: Add `~~strikethrough~~` and `` `code` `` patterns to `processInline`**

In `processInline`, add two new blocks immediately before the `// Plain character` fallback (after the `*italic*` block):

```typescript
// ~~strikethrough~~ — must check before plain ~ fallback
if (segment[i] === "~" && segment[i + 1] === "~") {
  const closeIdx = segment.indexOf("~~", i + 2);
  if (closeIdx > i + 1) {
    const spanStart = cleanLen;
    const inner = segment.slice(i + 2, closeIdx);
    parts.push(inner);
    cleanLen += inner.length;
    ranges.push({ startIndex: spanStart, endIndex: cleanLen, strikethrough: true });
    i = closeIdx + 2;
    continue;
  }
}

// `inline code` — single-backtick span
if (segment[i] === "`") {
  const closeIdx = segment.indexOf("`", i + 1);
  if (closeIdx > i) {
    const spanStart = cleanLen;
    const inner = segment.slice(i + 1, closeIdx);
    parts.push(inner);
    cleanLen += inner.length;
    ranges.push({ startIndex: spanStart, endIndex: cleanLen, fontFamily: "Courier New" });
    i = closeIdx + 1;
    continue;
  }
}
```

- [ ] **Step 6: Add `headingDepth` tracking and `fontSize` to the heading range in `parseMarkdown`**

In `parseMarkdown`, update the variable declarations at the top of the `for` loop body:

```typescript
let content = line;
let isHeading = false;
let headingDepth = 0;
```

Update the heading detection block:

```typescript
const headingMatch = line.match(/^(#{1,6}) /);
if (headingMatch) {
  content = line.slice(headingMatch[1].length + 1);
  isHeading = true;
  headingDepth = headingMatch[1].length;
}
```

Update the `isHeading` range push at the bottom of the loop:

```typescript
if (isHeading) {
  const fontSize = headingDepth === 1 ? 18 : headingDepth === 2 ? 16 : headingDepth === 3 ? 14 : undefined;
  const range: TextRange = { startIndex: spanStart, endIndex: cleanLen, bold: true };
  if (fontSize !== undefined) range.fontSize = fontSize;
  ranges.push(range);
}
```

- [ ] **Step 7: Run tests to confirm all 7 pass**

```bash
npx jest __tests__/rich-text.test.ts --no-coverage
```

Expected: all tests pass, including the 6 new ones and the updated h2 test.

- [ ] **Step 8: Run the full test suite**

```bash
npm test
```

Expected: all 490+ tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/server/rich-text.ts __tests__/rich-text.test.ts
git commit -m "feat: extend TextRange + parseMarkdown for strikethrough, inline code, and heading font sizes"
```

---

## Task 2: Wire up `formatMarkdownSelection`, `toCellValue`, menu, and rollup stub

No unit tests for this task — all code is GAS-coupled (`SpreadsheetApp`). Verification is via build.

**Files:**
- Modify: `src/server/index.ts`
- Modify: `rollup.config.js`

**Interfaces:**
- Consumes: `parseMarkdown(text: string): CellContent` from `./rich-text` (exported in Task 1)
- Consumes: `TextRange` with `strikethrough`, `fontFamily`, `fontSize` (Task 1)
- Produces: `formatMarkdownSelection(): void` (exported, GAS menu entry point)

---

- [ ] **Step 1: Add `parseMarkdown` to the `rich-text` import in `index.ts`**

Find the existing import block in `src/server/index.ts`:

```typescript
import {
  buildRichInferenceCellContent,
  buildRichGroundingCellContent,
  type CellContent,
} from "./rich-text";
```

Replace with:

```typescript
import {
  buildRichInferenceCellContent,
  buildRichGroundingCellContent,
  parseMarkdown,
  type CellContent,
} from "./rich-text";
```

- [ ] **Step 2: Extend `toCellValue` to handle the three new `TextRange` fields**

Find the existing `toCellValue` function in `src/server/index.ts` (around line 245):

```typescript
function toCellValue(content: CellContent): GoogleAppsScript.Spreadsheet.RichTextValue {
  const builder = SpreadsheetApp.newRichTextValue().setText(content.text);
  content.ranges.forEach(({ startIndex, endIndex, bold, italic, url }) => {
    if (bold === true || italic === true) {
      const style = SpreadsheetApp.newTextStyle();
      if (bold === true) style.setBold(true);
      if (italic === true) style.setItalic(true);
      builder.setTextStyle(startIndex, endIndex, style.build());
    }
    if (url) builder.setLinkUrl(startIndex, endIndex, url);
  });
  return builder.build();
}
```

Replace with:

```typescript
function toCellValue(content: CellContent): GoogleAppsScript.Spreadsheet.RichTextValue {
  const builder = SpreadsheetApp.newRichTextValue().setText(content.text);
  content.ranges.forEach(({ startIndex, endIndex, bold, italic, strikethrough, fontFamily, fontSize, url }) => {
    if (bold || italic || strikethrough || fontFamily || fontSize) {
      const style = SpreadsheetApp.newTextStyle();
      if (bold)          style.setBold(true);
      if (italic)        style.setItalic(true);
      if (strikethrough) style.setStrikethrough(true);
      if (fontFamily)    style.setFontFamily(fontFamily);
      if (fontSize)      style.setFontSize(fontSize);
      builder.setTextStyle(startIndex, endIndex, style.build());
    }
    if (url) builder.setLinkUrl(startIndex, endIndex, url);
  });
  return builder.build();
}
```

- [ ] **Step 3: Add `formatMarkdownSelection()` to `index.ts`**

Add the new function immediately after `toCellValue` (before `const FILE_PIPELINE_BATCH_SIZE`):

```typescript
export function formatMarkdownSelection(): void {
  const ui = SpreadsheetApp.getUi();
  const range = SpreadsheetApp.getActiveRange();
  if (!range) {
    ui.alert("Select one or more cells first.");
    return;
  }
  try {
    const values = range.getValues() as unknown[][];
    let count = 0;
    for (let r = 0; r < values.length; r++) {
      for (let c = 0; c < values[r].length; c++) {
        const value = values[r][c];
        if (typeof value !== "string" || value.trim() === "") continue;
        const cell = range.getCell(r + 1, c + 1);
        try {
          cell.setRichTextValue(toCellValue(parseMarkdown(value)));
          count++;
        } catch (_e) {
          cell.setValue(parseMarkdown(value).text);
        }
      }
    }
    ui.alert(`Formatted ${count} cell(s).`);
  } catch (e) {
    ui.alert(`Error: ${(e as Error).message}`);
  }
}
```

- [ ] **Step 4: Add the menu item to `onOpen()`**

Find `onOpen` in `src/server/index.ts`:

```typescript
export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("📐 SSI Toolkit")
    .addItem("📐 Open SSI Toolkit", "showSidebar")
    .addToUi();
}
```

Replace with:

```typescript
export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("📐 SSI Toolkit")
    .addItem("📐 Open SSI Toolkit", "showSidebar")
    .addItem("📝 Format Markdown", "formatMarkdownSelection")
    .addToUi();
}
```

- [ ] **Step 5: Add the rollup footer stub**

In `rollup.config.js`, add one line to the `footer` string immediately after the `function showSidebar()` stub (around line 80):

```js
function formatMarkdownSelection() { _GASEntry.formatMarkdownSelection(); }
```

The footer block should now read:

```js
function onOpen(e) { _GASEntry.onOpen(e); }
function showSidebar() { _GASEntry.showSidebar(); }
function formatMarkdownSelection() { _GASEntry.formatMarkdownSelection(); }
function runTool(fn, jobId) { _GASEntry.runTool(fn, jobId); }
// ... rest unchanged
```

- [ ] **Step 6: Update the menu test that will break**

In `__tests__/menu.test.ts`, find the test at line ~85 that asserts `addItem` is called exactly once:

```typescript
it("adds a single item that opens the sidebar", () => {
  onOpen();
  expect(mockAddItem).toHaveBeenCalledTimes(1);
  expect(mockAddItem).toHaveBeenCalledWith("📐 Open SSI Toolkit", "showSidebar");
});
```

Replace with:

```typescript
it("adds menu items for Open Toolkit and Format Markdown", () => {
  onOpen();
  expect(mockAddItem).toHaveBeenCalledTimes(2);
  expect(mockAddItem).toHaveBeenCalledWith("📐 Open SSI Toolkit", "showSidebar");
  expect(mockAddItem).toHaveBeenCalledWith("📝 Format Markdown", "formatMarkdownSelection");
});
```

Run to confirm the test now passes:

```bash
npx jest __tests__/menu.test.ts --no-coverage
```

Expected: all menu tests pass.

- [ ] **Step 7: Run typecheck and build to verify no errors**

```bash
npm run typecheck && npm run build
```

Expected: clean typecheck output and `dist/` files generated with no errors.

- [ ] **Step 8: Run the full test suite one final time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add src/server/index.ts rollup.config.js __tests__/menu.test.ts
git commit -m "feat: add Format Markdown menu item (formatMarkdownSelection)"
```
