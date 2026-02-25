# Sidebar Entry Point Testing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Test the GAS-coupled callback logic in `sidebar-entry.ts` and eliminate duplicated DOM fixture setup across test files by extracting a shared fixture module.

**Architecture:** Export testable functions from `sidebar-entry.ts`; create `__tests__/helpers/sidebar-fixtures.ts` with a complete sidebar HTML string and setup utilities shared by both test files; add `__tests__/sidebar-entry.test.ts` using a mock callback-capture pattern to invoke success/failure handlers without a GAS runtime. Refactor `__tests__/sidebar.test.ts` to import from the fixture module instead of duplicating setup.

**Tech Stack:** Jest 29, ts-jest, jsdom, TypeScript. No new dependencies.

**Design doc:** `docs/plans/2026-02-24-sidebar-entry-testing-design.md`

---

### Task 1: Create shared fixture module

**Files:**
- Create: `__tests__/helpers/sidebar-fixtures.ts`

This module owns the full sidebar DOM string and all setup helpers. It is the single source of truth for DOM structure across both test files.

**Step 1: Create the file**

```typescript
/**
 * @jest-environment jsdom
 *
 * Shared DOM fixtures and setup utilities for sidebar tests.
 * Used by sidebar.test.ts and sidebar-entry.test.ts.
 */

import {
  buildTagList,
  buildSingleTagList,
  applyPreset,
} from "../../src/client/sidebar";
import type { RunConfig } from "../../src/shared/types";

/**
 * Complete sidebar DOM — both panels with every element used by tests.
 * Set document.body.innerHTML = FULL_SIDEBAR_HTML at the start of any test
 * that needs the real DOM shape.
 */
export const FULL_SIDEBAR_HTML = `
  <div id="tool-list">
    <button id="btn-import-drive-links">Import Drive Links</button>
    <button id="btn-run-ai">Run AI</button>
    <button id="btn-sample-rows">Sample Rows</button>
    <button id="btn-extract-text">Extract Text</button>
  </div>
  <div id="ai-panel" style="display:none">
    <div id="no-headers-msg" style="display:none"></div>
    <div id="config-form" style="display:none">
      <div id="user-prompt-cols"></div>
      <div id="drive-file-cols"></div>
      <div id="system-prompt-col"></div>
      <div id="output-col"></div>
      <input id="new-col-input" type="text" style="display:none">
      <input type="radio" name="row-range" value="selection" checked>
      <input type="radio" name="row-range" value="range">
      <div id="range-inputs" style="display:none">
        <input type="number" id="row-start">
        <input type="number" id="row-end">
      </div>
    </div>
    <button id="back-btn">Back</button>
    <button id="cancel-btn">Cancel</button>
    <button id="run-btn">Run AI</button>
  </div>
`;

const DEFAULT_HEADERS = [
  "col_a",
  "col_b",
  "col_c",
  "source_drive",
  "system_prompt",
  "ai_inference",
];

/**
 * Sets FULL_SIDEBAR_HTML on document.body and populates all four tag
 * containers with the given headers.
 */
export function setupConfigPanel(headers: string[] = DEFAULT_HEADERS): void {
  document.body.innerHTML = FULL_SIDEBAR_HTML;
  buildTagList(document.getElementById("user-prompt-cols")!, headers);
  buildTagList(document.getElementById("drive-file-cols")!, headers);
  buildSingleTagList(document.getElementById("system-prompt-col")!, headers, false);
  buildSingleTagList(document.getElementById("output-col")!, headers, true);
}

export interface SetupOpts {
  headers?: string[];
  userPrompt?: string[];
  drive?: string[];
  system?: string;
  output?: string;
  newOutputName?: string;
  rowRange?: { start: number; end: number };
}

/**
 * Calls setupConfigPanel, then uses applyPreset to pre-select values.
 * Promoted from the local helper in assembleRunConfig tests.
 */
export function setupWithSelections({
  headers,
  userPrompt = [],
  drive = [],
  system,
  output,
  newOutputName,
  rowRange,
}: SetupOpts = {}): void {
  setupConfigPanel(headers);
  if (userPrompt.length) applyPreset({ userPromptCols: userPrompt });
  if (drive.length) applyPreset({ driveFileCols: drive });
  if (system) applyPreset({ systemPromptCol: system });
  if (output) applyPreset({ outputCol: output });
  if (rowRange) applyPreset({ rowRange });
  if (newOutputName !== undefined) {
    const newBtn = document.querySelector<HTMLButtonElement>(
      '#output-col [data-value="__new__"]',
    )!;
    newBtn.click();
    (document.getElementById("new-col-input") as HTMLInputElement).value = newOutputName;
  }
}
```

