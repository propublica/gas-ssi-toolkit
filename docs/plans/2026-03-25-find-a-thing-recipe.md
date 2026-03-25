# Find a Thing in a Thing — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the "Find a thing in a thing" recipe and overhaul the recipe type system with a columnar `ColumnSpec` model, unified `userPromptParts` in `RunConfig`, and `RecipeSettings` for non-column AI parameters.

**Architecture:** All changes cascade from `shared/types.ts` outward. `RunConfig.userPromptCols`/`driveFileCols` become `userPromptParts: Array<{kind, col}>`. `RecipeParams` becomes `{ columns: ColumnSpec[], settings?: RecipeSettings }`. `RecipePanel` is rewritten to render and process a `ColumnSpec[]` generically. `ConfigureAIRunPanel` gets a minimal wiring change — same UX, new data shape.

**Tech Stack:** TypeScript, Google Apps Script (V8), Rollup, Jest/ts-jest. No new dependencies.

**Design doc:** `docs/plans/2026-03-25-find-a-thing-recipe-design.md`
**Worktree:** `.worktrees/feature/find-a-thing-recipe`

---

## Task 1: Update `shared/types.ts`

Replace `userPromptCols`/`driveFileCols` in `RunConfig` with `userPromptParts`. Replace named fields in `PrepRecipeParams`/`PrepRecipeResult` with a `columns` array + `settings`. This breaks existing tests intentionally — they are fixed in subsequent tasks.

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Replace `RunConfig`**

```ts
export interface RunConfig {
  /**
   * Ordered parts of the user message. Each part references a column by header name.
   * Text parts are read as strings; file parts are fetched from Drive and encoded
   * as inline data. Order is preserved in the Gemini request.
   */
  userPromptParts: Array<{ kind: "text" | "file"; col: string }>;
  systemPromptCol?: string;
  outputCol: string;
  rowRange?: { start: number; end: number };
  tools?: ToolId[];
  includeGrounding?: boolean;
  applyMarkdown?: boolean;
}
```

**Step 2: Replace `PrepRecipeParams` and `PrepRecipeResult`**

```ts
export interface PrepRecipeParams {
  columns: Array<
    | { kind: "drive-file-folder";   colTitle: string; url: string }
    | { kind: "drive-file-constant"; colTitle: string; url: string }
    | { kind: "system-prompt";       colTitle: string; text: string }
    | { kind: "user-prompt";         colTitle: string; text: string }
    | { kind: "output";              colTitle: string }
  >;
  /**
   * Non-column settings echoed back in PrepRecipeResult without server processing.
   * Preserves single-source-of-truth for RunConfig assembly on the client.
   */
  settings?: {
    tools?: ToolId[];
    applyMarkdown?: boolean;
    includeGrounding?: boolean;
  };
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
  /**
   * Columns as written to the sheet, in the same order as PrepRecipeParams.columns.
   * The client assembles RunConfig from this — it is the single source of truth.
   */
  columns: Array<{
    kind: "drive-file-folder" | "drive-file-constant" | "system-prompt" | "user-prompt" | "output";
    colTitle: string;
  }>;
  /** Echoed from PrepRecipeParams.settings — no server-side processing. */
  settings?: {
    tools?: ToolId[];
    applyMarkdown?: boolean;
    includeGrounding?: boolean;
  };
}
```

**Step 3: Remove old `ImportDriveLinksConfig` and `ExtractTextConfig` are unchanged — leave them.**

**Step 4: Run typecheck to see cascading errors**

```bash
cd .worktrees/feature/find-a-thing-recipe
npm run typecheck
```

Expected: multiple errors in `index.ts`, `inference.ts`, `configure-ai-run.ts`, `recipe.ts`, `recipes.ts`, `google.d.ts`. This is expected — each is fixed in its own task.

**Step 5: Commit**

```bash
git add src/shared/types.ts
git commit -m "refactor(types): replace userPromptCols/driveFileCols with userPromptParts in RunConfig; columnar PrepRecipeParams/PrepRecipeResult"
```

---

## Task 2: Update `server/inference.ts`

Change `runInference` to accept ordered `userPromptParts` instead of separate `userPrompts` + `driveLinks` params.

**Files:**
- Modify: `src/server/inference.ts`
- Modify: `__tests__/inference.test.ts`

**Step 1: Write failing tests**

