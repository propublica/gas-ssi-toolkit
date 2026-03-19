# Sidebar Feature Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the 5-item custom menu with a single persistent sidebar that exposes all four tools, matching the UX of `updated_code.gs` + `updated_sidebar.html`.

**Architecture:** `showSidebar()` loads `Sidebar.html` (a standalone file in `dist/`) via `HtmlService.createTemplateFromFile`. The sidebar calls `google.script.run.runTool(fn)` to dispatch to any tool by name; `runTool` resolves the name against an explicit typed map in `index.ts`. `openQuickstartDoc` is removed — the user guide link lives as a plain `<a>` in the sidebar.

**Tech Stack:** TypeScript, Rollup (IIFE), clasp, Jest/ts-jest, Google Apps Script V8 runtime

**Design doc:** `docs/plans/2026-02-18-sidebar-feature-parity-design.md`

---

### Task 1: Update build scripts to copy `Sidebar.html` to `dist/`

**Files:**

- Modify: `package.json`

No test needed — the build either succeeds or fails. We verify by running the build at the end.

**Step 1: Edit `package.json` build scripts**

In `package.json`, the `"build"` and `"build:watch"` scripts currently only copy `appsscript.json`. Extend both to also copy `src/Sidebar.html`:

```json
"build": "rimraf dist && rollup -c && cp appsscript.json dist/ && cp src/Sidebar.html dist/",
"build:watch": "mkdir -p dist && cp appsscript.json dist/ && cp src/Sidebar.html dist/ && rollup -c --watch",
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "build: copy Sidebar.html to dist/ alongside appsscript.json"
```

---

### Task 2: Create `src/Sidebar.html`

**Files:**

- Create: `src/Sidebar.html`

This file is a static HTML artifact — no unit test. Visual correctness is verified by deploying to dev.

**Step 1: Create the file**

Create `src/Sidebar.html` with the following content (adapted directly from `updated_sidebar.html`):

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

        .container {
            padding: 16px;
        }

        .guide-card {
            background-color: #f8f9fa;
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 24px;
            text-align: center;
            transition: background-color 0.2s;
        }

        .guide-card:hover {
            background-color: #f1f3f4;
        }

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

        .section {
            margin-bottom: 28px;
        }

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

        .tool-btn:active {
            background-color: #e8eaed;
            transform: scale(0.98);
        }

        .icon {
            margin-right: 12px;
            font-size: 18px;
            width: 24px;
            text-align: center;
        }

        .status-footer {
            margin-top: 40px;
            padding: 16px;
            border-top: 1px solid #eee;
            font-size: 11px;
            color: var(--text-secondary);
            text-align: center;
            line-height: 1.5;
        }

        .loading {
            opacity: 0.5;
            pointer-events: none;
        }
    </style>
</head>

<body>
    <div class="container">
        <div class="guide-card">
            <a href="https://docs.google.com/document/d/1BQJzBHiE6L0hvU6NMD0jaQE71VWRpWH-vNQu3UtGjBA/edit?tab=t.66jobsqlduah#heading=h.h5k0s81xpiiq"
                target="_blank" class="guide-link">
                <span>📖</span> View User Guide ↗
            </a>
        </div>

        <div class="section">
            <h3>Main Tools</h3>
            <button class="tool-btn" onclick="run('importDriveLinks')">
                <span class="icon">📂</span> Import Drive Links
            </button>
            <button class="tool-btn" onclick="run('showSourceDialog')">
                <span class="icon">▶️</span> Run AI Inference
            </button>
        </div>

        <div class="section">
            <h3>Extras</h3>
            <button class="tool-btn" onclick="run('sampleRowsToEvaluation')">
                <span class="icon">🎲</span> Sample Rows
            </button>
            <button class="tool-btn" onclick="run('extractTextFromSelection')">
                <span class="icon">📜</span> Extract Text
            </button>
        </div>
    </div>

    <div class="status-footer">
        <strong>SSI Tools v2.0</strong><br>
        Powered by Gemini 2.0 Flash<br>
        Evaluation Unrestricted Mode
    </div>

    <script>
        function run(fn) {
            const btn = event.currentTarget;
            const originalContent = btn.innerHTML;

            btn.classList.add('loading');
            btn.innerHTML = '<span class="icon">⏳</span> Working...';

            google.script.run
                .withSuccessHandler(() => {
                    btn.classList.remove('loading');
                    btn.innerHTML = originalContent;
                })
                .withFailureHandler(msg => {
                    alert('Error: ' + msg);
                    btn.classList.remove('loading');
                    btn.innerHTML = originalContent;
                })
                .runTool(fn);
        }
    </script>
</body>

