# Recipe Panels Design

**Date:** 2026-02-25
**Status:** Approved
**Branch:** `feature/recipe-panels`

## Goals

1. Introduce a "Recipes" system that guides users through a structured form experience, reducing cognitive load by pre-populating spreadsheet columns and AI request configuration.
2. Build a generic `RecipePanel` driven by a `RecipeParams` config object — adding a new standard recipe means adding one entry to a `RECIPES` array, no new panel class required.
3. Keep the recipe system extensible: custom-shaped recipes can register their own panel class and slot into the same `RecipesListPanel` navigation.
4. Align the recipe data model with the existing `RunConfig → GeminiRequest` pipeline — no awkward singular-to-array conversions anywhere in the chain.

## Out of Scope

- Recipe CRUD / user-saved recipes. Recipes are defined in code as read-only presets.
- `generationConfig` / `modelName` overrides at the recipe level. Clean future path: extend `RunConfig` to carry these fields.
- Removing the ConfigureAIRunPanel navigation from Cook (may be revisited in a future iteration).

---

## Architecture Overview

### Files Created or Modified

```
src/shared/types.ts                          ← add RecipeFieldConfig, RecipeParams,
                                               PrepRecipeParams, PrepRecipeResult
src/server/index.ts                          ← add prepRecipe() export
src/server/utils.ts                          ← add findOrCreateColumn(), writeColumn()
rollup.config.js                             ← add prepRecipe global stub in footer
src/client/types.ts                          ← add RecipeDefinition; add "recipe" to PanelId,
                                               remove "document-summarization"
src/client/services.ts                       ← add prepRecipe() wrapper
src/client/recipes.ts                        ← new: RECIPES registry (RecipeDefinition[])
src/client/components/
  recipe-prep-cook.ts                        ← new: RecipePrepCook component
src/client/panels/
  recipes-list.ts                            ← replace stub: data-driven from RECIPES
  recipe.ts                                  ← new: generic RecipePanel
  recipes/
    document-summarization.ts               ← deleted (replaced by RECIPES entry)
src/client/sidebar-entry.ts                  ← register "recipe"; remove "document-summarization"
__tests__/components/
  recipe-prep-cook.test.ts                   ← new
__tests__/panels/
  recipes-list.test.ts                       ← new
  recipe.test.ts                             ← new
__tests__/utils.test.ts                      ← add findOrCreateColumn, writeColumn cases
```

### Navigation Stack

```
[tool-list] → [recipes-list] → [recipe] → [configure-ai-run]
```

Back from Configure AI Run restores `RecipePanel` with `prepComplete: true` and `preppedRunConfig` intact — Cook stays enabled.

### End-to-End Data Flow

```
RecipePanel
  → user fills form fields
  → clicks Prep Recipe
  → reads + validates form values once → builds PrepRecipeParams
  → services.prepRecipe(PrepRecipeParams)
      → server: getAllFilesRecursive, findOrCreateColumn, writeColumn
      → returns PrepRecipeResult { rowRange, colNames }
  → assembles preppedRunConfig from PrepRecipeResult (single source of truth)
  → RecipePrepCook enables Cook

  → user clicks Cook
  → nav.navigate("configure-ai-run", preppedRunConfig)
      → ConfigureAIRunPanel opens prepopulated
```

---

## Shared Types (`src/shared/types.ts`)

### `RecipeFieldConfig`

Per-sub-field configuration for `RecipeParams`. Maps directly to `LockableFieldConfig`.

```ts
export interface RecipeFieldConfig {
  value: string;
  locked?: boolean;      // defaults to true
  placeholder?: string;  // useful when locked: false with no default value
}
```

### `RecipeParams`

Drives form construction in `RecipePanel`. UI concern only — `helperText` and `locked` never reach the server.

```ts
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
```

`RecipePanel` renders only the sections present in `params`. A recipe that omits `driveFolder` gets no folder input field. A recipe that omits `systemPrompt` gets no system prompt section.

### `PrepRecipeParams`

Server payload. Resolved user values — no UI concerns (`helperText`, `locked`, `placeholder` are absent).

```ts
export interface PrepRecipeParams {
  driveFolder?: { url: string; colTitle: string };
  systemPrompt?: { colTitle: string; value: string };
  userPrompts?: Array<{ colTitle: string; value: string }>;
  outputCol?: { colTitle: string };
}
```

### `PrepRecipeResult`

Server response. The server reports exactly what it wrote — the client assembles `preppedRunConfig` entirely from this object. No re-reading of form state at Cook time.

```ts
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

### Alignment with `RunConfig` and `GeminiRequest`

The `userPrompts` array aligns end-to-end with the existing pipeline:

```
RecipeParams.userPrompts[]
  → PrepRecipeParams.userPrompts[]
  → PrepRecipeResult.colNames.userPrompts[]
  → RunConfig.userPromptCols[]
  → GeminiRequest.userTexts[]