Open `__tests__/inference.test.ts`. Replace call sites that use the old `(userPrompts, driveLinks, systemPrompt, tools)` signature. The key behaviors to test:

```ts
// Test: text parts become userTexts, file parts become inlineData
it("separates text and file parts and preserves order", () => {
  mockFetch.mockReturnValue(validResponse);
  mockDriveApp.getFileById.mockReturnValue({ getBlob: () => mockBlob });

  runInference(
    [
      { kind: "text", value: "describe this" },
      { kind: "file", value: "https://drive.google.com/file/d/abc123/view" },
      { kind: "text", value: "is it relevant?" },
    ],
    "you are an analyst",
  );

  const payload = JSON.parse(mockFetch.mock.calls[0][1].payload);
  expect(payload.contents[0].parts[0].text).toBe("describe this");
  expect(payload.contents[0].parts[1].inlineData).toBeDefined();
  expect(payload.contents[0].parts[2].text).toBe("is it relevant?");
});

// Test: returns null when all text parts are empty
it("returns null when no non-empty text parts", () => {
  const result = runInference([{ kind: "text", value: "" }]);
  expect(result).toBeNull();
});

// Test: file parts with invalid Drive links are silently filtered
it("silently filters invalid Drive links from file parts", () => {
  mockFetch.mockReturnValue(validResponse);
  runInference([
    { kind: "text", value: "prompt" },
    { kind: "file", value: "not-a-drive-link" },
  ]);
  expect(mockDriveApp.getFileById).not.toHaveBeenCalled();
});
```

Run tests to confirm they fail:
```bash
npm test -- --testPathPattern=inference
```

**Step 2: Update `runInference` implementation**

```ts
export function runInference(
  userPromptParts: Array<{ kind: "text" | "file"; value: unknown }>,
  systemPrompt?: unknown,
  tools?: ToolId[],
): GeminiResponse | null {
  const textParts = userPromptParts.filter((p) => p.kind === "text");
  const userTexts = textParts.flatMap((p) => flattenArg(p.value));
  if (userTexts.filter(Boolean).length === 0) return null;

  try {
    const fileParts = userPromptParts.filter((p) => p.kind === "file");
    const driveIds = fileParts
      .flatMap((p) => flattenArg(p.value))
      .filter(isValidDriveLink)
      .map(extractId);

    const inlineData =
      driveIds.length > 0 ? prepareDriveAttachments(driveIds) : [];

    return invokeGemini({
      systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
      userTexts,
      inlineData: inlineData.length ? inlineData : undefined,
      tools: tools?.length ? tools : undefined,
    });
  } catch (e) {
    return { text: "Error: " + (e as Error).message };
  }
}
```

**Step 3: Run inference tests**

```bash
npm test -- --testPathPattern=inference
```

Expected: all inference tests pass.

**Step 4: Commit**

```bash
git add src/server/inference.ts __tests__/inference.test.ts
git commit -m "refactor(inference): replace userPrompts/driveLinks params with userPromptParts array"
```

---

## Task 3: Update `server/index.ts` — `runBatchAI`

Update `runBatchAI` to build `userPromptParts` from `RunConfig` and pass to the new `runInference`.

**Files:**
- Modify: `src/server/index.ts`
- Modify: `__tests__/menu.test.ts`

**Step 1: Write failing test**

In `__tests__/menu.test.ts`, find the tests for `runBatchAI`. Update RunConfig fixtures to use `userPromptParts`. Example:

```ts
// Old fixture:
const config: RunConfig = {
  userPromptCols: ["Prompt"],
  driveFileCols: ["Drive Link"],
  outputCol: "Output",
};

// New fixture:
const config: RunConfig = {
  userPromptParts: [
    { kind: "text", col: "Prompt" },
    { kind: "file", col: "Drive Link" },
  ],
  outputCol: "Output",
};
```

Add a test asserting that parts are passed to runInference in the declared order:

```ts
it("passes userPromptParts to runInference in order", () => {
  const config: RunConfig = {
    userPromptParts: [
      { kind: "text", col: "Context" },
      { kind: "file", col: "Doc" },
      { kind: "text", col: "Question" },
    ],
    outputCol: "Output",
    rowRange: { start: 1, end: 1 },
  };
  // ... mock sheet values, call runBatchAI, assert runInference called with
  // parts in order: [{kind:"text",value:contextVal}, {kind:"file",value:docVal}, {kind:"text",value:questionVal}]
});
```