</html>
```

**Step 2: Commit**

```bash
git add src/Sidebar.html
git commit -m "feat: add Sidebar.html for persistent sidebar UI"
```

---

### Task 3: Update `rollup.config.js` footer stubs

**Files:**

- Modify: `rollup.config.js`

**Step 1: Update the footer**

The footer currently has stubs for `onOpen`, `showSourceDialog`, `handleDialogSelection`, `importDriveLinks`, `extractTextFromSelection`, `sampleRowsToEvaluation`, and `openQuickstartDoc`.

Replace the `footer` value with:

```js
footer: `
/**
 * Global Handshake — Explicit function stubs for Google Apps Script discovery.
 */
function onOpen(e) { _GASEntry.onOpen(e); }
function showSidebar() { _GASEntry.showSidebar(); }
function runTool(fn) { _GASEntry.runTool(fn); }
function showSourceDialog() { _GASEntry.showSourceDialog(); }
function handleDialogSelection(mode) { _GASEntry.handleDialogSelection(mode); }
function importDriveLinks() { _GASEntry.importDriveLinks(); }
function extractTextFromSelection() { _GASEntry.extractTextFromSelection(); }
function sampleRowsToEvaluation() { _GASEntry.sampleRowsToEvaluation(); }
`,
```

Note: `openQuickstartDoc` is removed. `showSidebar` and `runTool` are added.

**Step 2: Commit**

```bash
git add rollup.config.js
git commit -m "build: update rollup footer stubs for showSidebar and runTool"
```

---

### Task 4: Update `__tests__/menu.test.ts` (write failing tests first)

**Files:**

- Modify: `__tests__/menu.test.ts`

This task replaces the entire test file. Read `__tests__/menu.test.ts` before editing.

**Step 1: Replace the file contents**

The new file must:

- Add mocks for `createTemplateFromFile`, `evaluate()`, and `showSidebar` on the UI
- Update `onOpen` tests: single `addItem` call, new menu name `⚡ SSI Toolkit`
- Remove the `openQuickstartDoc` describe block entirely
- Add `showSidebar` describe block
- Add `runTool` describe block

```typescript
/**
 * Tests for src/server/index.ts (Menu and sidebar functions)
 */

// ── Mock globals BEFORE imports ────────────────────────────────

const mockAddItem = jest.fn().mockReturnThis();
const mockAddToUi = jest.fn();
const mockMenu = {
  addItem: mockAddItem,
  addToUi: mockAddToUi,
};
const mockCreateMenu = jest.fn().mockReturnValue(mockMenu);
const mockShowModalDialog = jest.fn();
const mockShowSidebarFn = jest.fn();
const mockUi = {
  createMenu: mockCreateMenu,
  showModalDialog: mockShowModalDialog,
  showSidebar: mockShowSidebarFn,
};
const mockSpreadsheetApp = {
  getUi: jest.fn().mockReturnValue(mockUi),
};

const mockEvaluate = jest.fn().mockReturnValue({
  setTitle: jest.fn().mockReturnThis(),
  setWidth: jest.fn().mockReturnThis(),
});
const mockCreateTemplateFromFile = jest.fn().mockReturnValue({
  evaluate: mockEvaluate,
});
const mockCreateHtmlOutput = jest.fn().mockReturnValue({
  setWidth: jest.fn().mockReturnThis(),
  setHeight: jest.fn().mockReturnThis(),
});
const mockHtmlService = {
  createHtmlOutput: mockCreateHtmlOutput,
  createTemplateFromFile: mockCreateTemplateFromFile,
};

(globalThis as any).SpreadsheetApp = mockSpreadsheetApp;
(globalThis as any).HtmlService = mockHtmlService;

// ── Import after mocks ─────────────────────────────────────────

import { onOpen, showSidebar, runTool } from "../src/server/index";

// ── Tests ──────────────────────────────────────────────────────

describe("onOpen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a menu named '⚡ SSI Toolkit'", () => {
    onOpen();
    expect(mockCreateMenu).toHaveBeenCalledWith("⚡ SSI Toolkit");
  });

  it("adds a single item that opens the sidebar", () => {
    onOpen();
    expect(mockAddItem).toHaveBeenCalledTimes(1);
    expect(mockAddItem).toHaveBeenCalledWith("🚀 Open SSI Toolkit", "showSidebar");
  });

  it("adds the menu to the UI", () => {
    onOpen();
    expect(mockAddToUi).toHaveBeenCalledTimes(1);
  });
});

describe("showSidebar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads the sidebar from the 'Sidebar' template file", () => {
    showSidebar();
    expect(mockCreateTemplateFromFile).toHaveBeenCalledWith("Sidebar");
  });

  it("evaluates the template and shows the sidebar", () => {
    showSidebar();
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    expect(mockShowSidebarFn).toHaveBeenCalledTimes(1);
  });
});