```

No singular-to-array conversions anywhere in the chain.

---

## Client Types (`src/client/types.ts`)

### `PanelId`

`"document-summarization"` is removed; `"recipe"` is added.

```ts
export type PanelId =
  | "tool-list"
  | "configure-ai-run"
  | "recipes-list"
  | "recipe";
```

### `RecipeDefinition`

Registry entry. Lives in `src/client/types.ts` (not `shared/`) so `panelId` can be typed as `PanelId`, giving compile-time guarantees that every recipe points at a registered panel.

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

---

## RECIPES Registry (`src/client/recipes.ts`)

The only place a new standard recipe is ever added. `satisfies RecipeParams` gives compile-time validation without widening the type.

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
          value: "You are an expert document analyst. Produce clear, structured summaries focusing on key themes, main arguments, important data points, and actionable conclusions.",
          locked: true,
        },
      },
      userPrompts: [
        {
          colTitle: { value: "User Prompt", locked: true },
          prompt: {
            value: "Please summarize the attached document. Include the main topics, key findings, and important conclusions. The document file will be attached as inline data.",
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

**To add a new standard recipe:** add one entry to this array.
**To add a custom-shaped recipe:** add one entry with a custom `panelId`, register that panel in `sidebar-entry.ts`.

---

## Server Side

### `findOrCreateColumn` and `writeColumn` (`src/server/utils.ts`)

Pure sheet-manipulation helpers. Accept a `Sheet` parameter — no calls to `SpreadsheetApp` globally, following the `getAllFilesRecursive` pattern. Independently testable.

```ts
/**
 * Find a column by header title or append a new one.
 * Returns the 1-based column index.
 */
export function findOrCreateColumn(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  title: string,
): number { ... }

/**
 * Write an array of values to a column starting at row 2.
 * Uses a single setValues() call for efficiency.
 */
export function writeColumn(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  colIdx: number,
  values: string[],
): void { ... }
```

### `prepRecipe` (`src/server/index.ts`)

Thin orchestrator — calls `SpreadsheetApp`, `DriveApp`, delegates column work to `utils.ts` helpers. Returns `PrepRecipeResult` as the single source of truth for what was written.

```ts
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
    writeColumn(sheet, col, Array(numRows).fill(params.systemPrompt.value));
    colNames.systemPrompt = params.systemPrompt.colTitle;
  }

  if (params.userPrompts) {
    colNames.userPrompts = [];
    for (const up of params.userPrompts) {
      const col = findOrCreateColumn(sheet, up.colTitle);
      writeColumn(sheet, col, Array(numRows).fill(up.value));
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

### `rollup.config.js` footer addition

```js
function prepRecipe(params) { return _GASEntry.prepRecipe(params); }
```

---

## Client: `RecipePrepCook` Component (`src/client/components/recipe-prep-cook.ts`)

Owns the Prep/Cook button pair and state machine. `RecipePanel` provides callbacks; `RecipePrepCook` manages all button state.

```ts
export interface RecipePrepCookConfig {
  onPrep: () => Promise<void>;          // RecipePanel calls server + assembles preppedRunConfig
  onCook: () => void | Promise<void>;   // void for navigation; Promise for future direct-run
  prepComplete?: boolean;               // for saved state restoration
}

export class RecipePrepCook {
  private prepComplete: boolean;

  constructor(container: HTMLElement, config: RecipePrepCookConfig);
  isPrepComplete(): boolean;
  reset(): void;  // called when form fields are edited after prep
}
```

### State Machine

| State | Prep button | Cook button |
|---|---|---|
| idle | enabled "Prep Recipe" | disabled |
| prepping | disabled "Prepping..." | disabled |
| prep-complete | enabled "Re-prep" | enabled "Cook" |
| cooking | disabled | disabled "Cooking..." |

- `onPrep` resolves → prep-complete, Cook enabled
- `onPrep` rejects → idle, error shown
- `onCook` returns `Promise` → cooking state; returns `void` → no cooking state
- `reset()` → idle, Cook disabled

---

## Client: `RecipePanel` (`src/client/panels/recipe.ts`)

Generic panel. Renders only the `RecipeParams` fields that are present. Delegates button state entirely to `RecipePrepCook`.

### Saved State

```ts
type SavedState = {
  // form values — UI restoration only
  driveFolderValue?: string;
  systemPromptTitle?: string;  systemPromptValue?: string;
  userPromptTitles?: string[]; userPromptValues?: string[];
  outputColTitle?: string;
  // cook state
  prepComplete: boolean;
  preppedRunConfig?: Partial<RunConfig>;
};
```

### LockableField Wiring

Each `RecipeFieldConfig` sub-field maps directly to a `LockableField`:

```ts
// RecipeFieldConfig → LockableFieldConfig (one-to-one)
{
  label:        "Column Title",          // fixed per section
  defaultValue: savedState?.x ?? field.value,
  locked:       field.locked,
  placeholder:  field.placeholder,
  onUnlock:     () => this.prepCook?.reset(),
}
```

`LockableFieldConfig` gains one new optional field: `onUnlock?: () => void`. Called when the user clicks the unlock button. `RecipePanel` wires every field's `onUnlock` to `prepCook.reset()` — any field unlock invalidates the current prep.

Field instances are stored in a nullable structured object:

```ts
private fields: {
  systemPromptTitle?: LockableField;
  systemPromptValue?: LockableField;
  userPromptTitles: LockableField[];
  userPromptValues: LockableField[];
  outputColTitle?: LockableField;
} = { userPromptTitles: [], userPromptValues: [] };
```

### `onPrep` Callback

```ts
onPrep: () => {
  const prepParams = this.buildPrepParams();   // reads + validates form; throws if invalid
  return services.prepRecipe(prepParams).then((result) => {
    this.preppedRunConfig = this.buildRunConfig(result);
  });
}
```

`buildRunConfig` assembles entirely from `PrepRecipeResult` — no form state involved:

```ts
private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
  return {
    driveFileCols:   result.colNames.driveLink    ? [result.colNames.driveLink]    : undefined,
    systemPromptCol: result.colNames.systemPrompt,
    userPromptCols:  result.colNames.userPrompts  ?? [],
    outputCol:       result.colNames.outputCol    ?? "",
    rowRange:        result.rowRange,
  };
}
```

### `onCook` Callback

```ts
onCook: () => {
  this.nav?.navigate("configure-ai-run", this.preppedRunConfig);
}
```

---

## Client: `RecipesListPanel` (`src/client/panels/recipes-list.ts`)

Data-driven from `RECIPES`. Adding a recipe to the registry automatically adds a button.

```ts
import { RECIPES } from "../recipes";

mount(container, nav) {
  container.innerHTML = this.template();
  RECIPES.forEach((recipe) => {
    container
      .querySelector(`#btn-${recipe.id}`)
      ?.addEventListener("click", () => nav.navigate(recipe.panelId, recipe.params));
  });
  container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
}
```

---

## Client: `sidebar-entry.ts`

```ts
import { RecipePanel } from "./panels/recipe";
// DocumentSummarizationPanel import removed