Run to confirm failure:
```bash
npm test -- --testPathPattern=menu
```

**Step 2: Update `runBatchAI` in `src/server/index.ts`**

Find the section that reads `userPromptCols` and `driveFileCols` per row. Replace with:

```ts
// Build parts for this row in declared order
const rowParts = config.userPromptParts.map((part) => ({
  kind: part.kind as "text" | "file",
  value: sheet.getRange(rowIndex, resolvedCols[part.col]).getValue(),
}));

const result = runInference(rowParts, systemPromptValue, config.tools);
```

Where `resolvedCols` is a pre-built `Record<string, number>` mapping column header → 1-based column index (built once before the row loop using the existing `resolveColumns` helper).

**Step 3: Run tests**

```bash
npm test -- --testPathPattern=menu
```

Expected: all menu/runBatchAI tests pass.

**Step 4: Commit**

```bash
git add src/server/index.ts __tests__/menu.test.ts
git commit -m "refactor(index): runBatchAI builds userPromptParts from RunConfig for ordered inference"
```

---

## Task 4: Update `server/index.ts` — `prepRecipe`

Update `prepRecipe` to handle the new `PrepRecipeParams.columns` array and return `PrepRecipeResult.columns`.

**Files:**
- Modify: `src/server/index.ts`
- Modify: `__tests__/menu.test.ts` (prepRecipe tests)

**Step 1: Read the current `prepRecipe` implementation**

Before writing tests, read lines ~40–120 of `src/server/index.ts` to understand the current column-writing logic. It currently handles named fields (`driveFolder`, `systemPrompt`, `userPrompts`, `outputCol`) and returns `{ rowRange, colNames }`.

**Step 2: Write failing tests for new `prepRecipe`**

```ts
it("prepRecipe writes drive-file-folder column from folder URL", () => {
  // mock getAllFilesRecursive to return 3 file links
  // call prepRecipe with columns: [{ kind:"drive-file-folder", colTitle:"Drive Link", url:"..." }]
  // assert column "Drive Link" created and 3 links written
  // assert result.columns = [{ kind:"drive-file-folder", colTitle:"Drive Link" }]
});

it("prepRecipe writes drive-file-constant same URL to every row", () => {
  // call prepRecipe with columns: [{ kind:"drive-file-constant", colTitle:"Ref File", url:"https://..." }]
  // assert column "Ref File" created and same URL written to every row in range
});

it("prepRecipe writes system-prompt text to every row", () => {
  // call prepRecipe with columns: [{ kind:"system-prompt", colTitle:"System Prompt", text:"You are..." }]
  // assert column written with text in every row
});

it("prepRecipe echoes settings in result", () => {
  // call prepRecipe with settings: { tools: ["google_search"] }
  // assert result.settings = { tools: ["google_search"] }
});

it("prepRecipe returns columns in input order", () => {
  // call prepRecipe with 3 columns
  // assert result.columns has same order
});
```

Run to confirm failure:
```bash
npm test -- --testPathPattern=menu
```

**Step 3: Rewrite `prepRecipe`**

The new implementation iterates `params.columns` in order. For each entry:

```ts
export function prepRecipe(params: PrepRecipeParams): PrepRecipeResult {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  let rowRange: { start: number; end: number } | undefined;
  const resultColumns: PrepRecipeResult["columns"] = [];

  for (const col of params.columns) {
    switch (col.kind) {
      case "drive-file-folder": {
        const files = getAllFilesRecursive(extractId(col.url));
        const colIndex = findOrCreateColumn(sheet, col.colTitle);
        files.forEach((file, i) => {
          sheet.getRange(i + 2, colIndex).setValue(file.url);
        });
        rowRange = { start: 1, end: files.length };
        resultColumns.push({ kind: col.kind, colTitle: col.colTitle });
        break;
      }
      case "drive-file-constant": {
        // rowRange must already be set by a preceding drive-file-folder column
        // or fall back to sheet data range
        const range = rowRange ?? getSheetDataRange(sheet);
        const colIndex = findOrCreateColumn(sheet, col.colTitle);
        for (let r = range.start; r <= range.end; r++) {
          sheet.getRange(r + 1, colIndex).setValue(col.url);
        }
        resultColumns.push({ kind: col.kind, colTitle: col.colTitle });
        break;
      }
      case "system-prompt":
      case "user-prompt": {
        const range = rowRange ?? getSheetDataRange(sheet);
        const colIndex = findOrCreateColumn(sheet, col.colTitle);
        for (let r = range.start; r <= range.end; r++) {
          sheet.getRange(r + 1, colIndex).setValue(col.text);
        }
        resultColumns.push({ kind: col.kind, colTitle: col.colTitle });
        break;
      }
      case "output": {
        findOrCreateColumn(sheet, col.colTitle);
        resultColumns.push({ kind: col.kind, colTitle: col.colTitle });
        break;
      }
    }
  }

  const finalRange = rowRange ?? getSheetDataRange(sheet);

  return {
    rowRange: finalRange,
    columns: resultColumns,
    settings: params.settings,
  };
}
```

