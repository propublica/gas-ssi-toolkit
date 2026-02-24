# Dynamic Column Mapping Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `runBatchAI`'s hardcoded column map and `AIMode` with a `RunConfig` object whose column names are selected by the user at runtime via the sidebar.

**Architecture:** A new `RunConfig` type captures user-selected column names. `runBatchAI` resolves those names to indices at execution time using a new pure helper `resolveColumns`. The sidebar replaces the old TEXT/FILE modal with an inline config panel that reads sheet headers on open and collects a `RunConfig` before calling the server.

**Tech Stack:** TypeScript, Google Apps Script (V8), Rollup IIFE bundle, Jest + ts-jest, `Sidebar.html` (vanilla JS served via HtmlService)

---

### Task 1: Update `runInference` to optional params

**Files:**
- Modify: `src/server/inference.ts`
- Modify: `__tests__/inference.test.ts`

**Step 1: Update test calls — replace explicit `null` args with omitted/`undefined`**

In `__tests__/inference.test.ts`, update every call site. The trailing `null` args become omitted (or `undefined` where the arg before them is still needed):

```ts
// Before → After

runInference("Hello AI", null, null)          → runInference("Hello AI")
runInference(null, null, null)                → runInference(null)
runInference("", null, null)                  → runInference("")
runInference([["p1"], ["p2"]], null, null)    → runInference([["p1"], ["p2"]])
runInference("prompt", "https://drive...", null) → runInference("prompt", "https://drive...")
runInference("prompt", "not-a-drive-link", null) → runInference("prompt", "not-a-drive-link")
runInference("prompt", null, null)  // drive omitted  → runInference("prompt")
runInference("prompt", null, "Be concise")   → runInference("prompt", undefined, "Be concise")
runInference("prompt", null, null)  // default sys  → runInference("prompt")
runInference("prompt", null, null)  // quota error  → runInference("prompt")
runInference("prompt", "https://drive...", null) // drive throw → runInference("prompt", "https://drive...")
```

The test descriptions stay the same — only the call signatures change.

**Step 2: Run existing tests — they should still pass**

```bash
npx jest __tests__/inference.test.ts
```

Expected: all 9 tests PASS (flattenArg handles null/undefined identically; no behavioral change yet).

**Step 3: Update `runInference` signature and add explicit guards**

Replace the body of `src/server/inference.ts` with:

```ts
export function runInference(
  userPrompts: unknown,
  driveLinks?: unknown,
  systemPrompt?: unknown,
): string | null {
  const userTexts = flattenArg(userPrompts);
  if (userTexts.length === 0) return null;

  try {
    const inlineData: GeminiInlineData[] =
      driveLinks !== undefined
        ? flattenArg(driveLinks)
            .filter(isValidDriveLink)
            .map((link) => fetchAndEncodeFile(extractId(link)))
        : [];

    return invokeGemini({
      systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
      userTexts,
      inlineData: inlineData.length ? inlineData : undefined,
    });
  } catch (e) {
    return "Error: " + (e as Error).message;
  }
}
```

**Step 4: Run tests again**

```bash
npx jest __tests__/inference.test.ts
```

Expected: all 9 tests PASS.

**Step 5: Commit**

```bash
git add src/server/inference.ts __tests__/inference.test.ts
git commit -m "refactor: make runInference driveLinks and systemPrompt optional params"
```

---

### Task 2: Add `resolveColumns` to `utils.ts` with tests

**Files:**
- Modify: `src/server/utils.ts` (add at bottom)
- Modify: `__tests__/utils.test.ts` (add new describe block)

**Step 1: Write failing tests**

Add this describe block to the bottom of `__tests__/utils.test.ts`:

```ts
describe("resolveColumns", () => {
  it("returns indices for all found names", () => {
    expect(resolveColumns(["a", "b", "c"], ["a", "c"])).toEqual([0, 2]);
  });

  it("returns -1 for names not in headers", () => {
    expect(resolveColumns(["a", "b"], ["c"])).toEqual([-1]);
  });

  it("returns empty array for empty names list", () => {
    expect(resolveColumns(["a", "b"], [])).toEqual([]);
  });

  it("returns -1 for all names when headers is empty", () => {
    expect(resolveColumns([], ["a"])).toEqual([-1]);
  });

  it("preserves the order of the names argument", () => {
    expect(resolveColumns(["x", "y", "z"], ["z", "x"])).toEqual([2, 0]);
  });
});
```