**Step 2: Run existing tests to confirm the fixture module doesn't break anything**

Run: `npm test`
Expected: 7 suites, 119 tests, all PASS. The fixture file is not imported yet so nothing changes.

**Step 3: Commit**

```bash
git add __tests__/helpers/sidebar-fixtures.ts
git commit -m "test: add shared sidebar DOM fixture module"
```

---

### Task 2: Refactor sidebar.test.ts to use shared fixtures

**Files:**
- Modify: `__tests__/sidebar.test.ts`

Replace the two duplicated local setup helpers with imports from the fixture module. The `makeContainer()` one-liners in `buildTagList` and `buildSingleTagList` describe blocks are simple enough to stay local. The `makeRowRangeDom` helper in `handleRowRangeChange` is specific to those tests and stays local. Only `applyPreset.setupPanel` and `assembleRunConfig.PANEL_HTML + setupWithSelections` are replaced.

**Step 1: Add imports at the top of the file and remove the local helpers**

At the top of `__tests__/sidebar.test.ts`, add after the existing imports:

```typescript
import {
  setupConfigPanel,
  setupWithSelections,
} from "./helpers/sidebar-fixtures";
```

**Step 2: Update the applyPreset describe block**

Remove the local `setupPanel` function (lines ~153–171). Replace every call `setupPanel(headers)` with `setupConfigPanel(headers)`:

```typescript
// BEFORE
describe("applyPreset", () => {
  function setupPanel(headers: string[]): void {
    document.body.innerHTML = `
      <div id="user-prompt-cols"></div>
      ...
    `;
    buildTagList(document.getElementById("user-prompt-cols")!, headers);
    ...
  }

  it("pre-selects userPromptCols", () => {
    setupPanel(["col_a", "col_b", "col_c"]);
    ...
  });

// AFTER
describe("applyPreset", () => {
  it("pre-selects userPromptCols", () => {
    setupConfigPanel(["col_a", "col_b", "col_c"]);
    ...
  });
```

Apply the same replacement to all 7 tests in the `applyPreset` describe block.

**Step 3: Update the assembleRunConfig describe block**

Remove the `PANEL_HTML` constant and the local `setupWithSelections` function. Replace every call to the local `setupWithSelections(opts)` with the imported one. The call signatures are identical so no other changes are needed.

```typescript
// BEFORE
describe("assembleRunConfig", () => {
  const PANEL_HTML = `...`;

  function setupWithSelections({ ... } = {}): void {
    document.body.innerHTML = PANEL_HTML;
    ...
  }

// AFTER
describe("assembleRunConfig", () => {
```

The `beforeAll` and `afterEach` for `globalThis.alert` remain unchanged.

**Step 4: Run tests**

Run: `npx jest __tests__/sidebar.test.ts`
Expected: 27 tests, all PASS.

**Step 5: Commit**

```bash
git add __tests__/sidebar.test.ts
git commit -m "refactor: sidebar tests use shared fixture module"
```

---

### Task 3: Export entry point functions from sidebar-entry.ts

**Files:**
- Modify: `src/client/sidebar-entry.ts`

Add the `export` keyword to the four testable functions. `init` stays private.

**Step 1: Add exports**

In `src/client/sidebar-entry.ts`, change the four function declarations:

```typescript
// BEFORE
function showAIPanel(preset?: Partial<RunConfig>): void {
function hideAIPanel(): void {
function dispatchTool(e: MouseEvent, fn: string): void {
function runAI(): void {

// AFTER
export function showAIPanel(preset?: Partial<RunConfig>): void {
export function hideAIPanel(): void {
export function dispatchTool(e: MouseEvent, fn: string): void {
export function runAI(): void {
```

**Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: no errors.

**Step 3: Run tests**

