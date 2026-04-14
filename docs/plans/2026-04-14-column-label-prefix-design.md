# Column Label Prefix for User Prompt Parts

**Date:** 2026-04-14
**Status:** Design complete, ready for implementation

## Problem

When the AI receives multiple prompt columns as separate parts in a single turn, it has no inherent way to know which piece of content came from which column. A document text, a URL, and a category label all arrive as bare strings with no semantic context. Adding the column name as a label prefix — e.g. `"Summary: <value>"` — gives the model explicit grounding for how to interpret each input.

## Goals

- Allow users to opt in to prefixing each text part with its source column name
- Keep the prefixing as a run-level toggle (not per-column) — consistent labeling is the common case
- Preserve the separation of concerns between `runBatchAI` (sheet I/O) and `runInference` (prompt assembly)
- File inputs (`kind: "file"`) are unaffected — `inline_data` parts cannot be labeled this way

## Design Decisions

### Global flag, not per-column

A single `prefixWithColName?: boolean` on `RunConfig` is sufficient. Per-column control would add UI complexity (a toggle per row in `PromptColList`) for marginal benefit — users will almost always want uniform labeling across all columns. The global flag is trivially convertible to per-column if needed later.

### Label carried through `PromptInput`, not pre-applied in `runBatchAI`

`runBatchAI` reads the `RunConfig` flag and conditionally sets `label: pc.col` on each `PromptInput` it builds. `runInference` then applies the prefix during part assembly, right where `flattenArg` already normalizes values into strings.

This respects the established role boundaries:
- `runBatchAI` decides *what sheet-derived context to forward* based on configuration
- `runInference` decides *how to assemble the final prompt parts* from its inputs

Pre-applying the prefix in `runBatchAI` would require calling `flattenArg` there (duplicating normalization logic) and would make the value in `PromptInput` a pre-processed string rather than a raw cell value.

### `label`, not `colName`, on `PromptInput`

`PromptInput` is a server-only type that abstracts away spreadsheet specifics. Naming the field `label` keeps it semantically neutral — `runInference` doesn't need to know that the label originated from a column name.

### Prefixing happens in `runInference` during text part assembly

For `kind: "text"` inputs with a `label`, each string produced by `flattenArg` is prepended with `"${label}: "`. The result is still a `{ text: string }` part — no structural change to the Gemini payload.

File inputs (`kind: "file"`) produce `{ inline_data }` parts. The `label` field is ignored for file inputs — binary content cannot be labeled inline.

## Architecture

### Data flow

```
ConfigureAIRunPanel
  prefixWithColName checkbox
    ↓ assembleRunConfig()
RunConfig.prefixWithColName?: boolean   [RPC boundary: shared/types.ts]
    ↓ google.script.run → runBatchAI()
PromptInput.label?: string              [server-only: server/types.ts]
    ↓ runInference()
GeminiUserPart { text: "ColName: value" }
    ↓ invokeGemini()
Gemini REST payload
```

### Files to touch

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `prefixWithColName?: boolean` to `RunConfig` |
| `src/server/types.ts` | Add `label?: string` to `PromptInput` |
| `src/server/index.ts` | In `runBatchAI`, populate `label: pc.col` in each `PromptInput` when `config.prefixWithColName` is true |
| `src/server/inference.ts` | When `input.label` is set on a text input, prepend `"${input.label}: "` to each text string during part assembly |
| `src/client/panels/configure-ai-run.ts` | Add `#prefix-col-name-cb` checkbox; wire into `assembleRunConfig()`, `unmount()`, `currentPreset()`, and `SavedState` — same pattern as `applyMarkdown` |

### No other files need to change

`PromptColList` is unchanged — the flag is run-level, not per-column. `google.d.ts`, `rollup.config.js`, and `services.ts` are unaffected. `customFunctions.ts` (`SSI()`) does not use `PromptInput` and is unaffected.

## UI Placement

The checkbox sits directly below the User Prompt Columns section label, parallel to where `applyMarkdown` sits below Output Column. Label: **"Prefix parts with column name"**. Helper text (optional, if space allows): "Prepends each column's name to its value before sending to the AI."

The checkbox is unchecked by default.
