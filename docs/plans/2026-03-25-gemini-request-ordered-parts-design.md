# GeminiRequest Ordered Parts — Design Document

## Problem

The Gemini REST API represents a user message as an ordered `parts` array. The sequence
of parts matters — the model reads them left-to-right as a document. A text prompt
followed by a file followed by a follow-up question is semantically distinct from the
same three items in a different order.

The current pipeline loses this ordering. `RunConfig` separates user input into two
disjoint pools — `userPromptCols` (text) and `driveFileCols` (files) — and the
assembly layer in `buildGeminiPayload` always emits all text parts first, then appends
all inline-data parts:

```typescript
// api.ts (current)
const parts: GeminiPart[] = req.userTexts.map((text) => ({ text }));
req.inlineData?.forEach((d) => parts.push({ inline_data: d }));
```

This is reflected in `GeminiRequest`, which encodes the same split at the type level:

```typescript
userTexts: string[];
inlineData?: GeminiInlineData[];
```

## Solution

Replace the two-field model with a single ordered `parts: GeminiUserPart[]` array that
directly mirrors the Gemini `contents[].parts` concept. Each part carries a `kind`
discriminant so `buildGeminiPayload` can map it to the correct REST shape without any
append logic.

## Scope

**Phase 1 (this plan):** Refactor the internal server layer only.

- `GeminiRequest`, `buildGeminiPayload`, `runInference`, and `customFunctions.SSI` all
  move to the new model.
- `RunConfig` (the RPC boundary) is **unchanged**. The client still sends separate
  `userPromptCols` and `driveFileCols` arrays. `runBatchAI` translates them into an
  ordered `GeminiUserPart[]` using the existing text-first, files-appended strategy —
  no semantic ordering change for end users yet.
- `drive.ts` (`prepareDriveAttachments`) is **unchanged** — it continues to return
  `GeminiInlineData[]`. The caller wraps each item into a `{ kind: "inline_data" }`
  part.

**Phase 2 (future):** Propagate ordered parts through the RPC boundary and simplify
the shared type interfaces. See the Phase 2 design section below.

**Phase 3 (future):** Wire up the Gemini Files API for files exceeding the inline size
limit. The `file_uri` variant in `GeminiUserPart` is already present; this phase only
requires adding a producer in `drive.ts`.

## New Types

### `GeminiUserPart` (added to `server/types.ts`)

```typescript
export type GeminiUserPart =
  | { kind: "text"; text: string }
  | { kind: "inline_data"; data: GeminiInlineData }
  | { kind: "file_uri"; mimeType: string; fileUri: string };
```

Three variants, not two:

- **`"text"`** — maps to `{ text: string }` in the REST payload.
- **`"inline_data"`** — maps to `{ inline_data: { mime_type, data } }`. This is what
  `prepareDriveAttachments` currently produces. Phase 1 only uses this variant.
- **`"file_uri"`** — maps to `{ file_data: { mime_type, file_uri } }`. This is the
  Gemini Files API path (for files > ~100 MB). Adding the variant now means Phase 3
  (Files API upload support) only requires wiring up the producer; the type and
  payload-assembly path already exist. `buildGeminiPayload` handles it; nothing in
  Phase 1 produces it.

### `GeminiRequest` (updated in `server/types.ts`)

```typescript
export interface GeminiRequest {
  apiKey: string;
  modelName?: string;
  systemPrompt?: string;
  parts: GeminiUserPart[];        // replaces userTexts + inlineData
  tools?: ToolId[];
  generationConfig?: GeminiGenerationConfig;
}
```

`GeminiInlineData` is retained — `drive.ts` still uses it as its return type.

## Layer Responsibilities After Phase 1