Run: `npm test`
Expected: 7 suites, 119 tests, all PASS. Adding exports to an IIFE-bundled module is invisible at runtime.

**Step 4: Commit**

```bash
git add src/client/sidebar-entry.ts
git commit -m "feat: export sidebar-entry functions for testing"
```

---

### Task 4: Create sidebar-entry.test.ts — hideAIPanel and showAIPanel

**Files:**
- Create: `__tests__/sidebar-entry.test.ts`

The core pattern: `mockRun.withSuccessHandler.mockImplementation` captures the callback the entry point registers, then the test invokes it manually to simulate GAS calling back.

**Step 1: Write the test file with hideAIPanel and showAIPanel tests**

```typescript
/**
 * @jest-environment jsdom
 *
 * Tests for sidebar-entry.ts — GAS-coupled panel navigation and tool dispatch.
 * Functions are tested by capturing the success/failure handlers they register
 * with google.script.run and invoking them manually, without a GAS runtime.
 *
 * init() is not tested — it contains only addEventListener wiring.
 */

const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  runTool: jest.fn(),
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
};
(globalThis as unknown as { google: unknown }).google = { script: { run: mockRun } };
globalThis.alert = jest.fn();

import { showAIPanel, hideAIPanel } from "../src/client/sidebar-entry";
import { setupConfigPanel, setupWithSelections } from "./helpers/sidebar-fixtures";

// Captured callbacks — assigned by mockImplementation in beforeEach.
let capturedSuccess: (v: unknown) => void;
let capturedFailure: (e: Error) => void;

beforeEach(() => {
  jest.clearAllMocks();
  mockRun.withSuccessHandler.mockImplementation((fn: (v: unknown) => void) => {
    capturedSuccess = fn;
    return mockRun;
  });
  mockRun.withFailureHandler.mockImplementation((fn: (e: Error) => void) => {
    capturedFailure = fn;
    return mockRun;
  });
  setupConfigPanel();
});

// ── hideAIPanel ───────────────────────────────────────────────────────────────

describe("hideAIPanel", () => {
  it("hides ai-panel and shows tool-list", () => {
    document.getElementById("ai-panel")!.style.display = "block";
    document.getElementById("tool-list")!.style.display = "none";
    hideAIPanel();
    expect(document.getElementById("ai-panel")!.style.display).toBe("none");
    expect(document.getElementById("tool-list")!.style.display).toBe("block");
  });
});

// ── showAIPanel ───────────────────────────────────────────────────────────────

describe("showAIPanel", () => {
  it("hides tool-list and shows ai-panel", () => {
    showAIPanel();
    expect(document.getElementById("tool-list")!.style.display).toBe("none");
    expect(document.getElementById("ai-panel")!.style.display).toBe("block");
  });

  it("calls getSheetHeaders", () => {
    showAIPanel();
    expect(mockRun.getSheetHeaders).toHaveBeenCalledTimes(1);
  });

  it("on success with headers: shows config-form and builds tag lists", () => {
    showAIPanel();
    capturedSuccess(["col_a", "col_b"]);
    expect(document.getElementById("config-form")!.style.display).toBe("block");
    expect(document.querySelectorAll("#user-prompt-cols .tag")).toHaveLength(2);
    // includeNew=true adds a __new__ tag, so output-col has headers.length + 1
    expect(document.querySelectorAll("#output-col .tag")).toHaveLength(3);
  });

  it("on success with a preset: applies preset after building tag lists", () => {
    showAIPanel({ userPromptCols: ["col_a"] });
    capturedSuccess(["col_a", "col_b"]);
    const selected = document.querySelectorAll("#user-prompt-cols .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("col_a");
  });

  it("on success with empty headers: shows no-headers-msg and hides config-form", () => {
    showAIPanel();
    capturedSuccess([]);
    expect(document.getElementById("no-headers-msg")!.style.display).toBe("block");
    expect(document.getElementById("config-form")!.style.display).toBe("none");
  });

  it("on failure: alerts with the error message and hides ai-panel", () => {
    showAIPanel();
    capturedFailure(new Error("Network error"));
    expect(globalThis.alert).toHaveBeenCalledWith(
      "Error loading headers: Network error",
    );
    expect(document.getElementById("ai-panel")!.style.display).toBe("none");
    expect(document.getElementById("tool-list")!.style.display).toBe("block");
  });
});
```

