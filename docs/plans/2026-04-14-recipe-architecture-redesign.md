# Recipe Architecture Redesign

**Date:** 2026-04-14
**Status:** Approved

## Goals

1. Break `ColumnDef` out of its tri-purpose role (UI rendering + spreadsheet prep + RunConfig assembly) into focused, independent structures.
2. Make recipes feel like a single action to the journalist — a small number of discrete inputs, then run.
3. Allow recipe authors to work with types already familiar from the rest of the system (`PrepColSpec`, `RunConfig`) rather than recipe-specific abstractions.

## Out of Scope

- Collapsing prep and cook into a single server action (future iteration).
- User-authored or saved recipes. Recipes remain code-defined presets.
- `generationConfig` / `modelName` overrides at the recipe level.

---

## Core Insight

A recipe has four distinct jobs, each now handled by a focused structure:

| Job | Structure | Lives in |
|-----|-----------|----------|
| Discovery (recipes list) | `id`, `name`, `icon`, `description` on `RecipeDefinition` | `client/types.ts` |
| Input collection (journalist form) | `UserInput[]` | `client/types.ts` |
| Spreadsheet prep | `prepTemplate: PrepColSpec[]` | `shared/types.ts` (existing type) |
| AI run configuration | `runTemplate: Partial<RunConfig>` | `shared/types.ts` (existing type) |

`prepTemplate` and `runTemplate` are linked only by matching column title strings — the same convention used by `RunConfig` everywhere else in the system. Neither needs to know about the other's structure.

---

## New Interfaces

### `src/client/types.ts`

Remove: `RecipeFieldConfig`, `ColStrategyKind`, `ColRole`, `AppendField`, `RecipeSettings`, `ColumnDef`, `RecipeParams`.

Add:

```ts
export interface UserInput {
  id: string;
  label: string;
  required?: boolean;
  helperText?: string;
  placeholder?: string;
}

export interface RecipeDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  inputs: UserInput[];
  prepTemplate: PrepColSpec[];
  runTemplate: Partial<RunConfig>;
}
```

### `src/shared/types.ts`

`ColStrategy` gains a `template` variant and `list-drive-folder` switches from a static `url` to an `inputId` reference:

```ts
export type ColStrategy =
  | { kind: "list-drive-folder"; inputId: string }
  | { kind: "fill-value"; value: string }
  | { kind: "template"; template: string }  // {{inputId}} placeholders resolved at prep time
  | { kind: "create-empty" };
```

`PrepRecipeParams` gains `inputValues` so the server can resolve `inputId` references:

```ts
export interface PrepRecipeParams {
  cols: PrepColSpec[];
  inputValues: Record<string, string>;
}
```

`PrepRecipeResult` is unchanged.

---

## Binding: How Inputs Connect to Columns and Settings

`UserInput.id` is the universal binding key. It appears in:

- **`ColStrategy`** — `list-drive-folder` and `template` variants reference `inputId` to pull journalist-provided values into column fill strategies at prep time.
- **`RunConfig` settings (future)** — any setting can optionally reference an `inputId` using the same pattern when a journalist-editable setting is needed.

The `RecipePanel` collects `inputValues: Record<string, string>` from the form and sends them alongside `prepTemplate` in `PrepRecipeParams`. The server resolves all `inputId` references server-side before writing columns.

---

## Example: Document Summarization Recipe

```ts
{
  id: "document-summarization",
  name: "Document Summarization",
  icon: "📄",
  description: "Summarize each file in a Google Drive folder",
  inputs: [
    {
      id: "folder",
      label: "Drive Folder",
      required: true,
      helperText: "Make sure you have access to this folder",
      placeholder: "Paste Google Drive folder URL",
    },
  ],
  prepTemplate: [
    { colTitle: "Drive Link",       strategy: { kind: "list-drive-folder", inputId: "folder" } },
    { colTitle: "System Prompt",    strategy: { kind: "fill-value", value: "You are an expert document analyst. Produce clear, structured summaries focusing on key themes, main arguments, important data points, and actionable conclusions." } },
    { colTitle: "User Prompt",      strategy: { kind: "fill-value", value: "Please summarize the attached document. Include the main topics, key findings, and important conclusions." } },
    { colTitle: "AI_Summarization", strategy: { kind: "create-empty" } },
  ],
  runTemplate: {
    promptCols: [
      { col: "Drive Link",    kind: "file" },
      { col: "User Prompt",  kind: "text" },
    ],
    systemPromptCol: "System Prompt",
    outputCol: "AI_Summarization",
  },
}
```

---

## Files to Modify

```
src/client/types.ts        ← remove ColumnDef cluster, add UserInput + updated RecipeDefinition
src/shared/types.ts        ← update ColStrategy, update PrepRecipeParams
src/client/recipes.ts      ← rewrite RECIPES array under new RecipeDefinition shape
src/client/panels/recipe.ts ← rewrite RecipePanel: render inputs[], collect inputValues,
                              pass prepTemplate + inputValues on prep,
                              assemble preppedRunConfig from runTemplate + result.rowRange on cook
src/server/index.ts        ← update prepRecipe() to accept inputValues, resolve inputId refs
                              in list-drive-folder and template strategies
```

---

## What Gets Simpler

- `RecipePanel` only needs to know about `inputs` to render the form. No column cards, no lockable fields per column, no tri-purpose ColumnDef loop.
- Recipe authors read `prepTemplate` and `runTemplate` independently. Prep strategy and AI role are no longer entangled on the same object.
- Adding a new recipe is: define `inputs`, define columns with fill strategies, define a partial `RunConfig`. All familiar types.