Add a private helper `getSheetDataRange(sheet)` that returns the active selection or last data row range if no `drive-file-folder` was processed.

**Step 4: Run tests**

```bash
npm test -- --testPathPattern=menu
npm test
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/server/index.ts __tests__/menu.test.ts
git commit -m "refactor(index): prepRecipe handles ColumnSpec array, returns PrepRecipeResult.columns"
```

---

## Task 5: Update `client/types.ts` and `src/client/google.d.ts`

Add `ColumnSpec` and related types. Replace `RecipeParams` with the columnar shape. Update `google.d.ts` since `runBatchAI` accepts `RunConfig`.

**Files:**
- Modify: `src/client/types.ts`
- Modify: `src/client/google.d.ts`

**Step 1: Update `src/client/types.ts`**

Replace the `RecipeParams` block. Keep `RecipeFieldConfig`, `LoadingStatus`, `LoadingState`, `Job`, `PanelId`, `NavigationContext`, `Panel`, `RecipeDefinition` unchanged. Add:

```ts
// ── Recipe column specs ──────────────────────────────────────────────────────

export interface PromptAppendField {
  id: string;
  label: string;
  placeholder?: string;
  /**
   * Text injected before the reporter's value when concatenating onto the base prompt.
   * e.g. "\n\nYou are specifically looking for:\n\n"
   */
  prefix?: string;
}

export interface DriveColumnSpec {
  colTitle: RecipeFieldConfig;
  url: RecipeFieldConfig;
  helperText?: string;
}

export interface PromptColumnSpec {
  colTitle: RecipeFieldConfig;
  prompt: RecipeFieldConfig;
  /**
   * appendFields on system-prompt: required when reporter input must be injected into
   * the system instruction (Gemini API requires a single string — no fragmentation).
   * appendFields on user-prompt: preferred over multiple columns when related inputs
   * should live in one coherent column rather than cluttering the sheet.
   */
  appendFields?: PromptAppendField[];
  helperText?: string;
}

export type ColumnSpec =
  | ({ kind: "drive-file-folder"   } & DriveColumnSpec)
  | ({ kind: "drive-file-constant" } & DriveColumnSpec)
  | ({ kind: "system-prompt"       } & PromptColumnSpec)
  | ({ kind: "user-prompt"         } & PromptColumnSpec)
  | ({ kind: "output"              } & { colTitle: RecipeFieldConfig; helperText?: string })

export interface RecipeSettings {
  tools?: ToolId[];
  applyMarkdown?: boolean;
  includeGrounding?: boolean;
  // future: modelId?: string;
}

export interface RecipeParams {
  columns: ColumnSpec[];
  /**
   * Optional recipe-level AI run settings pre-applied to RunConfig after Prep.
   * Reporters can still adjust them in ConfigureAIRunPanel.
   */
  settings?: RecipeSettings;
}
```

Note: `ToolId` must be imported from `../../shared/types` in this file.

**Step 2: Update `src/client/google.d.ts`**

The `runBatchAI` stub accepts `RunConfig`. Since `RunConfig` now uses `userPromptParts`, the type reference is already correct as long as `RunConfig` is imported from `shared/types`. Verify the import and stub look like:

```ts
import type { RunConfig } from "../shared/types";
// ...
runBatchAI(config: RunConfig, jobId: string): void;
```

No change needed if the import is already there — just verify.

**Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: errors reduced to `recipe.ts`, `configure-ai-run.ts`, `recipes.ts`. Those are fixed in subsequent tasks.

**Step 4: Commit**

