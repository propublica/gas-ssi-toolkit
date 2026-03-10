# Recipe Panels Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Recipes system — a `RecipePanel` driven by a `RecipeParams` config object, a `RecipePrepCook` component, a data-driven `RecipesListPanel`, and the server-side `prepRecipe` function — as specified in `docs/plans/2026-02-25-recipe-panels-design.md`.

**Architecture:** `RecipeParams` defines form fields declaratively; `RecipePanel` renders only the sections present. `RecipePrepCook` owns the Prep/Cook button state machine. The server writes spreadsheet columns and returns `PrepRecipeResult` as the single source of truth; the client assembles `preppedRunConfig` entirely from that result.

**Tech Stack:** TypeScript, Google Apps Script (GAS), Jest + ts-jest, jsdom, Rollup IIFE build.

---

## Before You Start

Read these files to understand existing patterns:
- `docs/plans/2026-02-25-recipe-panels-design.md` — the approved design (full reference)
- `src/shared/types.ts` — existing shared types
- `src/client/types.ts` — PanelId, Panel, NavigationContext interfaces
- `src/client/services.ts` — GAS wrapper pattern
- `src/client/components/lockable-field.ts` — LockableField component (you will extend it)
- `src/client/panels/configure-ai-run.ts` — reference panel implementation
- `__tests__/services.test.ts` — `captureHandlers()` pattern for GAS mock tests
- `__tests__/components/lockable-field.test.ts` — component test patterns
- `__tests__/panels/configure-ai-run.test.ts` — panel test patterns
- `jest.config.cjs` — coverage threshold configuration

Run `npm test` before starting — all 162 tests must pass.

---

### Task 1: Add Shared Types

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add the four new interfaces after the existing `RunConfig` interface**

```ts
// ── Recipes ────────────────────────────────────────────────────

export interface RecipeFieldConfig {
  value: string;
  locked?: boolean;      // defaults to true
  placeholder?: string;
}

export interface RecipeParams {
  driveFolder?: {
    colTitle: string;
    helperText?: string;
  };
  systemPrompt?: {
    colTitle: RecipeFieldConfig;
    prompt: RecipeFieldConfig;
  };
  userPrompts?: Array<{
    colTitle: RecipeFieldConfig;
    prompt: RecipeFieldConfig;
  }>;
  outputCol?: {
    colTitle: RecipeFieldConfig;
  };
}

export interface PrepRecipeParams {
  driveFolder?: { url: string; colTitle: string };
  systemPrompt?: { colTitle: string; value: string };
  userPrompts?: Array<{ colTitle: string; value: string }>;
  outputCol?: { colTitle: string };
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
  colNames: {
    driveLink?: string;
    systemPrompt?: string;
    userPrompts?: string[];
    outputCol?: string;
  };
}
```

**Step 2: Run typecheck to verify no errors**

```bash
npm run typecheck
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add RecipeFieldConfig, RecipeParams, PrepRecipeParams, PrepRecipeResult types"
```

---

### Task 2: Update Client Types

**Files:**
- Modify: `src/client/types.ts`

**Step 1: Replace `"document-summarization"` with `"recipe"` in `PanelId`, add `RecipeDefinition`**

Replace the existing `PanelId` line:
```ts
export type PanelId = "tool-list" | "configure-ai-run" | "recipes-list" | "document-summarization";
```
With:
```ts
export type PanelId = "tool-list" | "configure-ai-run" | "recipes-list" | "recipe";
```

Then add after the existing interfaces:
```ts
export interface RecipeDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  panelId: PanelId;
  params?: unknown;
}
```

**Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: TypeScript will error on `sidebar-entry.ts` because it still imports `DocumentSummarizationPanel` and registers `"document-summarization"`. That is expected — it will be fixed in Task 11. If there are errors on other files, investigate.

**Step 3: Commit**

```bash
git add src/client/types.ts
git commit -m "feat: add 'recipe' to PanelId, add RecipeDefinition interface"
```

---

### Task 3: Sheet Helpers in `utils.ts`

**Files:**
- Modify: `src/server/utils.ts`
- Modify: `__tests__/utils.test.ts`

These helpers follow the `getAllFilesRecursive` pattern: they accept a GAS sheet object as a parameter rather than calling `SpreadsheetApp` globally, making them testable without GAS mocks.

**Step 1: Add failing tests to `__tests__/utils.test.ts`**

At the bottom of the file, add:

```ts
// ── findOrCreateColumn ──────────────────────────────────────────

describe("findOrCreateColumn", () => {
  function makeSheet(headers: string[]): GoogleAppsScript.Spreadsheet.Sheet {
    const values = [headers.map((h) => h)];
    return {
      getLastColumn: () => headers.length,
      getRange: jest.fn().mockImplementation((row: number, col: number, numRows?: number, numCols?: number) => {
        if (numRows === 1 && numCols !== undefined) {
          // getRange(1, 1, 1, lastCol) — reading headers
          return { getValues: () => values };
        }
        // getRange(1, newCol) — writing new header
        return { setValue: jest.fn() };
      }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
  }

  it("returns 1-based index of existing column", () => {
    const sheet = makeSheet(["Drive Link", "System Prompt", "Output"]);
    const { findOrCreateColumn } = require("@server/utils");
    expect(findOrCreateColumn(sheet, "System Prompt")).toBe(2);
  });

  it("appends new column and returns its 1-based index when not found", () => {
    const sheet = makeSheet(["Drive Link"]);
    const setValueMock = jest.fn();
    (sheet.getRange as jest.Mock).mockImplementation((row: number, col: number, numRows?: number, numCols?: number) => {
      if (numRows === 1 && numCols !== undefined) {
        return { getValues: () => [["Drive Link"]] };
      }
      return { setValue: setValueMock };
    });
    const { findOrCreateColumn } = require("@server/utils");
    const idx = findOrCreateColumn(sheet, "New Col");
    expect(idx).toBe(2);
    expect(setValueMock).toHaveBeenCalledWith("New Col");
  });
});

// ── writeColumn ─────────────────────────────────────────────────

describe("writeColumn", () => {
  it("writes values starting at row 2 using a single setValues call", () => {
    const setValuesMock = jest.fn();
    const sheet = {
      getRange: jest.fn().mockReturnValue({ setValues: setValuesMock }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    const { writeColumn } = require("@server/utils");
    writeColumn(sheet, 3, ["a", "b", "c"]);
    expect(sheet.getRange).toHaveBeenCalledWith(2, 3, 3, 1);
    expect(setValuesMock).toHaveBeenCalledWith([["a"], ["b"], ["c"]]);
  });
});
```

