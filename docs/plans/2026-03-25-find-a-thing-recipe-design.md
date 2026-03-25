# Design: "Find a Thing in a Thing" Recipe + Recipe System Foundations

**Date:** 2026-03-25
**Status:** Design complete, ready for implementation

---

## Motivation

A reporter has a stack of files — court documents, PDFs, images, audio, video. They want to
know which ones contain a specific thing: a photograph, a signature, an exhibit sticker, a
person's name used in a particular legal context. Simple string matching won't work. The
question requires semantic understanding.

This document designs a new "Find a thing in a thing" recipe that supports this use case,
and in doing so, establishes a stronger foundational type system for the recipe layer that
will support future recipes cleanly.

---

## Part 1: Recipe System Foundations

The existing `RecipeParams` interface used named top-level fields (`driveFolder`,
`systemPrompt`, `userPrompts`, `outputCol`). Adding `referenceFile` as a peer to
`driveFolder` exposed the underlying problem: the named-field approach conflates
sheet structure, population strategy, and RunConfig role all in one shape.

The deeper insight is that drive file links and user prompt text are both **parts of the
user message** sent to Gemini. The `driveFileCols` / `userPromptCols` split in `RunConfig`
is an implementation detail about encoding (inline data vs. text), not a meaningful
semantic distinction. In the Gemini API, both land in `contents[0].parts`.

This redesign unifies them.

### 1.1 New `RecipeParams` shape

```ts
interface PromptAppendField {
  id: string;
  label: string;
  placeholder?: string;
  /**
   * Text injected before the reporter's value when concatenating onto the base prompt.
   * e.g. "\n\nYou are specifically looking for:\n\n"
   */
  prefix?: string;
}

interface DriveColumnSpec {
  colTitle: RecipeFieldConfig;
  url: RecipeFieldConfig;
  helperText?: string;
}

interface PromptColumnSpec {
  colTitle: RecipeFieldConfig;
  prompt: RecipeFieldConfig;
  appendFields?: PromptAppendField[];
  helperText?: string;
}

/**
 * A ColumnSpec defines one column in the recipe's sheet setup.
 *
 * `kind` encodes both the population strategy (how Prep fills the column)
 * and the RunConfig role (how the column is used during inference):
 *
 *   drive-file-folder   → one Drive link per row, imported from a folder
 *   drive-file-constant → same Drive link in every row (a reference file)
 *   system-prompt       → same text every row → systemPromptCol in RunConfig
 *   user-prompt         → same text every row → part of userPromptParts (kind: "text")
 *   output              → written by the AI run
 *
 * drive-file-folder and drive-file-constant both become entries in
 * userPromptParts (kind: "file") in RunConfig. The population strategy
 * difference is only relevant during Prep.
 */
type ColumnSpec =
  | ({ kind: "drive-file-folder"   } & DriveColumnSpec)
  | ({ kind: "drive-file-constant" } & DriveColumnSpec)
  | ({ kind: "system-prompt"       } & PromptColumnSpec)
  | ({ kind: "user-prompt"         } & PromptColumnSpec)
  | ({ kind: "output"              } & { colTitle: RecipeFieldConfig; helperText?: string })

/**
 * Non-column AI run settings that a recipe can pre-configure.
 * These flow through PrepRecipeParams → PrepRecipeResult via echo
 * (server does not process them) and are applied when assembling RunConfig.
 */
interface RecipeSettings {
  tools?: ToolId[];
  applyMarkdown?: boolean;
  includeGrounding?: boolean;
  // future: modelId?: string;
}

interface RecipeParams {
  columns: ColumnSpec[];
  /**
   * Optional recipe-level AI run settings. When present, these are pre-applied
   * to RunConfig after Prep — reporters can still adjust them in ConfigureAIRunPanel.
   */
  settings?: RecipeSettings;
}
```

The `columns` array is ordered. `RecipePanel` renders each entry in sequence. The order
of `user-prompt` and `drive-file-*` columns in the array determines the order of parts
sent to Gemini — this is intentional and meaningful.

`DriveColumnSpec` and `PromptColumnSpec` are named atoms, reusable across `kind` variants.

### 1.2 `appendFields` — dynamic prompt injection

`appendFields` on a `PromptColumnSpec` allows reporter-editable text to be concatenated
onto a locked base prompt during Prep. Each field has a `prefix` that provides context
to the model:

```
final prompt = base + prefix_1 + field_value_1 + prefix_2 + field_value_2 + ...
```

