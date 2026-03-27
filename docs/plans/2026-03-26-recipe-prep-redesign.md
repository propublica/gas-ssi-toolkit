# Recipe Prep Redesign: Agnostic Column Specs

**Date:** 2026-03-26
**Status:** Design complete, implementation plan ready

---

## Motivation

The existing `PrepRecipeParams` conflates three separate concerns in one named-field shape:
- **Population strategy** — how the server fills a column (scan a folder, fill a value, create empty)
- **Semantic role** — what the column means in a RunConfig (file input, text prompt, system prompt, output)
- **UI configuration** — what fields to render and what their defaults/locks are

This made the "single source of truth" invariant (`preppedRunConfig` assembled from `PrepRecipeResult` alone) load-bearing. But that invariant was solving the wrong problem: users **should** be able to modify column titles, prompt values, and settings between prep and cook. Once that's accepted, `PrepRecipeResult` no longer needs to echo anything back — the client already has everything except the row count.

A secondary issue: `PrepRecipeResult` echoed `tools` and `colNames` back from the server despite the server doing no processing on them. These were only there to preserve the invariant.

---

## Design

### Core Insight

Split the three concerns across the right owners:

| Concern | Owner | Lives in |
|---|---|---|
| Population strategy | Server | `PrepColSpec.strategy` (sent in `PrepRecipeParams`) |
| Semantic role | Client | `ColumnDef.role` (recipe definition, never sent to server) |
| UI configuration | Client | `ColumnDef.colTitle / prompt / url / appendFields` |

`PrepRecipeResult` shrinks to just `{ rowRange }` — the only thing the client genuinely couldn't know before prep ran.

---

### Shared Types (`src/shared/types.ts`)

```typescript
export type ColStrategy =
  | { kind: "list-drive-folder"; url: string }  // scan folder, one row per file
  | { kind: "fill-value"; value: string }        // fill N rows with the same value
  | { kind: "create-empty" };                    // create column header only

export interface PrepColSpec {
  colTitle: string;
  strategy: ColStrategy;
}

export interface PrepRecipeParams {
  cols: PrepColSpec[];
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
}
```

`tools`, `colNames`, and the `settings` echo are all removed. The old named-field `PrepRecipeParams` and `PrepRecipeResult` are replaced entirely.

---

### Client Types (`src/client/types.ts`)

```typescript
export type ColStrategyKind = "list-drive-folder" | "fill-value" | "create-empty";
export type ColRole = "userPrompt" | "systemPrompt" | "driveLink" | "output";

export interface AppendField {
  id: string;
  label: string;
  placeholder?: string;
  /** Injected before the reporter's value when composing the final prompt string. */
  prefix?: string;
}

export interface RecipeSettings {
  tools?: ToolId[];
  applyMarkdown?: boolean;
  includeGrounding?: boolean;
}

export interface ColumnDef {
  label: string;                  // UI section heading ("Drive Folder", "System Prompt", …)
  role: ColRole;                  // how this column maps into RunConfig
  strategyKind: ColStrategyKind;  // what PrepColSpec.strategy type to generate
  colTitle: RecipeFieldConfig;    // lockable column header field
  prompt?: RecipeFieldConfig;     // lockable prompt text (for fill-value columns)
  url?: RecipeFieldConfig;        // lockable URL input (for drive columns)
  appendFields?: AppendField[];   // extra reporter inputs appended to prompt before prep
  helperText?: string;
  required?: boolean;             // shows * in section heading
}

export interface RecipeParams {
  columns: ColumnDef[];
  settings?: RecipeSettings;
}
```

`RecipeDefinition` is unchanged structurally — `params?: RecipeParams` already references the updated type.

---

### Server `prepRecipe()` (`src/server/index.ts`)

Two-pass approach to avoid double folder scans:

```typescript
export function prepRecipe(params: PrepRecipeParams): PrepRecipeResult {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  let numRows = 1;

  // Pass 1: scan folders, build URL cache, determine numRows
  const folderCache = new Map<string, string[]>();
  for (const col of params.cols) {
    if (col.strategy.kind === "list-drive-folder") {
      const url = col.strategy.url;
      if (!folderCache.has(url)) {
        const folder = DriveApp.getFolderById(extractId(url));
        const files: { url: string }[] = [];
        getAllFilesRecursive(folder, files);
        folderCache.set(url, files.map((f) => f.url));
      }
      numRows = Math.max(numRows, folderCache.get(url)!.length || 1);
    }
  }

  // Pass 2: write all columns
  for (const col of params.cols) {
    const colIdx = findOrCreateColumn(sheet, col.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
    switch (col.strategy.kind) {
      case "list-drive-folder": {
        const urls = folderCache.get(col.strategy.url) ?? [];
        writeColumn(sheet, colIdx, urls, SpreadsheetApp.WrapStrategy.CLIP);
        break;
      }
      case "fill-value":
        writeColumn(
          sheet, colIdx,
          Array(numRows).fill(col.strategy.value) as string[],
          SpreadsheetApp.WrapStrategy.CLIP,
        );
        break;
      case "create-empty":
        break; // findOrCreateColumn already created the header
    }
  }

  SpreadsheetApp.flush();
  return { rowRange: { start: 2, end: 2 + numRows - 1 } };
}
```

---

### Client `buildPrepParams()` (`src/client/panels/recipe.ts`)

Iterates `ColumnDef[]`, resolves UI field values, constructs `PrepColSpec[]`. `appendFields` are composed into the prompt string before the server sees anything:

```typescript
private buildPrepParams(): PrepRecipeParams | null {
  const columns = this.definition!.params!.columns;
  const cols: PrepColSpec[] = [];

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const colTitle = this.fields[i].colTitle?.getValue() ?? col.colTitle.value;

    let strategy: ColStrategy;
    switch (col.strategyKind) {
      case "list-drive-folder": {
        const url = this.fields[i].url?.value.trim() ?? "";
        if (!url) {
          globalThis.alert(`Please enter a URL for "${col.label}".`);
          return null;
        }
        strategy = { kind: "list-drive-folder", url };
        break;
      }
      case "fill-value": {
        const base = this.fields[i].prompt?.getValue() ?? col.prompt?.value ?? "";
        const appended = (col.appendFields ?? [])
          .map((af) => {
            const v = this.fields[i].appendInputs?.[af.id]?.value.trim() ?? "";
            return v ? (af.prefix ?? "") + v : "";
          })
          .join("");
        strategy = { kind: "fill-value", value: base + appended };
        break;
      }
      case "create-empty":
        strategy = { kind: "create-empty" };
        break;
    }

    cols.push({ colTitle, strategy });
  }

  return { cols };
}
```

---

### Client `buildRunConfig()` (`src/client/panels/recipe.ts`)

Reads `ColumnDef.role` for RunConfig mapping. `tools` and other settings come from `definition.params.settings`, not from the server result:

```typescript
private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
  const columns = this.definition!.params!.columns ?? [];
  const settings = this.definition!.params!.settings ?? {};
  const promptCols: PromptColumnSpec[] = [];
  let systemPromptCol: string | undefined;
  let outputCol = "";

  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    const resolvedTitle = this.fields[i].colTitle?.getValue() ?? col.colTitle.value;

    switch (col.role) {
      case "userPrompt":
        promptCols.push({ col: resolvedTitle, kind: "text" });
        break;
      case "driveLink":
        promptCols.push({ col: resolvedTitle, kind: "file" });
        break;
      case "systemPrompt":
        systemPromptCol = resolvedTitle;
        break;
      case "output":
        outputCol = resolvedTitle;
        break;
    }
  }

  return {
    promptCols,
    systemPromptCol,
    outputCol,
    rowRange: result.rowRange,
    ...settings,
  };
}
```

---

### Saved State

Named fields are replaced with a column-indexed array:

```typescript
type ColSavedValues = {
  colTitle?: string;
  prompt?: string;
  url?: string;
  appendValues?: Record<string, string>;
};

type SavedState = {
  colValues: ColSavedValues[];
  prepComplete: boolean;
  preppedRunConfig?: Partial<RunConfig>;
};
```

---

### `appendFields` flow

`appendFields` live in `ColumnDef` (recipe definition). They are rendered by `RecipePanel` as plain `<input>` elements. When `buildPrepParams()` runs, it reads these inputs and composes them into the `fill-value` strategy's `value` — the server receives the composed string and never knows `appendFields` exist.