describe("runTool", () => {
  it("dispatches 'importDriveLinks' without throwing", () => {
    // importDriveLinks calls SpreadsheetApp.getUi() — already mocked
    // We just need it not to throw on dispatch itself
    expect(() => runTool("importDriveLinks")).not.toThrow();
  });

  it("throws for an unknown function name", () => {
    expect(() => runTool("doesNotExist")).toThrow("Function not found: doesNotExist");
  });
});
```

**Step 2: Run the tests and confirm they fail**

```bash
npx jest __tests__/menu.test.ts
```

Expected: FAIL — `showSidebar` and `runTool` are not yet exported from `index.ts`, and `onOpen` still creates the old menu.

**Step 3: Commit the failing tests**

```bash
git add __tests__/menu.test.ts
git commit -m "test: update menu tests for sidebar UX (failing)"
```

---

### Task 5: Update `src/server/index.ts` to make tests pass

**Files:**

- Modify: `src/server/index.ts`

Read `src/server/index.ts` before editing. Make these changes:

**Step 1: Update `onOpen()`**

Replace the existing `onOpen` body:

```typescript
export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("⚡ SSI Toolkit")
    .addItem("🚀 Open SSI Toolkit", "showSidebar")
    .addToUi();
}
```

**Step 2: Remove `openQuickstartDoc()`**

Delete the entire `openQuickstartDoc` function and its section comment.

**Step 3: Add `showSidebar()` after the UI handlers section**

```typescript
export function showSidebar(): void {
  const html = HtmlService.createTemplateFromFile("Sidebar");
  const output = html.evaluate().setTitle("SSI Toolkit").setWidth(300);
  SpreadsheetApp.getUi().showSidebar(output);
}
```

**Step 4: Add `runTool()` and the dispatch map**

Add this immediately after `showSidebar`. The dispatch map must reference the four tool functions that are defined later in the same file. Since JavaScript hoists function declarations but not `const`, define the map as a `function` or place it after the tool definitions. The simplest approach: put the map and `runTool` at the bottom of the file, after all four tool functions are defined.

```typescript
// ==========================================
// 🔀 SIDEBAR DISPATCHER
// ==========================================

const TOOLS: Record<string, () => void> = {
  importDriveLinks,
  showSourceDialog,
  sampleRowsToEvaluation,
  extractTextFromSelection,
};

export function runTool(functionName: string): void {
  const fn = TOOLS[functionName];
  if (!fn) throw new Error("Function not found: " + functionName);
  fn();
}
```

**Step 5: Run the tests and confirm they pass**

```bash
npx jest __tests__/menu.test.ts
```

Expected: all tests PASS.

**Step 6: Run the full test suite to confirm no regressions**

```bash
npm test
```

Expected: all 4 suites pass.

**Step 7: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 8: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: replace menu with sidebar — add showSidebar and runTool"
```

---

### Task 6: Verify the build end-to-end

**Step 1: Run the full build**

```bash
npm run build
```

Expected: exits 0. `dist/` should contain `index.js`, `appsscript.json`, and `Sidebar.html`.

**Step 2: Confirm `dist/Sidebar.html` exists**

```bash
ls dist/
```

Expected output includes `Sidebar.html`.

**Step 3: Confirm the footer stubs are in the bundle**

```bash
grep -E "showSidebar|runTool|openQuickstartDoc" dist/index.js
```

Expected: lines for `showSidebar` and `runTool`; no line for `openQuickstartDoc`.

**Step 4: Commit if anything was adjusted; otherwise proceed to deploy**

```bash
git add -A
git status
# If clean, no commit needed. If any tweaks were made, commit them.
```

---

### Task 7: Deploy to dev and smoke-test

**Step 1: Deploy to dev**

```bash
npm run deploy:dev
```

Expected: build succeeds, clasp pushes `dist/` (3 files: `index.js`, `appsscript.json`, `Sidebar.html`).

**Step 2: Open the Apps Script editor to confirm the files are present**

```bash
npm run clasp:open
```

Confirm `Sidebar.html` appears in the file list alongside `Code.gs` / `index.gs`.

**Step 3: Open the spreadsheet and smoke-test**

- Reload the Google Sheets document
- The `⚡ SSI Toolkit` menu should appear with a single item: `🚀 Open SSI Toolkit`
- Click it — the sidebar should open on the right
- Click "View User Guide ↗" — should open the doc in a new tab
- Click "Import Drive Links" — should trigger the folder prompt
- Click "Run AI Inference" — should open the AI mode selection dialog
- Click "Sample Rows" — should trigger the sample size prompt
- Click "Extract Text" — should trigger the Drive service check

**Step 4: Final commit (if any fixes made during smoke test)**

```bash
git add -A
git commit -m "fix: <describe any smoke-test fix>"
```