```bash
git add src/client/types.ts src/client/google.d.ts
git commit -m "refactor(client/types): add ColumnSpec union, RecipeSettings, rewrite RecipeParams as columns array"
```

---

## Task 6: Update `ConfigureAIRunPanel`

Minimal wiring change: same two-TagList UX, new `userPromptParts` data shape in `SavedState` and `assembleRunConfig`.

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Modify: `__tests__/panels/configure-ai-run.test.ts`

**Step 1: Update `SavedState` type**

```ts
export type SavedState = Required<
  Omit<RunConfig, "rowRange" | "tools" | "includeGrounding" | "applyMarkdown">
> &
  Pick<RunConfig, "rowRange" | "tools" | "includeGrounding" | "applyMarkdown">;
```

This still compiles correctly because `userPromptParts` is now required in `RunConfig` and `Required<Omit<...>>` covers it. The only change is that `SavedState.userPromptParts` replaces `SavedState.userPromptCols` and `SavedState.driveFileCols`.

**Step 2: Update `mount()` preset logic**

Replace:
```ts
userPromptCols: savedState.userPromptCols,
driveFileCols: savedState.driveFileCols.length ? savedState.driveFileCols : undefined,
```
With:
```ts
userPromptParts: savedState.userPromptParts,
```

**Step 3: Update `loadHeaders()` pre-selection**

Replace:
```ts
this.userPromptList = new TagList(..., preset.userPromptCols ?? []);
this.driveFileList  = new TagList(..., preset.driveFileCols  ?? []);
```
With:
```ts
const presetText = (preset.userPromptParts ?? [])
  .filter((p) => p.kind === "text").map((p) => p.col);
const presetFile = (preset.userPromptParts ?? [])
  .filter((p) => p.kind === "file").map((p) => p.col);
this.userPromptList = new TagList(..., presetText);
this.driveFileList  = new TagList(..., presetFile);
```

**Step 4: Update `unmount()`**

Replace the two separate arrays with:
```ts
userPromptParts: [
  ...(this.userPromptList?.getValue() ?? []).map((col) => ({ kind: "text" as const, col })),
  ...(this.driveFileList?.getValue()  ?? []).map((col) => ({ kind: "file" as const, col })),
],
```

**Step 5: Update `currentPreset()`**

Same as unmount — replace `userPromptCols`/`driveFileCols` with `userPromptParts` assembly.

**Step 6: Update `assembleRunConfig()`**

Replace:
```ts
return {
  userPromptCols,
  driveFileCols: driveFileCols.length > 0 ? driveFileCols : undefined,
  ...
};
```
With:
```ts
return {
  userPromptParts: [
    ...userPromptCols.map((col) => ({ kind: "text" as const, col })),
    ...driveFileCols.map((col) => ({ kind: "file" as const, col })),
  ],
  ...
};
```

**Step 7: Update tests in `__tests__/panels/configure-ai-run.test.ts`**

Find all `RunConfig` fixtures and replace `userPromptCols`/`driveFileCols` with `userPromptParts`. Find assertions on `assembleRunConfig` output and update them. Example:

```ts
// Before:
expect(config.userPromptCols).toEqual(["Prompt"]);
expect(config.driveFileCols).toEqual(["Doc"]);

// After:
expect(config.userPromptParts).toEqual([
  { kind: "text", col: "Prompt" },
  { kind: "file", col: "Doc" },
]);
```

**Step 8: Run tests**

```bash
npm test -- --testPathPattern=configure-ai-run
npm run typecheck
```

Expected: all pass.

**Step 9: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "refactor(configure-ai-run): wire userPromptParts; keep two-TagList UX unchanged"
```

---

## Task 7: Rewrite `RecipePanel`

The largest change. `RecipePanel` must render and process a generic `ColumnSpec[]` instead of named fields.

**Files:**
- Modify: `src/client/panels/recipe.ts`
- Modify: `__tests__/panels/recipe.test.ts`

**Step 1: Update `SavedState`**

```ts
type ColumnSavedState = {
  colTitle?: string;
  url?: string;
  prompt?: string;
  appendFieldValues?: Record<string, string>; // keyed by PromptAppendField.id
};