`appendFields` applies to both `system-prompt` and `user-prompt` column specs, for
different reasons:

- **`system-prompt`** — the Gemini API's `systemInstruction` field is a single string.
  It cannot be fragmented across multiple parts. If a reporter's customizable input
  (e.g. a search description) must live in the system instruction, concatenation into
  one column is the only option. `appendFields` is load-bearing here.

- **`user-prompt`** — multiple `user-prompt` columns could technically serve the same
  purpose, but consolidating tightly related inputs into one column prevents visual
  clutter in the reporter's sheet. A recipe asking three reporter inputs should not
  produce three fragmented prompt columns when one coherent column serves better.
  `appendFields` is a deliberate UX choice here.

Limitations to know:
- Dynamic content always **appends** — it cannot be interleaved into the middle of the
  base prompt. If mid-prompt injection is needed in a future recipe, the `segments`
  approach (static/dynamic segments in order) would be required.

### 1.3 Updated `RunConfig`

```ts
// shared/types.ts

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

`userPromptCols` and `driveFileCols` are removed. All user message content — text and
files — is expressed as ordered parts.

### 1.4 Updated `PrepRecipeParams` and `PrepRecipeResult`

```ts
// shared/types.ts

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
    // future: modelId?: string;
  };
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
  /**
   * Column names as written to the sheet, in the same order as PrepRecipeParams.columns.
   * The client uses this to assemble RunConfig — it is the single source of truth.
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
    // future: modelId?: string;
  };
}
```

The client's `buildRunConfig()` in `RecipePanel` assembles `RunConfig` from
`PrepRecipeResult.columns` by scanning for kinds:
- `system-prompt` → `systemPromptCol`
- `user-prompt` + `drive-file-folder` + `drive-file-constant` → `userPromptParts` (in order)
- `output` → `outputCol`

### 1.5 Updated `runInference` signature

```ts
// server/inference.ts

export function runInference(
  userPromptParts: Array<{ kind: "text" | "file"; value: unknown }>,
  systemPrompt?: unknown,
  tools?: ToolId[],
): GeminiResponse | null
```

`runBatchAI` in `index.ts` constructs `userPromptParts` from `RunConfig` by reading each
column in order and tagging values with their kind. Text parts pass through `flattenArg`;
file parts are filtered with `isValidDriveLink`, extracted with `extractId`, and encoded
via `prepareDriveAttachments`.

---

## Part 2: ConfigureAIRunPanel — Now and Later

### 2.1 Minimal change (this implementation)

`ConfigureAIRunPanel` keeps its existing two-TagList UX ("User prompt columns" and "Drive
file columns"). Only `assembleRunConfig()` changes — it maps the two selections into
`userPromptParts` with a fixed convention: text parts first, file parts after.

```ts
userPromptParts: [
  ...userPromptCols.map(col => ({ kind: "text" as const, col })),
  ...driveFileCols.map(col => ({ kind: "file" as const, col })),
]
```

Reporters experience no UX change. The underlying data model is correct.

### 2.2 Future: ordered parts UX

> **Note for future implementation.**
>
> The two-bucket UX ("text columns" / "file columns") does not expose the ordering that
> `userPromptParts` now supports. When there is a concrete reporter need for controlling
> the sequence in which context is presented to the model, replace the two TagLists with
> an **ordered parts builder**:
>
> - A single "Message parts" list, rendered in sequence
> - Each row: a column picker + a type badge ("Text" / "File"), type inferred or manually set
> - Up/down controls or drag handles for reordering
> - An "Add part" button to append a new row
>
> Example sequence a reporter might construct:
> ```
> 1. [System Context]     Text  ↑↓ ✕
> 2. [Court Document]     File  ↑↓ ✕
> 3. [Reference Exhibit]  File  ↑↓ ✕
> 4. [Search Question]    Text  ↑↓ ✕
> ```
>
> This is a new `OrderedPartsList` component. The `ConfigureAIRunPanel` template and
> wiring change significantly; `RunConfig` and inference layer are already correct by
> then. The `SavedState` type in `ConfigureAIRunPanel` would drop `userPromptCols` and
> `driveFileCols` in favour of `userPromptParts`.

---

## Part 3: "Find a Thing in a Thing" Recipe

### 3.1 Purpose

Given a folder of files (documents, PDFs, images, audio, video), determine which files
contain a reporter-described item. Supports an optional reference file — any Drive file
type — that illustrates what to look for visually or structurally.

### 3.2 Output format

Each row receives one of: `yes`, `no`, or `unsure`, followed by a single sentence of
reasoning. No other commentary.

### 3.3 Prompt design

**System prompt** (locked base + one `appendField`):

Base:
```
You are a document analyst helping a reporter identify specific items within a collection
of files. For each file you receive, determine whether it contains the item described
below. Respond with exactly one of: "yes", "no", or "unsure". Follow your answer with a
single sentence explaining your reasoning. Do not add any other commentary.

If a reference file is attached, it is a concrete example of what you are looking for —
use it as a visual or structural guide when evaluating the document.
```

AppendField:
```
prefix:  "\n\nYou are specifically looking for:\n\n"
label:   "What are you looking for?"
placeholder: "Describe the item, person, pattern, or visual artifact you want to find"
```

**User prompt** (locked):
```
Analyze the attached file and determine whether it contains the item described in your
instructions.
```

### 3.4 Recipe definition

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
        url: { value: "", locked: false, placeholder: "Paste a Drive link to a reference file (optional)" },
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
            "Do not add any other commentary.\n\nIf a reference file is attached, it is a " +
            "concrete example of what you are looking for — use it as a visual or structural " +
            "guide when evaluating the document.",
          locked: true,
        },
        appendFields: [
          {
            id: "searchDescription",
            label: "What are you looking for?",
            placeholder: "Describe the item, person, pattern, or visual artifact you want to find",
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
  },
}
```

Note: the `drive-file-constant` column (Reference File) is only written to the sheet and
added to `userPromptParts` if the reporter provides a URL. `RecipePanel.buildPrepParams()`
omits it from `PrepRecipeParams` when the url field is empty; `buildRunConfig()` omits it
from `userPromptParts` when absent from `PrepRecipeResult.columns`.

---

## Part 4: Implementation Scope

### Files to change

**Shared types** (`src/shared/types.ts`):
- Replace `userPromptCols` + `driveFileCols` in `RunConfig` with `userPromptParts`
- Replace `PrepRecipeParams` named fields with `columns` array
- Replace `PrepRecipeResult.colNames` with `columns` array

**Client types** (`src/client/types.ts`):
- Replace `RecipeParams` named fields with `columns: ColumnSpec[]`
- Add `PromptAppendField`, `DriveColumnSpec`, `PromptColumnSpec`, `ColumnSpec`
- Remove `RecipeFieldConfig` from `driveFolder`/`referenceFile` (those fields are gone)

**Server — inference** (`src/server/inference.ts`):
- Update `runInference` to accept `userPromptParts: Array<{kind, value}>` instead of
  separate `userPrompts` + `driveLinks` params

**Server — index** (`src/server/index.ts`):
- Update `runBatchAI` to build `userPromptParts` from `RunConfig` and pass to `runInference`
- Update `prepRecipe` to handle the new `PrepRecipeParams.columns` array

**Client — RecipePanel** (`src/client/panels/recipe.ts`):
- Rewrite `mountFields()` to render `ColumnSpec[]` generically
- Rewrite `buildPrepParams()` to produce the new `PrepRecipeParams` shape
- Rewrite `buildRunConfig()` to assemble `userPromptParts` from `PrepRecipeResult.columns`
- Handle `appendFields` concatenation before sending to Prep
- Handle optional `drive-file-constant` (omit when url is empty)

**Client — ConfigureAIRunPanel** (`src/client/panels/configure-ai-run.ts`):
- Update `assembleRunConfig()` to produce `userPromptParts` from the two TagLists
- Update `SavedState` to use `userPromptParts` instead of `userPromptCols`/`driveFileCols`
- Update `mount()` preset logic accordingly

**Client — recipes** (`src/client/recipes.ts`):
- Migrate `document-summarization` recipe to new `columns` shape
- Add `find-a-thing` recipe definition

**Tests** (`__tests__/inference.test.ts`, others):
- Update `runInference` call sites to new signature

### Order of changes

1. `shared/types.ts` — establishes the new contracts everything else builds toward
2. `server/inference.ts` + `server/index.ts` — unblocks server-side testing
3. `client/types.ts` — unblocks panel work
4. `client/panels/recipe.ts` — largest client change
5. `client/panels/configure-ai-run.ts` — minimal wiring change
6. `client/recipes.ts` — add new recipe, migrate existing
7. Tests — update call sites, add coverage for new recipe prep logic