**Step 2: Run the new tests to verify they fail**

```bash
npx jest __tests__/utils.test.ts -t "findOrCreateColumn|writeColumn"
```
Expected: FAIL — `findOrCreateColumn is not a function` / `writeColumn is not a function`.

**Step 3: Add implementations to `src/server/utils.ts`**

Add at the bottom of `utils.ts`:

```ts
/**
 * Find a column by header title in row 1, or append a new one.
 * Returns the 1-based column index.
 */
export function findOrCreateColumn(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  title: string,
): number {
  const lastCol = sheet.getLastColumn();
  if (lastCol > 0) {
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0] as string[];
    const idx = headers.indexOf(title);
    if (idx !== -1) return idx + 1;
  }
  const newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(title);
  return newCol;
}

/**
 * Write an array of string values to a column starting at row 2.
 * Uses a single setValues() call for efficiency.
 */
export function writeColumn(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  colIdx: number,
  values: string[],
): void {
  sheet.getRange(2, colIdx, values.length, 1).setValues(values.map((v) => [v]));
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/utils.test.ts
```
Expected: all utils tests PASS.

**Step 5: Commit**

```bash
git add src/server/utils.ts __tests__/utils.test.ts
git commit -m "feat: add findOrCreateColumn and writeColumn helpers to utils"
```

---

### Task 4: `prepRecipe` Server Function

**Files:**
- Modify: `src/server/index.ts`
- Modify: `rollup.config.js`

`prepRecipe` uses SpreadsheetApp, so it belongs in `index.ts` alongside the other tool orchestrators. It is excluded from coverage collection (same as the other orchestrators — see `jest.config.cjs` `collectCoverageFrom`).

**Step 1: Add the import for new types and helpers at the top of `src/server/index.ts`**

Find the existing import line:
```ts
import {
  extractId,
  isValidDriveLink,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  resolveColumns,
} from "./utils";
```

Replace with:
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
} from "./utils";
import type { RunConfig, PrepRecipeParams, PrepRecipeResult } from "../shared/types";
```

Also remove `RunConfig` from the existing `import type` line if it's there separately.

**Step 2: Add `prepRecipe` at the bottom of `src/server/index.ts`, after the SIDEBAR DISPATCHER section**

```ts
// ==========================================
// 🥞 RECIPE PREP
// ==========================================