type SavedState = {
  columnStates: ColumnSavedState[];
  prepComplete: boolean;
  preppedRunConfig?: Partial<RunConfig>;
};
```

**Step 2: Update class fields**

Replace the current named field references with column-indexed structures:

```ts
private columnFields: Array<{
  colTitle?: LockableField;
  url?: LockableField;
  prompt?: LockableField;
  appendFieldInputs?: Map<string, HTMLTextAreaElement>;
}> = [];
```

**Step 3: Rewrite `template()`**

Render one `.recipe-section-card` per column. Use `col.kind` as the section title source and `col.helperText` when present:

```ts
private template(definition: RecipeDefinition | null): string {
  const params = definition?.params ?? { columns: [] };
  const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";

  const sections = params.columns.map((col, i) => {
    const sectionTitle = this.sectionTitleFor(col);
    const helperHtml = col.helperText
      ? `<p class="field-helper">${col.helperText}</p>` : "";

    let fields = `
      <div id="col-title-${i}-container"></div>`;

    if (col.kind === "drive-file-folder" || col.kind === "drive-file-constant") {
      fields += `<div id="col-url-${i}-container"></div>`;
    }

    if (col.kind === "system-prompt" || col.kind === "user-prompt") {
      fields += `<div id="col-prompt-${i}-container"></div>`;
      (col.appendFields ?? []).forEach((af) => {
        fields += `
          <label class="field-label">${af.label}</label>
          <textarea id="append-field-${i}-${af.id}" class="text-input text-input--multiline"
            placeholder="${af.placeholder ?? ""}"></textarea>`;
      });
    }

    return `
      <div class="recipe-section-card">
        <div class="recipe-section-card-title">${sectionTitle}</div>
        ${helperHtml}
        ${fields}
      </div>`;
  }).join("");

  return `
    <div class="panel-header">
      <button id="back-btn" class="back-btn">← Back</button>
      <span class="panel-title">${title}</span>
    </div>
    ${sections}
    <div id="prep-cook-container"></div>`;
}