Also add `resolveColumns` to the import line at the top of `__tests__/utils.test.ts`:

```ts
import {
  extractId,
  isValidDriveLink,
  createSeededRandom,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  flattenArg,
  resolveColumns,   // add this
} from "../src/server/utils";
```

**Step 2: Run to confirm failure**

```bash
npx jest __tests__/utils.test.ts -t "resolveColumns"
```

Expected: FAIL — `resolveColumns is not a function` (or similar export error).

**Step 3: Implement `resolveColumns` in `utils.ts`**

Add at the bottom of `src/server/utils.ts`:

```ts
/**
 * Map an array of column header names to their zero-based indices.
 * Returns -1 for any name not found in `headers`.
 */
export function resolveColumns(headers: string[], names: string[]): number[] {
  return names.map((name) => headers.indexOf(name));
}
```

**Step 4: Run tests to confirm pass**

```bash
npx jest __tests__/utils.test.ts
```

Expected: all tests PASS (including the 5 new ones).

**Step 5: Commit**

```bash
git add src/server/utils.ts __tests__/utils.test.ts
git commit -m "feat: add resolveColumns pure helper to utils"
```

---

### Task 3: Update types and config

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/config.ts`

> Note: After this task `src/server/index.ts` will have TypeScript errors. Do NOT commit until Task 4 is also complete.

**Step 1: Update `src/shared/types.ts`**

Remove these interfaces entirely:
- `ColumnConfig`
- `ColumnMap`

Remove `COLUMNS: ColumnConfig` from `AppConfig`.

Remove the `AIMode` type.

Add `RunConfig` after `AppConfig`:

```ts
export interface RunConfig {
  userPromptCols: string[];
  driveFileCols?: string[];
  systemPromptCol?: string;
  outputCol: string;
  rowRange?: { start: number; end: number };
}
```

Final `types.ts` should have: `AppConfig` (without `COLUMNS`), `RunConfig`, `GeminiInlineData`, `GeminiFunctionDeclaration`, `GeminiGenerationConfig`, `GeminiRequest`, `DriveFileInfo`.

**Step 2: Update `src/server/config.ts`**

Remove the `COLUMNS` field from `CONFIG`. The file should now read:

```ts
import type { AppConfig } from "../shared/types";

export const CONFIG: AppConfig = {
  API_KEY_PROPERTY: "GEMINI_API_KEY",
  MODEL_NAME: "gemini-2.0-flash",
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
};
```

**Step 3: Run typecheck — expect errors in `index.ts` only**

```bash
npm run typecheck
```

Expected: errors in `src/server/index.ts` referencing `AIMode`, `ColumnMap`, `CONFIG.COLUMNS`. No errors elsewhere. If errors appear in other files, fix them before continuing.

---

### Task 4: Rewrite `runBatchAI`, add `getSheetHeaders`, clean up `index.ts`

**Files:**
- Modify: `src/server/index.ts`

This task fixes the errors introduced in Task 3 and replaces the old implementation.

**Step 1: Update imports at the top of `index.ts`**

Remove:
```ts
import { HTML_TEMPLATE } from "./dialog";
import type { AIMode, ColumnMap } from "../shared/types";
```

Add:
```ts
import type { RunConfig } from "../shared/types";
```

Add `resolveColumns` to the existing utils import line:
```ts
import {
  extractId,
  isValidDriveLink,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  resolveColumns,   // add
} from "./utils";
```

**Step 2: Remove `showSourceDialog` and `handleDialogSelection`**

Delete both functions entirely from `index.ts`.

**Step 3: Remove `showSourceDialog` from the `TOOLS` dispatcher**

```ts
// Before
const TOOLS: Record<string, () => void> = {
  importDriveLinks,
  showSourceDialog,
  sampleRowsToEvaluation,
  extractTextFromSelection,
};