| Layer | File | Responsibility |
|---|---|---|
| REST payload assembly | `api.ts` | Map `GeminiUserPart[]` → Gemini REST parts; no ordering logic |
| Drive resolution | `drive.ts` | Fetch files, return `GeminiInlineData[]`; no knowledge of `GeminiUserPart` |
| Inference assembly | `inference.ts` | Wrap text strings and `GeminiInlineData` into `GeminiUserPart[]`; text-first ordering |
| Custom function | `customFunctions.ts` | Wrap text strings into `GeminiUserPart[]` before calling `invokeGemini` |
| Batch orchestrator | `index.ts` | Unchanged — delegates assembly to `runInference` |

## What Does Not Change (Phase 1)

- `RunConfig` and all types in `shared/types.ts`
- `drive.ts` (including `prepareDriveAttachments` return type)
- `runInference` external signature
- `runBatchAI` in `index.ts`
- The REST payload shape emitted to Gemini (same JSON, assembled differently)
- All `inference.test.ts` tests (they check the outgoing HTTP payload, which is
  unchanged)

---

## Phase 2 Design

Phase 2 has two goals: propagate ordered parts through the RPC boundary, and
consolidate the shared type interfaces that have accumulated redundant structure.

### The Redundancy Problem

`PrepRecipeResult.colNames` exists solely to be translated into `RunConfig` fields by
`buildRunConfig()` in `recipe.ts`:

```typescript
// recipe.ts — pure renaming, no logic
private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
  return {
    driveFileCols: result.colNames.driveLink ? [result.colNames.driveLink] : undefined,
    systemPromptCol: result.colNames.systemPrompt,
    userPromptCols: result.colNames.userPrompts ?? [],
    outputCol: result.colNames.outputCol ?? "",
    rowRange: result.rowRange,
  };
}
```

`colNames` uses different field names than `RunConfig` for the same concepts, so a
translation step is required. That translation is the symptom; the `colNames` nesting
with mismatched names is the cause.

### The `kind` Discriminant Across the Stack

After Phase 2, a single `kind: "text" | "file"` discriminant flows consistently through
every layer, getting richer or simpler depending on whether the layer is creating,
referencing, or resolving columns:

| Layer | Type | Role | Per-kind payload |
|---|---|---|---|
| `PrepRecipeParams` | `PrepRecipeColSpec[]` | Column creation | `text: { value }`, `file: { folderUrl? }` |
| `PrepRecipeResult` | `PromptColumnSpec[]` | Column reference | none — bare col name + kind |
| `RunConfig` | `PromptColumnSpec[]` | Run configuration | none — bare col name + kind |
| `GeminiUserPart` | discriminated union | Gemini REST part | `text: { text }`, `inline_data: { data }`, `file_uri: { fileUri }` |

The `kind` is richer at the creation layer (needs to know *what to write*), collapses to
a bare reference in the middle (just *which column and what kind*), then expands again at
the inference layer (needs to know *what to send to Gemini*).

### New Shared Types

**`PromptColumnSpec`** (added to `shared/types.ts`):

```typescript
export interface PromptColumnSpec {
  col: string;
  kind: "text" | "file";
}
```

This is the user-facing column kind — `"text"` or `"file"`. The server-side distinction
between `"inline_data"` and `"file_uri"` is a resolution concern internal to
`drive.ts` and `inference.ts`; it never crosses the RPC boundary.

**`RunConfig`** (updated in `shared/types.ts`):

```typescript
export interface RunConfig {
  promptCols: PromptColumnSpec[];   // replaces userPromptCols + driveFileCols
  systemPromptCol?: string;
  outputCol: string;
  rowRange?: { start: number; end: number };
  tools?: ToolId[];
  includeGrounding?: boolean;
  applyMarkdown?: boolean;
}
```

**`PrepRecipeResult`** (updated in `shared/types.ts`):

```typescript
export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
  promptCols?: PromptColumnSpec[];  // replaces colNames.driveLink + colNames.userPrompts
  systemPromptCol?: string;         // replaces colNames.systemPrompt
  outputCol?: string;               // replaces colNames.outputCol
  tools?: ToolId[];
}
```