private sectionTitleFor(col: ColumnSpec): string {
  switch (col.kind) {
    case "drive-file-folder":   return "Drive Folder <span class=\"required\">*</span>";
    case "drive-file-constant": return "Reference File";
    case "system-prompt":       return "System Prompt";
    case "user-prompt":         return "User Prompt";
    case "output":              return "Output Column";
  }
}
```

**Step 4: Rewrite `mountFields()`**

```ts
private mountFields(container: HTMLElement, params: RecipeParams, savedState?: SavedState): void {
  const reset = (): void => this.prepCook?.reset();
  this.columnFields = [];

  params.columns.forEach((col, i) => {
    const saved = savedState?.columnStates?.[i];
    const fields: (typeof this.columnFields)[number] = {};

    // colTitle — always present
    fields.colTitle = new LockableField(
      container.querySelector(`#col-title-${i}-container`)!,
      {
        label: "Column",
        defaultValue: saved?.colTitle ?? col.colTitle.value,
        locked: col.colTitle.locked,
        onUnlock: reset,
      },
    );

    if (col.kind === "drive-file-folder" || col.kind === "drive-file-constant") {
      fields.url = new LockableField(
        container.querySelector(`#col-url-${i}-container`)!,
        {
          label: col.kind === "drive-file-folder" ? "Folder URL" : "File URL",
          defaultValue: saved?.url ?? col.url.value,
          locked: col.url.locked,
          placeholder: col.url.placeholder,
          onUnlock: reset,
        },
      );
    }

    if (col.kind === "system-prompt" || col.kind === "user-prompt") {
      fields.prompt = new LockableField(
        container.querySelector(`#col-prompt-${i}-container`)!,
        {
          label: "Prompt",
          defaultValue: saved?.prompt ?? col.prompt.value,
          locked: col.prompt.locked,
          multiline: true,
          onUnlock: reset,
        },
      );

      fields.appendFieldInputs = new Map();
      (col.appendFields ?? []).forEach((af) => {
        const el = container.querySelector<HTMLTextAreaElement>(
          `#append-field-${i}-${af.id}`,
        )!;
        if (saved?.appendFieldValues?.[af.id]) {
          el.value = saved.appendFieldValues[af.id];
        }
        el.addEventListener("input", reset);
        fields.appendFieldInputs!.set(af.id, el);
      });
    }

    this.columnFields.push(fields);
  });
}
```

**Step 5: Rewrite `unmount()`**

```ts
unmount(): SavedState {
  return {
    columnStates: (this.params?.columns ?? []).map((col, i) => {
      const f = this.columnFields[i];
      const state: ColumnSavedState = {
        colTitle: f?.colTitle?.getValue(),
        url: f?.url?.getValue(),
        prompt: f?.prompt?.getValue(),
      };
      if (f?.appendFieldInputs?.size) {
        state.appendFieldValues = {};
        f.appendFieldInputs.forEach((el, id) => {
          state.appendFieldValues![id] = el.value;
        });
      }
      return state;
    }),
    prepComplete: this.prepCook?.isPrepComplete() ?? false,
    preppedRunConfig: this.preppedRunConfig ?? undefined,
  };
}
```

**Step 6: Rewrite `buildPrepParams()`**

```ts
private buildPrepParams(): PrepRecipeParams | null {
  const columns: PrepRecipeParams["columns"] = [];

  for (let i = 0; i < (this.params?.columns.length ?? 0); i++) {
    const col = this.params!.columns[i];
    const f = this.columnFields[i];
    const colTitle = f.colTitle?.getValue() ?? col.colTitle.value;

    if (col.kind === "drive-file-folder") {
      const url = f.url?.getValue()?.trim() ?? "";
      if (!url) {
        globalThis.alert("Please enter a Google Drive folder URL.");
        return null;
      }
      columns.push({ kind: "drive-file-folder", colTitle, url });

    } else if (col.kind === "drive-file-constant") {
      const url = f.url?.getValue()?.trim() ?? "";
      if (!url) continue; // optional — skip if empty
      columns.push({ kind: "drive-file-constant", colTitle, url });

    } else if (col.kind === "system-prompt" || col.kind === "user-prompt") {
      let text = f.prompt?.getValue() ?? col.prompt.value;
      // Concatenate appendFields onto base prompt
      for (const af of col.appendFields ?? []) {
        const val = f.appendFieldInputs?.get(af.id)?.value?.trim() ?? "";
        if (!val) {
          globalThis.alert(`Please fill in "${af.label}".`);
          return null;
        }
        text += (af.prefix ?? "") + val;
      }
      columns.push({ kind: col.kind, colTitle, text });

    } else if (col.kind === "output") {
      columns.push({ kind: "output", colTitle });
    }
  }

  return {
    columns,
    settings: this.definition?.params?.settings
      ? {
          tools: this.definition.params.settings.tools,
          applyMarkdown: this.definition.params.settings.applyMarkdown,
          includeGrounding: this.definition.params.settings.includeGrounding,
        }
      : undefined,
  };
}
```

**Step 7: Rewrite `buildRunConfig()`**

```ts
private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
  const userPromptParts: RunConfig["userPromptParts"] = [];
  let systemPromptCol: string | undefined;
  let outputCol = "";

  for (const col of result.columns) {
    switch (col.kind) {
      case "drive-file-folder":
      case "drive-file-constant":
        userPromptParts.push({ kind: "file", col: col.colTitle });
        break;
      case "user-prompt":
        userPromptParts.push({ kind: "text", col: col.colTitle });
        break;
      case "system-prompt":
        systemPromptCol = col.colTitle;
        break;
      case "output":
        outputCol = col.colTitle;
        break;
    }
  }

  return {
    userPromptParts,
    systemPromptCol,
    outputCol,
    rowRange: result.rowRange,
    tools: result.settings?.tools,
    applyMarkdown: result.settings?.applyMarkdown,
    includeGrounding: result.settings?.includeGrounding,
  };
}
```

**Step 8: Update tests in `__tests__/panels/recipe.test.ts`**

Key test scenarios to cover:

```ts
it("renders a section card for each column in params.columns", () => { ... });

it("buildPrepParams skips drive-file-constant when url is empty", () => { ... });

it("buildPrepParams concatenates appendFields onto prompt text", () => {
  // mount with a system-prompt column that has one appendField
  // fill in the appendField textarea
  // call prep → assert PrepRecipeParams.columns[0].text includes prefix + value
});

it("buildPrepParams alerts and returns null when required appendField is empty", () => { ... });

it("buildRunConfig assembles userPromptParts in column order", () => {
  // PrepRecipeResult.columns: [drive-file-folder, user-prompt, output]
  // assert RunConfig.userPromptParts = [{kind:"file",col:...},{kind:"text",col:...}]
});