// After
const TOOLS: Record<string, () => void> = {
  importDriveLinks,
  sampleRowsToEvaluation,
  extractTextFromSelection,
};
```

**Step 4: Add `getSheetHeaders`**

Add this function in the UI HANDLERS section:

```ts
export function getSheetHeaders(): string[] {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0] as string[];
}
```

**Step 5: Replace `runBatchAI`**

Replace the entire `runBatchAI` function with:

```ts
export function runBatchAI(config: RunConfig): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] as string[];

  // Validate user prompt columns (required)
  const userPromptIdxs = resolveColumns(headers, config.userPromptCols);
  const missingUserPrompt = config.userPromptCols.filter((_, i) => userPromptIdxs[i] === -1);
  if (missingUserPrompt.length > 0) {
    ui.alert(
      "Error: Missing Columns",
      `Could not find columns: ${missingUserPrompt.join(", ")}`,
      ui.ButtonSet.OK,
    );
    return;
  }

  // Validate drive file columns (if selected)
  let driveFileIdxs: number[] = [];
  if (config.driveFileCols && config.driveFileCols.length > 0) {
    driveFileIdxs = resolveColumns(headers, config.driveFileCols);
    const missingDrive = config.driveFileCols.filter((_, i) => driveFileIdxs[i] === -1);
    if (missingDrive.length > 0) {
      ui.alert(
        "Error: Missing Columns",
        `Could not find columns: ${missingDrive.join(", ")}`,
        ui.ButtonSet.OK,
      );
      return;
    }
  }

  // Validate system prompt column (if selected)
  let systemPromptIdx = -1;
  if (config.systemPromptCol) {
    const idxs = resolveColumns(headers, [config.systemPromptCol]);
    if (idxs[0] === -1) {
      ui.alert(
        "Error: Missing Columns",
        `Could not find column: ${config.systemPromptCol}`,
        ui.ButtonSet.OK,
      );
      return;
    }
    systemPromptIdx = idxs[0];
  }

  // Resolve output column — create if not found
  let outputIdx = headers.indexOf(config.outputCol);
  if (outputIdx === -1) {
    const newColIdx = sheet.getLastColumn() + 1;
    sheet.getRange(1, newColIdx).setValue(config.outputCol);
    outputIdx = newColIdx - 1;
  }

  // Determine row range
  let startRow: number;
  let numRows: number;
  if (config.rowRange) {
    startRow = config.rowRange.start;
    numRows = config.rowRange.end - config.rowRange.start + 1;
  } else {
    const range = sheet.getActiveRange();
    if (!range) return;
    startRow = range.getRow();
    numRows = range.getNumRows();
  }

  const dataValues = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();

  SpreadsheetApp.getActive().toast(`Starting AI Batch...`, "AI Agent", -1);
  let processed = 0;

  for (let i = 0; i < dataValues.length; i++) {
    const row = dataValues[i];
    const realRowIndex = startRow + i;

    SpreadsheetApp.getActive().toast(`Processing Row ${realRowIndex}...`, "AI Agent", -1);

    const userPrompts = userPromptIdxs.map((idx) => row[idx]);
    const driveLinks = driveFileIdxs.length > 0 ? driveFileIdxs.map((idx) => row[idx]) : undefined;
    const systemPrompt = systemPromptIdx >= 0 ? row[systemPromptIdx] : undefined;

    const result = runInference(userPrompts, driveLinks, systemPrompt);
    if (result === null) continue;

    sheet.getRange(realRowIndex, outputIdx + 1).setValue(result);
    processed++;
    SpreadsheetApp.flush();
  }

  SpreadsheetApp.getActive().toast(`Complete! Processed ${processed} rows.`, "Success", 5);
}
```

**Step 6: Run typecheck — expect zero errors**

```bash
npm run typecheck
```

Expected: no errors.

**Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

**Step 8: Commit tasks 3 and 4 together**

```bash
git add src/shared/types.ts src/server/config.ts src/server/index.ts
git commit -m "feat: replace AIMode/ColumnMap with RunConfig, rewrite runBatchAI, add getSheetHeaders"
```

---

### Task 5: Update Rollup footer

**Files:**
- Modify: `rollup.config.js`

**Step 1: Edit the `footer` string**

Remove:
```js
function showSourceDialog() { _GASEntry.showSourceDialog(); }
function handleDialogSelection(mode) { _GASEntry.handleDialogSelection(mode); }
```

Add (alongside the existing stubs):
```js
function getSheetHeaders() { return _GASEntry.getSheetHeaders(); }
function runBatchAI(config) { _GASEntry.runBatchAI(config); }
```

The full footer should look like:

```js
footer: `
// ... (doc comment unchanged) ...
function onOpen(e) { _GASEntry.onOpen(e); }
function showSidebar() { _GASEntry.showSidebar(); }
function runTool(fn) { _GASEntry.runTool(fn); }
function getSheetHeaders() { return _GASEntry.getSheetHeaders(); }
function runBatchAI(config) { _GASEntry.runBatchAI(config); }
function importDriveLinks() { _GASEntry.importDriveLinks(); }
function extractTextFromSelection() { _GASEntry.extractTextFromSelection(); }
function sampleRowsToEvaluation() { _GASEntry.sampleRowsToEvaluation(); }
/**
 * @customfunction
 * (full JSDoc block unchanged)
 */
function SSI(userTexts, systemPrompt, toolNames) { return _GASEntry.SSI(userTexts, systemPrompt, toolNames); }
`,
```

**Step 2: Build to verify**

```bash
npm run build
```

Expected: build succeeds, `dist/index.js` generated with no errors.

**Step 3: Commit**

```bash
git add rollup.config.js
git commit -m "chore: update rollup footer — add getSheetHeaders/runBatchAI stubs, remove showSourceDialog/handleDialogSelection"
```

---

### Task 6: Delete `dialog.ts`

**Files:**
- Delete: `src/server/dialog.ts`

**Step 1: Delete the file**

```bash
rm src/server/dialog.ts
```

**Step 2: Build and typecheck to confirm no dangling references**

```bash
npm run typecheck && npm run build
```

Expected: no errors. (`index.ts` import for `dialog.ts` was already removed in Task 4.)

**Step 3: Commit**

```bash
git commit -m "chore: delete dialog.ts — replaced by sidebar config panel"
```

---

### Task 7: Update `Sidebar.html`

**Files:**
- Modify: `src/Sidebar.html`

**Step 1: Replace the entire file**

The new sidebar keeps the existing tool buttons and adds an inline config panel that shows when "Run AI Inference" is clicked. Replace the full contents of `src/Sidebar.html` with:

```html
<!DOCTYPE html>
<html>