const panels = new Map<PanelId, Panel>([
  ["tool-list",        new ToolListPanel()],
  ["configure-ai-run", new ConfigureAIRunPanel()],
  ["recipes-list",     new RecipesListPanel()],
  ["recipe",           new RecipePanel()],
]);
```

---

## Testing Strategy

### `__tests__/components/recipe-prep-cook.test.ts`
- Idle state: Prep enabled, Cook disabled
- Click Prep → disabled, "Prepping..."
- `onPrep` resolves → "Re-prep" enabled, Cook enabled
- `onPrep` rejects → returns to idle, error shown
- `onCook` returns `void` → `onCook` called, no cooking state
- `onCook` returns `Promise` → cooking state entered, both buttons disabled
- `reset()` → returns to idle, Cook disabled
- Mount with `prepComplete: true` → Cook enabled from start

### `__tests__/panels/recipes-list.test.ts`
- Renders one button per `RECIPES` entry
- Click button → `nav.navigate` called with correct `panelId` and `params`
- Click back → `nav.back` called

### `__tests__/panels/recipe.test.ts`
- Mount with only `driveFolder` in params → only that field rendered
- Mount with all params → all sections rendered with correct defaults
- `locked: true` fields start disabled; `locked: false` fields start enabled
- Unlock a field → `prepCook.reset()` called
- Edit drive folder value → `prepCook.reset()` called
- Click Prep → `services.prepRecipe` called with correct `PrepRecipeParams`
- `prepRecipe` resolves → `preppedRunConfig` assembled from `PrepRecipeResult` only
- Click Cook → `nav.navigate("configure-ai-run", preppedRunConfig)` called
- `unmount()` → returns full `SavedState`
- Mount with `savedState` → form values restored, `prepComplete` and `preppedRunConfig` restored

### `__tests__/utils.test.ts` (additions)
- `findOrCreateColumn` — finds existing column by title; creates new column when not found
- `writeColumn` — writes values to correct column starting at row 2

---

## Anticipated Future Work

- **Direct Cook execution:** change `onCook` to call `runBatchAI` directly instead of navigating to `ConfigureAIRunPanel`. `RecipePrepCook` already handles the async cooking state.
- **`generationConfig` / `modelName` overrides:** extend `RunConfig` to carry these fields; surface in `RecipeParams` as pass-through to `GeminiRequest`.
- **Multiple custom recipe shapes:** register additional panel classes and `PanelId` values as needed. `RecipesListPanel` and `RECIPES` require no changes.