**Step 2: Run the new test file**

Run: `npx jest __tests__/sidebar-entry.test.ts`
Expected: 7 tests, all PASS.

If any test fails, check:
- `capturedSuccess`/`capturedFailure` is undefined → the `mockImplementation` in `beforeEach` ran after `jest.clearAllMocks()` cleared the previous implementation; verify order (clear first, then re-implement).
- Display assertions fail → check that `FULL_SIDEBAR_HTML` has the correct initial `style` values on each element.

**Step 3: Run full suite**

Run: `npm test`
Expected: 7 suites, all PASS. (sidebar-entry.test.ts is not yet counted in coverage — that's Task 7.)

**Step 4: Commit**

```bash
git add __tests__/sidebar-entry.test.ts
git commit -m "test: hideAIPanel and showAIPanel callback tests"
```

---

### Task 5: Add dispatchTool tests

**Files:**
- Modify: `__tests__/sidebar-entry.test.ts`

**Step 1: Add dispatchTool import and tests**

Add `dispatchTool` to the import at the top:

```typescript
import { showAIPanel, hideAIPanel, dispatchTool } from "../src/client/sidebar-entry";
```

Add a helper function above the describe blocks (after the `beforeEach`):

```typescript
/** Creates a button with the given innerHTML and a MouseEvent whose currentTarget is that button. */
function makeButtonEvent(html = "Click"): { e: MouseEvent; btn: HTMLButtonElement } {
  const btn = document.createElement("button");
  btn.innerHTML = html;
  document.body.appendChild(btn);
  const e = new MouseEvent("click");
  Object.defineProperty(e, "currentTarget", { value: btn, writable: false });
  return { e, btn };
}
```

Add the describe block:

```typescript
// ── dispatchTool ──────────────────────────────────────────────────────────────

describe("dispatchTool", () => {
  it("adds loading class and sets loading text on the button", () => {
    const { e, btn } = makeButtonEvent("Import");
    dispatchTool(e, "importDriveLinks");
    expect(btn.classList.contains("loading")).toBe(true);
    expect(btn.innerHTML).toContain("Working...");
  });

  it("calls runTool with the given function name", () => {
    const { e } = makeButtonEvent();
    dispatchTool(e, "importDriveLinks");
    expect(mockRun.runTool).toHaveBeenCalledWith("importDriveLinks");
  });

  it("on success: removes loading class and restores original innerHTML", () => {
    const { e, btn } = makeButtonEvent("Import");
    dispatchTool(e, "importDriveLinks");
    capturedSuccess(undefined);
    expect(btn.classList.contains("loading")).toBe(false);
    expect(btn.innerHTML).toBe("Import");
  });

  it("on failure: alerts, removes loading class, restores original innerHTML", () => {
    const { e, btn } = makeButtonEvent("Import");
    dispatchTool(e, "importDriveLinks");
    capturedFailure(new Error("Drive error"));
    expect(globalThis.alert).toHaveBeenCalledWith("Error: Drive error");
    expect(btn.classList.contains("loading")).toBe(false);
    expect(btn.innerHTML).toBe("Import");
  });
});
```

**Step 2: Run the test file**

Run: `npx jest __tests__/sidebar-entry.test.ts`
Expected: 11 tests, all PASS.

**Step 3: Commit**

```bash
git add __tests__/sidebar-entry.test.ts
git commit -m "test: dispatchTool loading state and runTool callback tests"
```

---

### Task 6: Add runAI tests

**Files:**
- Modify: `__tests__/sidebar-entry.test.ts`

**Step 1: Add runAI import**

```typescript
import { showAIPanel, hideAIPanel, dispatchTool, runAI } from "../src/client/sidebar-entry";
```

**Step 2: Add the describe block**

```typescript
// ── runAI ─────────────────────────────────────────────────────────────────────

describe("runAI", () => {
  it("does not call runBatchAI when assembleRunConfig returns null (no selections)", () => {
    // beforeEach calls setupConfigPanel() with no pre-selections,
    // so assembleRunConfig() will return null (no userPromptCols).
    runAI();
    expect(mockRun.runBatchAI).not.toHaveBeenCalled();
  });

  it("disables run-btn and sets text to 'Running...' while the request is in flight", () => {
    setupWithSelections({ userPrompt: ["col_a"], output: "ai_inference" });
    runAI();
    const btn = document.getElementById("run-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Running...");
  });

  it("calls runBatchAI with the assembled RunConfig", () => {
    setupWithSelections({ userPrompt: ["col_a"], output: "ai_inference" });
    runAI();
    expect(mockRun.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ userPromptCols: ["col_a"], outputCol: "ai_inference" }),
    );
  });

  it("on success: re-enables run-btn, resets text, and hides ai-panel", () => {
    setupWithSelections({ userPrompt: ["col_a"], output: "ai_inference" });
    runAI();
    capturedSuccess(undefined);
    const btn = document.getElementById("run-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Run AI");
    expect(document.getElementById("tool-list")!.style.display).toBe("block");
  });

  it("on failure: alerts, re-enables run-btn, and resets text", () => {
    setupWithSelections({ userPrompt: ["col_a"], output: "ai_inference" });
    runAI();
    capturedFailure(new Error("API error"));
    const btn = document.getElementById("run-btn") as HTMLButtonElement;
    expect(globalThis.alert).toHaveBeenCalledWith("Error: API error");
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toBe("Run AI");
  });
});
```

**Step 3: Run the test file**

Run: `npx jest __tests__/sidebar-entry.test.ts`
Expected: 16 tests, all PASS.

**Step 4: Run full suite**

Run: `npm test`
Expected: 8 suites (sidebar-entry.test.ts now added), all PASS.

**Step 5: Commit**

```bash
git add __tests__/sidebar-entry.test.ts
git commit -m "test: runAI assembly, runBatchAI dispatch, and callback tests"
```

---

### Task 7: Update jest.config.cjs and lock in coverage thresholds

**Files:**
- Modify: `jest.config.cjs`

**Step 1: Add transform rules for the new files**

In the `transform` block, add two rules alongside the existing `sidebar.test.ts` rule:

```javascript
transform: {
  // Client source files and sidebar tests use the client tsconfig (DOM lib).
  "^.+/src/client/.+\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
  "^.+/__tests__/sidebar\\.test\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
  "^.+/__tests__/sidebar-entry\\.test\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
  "^.+/__tests__/helpers/sidebar-fixtures\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
  // All other TypeScript files use the main tsconfig.
  "^.+\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.json" }],
},
```

**Step 2: Remove sidebar-entry.ts from collectCoverageFrom exclusions**

```javascript
collectCoverageFrom: [
  "src/**/*.ts",
  "!src/server/index.ts",
  // Remove the line: "!src/client/sidebar-entry.ts",
],
```

**Step 3: Run coverage and read the actuals**

Run: `npm run test:coverage`

Look at the `sidebar-entry.ts` row in the coverage table. Write down the four numbers (statements, branches, functions, lines).

Example output you will see:
```
  sidebar-entry.ts  |  XX.XX  |  XX.XX  |  XX.XX  |  XX.XX  |
```

`init()` and its inner arrow functions are untested, so:
- Statements will likely be ~85–90%
- Branches will likely be ~75–85%
- Functions will likely be ~55–70% (Istanbul counts arrow functions)

**Step 4: Add the threshold block**

Subtract ~5 points from each observed value and add to `coverageThreshold`:

```javascript
// init() and its inner arrow functions (addEventListener wiring) are not
// unit-tested. Thresholds reflect coverage of the four exported functions only.
"./src/client/sidebar-entry.ts": {
  statements: <observed - 5>,
  branches: <observed - 5>,
  functions: <observed - 5>,
},
```

For example, if you observe `statements: 88.46, branches: 80.00, functions: 62.50`, set:

```javascript
"./src/client/sidebar-entry.ts": {
  statements: 83,
  branches: 75,
  functions: 57,
},
```

**Step 5: Run coverage again to confirm thresholds pass**

Run: `npm run test:coverage`
Expected: all per-file thresholds met. No threshold failure lines.

**Step 6: Commit**

```bash
git add jest.config.cjs
git commit -m "chore: add sidebar-entry.ts to coverage with per-file thresholds"
```