<head>
    <base target="_top">
    <link href="https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500&display=swap" rel="stylesheet">
    <style>
        :root {
            --primary-blue: #1a73e8;
            --hover-blue: #f1f3f4;
            --border-color: #dadce0;
            --text-main: #3c4043;
            --text-secondary: #5f6368;
        }

        body {
            padding: 0;
            margin: 0;
            font-family: 'Google Sans', Roboto, Arial, sans-serif;
            background-color: #ffffff;
            color: var(--text-main);
        }

        .container { padding: 16px; }

        .guide-card {
            background-color: #f8f9fa;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 24px;
            text-align: center;
            transition: background-color 0.2s;
        }

        .guide-card:hover { background-color: #f1f3f4; }

        .guide-link {
            color: var(--primary-blue);
            font-weight: 500;
            text-decoration: none;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-size: 14px;
        }

        .section { margin-bottom: 28px; }

        h3 {
            font-size: 11px;
            font-weight: 500;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.8px;
            margin: 0 0 12px 4px;
        }

        .tool-btn {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: flex-start;
            padding: 12px 16px;
            margin-bottom: 8px;
            border-radius: 24px;
            border: 1px solid var(--border-color);
            background: white;
            cursor: pointer;
            transition: all 0.2s ease;
            font-family: 'Google Sans', sans-serif;
            font-size: 14px;
            font-weight: 500;
            color: var(--text-main);
        }

        .tool-btn:hover {
            background-color: var(--hover-blue);
            border-color: transparent;
            color: var(--primary-blue);
        }

        .tool-btn:active { background-color: #e8eaed; transform: scale(0.98); }

        .icon { margin-right: 12px; font-size: 18px; width: 24px; text-align: center; }

        .status-footer {
            margin-top: 40px;
            padding: 16px;
            border-top: 1px solid #eee;
            font-size: 11px;
            color: var(--text-secondary);
            text-align: center;
            line-height: 1.5;
        }

        .loading { opacity: 0.5; pointer-events: none; }

        /* ── AI Config Panel ── */

        .panel-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 20px;
        }

        .back-btn {
            background: none;
            border: none;
            color: var(--primary-blue);
            cursor: pointer;
            font-size: 14px;
            font-family: 'Google Sans', sans-serif;
            padding: 0;
        }

        .panel-title { font-weight: 500; font-size: 15px; }

        .field-group { margin-bottom: 16px; }

        .field-label {
            display: block;
            font-size: 11px;
            font-weight: 500;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.7px;
            margin-bottom: 6px;
        }

        .required { color: #d93025; }
        .optional { color: var(--text-secondary); font-weight: 400; text-transform: none; letter-spacing: 0; font-size: 11px; }

        .checkbox-list {
            display: flex;
            flex-direction: column;
            gap: 4px;
            max-height: 110px;
            overflow-y: auto;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            padding: 8px;
            font-size: 13px;
        }

        .checkbox-list label {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .select-input {
            width: 100%;
            padding: 7px 8px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            font-family: 'Google Sans', sans-serif;
            font-size: 13px;
            color: var(--text-main);
            box-sizing: border-box;
        }

        .text-input {
            width: 100%;
            padding: 7px 8px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            font-family: 'Google Sans', sans-serif;
            font-size: 13px;
            margin-top: 6px;
            box-sizing: border-box;
        }

        .row-range-options {
            display: flex;
            flex-direction: column;
            gap: 6px;
            font-size: 13px;
        }

        .row-range-options label {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .range-inputs { display: flex; gap: 8px; margin-top: 6px; }

        .range-inputs input {
            width: 50%;
            padding: 6px 8px;
            border: 1px solid var(--border-color);
            border-radius: 4px;
            font-size: 13px;
            font-family: 'Google Sans', sans-serif;
            box-sizing: border-box;
        }

        .panel-buttons { display: flex; gap: 8px; margin-top: 24px; }

        .btn-run {
            flex: 1;
            padding: 10px;
            background: var(--primary-blue);
            color: white;
            border: none;
            border-radius: 4px;
            font-family: 'Google Sans', sans-serif;
            font-weight: 500;
            font-size: 14px;
            cursor: pointer;
        }

        .btn-run:hover { background: #1557b0; }
        .btn-run:disabled { background: #9aa0a6; cursor: default; }

        .btn-cancel {
            padding: 10px 16px;
            background: white;
            color: var(--text-main);
            border: 1px solid var(--border-color);
            border-radius: 4px;
            font-family: 'Google Sans', sans-serif;
            font-size: 14px;
            cursor: pointer;
        }

        .no-headers-msg {
            font-size: 13px;
            color: var(--text-secondary);
            text-align: center;
            padding: 24px 0;
            font-style: italic;
        }
    </style>
</head>

<body>
    <!-- Default tool list -->
    <div id="tool-list" class="container">
        <div class="guide-card">
            <a href="https://docs.google.com/document/d/1BQJzBHiE6L0hvU6NMD0jaQE71VWRpWH-vNQu3UtGjBA/edit?tab=t.66jobsqlduah#heading=h.h5k0s81xpiiq"
                target="_blank" class="guide-link">
                <span>📖</span> View User Guide ↗
            </a>
        </div>
        <div class="section">
            <h3>Main Tools</h3>
            <button class="tool-btn" onclick="dispatchTool(event, 'importDriveLinks')">
                <span class="icon">📂</span> Import Drive Links
            </button>
            <button class="tool-btn" onclick="showAIPanel()">
                <span class="icon">▶️</span> Run AI Inference
            </button>
        </div>
        <div class="section">
            <h3>Extras</h3>
            <button class="tool-btn" onclick="dispatchTool(event, 'sampleRowsToEvaluation')">
                <span class="icon">🎲</span> Sample Rows
            </button>
            <button class="tool-btn" onclick="dispatchTool(event, 'extractTextFromSelection')">
                <span class="icon">📜</span> Extract Text
            </button>
        </div>
        <div class="status-footer">
            <strong>SSI Tools v2.0</strong><br>
            Powered by Gemini 2.0 Flash<br>
            Evaluation Unrestricted Mode
        </div>
    </div>

    <!-- AI config panel -->
    <div id="ai-panel" class="container" style="display:none">
        <div class="panel-header">
            <button class="back-btn" onclick="hideAIPanel()">← Back</button>
            <span class="panel-title">Configure AI Run</span>
        </div>

        <div id="no-headers-msg" class="no-headers-msg" style="display:none">
            No columns found — add headers to your sheet first.
        </div>

        <div id="config-form" style="display:none">
            <div class="field-group">
                <span class="field-label">User prompt columns <span class="required">*</span></span>
                <div id="user-prompt-cols" class="checkbox-list"></div>
            </div>

            <div class="field-group">
                <span class="field-label">Drive file columns <span class="optional">(optional)</span></span>
                <div id="drive-file-cols" class="checkbox-list"></div>
            </div>

            <div class="field-group">
                <span class="field-label">System prompt column <span class="optional">(optional)</span></span>
                <select id="system-prompt-col" class="select-input">
                    <option value="">None</option>
                </select>
            </div>

            <div class="field-group">
                <span class="field-label">Output column <span class="required">*</span></span>
                <select id="output-col" class="select-input" onchange="handleOutputColChange(this)">
                    <option value="">Select...</option>
                    <option value="__new__">New column...</option>
                </select>
                <input id="new-col-input" type="text" class="text-input" placeholder="ai_column_name" value="ai_" style="display:none">
            </div>

            <div class="field-group">
                <span class="field-label">Rows to process</span>
                <div class="row-range-options">
                    <label><input type="radio" name="row-range" value="selection" checked onchange="handleRowRangeChange()"> Use sheet selection</label>
                    <label><input type="radio" name="row-range" value="range" onchange="handleRowRangeChange()"> Specify range</label>
                    <div id="range-inputs" class="range-inputs" style="display:none">
                        <input type="number" id="row-start" placeholder="Start row" min="2">
                        <input type="number" id="row-end" placeholder="End row" min="2">
                    </div>
                </div>
            </div>

            <div class="panel-buttons">
                <button class="btn-cancel" onclick="hideAIPanel()">Cancel</button>
                <button id="run-btn" class="btn-run" onclick="runAI()">Run AI</button>
            </div>
        </div>
    </div>

    <script>
        // ── Existing tool dispatch ──────────────────────────────────
        function dispatchTool(e, fn) {
            var btn = e.currentTarget;
            var orig = btn.innerHTML;
            btn.classList.add('loading');
            btn.innerHTML = '<span class="icon">⏳</span> Working...';
            google.script.run
                .withSuccessHandler(function() { btn.classList.remove('loading'); btn.innerHTML = orig; })
                .withFailureHandler(function(msg) { alert('Error: ' + msg); btn.classList.remove('loading'); btn.innerHTML = orig; })
                .runTool(fn);
        }

        // ── AI panel ───────────────────────────────────────────────
        function showAIPanel() {
            document.getElementById('tool-list').style.display = 'none';
            document.getElementById('ai-panel').style.display = 'block';
            document.getElementById('config-form').style.display = 'none';
            document.getElementById('no-headers-msg').style.display = 'none';
            google.script.run
                .withSuccessHandler(loadHeaders)
                .withFailureHandler(function(msg) { alert('Error loading headers: ' + msg); hideAIPanel(); })
                .getSheetHeaders();
        }

        function hideAIPanel() {
            document.getElementById('ai-panel').style.display = 'none';
            document.getElementById('tool-list').style.display = 'block';
        }

        function loadHeaders(headers) {
            if (!headers || headers.length === 0) {
                document.getElementById('no-headers-msg').style.display = 'block';
                return;
            }
            buildCheckboxList('user-prompt-cols', headers);
            buildCheckboxList('drive-file-cols', headers);
            buildSelectOptions('system-prompt-col', headers, true);
            buildSelectOptions('output-col', headers, false);
            // Append "New column..." to output select after real headers
            var outputSel = document.getElementById('output-col');
            var newOpt = document.createElement('option');
            newOpt.value = '__new__';
            newOpt.textContent = 'New column...';
            outputSel.appendChild(newOpt);
            document.getElementById('config-form').style.display = 'block';
        }

        function buildCheckboxList(containerId, headers) {
            var container = document.getElementById(containerId);
            container.innerHTML = '';
            headers.forEach(function(h) {
                var label = document.createElement('label');
                var cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = h;
                label.appendChild(cb);
                label.appendChild(document.createTextNode(' ' + h));
                container.appendChild(label);
            });
        }

        function buildSelectOptions(selectId, headers, includeNone) {
            var sel = document.getElementById(selectId);
            sel.innerHTML = '';
            if (includeNone) {
                var none = document.createElement('option');
                none.value = '';
                none.textContent = 'None';
                sel.appendChild(none);
            } else {
                var ph = document.createElement('option');
                ph.value = '';
                ph.textContent = 'Select...';
                sel.appendChild(ph);
            }
            headers.forEach(function(h) {
                var opt = document.createElement('option');
                opt.value = h;
                opt.textContent = h;
                sel.appendChild(opt);
            });
        }

        function handleOutputColChange(sel) {
            document.getElementById('new-col-input').style.display =
                sel.value === '__new__' ? 'block' : 'none';
        }

        function handleRowRangeChange() {
            var isRange = document.querySelector('input[name="row-range"]:checked').value === 'range';
            document.getElementById('range-inputs').style.display = isRange ? 'flex' : 'none';
        }

        function runAI() {
            var userPromptCols = Array.prototype.slice
                .call(document.querySelectorAll('#user-prompt-cols input:checked'))
                .map(function(cb) { return cb.value; });

            if (userPromptCols.length === 0) {
                alert('Please select at least one User prompt column.');
                return;
            }

            var driveFileCols = Array.prototype.slice
                .call(document.querySelectorAll('#drive-file-cols input:checked'))
                .map(function(cb) { return cb.value; });

            var sysVal = document.getElementById('system-prompt-col').value;
            var systemPromptCol = sysVal || undefined;

            var outputSel = document.getElementById('output-col');
            var outputCol;
            if (outputSel.value === '__new__') {
                outputCol = document.getElementById('new-col-input').value.trim();
                if (!outputCol) { alert('Please enter a name for the new output column.'); return; }
            } else if (outputSel.value) {
                outputCol = outputSel.value;
            } else {
                alert('Please select an output column.');
                return;
            }

            var rowRangeMode = document.querySelector('input[name="row-range"]:checked').value;
            var rowRange;
            if (rowRangeMode === 'range') {
                var start = parseInt(document.getElementById('row-start').value, 10);
                var end = parseInt(document.getElementById('row-end').value, 10);
                if (isNaN(start) || isNaN(end) || start < 2 || end < start) {
                    alert('Please enter a valid row range (start ≥ 2, end ≥ start).');
                    return;
                }
                rowRange = { start: start, end: end };
            }

            var config = {
                userPromptCols: userPromptCols,
                driveFileCols: driveFileCols.length > 0 ? driveFileCols : undefined,
                systemPromptCol: systemPromptCol,
                outputCol: outputCol,
                rowRange: rowRange,
            };

            var btn = document.getElementById('run-btn');
            btn.disabled = true;
            btn.textContent = 'Running...';

            google.script.run
                .withSuccessHandler(function() { hideAIPanel(); })
                .withFailureHandler(function(msg) {
                    alert('Error: ' + msg);
                    btn.disabled = false;
                    btn.textContent = 'Run AI';
                })
                .runBatchAI(config);
        }
    </script>
</body>

</html>
```

**Step 2: Build to verify**

```bash
npm run build
```

Expected: build succeeds. (`Sidebar.html` is copied to `dist/` by the build script — verify it appears there.)

**Step 3: Commit**

```bash
git add src/Sidebar.html
git commit -m "feat: replace AI modal with inline sidebar config panel"
```

---

### Task 8: Full verification

**Step 1: Run all tests**

```bash
npm test
```

Expected: all tests PASS.

**Step 2: Run coverage**

```bash
npm run test:coverage
```

Expected: all per-file thresholds met. `src/server/utils.ts` threshold should now include `resolveColumns`.

**Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

**Step 4: Lint**

```bash
npm run lint
```

Expected: zero errors. Fix any warnings if present.

**Step 5: Full build**

```bash
npm run build
```

Expected: `dist/index.js` and `dist/Sidebar.html` generated cleanly.

**Step 6: Commit if any lint fixes were needed**

```bash
git add -p
git commit -m "chore: lint fixes"
```