---

### Recipe Definition Example: Document Summarization

```typescript
{
  id: "document-summarization",
  name: "Document Summarization",
  icon: "📄",
  description: "Summarize each file in a Google Drive folder",
  panelId: "recipe",
  params: {
    columns: [
      {
        label: "Drive Folder",
        role: "driveLink",
        strategyKind: "list-drive-folder",
        colTitle: { value: "Drive Link", locked: true },
        url: { value: "", locked: false, placeholder: "Paste Google Drive folder URL" },
        helperText: "Make sure you have access to this folder",
        required: true,
      },
      {
        label: "System Prompt",
        role: "systemPrompt",
        strategyKind: "fill-value",
        colTitle: { value: "System Prompt", locked: true },
        prompt: {
          value:
            "You are an expert document analyst. Produce clear, structured summaries " +
            "focusing on key themes, main arguments, important data points, and actionable conclusions.",
          locked: true,
        },
      },
      {
        label: "User Prompt",
        role: "userPrompt",
        strategyKind: "fill-value",
        colTitle: { value: "User Prompt", locked: true },
        prompt: {
          value:
            "Please summarize the attached document. Include the main topics, key findings, " +
            "and important conclusions. The document file will be attached as inline data.",
          locked: true,
        },
      },
      {
        label: "Output Column",
        role: "output",
        strategyKind: "create-empty",
        colTitle: { value: "AI_Summarization", locked: true },
      },
    ],
  } satisfies RecipeParams,
},
```

---

## What This Enables

### Find a Thing in a Thing recipe

```typescript
columns: [
  {
    label: "Documents Folder",
    role: "driveLink",
    strategyKind: "list-drive-folder",
    colTitle: { value: "Drive Link", locked: true },
    url: { value: "", locked: false },
    required: true,
  },
  {
    label: "Reference File",
    role: "driveLink",
    strategyKind: "fill-value",      // same URL in every row
    colTitle: { value: "Reference File", locked: true },
    url: { value: "", locked: false, placeholder: "Paste reference file URL" },
  },
  {
    label: "System Prompt",
    role: "systemPrompt",
    strategyKind: "fill-value",
    colTitle: { value: "System Prompt", locked: true },
    prompt: { value: "You are a document analyst...", locked: true },
  },
  {
    label: "User Prompt",
    role: "userPrompt",
    strategyKind: "fill-value",
    colTitle: { value: "User Prompt", locked: true },
    prompt: { value: "Does this document contain the following item?", locked: true },
    appendFields: [
      {
        id: "search-description",
        label: "What are you looking for?",
        placeholder: "e.g. a signature, an exhibit sticker, a person's name",
        prefix: "\n\nYou are specifically looking for:\n\n",
      },
    ],
  },
  {
    label: "Output Column",
    role: "output",
    strategyKind: "create-empty",
    colTitle: { value: "AI_FindResult", locked: true },
  },
],
settings: { tools: ["google_search"] },
```

Note: `fill-value` for a `driveLink` role correctly maps to `{ kind: "file" }` in `promptCols`. The distinction between "folder scan" and "constant file link" is a strategy concern only — both become file parts in the Gemini request.

---

## Files Changed

| File | Change |
|---|---|
| `src/shared/types.ts` | Replace `PrepRecipeParams`/`PrepRecipeResult` with new agnostic shapes; add `ColStrategy`, `PrepColSpec` |
| `src/client/types.ts` | Replace `RecipeParams` named fields with `ColumnDef[]`; add `ColStrategyKind`, `ColRole`, `AppendField`, `RecipeSettings` |
| `src/client/recipes.ts` | Migrate document-summarization to new `ColumnDef` shape |
| `src/client/panels/recipe.ts` | Rewrite `template()`, `mountFields()`, `buildPrepParams()`, `buildRunConfig()`, `unmount()` |
| `src/server/index.ts` | Rewrite `prepRecipe()` to iterate `PrepColSpec[]` with two-pass folder scan |
| `__tests__/panels/recipe.test.ts` | Rewrite tests for new `ColumnDef` shape and DOM structure |