it("buildRunConfig maps settings from PrepRecipeResult", () => {
  // result.settings = { tools: ["google_search"] }
  // assert RunConfig.tools = ["google_search"]
});
```

**Step 9: Run tests**

```bash
npm test -- --testPathPattern=recipe
npm run typecheck
```

Expected: all pass.

**Step 10: Commit**

```bash
git add src/client/panels/recipe.ts __tests__/panels/recipe.test.ts
git commit -m "refactor(recipe-panel): rewrite for ColumnSpec[] — generic column rendering, appendFields concatenation, buildRunConfig from PrepRecipeResult.columns"
```

---

## Task 8: Update `client/recipes.ts`

Migrate `document-summarization` to the new `columns` shape. Add the `find-a-thing` recipe.

**Files:**
- Modify: `src/client/recipes.ts`

**Step 1: Migrate `document-summarization`**

```ts
{
  id: "document-summarization",
  name: "Document Summarization",
  icon: "📄",
  description: "Summarize each file in a Google Drive folder",
  panelId: "recipe",
  params: {
    columns: [
      {
        kind: "drive-file-folder",
        colTitle: { value: "Drive Link", locked: false },
        url: { value: "", locked: false, placeholder: "Paste Google Drive folder URL" },
        helperText: "Make sure you have access to this folder",
      },
      {
        kind: "system-prompt",
        colTitle: { value: "System Prompt", locked: true },
        prompt: {
          value:
            "You are an expert document analyst. Produce clear, structured summaries " +
            "focusing on key themes, main arguments, important data points, and actionable conclusions.",
          locked: true,
        },
      },
      {
        kind: "user-prompt",
        colTitle: { value: "User Prompt", locked: true },
        prompt: {
          value:
            "Please summarize the attached document. Include the main topics, key findings, " +
            "and important conclusions. The document file will be attached as inline data.",
          locked: true,
        },
      },
      {
        kind: "output",
        colTitle: { value: "AI_Summarization", locked: true },
      },
    ],
  } satisfies RecipeParams,
},
```

**Step 2: Add `find-a-thing` recipe**

```ts
{
  id: "find-a-thing",
  name: "Find a Thing in a Thing",
  icon: "🔍",
  description: "Scan a folder of files to find which ones contain a specific item",
  panelId: "recipe",
  params: {
    columns: [
      {
        kind: "drive-file-folder",
        colTitle: { value: "Drive Link", locked: false },
        url: { value: "", locked: false, placeholder: "Paste Google Drive folder URL" },
        helperText: "The folder of files to scan",
      },
      {
        kind: "drive-file-constant",
        colTitle: { value: "Reference File", locked: false },
        url: { value: "", locked: false, placeholder: "Paste a Drive link to a reference file" },
        helperText: "Optional. Any file type — attach an example of what you're looking for.",
      },
      {
        kind: "system-prompt",
        colTitle: { value: "System Prompt", locked: true },
        prompt: {
          value:
            "You are a document analyst helping a reporter identify specific items within " +
            "a collection of files. For each file you receive, determine whether it contains " +
            "the item described below. Respond with exactly one of: \"yes\", \"no\", or " +
            "\"unsure\". Follow your answer with a single sentence explaining your reasoning. " +
            "Do not add any other commentary.\n\n" +
            "If a reference file is attached, it is a concrete example of what you are looking " +
            "for — use it as a visual or structural guide when evaluating the document.",
          locked: true,
        },
        appendFields: [
          {
            id: "searchDescription",
            label: "What are you looking for?",
            placeholder:
              "Describe the item, person, pattern, or visual artifact you want to find",
            prefix: "\n\nYou are specifically looking for:\n\n",
          },
        ],
      },
      {
        kind: "user-prompt",
        colTitle: { value: "User Prompt", locked: true },
        prompt: {
          value:
            "Analyze the attached file and determine whether it contains the item described " +
            "in your instructions.",
          locked: true,
        },
      },
      {
        kind: "output",
        colTitle: { value: "AI_FindAThing", locked: false },
      },
    ],
  } satisfies RecipeParams,
},
```

**Step 3: Run full test suite + typecheck + build**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all 326+ tests pass, clean build, no type errors.

**Step 4: Commit**

```bash
git add src/client/recipes.ts
git commit -m "feat(recipes): add find-a-thing recipe; migrate document-summarization to ColumnSpec shape"
```

---

## Final Verification

```bash
npm run typecheck && npm test && npm run build
```

All checks green. Then use `superpowers:finishing-a-development-branch` to prepare the PR.