The `colNames` nesting is eliminated. Field names now match `RunConfig` directly.
`PrepRecipeResult` is shaped like a `Partial<RunConfig>` with `rowRange` required —
the server always detects the row range, and the client can trust it.

**`PrepRecipeColSpec`** (added to `shared/types.ts`):

```typescript
export type PrepRecipeColSpec =
  | { kind: "text"; colTitle: string; value: string }
  | { kind: "file"; colTitle: string; folderUrl?: string };
```

Used in `PrepRecipeParams` to express ordered column creation instructions. Richer than
`PromptColumnSpec` because it carries creation data (`value` for text columns,
`folderUrl` for file columns). `folderUrl` is optional — some recipes pre-populate file
columns via other means (e.g. a prior Import Drive Links step).

**`PrepRecipeParams`** (updated in `shared/types.ts`):

```typescript
export interface PrepRecipeParams {
  promptCols?: PrepRecipeColSpec[];   // replaces userPrompts + driveFolder
  systemPrompt?: { colTitle: string; value: string };
  outputCol?: { colTitle: string };
  tools?: ToolId[];
}
```

The `driveFolder` and `userPrompts` fields are replaced by an ordered `promptCols`
array. The server iterates it in order, creates each column, populates it (Drive folder
listing for `file` kind, static value for `text` kind), then emits `PrepRecipeResult`
with `promptCols: PromptColumnSpec[]` preserving that same order.

### Effect on `recipe.ts`

`buildRunConfig()` becomes a trivial spread and can likely be inlined:

```typescript
private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
  return {
    promptCols: result.promptCols,
    systemPromptCol: result.systemPromptCol,
    outputCol: result.outputCol ?? "",
    rowRange: result.rowRange,
    tools: result.tools,
  };
}
```

### Effect on `index.ts` (`prepRecipe`)

The server-side `prepRecipe` function currently assembles `colNames` with its own field
names. In Phase 2 it assembles `promptCols: PromptColumnSpec[]` directly, ordering
columns in the recipe's intended sequence. The recipe definition on the server carries
this ordering knowledge; the client never needs to infer it.

### Effect on `runBatchAI`

`RunConfig.promptCols` replaces the two separate index arrays. `runBatchAI` iterates
`promptCols` in order, resolving each column by header name and building a
`GeminiUserPart[]` that preserves the declared sequence — text columns as
`{ kind: "text" }` parts, file columns fetched via `prepareDriveAttachments` and
wrapped as `{ kind: "inline_data" }` parts.

### Phase 2 Files Touched

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `PromptColumnSpec`, `PrepRecipeColSpec`; update `RunConfig`, `PrepRecipeParams`, `PrepRecipeResult` |
| `src/server/index.ts` | Update `prepRecipe` to accept `PrepRecipeColSpec[]` and emit ordered `PromptColumnSpec[]`; update `runBatchAI` to iterate `promptCols` |
| `src/client/panels/recipe.ts` | Update `buildPrepParams` to assemble `promptCols`; simplify `buildRunConfig` to spread `PrepRecipeResult` |
| `src/client/recipes.ts` | Update `RecipeDefinition` params to use ordered `PrepRecipeColSpec[]` format |
| `src/client/panels/configure-ai-run.ts` | Redesign column-picker UI (separate design pass — do last) |
| `src/client/google.d.ts` | Update RPC stubs if any signatures change |
| Relevant tests | Update to new field names and structures |

### Phase 2 Entry Point

A new session picking up Phase 2 should start by reading:
- This document
- `src/shared/types.ts` — current RPC boundary types
- `src/server/index.ts` — `prepRecipe` and `runBatchAI` implementations
- `src/client/panels/recipe.ts` — `buildPrepParams` and `buildRunConfig`
- `src/client/recipes.ts` — recipe definitions using the old format

The `configure-ai-run.ts` UI redesign should be treated as a separate sub-task within
Phase 2 and done last, after the data layer is working end-to-end.