export function prepRecipe(params: PrepRecipeParams): PrepRecipeResult {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const colNames: PrepRecipeResult["colNames"] = {};
  let numRows = 1;

  if (params.driveFolder) {
    const folderId = extractId(params.driveFolder.url);
    const folder = DriveApp.getFolderById(folderId);
    const files: { url: string }[] = [];
    getAllFilesRecursive(folder, files);
    numRows = files.length || 1;
    const col = findOrCreateColumn(sheet, params.driveFolder.colTitle);
    writeColumn(sheet, col, files.map((f) => f.url));
    colNames.driveLink = params.driveFolder.colTitle;
  }

  if (params.systemPrompt) {
    const col = findOrCreateColumn(sheet, params.systemPrompt.colTitle);
    writeColumn(sheet, col, Array(numRows).fill(params.systemPrompt.value) as string[]);
    colNames.systemPrompt = params.systemPrompt.colTitle;
  }

  if (params.userPrompts) {
    colNames.userPrompts = [];
    for (const up of params.userPrompts) {
      const col = findOrCreateColumn(sheet, up.colTitle);
      writeColumn(sheet, col, Array(numRows).fill(up.value) as string[]);
      colNames.userPrompts.push(up.colTitle);
    }
  }

  if (params.outputCol) {
    findOrCreateColumn(sheet, params.outputCol.colTitle);
    colNames.outputCol = params.outputCol.colTitle;
  }

  SpreadsheetApp.flush();

  return {
    rowRange: { start: 2, end: 2 + numRows - 1 },
    colNames,
  };
}
```

**Step 3: Add global stub to `rollup.config.js` footer**

In `rollup.config.js`, find the `footer` string in the server bundle config. It contains lines like:
```js
function onOpen(e) { _GASEntry.onOpen(e); }
```

Add at the end of the footer stubs:
```js
function prepRecipe(params) { return _GASEntry.prepRecipe(params); }
```

**Step 4: Run typecheck and build**

```bash
npm run typecheck && npm run build
```
Expected: no errors, `dist/` regenerated.

**Step 5: Commit**

```bash
git add src/server/index.ts rollup.config.js
git commit -m "feat: add prepRecipe server function and rollup global stub"
```

---

### Task 5: `services.prepRecipe` Client Wrapper

**Files:**
- Modify: `src/client/services.ts`
- Modify: `__tests__/services.test.ts`

**Step 1: Add `prepRecipe` to `mockRun` in `__tests__/services.test.ts`**

Find the `mockRun` object at the top of the test file and add `prepRecipe: jest.fn()`:

```ts
const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
  runTool: jest.fn(),
  prepRecipe: jest.fn(),   // ← add this
};
```

**Step 2: Add failing tests at the bottom of `__tests__/services.test.ts`**

```ts
describe("prepRecipe", () => {
  it("calls google.script.run.prepRecipe with params and resolves with result", async () => {
    const handlers = captureHandlers();
    const params: import("../src/shared/types").PrepRecipeParams = {
      driveFolder: { url: "https://drive.google.com/folder/abc", colTitle: "Drive Link" },
      outputCol: { colTitle: "AI_Summarization" },
    };
    const result: import("../src/shared/types").PrepRecipeResult = {
      rowRange: { start: 2, end: 5 },
      colNames: { driveLink: "Drive Link", outputCol: "AI_Summarization" },
    };
    const promise = services.prepRecipe(params);
    handlers.resolve(result);
    await expect(promise).resolves.toEqual(result);
    expect(mockRun.prepRecipe).toHaveBeenCalledWith(params);
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.prepRecipe({});
    handlers.reject(new Error("prep error"));
    await expect(promise).rejects.toThrow("prep error");
  });
});
```

**Step 3: Run the new tests to verify they fail**

```bash
npx jest __tests__/services.test.ts -t "prepRecipe"
```
Expected: FAIL — `services.prepRecipe is not a function`.

**Step 4: Add `prepRecipe` to `src/client/services.ts`**

Add after the existing `runTool` export:

```ts
export function prepRecipe(
  params: import("../shared/types").PrepRecipeParams,
): Promise<import("../shared/types").PrepRecipeResult> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) =>
        resolve(result as import("../shared/types").PrepRecipeResult),
      )
      .withFailureHandler((err: Error) => reject(err))
      .prepRecipe(params);
  });
}
```

Or add the imports at the top of `services.ts` and use named types:

```ts
import type { RunConfig, PrepRecipeParams, PrepRecipeResult } from "../shared/types";
```

Then:

```ts
export function prepRecipe(params: PrepRecipeParams): Promise<PrepRecipeResult> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) => resolve(result as PrepRecipeResult))
      .withFailureHandler((err: Error) => reject(err))
      .prepRecipe(params);
  });
}
```

Also add `prepRecipe` to the `google.d.ts` type stub so TypeScript doesn't complain about `google.script.run.prepRecipe`. Open `src/client/google.d.ts` and add `prepRecipe(params: unknown): void;` inside the `run` interface.

**Step 5: Run tests to verify they pass**

```bash
npx jest __tests__/services.test.ts
```
Expected: all services tests PASS.

**Step 6: Commit**

```bash
git add src/client/services.ts src/client/google.d.ts __tests__/services.test.ts
git commit -m "feat: add prepRecipe service wrapper"
```

---

### Task 6: Add `onUnlock` Callback to `LockableField`

**Files:**
- Modify: `src/client/components/lockable-field.ts`
- Modify: `__tests__/components/lockable-field.test.ts`

**Step 1: Add a failing test to the existing `lockable-field.test.ts`**

Find the existing test file and add a new `describe` block at the bottom:

```ts
describe("onUnlock callback", () => {
  it("calls onUnlock when the unlock button is clicked", () => {
    const container = document.createElement("div");
    const onUnlock = jest.fn();
    new LockableField(container, {
      label: "Test",
      defaultValue: "hello",
      locked: true,
      onUnlock,
    });
    const btn = container.querySelector<HTMLButtonElement>(".unlock-btn")!;
    btn.click();
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it("does not error when onUnlock is not provided", () => {
    const container = document.createElement("div");
    new LockableField(container, { label: "Test", defaultValue: "hello" });
    const btn = container.querySelector<HTMLButtonElement>(".unlock-btn")!;
    expect(() => btn.click()).not.toThrow();
  });
});
```

**Step 2: Run the new tests to verify they fail**

```bash
npx jest __tests__/components/lockable-field.test.ts -t "onUnlock"
```
Expected: FAIL.

**Step 3: Update `LockableFieldConfig` and the unlock button listener in `lockable-field.ts`**

Add `onUnlock` to `LockableFieldConfig`:

```ts
export interface LockableFieldConfig {
  label: string;
  defaultValue: string;
  locked?: boolean;
  placeholder?: string;
  multiline?: boolean;
  onUnlock?: () => void;   // ← add this
}
```

In the `render` method, update the `unlockBtn` click listener to also call `config.onUnlock?.()`:

```ts
unlockBtn.addEventListener("click", () => {
  this.locked = !this.locked;
  input.disabled = this.locked;
  unlockBtn.textContent = this.locked ? "🔒 Edit" : "🔓 Lock";
  if (!this.locked) config.onUnlock?.();
});
```

**Step 4: Run all lockable-field tests**

```bash
npx jest __tests__/components/lockable-field.test.ts
```
Expected: all PASS.

**Step 5: Commit**

```bash
git add src/client/components/lockable-field.ts __tests__/components/lockable-field.test.ts
git commit -m "feat: add onUnlock callback to LockableField"
```

---

### Task 7: `RecipePrepCook` Component

**Files:**
- Create: `src/client/components/recipe-prep-cook.ts`
- Create: `__tests__/components/recipe-prep-cook.test.ts`

**Step 1: Create the failing test file**

```ts
/**
 * @jest-environment jsdom
 */
import { RecipePrepCook } from "../../src/client/components/recipe-prep-cook";

function mount(config: ConstructorParameters<typeof RecipePrepCook>[1]) {
  const container = document.createElement("div");
  const component = new RecipePrepCook(container, config);
  return { container, component };
}

describe("idle state", () => {
  it("renders Prep enabled and Cook disabled", () => {
    const { container } = mount({ onPrep: jest.fn(), onCook: jest.fn() });
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    expect(prep.disabled).toBe(false);
    expect(prep.textContent).toBe("Prep Recipe");
    expect(cook.disabled).toBe(true);
  });
});

describe("prepping state", () => {
  it("disables Prep and shows Prepping... while onPrep is pending", async () => {
    let resolvePrep!: () => void;
    const onPrep = jest.fn(
      () => new Promise<void>((res) => { resolvePrep = res; }),
    );
    const { container } = mount({ onPrep, onCook: jest.fn() });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    expect(prep.disabled).toBe(true);
    expect(prep.textContent).toBe("Prepping...");
    resolvePrep();
  });
});

describe("prep-complete state", () => {
  async function mountPrepped(onCook = jest.fn()) {
    const onPrep = jest.fn().mockResolvedValue(undefined);
    const { container, component } = mount({ onPrep, onCook });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await Promise.resolve();
    await Promise.resolve();
    return { container, component, onCook };
  }

  it("enables Cook and shows Re-prep after onPrep resolves", async () => {
    const { container } = await mountPrepped();
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    expect(prep.disabled).toBe(false);
    expect(prep.textContent).toBe("Re-prep");
    expect(cook.disabled).toBe(false);
  });

  it("isPrepComplete returns true", async () => {
    const { component } = await mountPrepped();
    expect(component.isPrepComplete()).toBe(true);
  });

  it("calls onCook when Cook is clicked (sync)", async () => {
    const { container, onCook } = await mountPrepped();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(onCook).toHaveBeenCalledTimes(1);
  });

  it("does not enter cooking state when onCook is synchronous", async () => {
    const { container } = await mountPrepped(jest.fn(() => undefined));
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    // remains in prep-complete (cook is still enabled)
    expect(cook.disabled).toBe(false);
  });
});

describe("cooking state", () => {
  it("disables both buttons when onCook returns a Promise", async () => {
    const onPrep = jest.fn().mockResolvedValue(undefined);
    let resolveCook!: () => void;
    const onCook = jest.fn(
      () => new Promise<void>((res) => { resolveCook = res; }),
    );
    const { container } = mount({ onPrep, onCook });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await Promise.resolve();
    await Promise.resolve();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    expect(prep.disabled).toBe(true);
    expect(cook.disabled).toBe(true);
    expect(cook.textContent).toBe("Cooking...");
    resolveCook();
  });
});

describe("error handling", () => {
  it("returns to idle and shows alert when onPrep rejects", async () => {
    const alertMock = jest.fn();
    globalThis.alert = alertMock;
    const onPrep = jest.fn().mockRejectedValue(new Error("prep failed"));
    const { container, component } = mount({ onPrep, onCook: jest.fn() });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(alertMock).toHaveBeenCalledWith("Error: prep failed");
    expect(component.isPrepComplete()).toBe(false);
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    expect(prep.disabled).toBe(false);
    expect(prep.textContent).toBe("Prep Recipe");
  });
});

describe("reset()", () => {
  it("returns to idle and disables Cook", async () => {
    const onPrep = jest.fn().mockResolvedValue(undefined);
    const { container, component } = mount({ onPrep, onCook: jest.fn() });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await Promise.resolve();
    await Promise.resolve();
    component.reset();
    const prep = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    expect(prep.textContent).toBe("Prep Recipe");
    expect(cook.disabled).toBe(true);
    expect(component.isPrepComplete()).toBe(false);
  });
});

describe("initialState restoration", () => {
  it("mounts in prep-complete state when prepComplete: true", () => {
    const { container, component } = mount({
      onPrep: jest.fn(),
      onCook: jest.fn(),
      prepComplete: true,
    });
    const cook = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    expect(cook.disabled).toBe(false);
    expect(component.isPrepComplete()).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/components/recipe-prep-cook.test.ts
```
Expected: FAIL — module not found.

**Step 3: Create `src/client/components/recipe-prep-cook.ts`**

```ts
export interface RecipePrepCookConfig {
  onPrep: () => Promise<void>;
  onCook: () => void | Promise<void>;
  prepComplete?: boolean;
}

export class RecipePrepCook {
  private prepComplete: boolean;
  private prepBtn!: HTMLButtonElement;
  private cookBtn!: HTMLButtonElement;

  constructor(container: HTMLElement, config: RecipePrepCookConfig) {
    this.prepComplete = config.prepComplete ?? false;
    this.render(container, config);
  }

  isPrepComplete(): boolean {
    return this.prepComplete;
  }

  reset(): void {
    this.prepComplete = false;
    this.setIdle();
  }

  private render(container: HTMLElement, config: RecipePrepCookConfig): void {
    container.innerHTML = `
      <div class="panel-buttons">
        <button id="prep-btn" class="btn-prep">Prep Recipe</button>
        <button id="cook-btn" class="btn-cook" disabled>Cook</button>
      </div>
    `;
    this.prepBtn = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    this.cookBtn = container.querySelector<HTMLButtonElement>("#cook-btn")!;

    if (this.prepComplete) this.setPrepComplete();

    this.prepBtn.addEventListener("click", () => this.handlePrep(config.onPrep));
    this.cookBtn.addEventListener("click", () => this.handleCook(config.onCook));
  }

  private handlePrep(onPrep: () => Promise<void>): void {
    this.prepBtn.disabled = true;
    this.prepBtn.textContent = "Prepping...";
    this.cookBtn.disabled = true;

    onPrep().then(
      () => {
        this.prepComplete = true;
        this.setPrepComplete();
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.setIdle();
      },
    );
  }

  private handleCook(onCook: () => void | Promise<void>): void {
    const result = onCook();
    if (result instanceof Promise) {
      this.prepBtn.disabled = true;
      this.cookBtn.disabled = true;
      this.cookBtn.textContent = "Cooking...";
      result.then(
        () => this.setPrepComplete(),
        (err: Error) => {
          globalThis.alert("Error: " + err.message);
          this.setPrepComplete();
        },
      );
    }
  }

  private setIdle(): void {
    this.prepBtn.disabled = false;
    this.prepBtn.textContent = "Prep Recipe";
    this.cookBtn.disabled = true;
    this.cookBtn.textContent = "Cook";
  }

  private setPrepComplete(): void {
    this.prepBtn.disabled = false;
    this.prepBtn.textContent = "Re-prep";
    this.cookBtn.disabled = false;
    this.cookBtn.textContent = "Cook";
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/components/recipe-prep-cook.test.ts
```
Expected: all PASS.

**Step 5: Commit**

```bash
git add src/client/components/recipe-prep-cook.ts __tests__/components/recipe-prep-cook.test.ts
git commit -m "feat: add RecipePrepCook component with prep/cook state machine"
```

---

### Task 8: RECIPES Registry

**Files:**
- Create: `src/client/recipes.ts`

No tests needed — this is a pure data file. Correctness is enforced by `satisfies RecipeParams` at compile time.

**Step 1: Create `src/client/recipes.ts`**

```ts
import type { RecipeDefinition } from "./types";
import type { RecipeParams } from "../shared/types";

export const RECIPES: RecipeDefinition[] = [
  {
    id: "document-summarization",
    name: "Document Summarization",
    icon: "📄",
    description: "Summarize each file in a Google Drive folder",
    panelId: "recipe",
    params: {
      driveFolder: {
        colTitle: "Drive Link",
        helperText: "Make sure you have access to this folder",
      },
      systemPrompt: {
        colTitle: { value: "System Prompt", locked: true },
        prompt: {
          value:
            "You are an expert document analyst. Produce clear, structured summaries " +
            "focusing on key themes, main arguments, important data points, and actionable conclusions.",
          locked: true,
        },
      },
      userPrompts: [
        {
          colTitle: { value: "User Prompt", locked: true },
          prompt: {
            value:
              "Please summarize the attached document. Include the main topics, key findings, " +
              "and important conclusions. The document file will be attached as inline data.",
            locked: true,
          },
        },
      ],
      outputCol: {
        colTitle: { value: "AI_Summarization", locked: true },
      },
    } satisfies RecipeParams,
  },
];
```

**Step 2: Run typecheck**

```bash
npm run typecheck
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/client/recipes.ts
git commit -m "feat: add RECIPES registry with Document Summarization entry"
```

---

### Task 9: `RecipePanel`

**Files:**
- Create: `src/client/panels/recipe.ts`
- Create: `__tests__/panels/recipe.test.ts`

This is the most complex task. The panel renders conditionally based on `RecipeParams`, delegates button state to `RecipePrepCook`, and assembles `preppedRunConfig` entirely from `PrepRecipeResult`.

**Step 1: Create the failing test file `__tests__/panels/recipe.test.ts`**

```ts
/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import { RecipePanel } from "../../src/client/panels/recipe";
import * as services from "../../src/client/services";
import type { RecipeParams, PrepRecipeResult } from "../../src/shared/types";
import type { NavigationContext } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return {
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  };
}

function mount(params: RecipeParams, savedState?: unknown) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipePanel();
  panel.mount(container, nav, params, savedState as never);
  return { container, nav, panel };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

// ── rendering ───────────────────────────────────────────────────

describe("rendering", () => {
  it("renders drive folder input when driveFolder param present", () => {
    const { container } = mount({ driveFolder: { colTitle: "Drive Link" } });
    expect(container.querySelector("#drive-folder-input")).not.toBeNull();
  });

  it("does not render drive folder input when driveFolder absent", () => {
    const { container } = mount({});
    expect(container.querySelector("#drive-folder-input")).toBeNull();
  });

  it("renders system prompt fields when systemPrompt param present", () => {
    const { container } = mount({
      systemPrompt: {
        colTitle: { value: "System Prompt", locked: true },
        prompt: { value: "You are helpful.", locked: true },
      },
    });
    expect(container.querySelector("#system-prompt-title-container")).not.toBeNull();
    expect(container.querySelector("#system-prompt-value-container")).not.toBeNull();
  });

  it("renders one user prompt section per userPrompts entry", () => {
    const { container } = mount({
      userPrompts: [
        { colTitle: { value: "User Prompt", locked: true }, prompt: { value: "Summarize.", locked: true } },
        { colTitle: { value: "User Prompt 2", locked: true }, prompt: { value: "Also this.", locked: true } },
      ],
    });
    expect(container.querySelector("#user-prompt-title-0-container")).not.toBeNull();
    expect(container.querySelector("#user-prompt-title-1-container")).not.toBeNull();
  });
});

// ── LockableField defaults ────────────────────────────────────────

describe("LockableField defaults", () => {
  it("initialises fields with locked: true values from params", () => {
    const { container } = mount({
      outputCol: { colTitle: { value: "AI_Summarization", locked: true } },
    });
    const input = container.querySelector<HTMLInputElement>("#output-col-title-container input")!;
    expect(input.value).toBe("AI_Summarization");
    expect(input.disabled).toBe(true);
  });

  it("initialises fields with locked: false as unlocked", () => {
    const { container } = mount({
      outputCol: { colTitle: { value: "AI_Output", locked: false } },
    });
    const input = container.querySelector<HTMLInputElement>("#output-col-title-container input")!;
    expect(input.disabled).toBe(false);
  });
});

// ── prep flow ──────────────────────────────────────────────────

describe("Prep flow", () => {
  const fullParams: RecipeParams = {
    driveFolder: { colTitle: "Drive Link", helperText: "Check access" },
    systemPrompt: {
      colTitle: { value: "System Prompt", locked: true },
      prompt: { value: "You are helpful.", locked: true },
    },
    userPrompts: [
      { colTitle: { value: "User Prompt", locked: true }, prompt: { value: "Summarize.", locked: true } },
    ],
    outputCol: { colTitle: { value: "AI_Out", locked: true } },
  };

  const mockResult: PrepRecipeResult = {
    rowRange: { start: 2, end: 11 },
    colNames: {
      driveLink: "Drive Link",
      systemPrompt: "System Prompt",
      userPrompts: ["User Prompt"],
      outputCol: "AI_Out",
    },
  };

  it("calls services.prepRecipe with resolved form values", async () => {
    mockPrepRecipe.mockResolvedValue(mockResult);
    const { container } = mount(fullParams);
    container.querySelector<HTMLInputElement>("#drive-folder-input")!.value =
      "https://drive.google.com/drive/folders/abc123";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        driveFolder: expect.objectContaining({ colTitle: "Drive Link" }),
        systemPrompt: { colTitle: "System Prompt", value: "You are helpful." },
        userPrompts: [{ colTitle: "User Prompt", value: "Summarize." }],
        outputCol: { colTitle: "AI_Out" },
      }),
    );
  });

  it("shows alert and does not proceed if drive folder is empty", async () => {
    const alertMock = jest.fn();
    globalThis.alert = alertMock;
    const { container } = mount(fullParams);
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(alertMock).toHaveBeenCalledWith(
      expect.stringContaining("folder"),
    );
    expect(mockPrepRecipe).not.toHaveBeenCalled();
  });
});

// ── Cook flow ──────────────────────────────────────────────────

describe("Cook flow", () => {
  it("navigates to configure-ai-run with preppedRunConfig assembled from PrepRecipeResult", async () => {
    const result: PrepRecipeResult = {
      rowRange: { start: 2, end: 5 },
      colNames: {
        driveLink: "Drive Link",
        systemPrompt: "Sys",
        userPrompts: ["User"],
        outputCol: "Out",
      },
    };
    mockPrepRecipe.mockResolvedValue(result);
    const { container, nav } = mount({
      driveFolder: { colTitle: "Drive Link" },
      systemPrompt: {
        colTitle: { value: "Sys", locked: true },
        prompt: { value: "p", locked: true },
      },
      userPrompts: [
        { colTitle: { value: "User", locked: true }, prompt: { value: "q", locked: true } },
      ],
      outputCol: { colTitle: { value: "Out", locked: true } },
    });
    container.querySelector<HTMLInputElement>("#drive-folder-input")!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith("configure-ai-run", {
      driveFileCols: ["Drive Link"],
      systemPromptCol: "Sys",
      userPromptCols: ["User"],
      outputCol: "Out",
      rowRange: { start: 2, end: 5 },
    });
  });
});

// ── saved state ────────────────────────────────────────────────

describe("unmount / saved state", () => {
  it("unmount returns form values and prepComplete: false when not prepped", () => {
    const { container, panel } = mount({
      driveFolder: { colTitle: "Drive Link" },
      outputCol: { colTitle: { value: "AI_Out", locked: true } },
    });
    container.querySelector<HTMLInputElement>("#drive-folder-input")!.value = "my-folder";
    const state = panel.unmount();
    expect(state).toMatchObject({
      driveFolderValue: "my-folder",
      prepComplete: false,
    });
  });

  it("mounts with savedState — restores form values", () => {
    const savedState = {
      driveFolderValue: "restored-folder",
      outputColTitle: "MyOutput",
      prepComplete: false,
    };
    const { container } = mount(
      { driveFolder: { colTitle: "Drive Link" }, outputCol: { colTitle: { value: "AI_Out", locked: true } } },
      savedState,
    );
    expect(container.querySelector<HTMLInputElement>("#drive-folder-input")!.value).toBe("restored-folder");
  });

  it("mounts with savedState prepComplete: true — Cook is enabled", () => {
    const savedState = {
      prepComplete: true,
      preppedRunConfig: { outputCol: "Out", userPromptCols: ["User"] },
    };
    const { container } = mount({ outputCol: { colTitle: { value: "Out", locked: true } } }, savedState);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/panels/recipe.test.ts
```
Expected: FAIL — module not found.

**Step 3: Create `src/client/panels/recipe.ts`**

```ts
import type { NavigationContext, Panel } from "../types";
import type { RecipeParams, PrepRecipeParams, PrepRecipeResult, RunConfig } from "../../shared/types";
import { LockableField } from "../components/lockable-field";
import { RecipePrepCook } from "../components/recipe-prep-cook";
import { prepRecipe } from "../services";

type SavedState = {
  driveFolderValue?: string;
  systemPromptTitle?: string;
  systemPromptValue?: string;
  userPromptTitles?: string[];
  userPromptValues?: string[];
  outputColTitle?: string;
  prepComplete: boolean;
  preppedRunConfig?: Partial<RunConfig>;
};

export class RecipePanel implements Panel<RecipeParams, SavedState> {
  private nav: NavigationContext | null = null;
  private params: RecipeParams | null = null;
  private prepCook: RecipePrepCook | null = null;
  private preppedRunConfig: Partial<RunConfig> | null = null;
  private driveFolderInput: HTMLInputElement | null = null;

  private fields: {
    systemPromptTitle?: LockableField;
    systemPromptValue?: LockableField;
    userPromptTitles: LockableField[];
    userPromptValues: LockableField[];
    outputColTitle?: LockableField;
  } = { userPromptTitles: [], userPromptValues: [] };

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    params?: RecipeParams,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.params = params ?? {};
    this.fields = { userPromptTitles: [], userPromptValues: [] };
    this.preppedRunConfig = savedState?.preppedRunConfig ?? null;

    container.innerHTML = this.template(this.params);

    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());

    this.mountFields(container, this.params, savedState);
    this.mountPrepCook(container, savedState?.prepComplete ?? false);
  }

  unmount(): SavedState {
    return {
      driveFolderValue: this.driveFolderInput?.value,
      systemPromptTitle: this.fields.systemPromptTitle?.getValue(),
      systemPromptValue: this.fields.systemPromptValue?.getValue(),
      userPromptTitles: this.fields.userPromptTitles.map((f) => f.getValue()),
      userPromptValues: this.fields.userPromptValues.map((f) => f.getValue()),
      outputColTitle: this.fields.outputColTitle?.getValue(),
      prepComplete: this.prepCook?.isPrepComplete() ?? false,
      preppedRunConfig: this.preppedRunConfig ?? undefined,
    };
  }

  private mountFields(
    container: HTMLElement,
    params: RecipeParams,
    savedState?: SavedState,
  ): void {
    const reset = () => this.prepCook?.reset();

    if (params.driveFolder) {
      this.driveFolderInput = container.querySelector<HTMLInputElement>("#drive-folder-input");
      if (savedState?.driveFolderValue && this.driveFolderInput) {
        this.driveFolderInput.value = savedState.driveFolderValue;
      }
      this.driveFolderInput?.addEventListener("input", reset);
    }

    if (params.systemPrompt) {
      this.fields.systemPromptTitle = new LockableField(
        container.querySelector("#system-prompt-title-container")!,
        {
          label: "Column Title",
          defaultValue: savedState?.systemPromptTitle ?? params.systemPrompt.colTitle.value,
          locked: params.systemPrompt.colTitle.locked,
          onUnlock: reset,
        },
      );
      this.fields.systemPromptValue = new LockableField(
        container.querySelector("#system-prompt-value-container")!,
        {
          label: "Prompt",
          defaultValue: savedState?.systemPromptValue ?? params.systemPrompt.prompt.value,
          locked: params.systemPrompt.prompt.locked,
          multiline: true,
          onUnlock: reset,
        },
      );
    }

    if (params.userPrompts) {
      params.userPrompts.forEach((up, i) => {
        this.fields.userPromptTitles[i] = new LockableField(
          container.querySelector(`#user-prompt-title-${i}-container`)!,
          {
            label: "Column Title",
            defaultValue: savedState?.userPromptTitles?.[i] ?? up.colTitle.value,
            locked: up.colTitle.locked,
            onUnlock: reset,
          },
        );
        this.fields.userPromptValues[i] = new LockableField(
          container.querySelector(`#user-prompt-value-${i}-container`)!,
          {
            label: "Prompt",
            defaultValue: savedState?.userPromptValues?.[i] ?? up.prompt.value,
            locked: up.prompt.locked,
            multiline: true,
            onUnlock: reset,
          },
        );
      });
    }

    if (params.outputCol) {
      this.fields.outputColTitle = new LockableField(
        container.querySelector("#output-col-title-container")!,
        {
          label: "Output Column Name",
          defaultValue: savedState?.outputColTitle ?? params.outputCol.colTitle.value,
          locked: params.outputCol.colTitle.locked,
          onUnlock: reset,
        },
      );
    }
  }

  private mountPrepCook(container: HTMLElement, prepComplete: boolean): void {
    this.prepCook = new RecipePrepCook(container.querySelector("#prep-cook-container")!, {
      onPrep: () => {
        const params = this.buildPrepParams();
        if (!params) return Promise.reject(new Error("cancelled"));
        return prepRecipe(params).then((result: PrepRecipeResult) => {
          this.preppedRunConfig = this.buildRunConfig(result);
        });
      },
      onCook: () => {
        if (this.preppedRunConfig) {
          this.nav?.navigate("configure-ai-run", this.preppedRunConfig);
        }
      },
      prepComplete,
    });
  }

  private buildPrepParams(): PrepRecipeParams | null {
    const params = this.params!;
    const result: PrepRecipeParams = {};

    if (params.driveFolder) {
      const url = this.driveFolderInput?.value.trim() ?? "";
      if (!url) {
        globalThis.alert("Please enter a Google Drive folder link.");
        return null;
      }
      result.driveFolder = { url, colTitle: params.driveFolder.colTitle };
    }

    if (params.systemPrompt) {
      result.systemPrompt = {
        colTitle: this.fields.systemPromptTitle?.getValue() ?? params.systemPrompt.colTitle.value,
        value: this.fields.systemPromptValue?.getValue() ?? params.systemPrompt.prompt.value,
      };
    }

    if (params.userPrompts) {
      result.userPrompts = params.userPrompts.map((up, i) => ({
        colTitle: this.fields.userPromptTitles[i]?.getValue() ?? up.colTitle.value,
        value: this.fields.userPromptValues[i]?.getValue() ?? up.prompt.value,
      }));
    }

    if (params.outputCol) {
      result.outputCol = {
        colTitle: this.fields.outputColTitle?.getValue() ?? params.outputCol.colTitle.value,
      };
    }

    return result;
  }

  private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
    return {
      driveFileCols: result.colNames.driveLink ? [result.colNames.driveLink] : undefined,
      systemPromptCol: result.colNames.systemPrompt,
      userPromptCols: result.colNames.userPrompts ?? [],
      outputCol: result.colNames.outputCol ?? "",
      rowRange: result.rowRange,
    };
  }

  private template(params: RecipeParams): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">Recipe</span>
      </div>
      ${
        params.driveFolder
          ? `
        <div class="field-group">
          <span class="field-label">Google Drive Folder Link <span class="required">*</span></span>
          ${params.driveFolder.helperText ? `<p class="field-helper">${params.driveFolder.helperText}</p>` : ""}
          <input id="drive-folder-input" type="text" class="text-input"
            placeholder="Paste Google Drive folder URL or ID" />
        </div>`
          : ""
      }
      ${
        params.systemPrompt
          ? `
        <div class="field-group">
          <span class="field-label">System Prompt</span>
          <div id="system-prompt-title-container"></div>
          <div id="system-prompt-value-container"></div>
        </div>`
          : ""
      }
      ${(params.userPrompts ?? [])
        .map(
          (_, i) => `
        <div class="field-group">
          <span class="field-label">User Prompt</span>
          <div id="user-prompt-title-${i}-container"></div>
          <div id="user-prompt-value-${i}-container"></div>
        </div>`,
        )
        .join("")}
      ${
        params.outputCol
          ? `
        <div class="field-group">
          <span class="field-label">Output Column</span>
          <div id="output-col-title-container"></div>
        </div>`
          : ""
      }
      <div id="prep-cook-container"></div>
    `;
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/panels/recipe.test.ts
```
Expected: all PASS. If any fail, check that the container IDs in `template()` match the IDs queried in `mountFields()` and in the tests.

**Step 5: Commit**

```bash
git add src/client/panels/recipe.ts __tests__/panels/recipe.test.ts
git commit -m "feat: add generic RecipePanel driven by RecipeParams"
```

---

### Task 10: `RecipesListPanel`

**Files:**
- Modify: `src/client/panels/recipes-list.ts`
- Create: `__tests__/panels/recipes-list.test.ts`

**Step 1: Create failing test file `__tests__/panels/recipes-list.test.ts`**

```ts
/**
 * @jest-environment jsdom
 */

// Mock RECIPES before importing the panel
jest.mock("../../src/client/recipes", () => ({
  RECIPES: [
    {
      id: "doc-sum",
      name: "Document Summarization",
      icon: "📄",
      description: "Summarize files",
      panelId: "recipe",
      params: { driveFolder: { colTitle: "Drive Link" } },
    },
    {
      id: "custom",
      name: "Custom Recipe",
      icon: "🔧",
      description: "Custom",
      panelId: "recipe",
      params: {},
    },
  ],
}));

import { RecipesListPanel } from "../../src/client/panels/recipes-list";
import type { NavigationContext } from "../../src/client/types";

function makeNav(): jest.Mocked<NavigationContext> {
  return {
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  };
}

function mount() {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipesListPanel();
  panel.mount(container, nav);
  return { container, nav, panel };
}

describe("RecipesListPanel", () => {
  it("renders one button per RECIPES entry", () => {
    const { container } = mount();
    expect(container.querySelector("#btn-doc-sum")).not.toBeNull();
    expect(container.querySelector("#btn-custom")).not.toBeNull();
  });

  it("clicking a recipe button calls nav.navigate with correct panelId and params", () => {
    const { container, nav } = mount();
    container.querySelector<HTMLButtonElement>("#btn-doc-sum")!.click();
    expect(nav.navigate).toHaveBeenCalledWith("recipe", { driveFolder: { colTitle: "Drive Link" } });
  });

  it("clicking back calls nav.back()", () => {
    const { container, nav } = mount();
    container.querySelector<HTMLButtonElement>("#back-btn")!.click();
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  it("unmount returns undefined", () => {
    const { panel } = mount();
    expect(panel.unmount()).toBeUndefined();
  });
});
```

**Step 2: Run the tests to verify they fail**

```bash
npx jest __tests__/panels/recipes-list.test.ts
```
Expected: FAIL.

**Step 3: Replace `src/client/panels/recipes-list.ts` with data-driven implementation**

```ts
import type { NavigationContext, Panel } from "../types";
import { RECIPES } from "../recipes";

export class RecipesListPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = this.template();
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    RECIPES.forEach((recipe) => {
      container
        .querySelector(`#btn-${recipe.id}`)
        ?.addEventListener("click", () => nav.navigate(recipe.panelId, recipe.params));
    });
  }

  unmount(): undefined {
    return undefined;
  }

  private template(): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">🥞 Recipes</span>
      </div>
      <div class="section">
        ${RECIPES.map(
          (r) => `
          <button id="btn-${r.id}" class="tool-btn">
            <span class="icon">${r.icon}</span> ${r.name}
            <span class="tool-btn-sub">${r.description}</span>
          </button>`,
        ).join("")}
      </div>
    `;
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/panels/recipes-list.test.ts
```
Expected: all PASS.

**Step 5: Commit**

```bash
git add src/client/panels/recipes-list.ts __tests__/panels/recipes-list.test.ts
git commit -m "feat: replace RecipesListPanel stub with data-driven RECIPES implementation"
```

---

### Task 11: Update `sidebar-entry.ts` and Delete Stub

**Files:**
- Modify: `src/client/sidebar-entry.ts`
- Delete: `src/client/panels/recipes/document-summarization.ts`

**Step 1: Update `src/client/sidebar-entry.ts`**

Replace:
```ts
import { DocumentSummarizationPanel } from "./panels/recipes/document-summarization";
```
With:
```ts
import { RecipePanel } from "./panels/recipe";
```

Replace:
```ts
["document-summarization", new DocumentSummarizationPanel()],
```
With:
```ts
["recipe", new RecipePanel()],
```

**Step 2: Delete the stub file**

```bash
rm src/client/panels/recipes/document-summarization.ts
```

If `src/client/panels/recipes/` is now empty, remove the directory too:

```bash
rmdir src/client/panels/recipes
```

**Step 3: Run typecheck and full test suite**

```bash
npm run typecheck && npm test
```
Expected: no type errors, all tests PASS.

**Step 4: Commit**

```bash
git add src/client/sidebar-entry.ts
git rm src/client/panels/recipes/document-summarization.ts
git commit -m "feat: register RecipePanel in router; remove DocumentSummarizationPanel stub"
```

---

### Task 12: Coverage Thresholds and Final Verification

**Files:**
- Modify: `jest.config.cjs`

**Step 1: Add coverage thresholds for new client files**

In `jest.config.cjs`, add inside `coverageThreshold`:

```js
"./src/client/components/recipe-prep-cook.ts": {
  statements: 85,
  branches: 75,
  functions: 100,
},
"./src/client/panels/recipe.ts": {
  statements: 80,
  branches: 65,
  functions: 90,
},
"./src/client/panels/recipes-list.ts": {
  statements: 85,
  branches: 75,
  functions: 100,
},
```

`src/client/recipes.ts` is a pure data file (interfaces + array literal) — no branching logic to threshold.

**Step 2: Run coverage to verify thresholds pass**

```bash
npm run test:coverage
```
Expected: all thresholds met, no failures.

**Step 3: Run lint and format check**

```bash
npm run lint && npm run format:check
```
Expected: no errors. Fix any lint issues with `npm run lint:fix` and format issues with `npm run format`.

**Step 4: Final commit**

```bash
git add jest.config.cjs
git commit -m "test: add coverage thresholds for recipe-prep-cook, recipe, recipes-list"
```

---

## Done

At this point:
- All 12 tasks are complete
- Full test suite passes with coverage thresholds met
- `feature/recipe-panels` branch is ready for review

Use `superpowers:finishing-a-development-branch` to decide how to integrate this work.
