# Gemini Tools — Design

**Date:** 2026-03-04
**Scope:** Google Search grounding tool (initial), with architecture that accommodates future grounding and function-calling tools.

---

## Background

The Gemini REST API supports two categories of tools:

- **Grounding tools** (`google_search`, `url_context`, `code_execution`) — declared in the request; Google's servers execute them automatically. No multi-turn loop required.
- **Function-calling tools** — declared in the request as schemas; your code executes them and feeds results back in a second request. Requires a multi-turn loop.

Both categories land in the same `tools` array in the Gemini payload but with different entry shapes:

```json
{ "tools": [
    { "google_search": {} },
    { "function_declarations": [{ "name": "...", "description": "..." }] }
]}
```

This feature introduces Google Search as the first grounding tool, lays the type and registry infrastructure for both tool categories, and exposes tool selection in the `ConfigureAIRunPanel` sidebar UI.

The multi-turn function-calling loop is **out of scope** — the architecture accommodates it without requiring a rewrite, but does not implement it.

---

## 1. Type Reorganization

### Motivation

`shared/types.ts` has accumulated types that never cross the client↔server boundary. This feature is an opportunity to enforce a clean separation.

**Rule:** `shared/types.ts` contains only types that cross `google.script.run` calls.

### `shared/types.ts` — after

```ts
/**
 * Shared types for the SSI Toolkit.
 *
 * IMPORTANT: This file is the client↔server RPC boundary.
 * Only types that cross google.script.run calls belong here.
 * - Server-only types (Gemini API shapes): src/server/types.ts
 * - Client-only types (UI, panels, recipes): src/client/types.ts
 */

/**
 * All tool IDs recognized by the toolkit.
 * Extend this union when adding a new tool — the compiler will then
 * require a matching entry in TOOL_REGISTRY (server/tools.ts)
 * and TOOL_CATALOG (client/tools.ts).
 */
export type ToolId = "google_search";

export interface RunConfig {
  userPromptCols: string[];
  driveFileCols?: string[];
  systemPromptCol?: string;
  outputCol: string;
  rowRange?: { start: number; end: number };
  /** Tool IDs to enable for every row in this run. */
  tools?: ToolId[];
}

export interface PrepRecipeParams {
  driveFolder?: { url: string; colTitle: string };
  systemPrompt?: { colTitle: string; value: string };
  userPrompts?: Array<{ colTitle: string; value: string }>;
  outputCol?: { colTitle: string };
  /** Tool IDs to pass through to PrepRecipeResult for preppedRunConfig assembly. */
  tools?: ToolId[];
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
  colNames: {
    driveLink?: string;
    systemPrompt?: string;
    userPrompts?: string[];
    outputCol?: string;
  };
  /** Echoed from PrepRecipeParams — no server processing, preserves single-source-of-truth invariant. */
  tools?: ToolId[];
}
```

### Moves

| Type | From | To |
|---|---|---|
| `AppConfig` | `shared/types.ts` | `server/types.ts` |
| `GeminiRequest` | `shared/types.ts` | `server/types.ts` |
| `GeminiInlineData` | `shared/types.ts` | `server/types.ts` |
| `GeminiFunctionDeclaration` | `shared/types.ts` | `server/types.ts` |
| `GeminiGenerationConfig` | `shared/types.ts` | `server/types.ts` |
| `DriveFileInfo` | `shared/types.ts` | deleted (unused) |
| `RecipeParams` | `shared/types.ts` | `client/types.ts` |
| `RecipeFieldConfig` | `shared/types.ts` | `client/types.ts` |

---

## 2. Tool Registries

Two registries represent the same tool set from different perspectives — display metadata on the client, payload construction data on the server. `ToolId` is the shared key that links them.

### Client — `client/tools.ts` (new file)

```ts
import type { ToolId } from "../shared/types";

/**
 * Display metadata for a tool shown in the sidebar TagList.
 * No payload or kind information — those are server concerns.
 */
export interface ToolCatalogEntry {
  id: ToolId;
  name: string;
  description: string;
}

/**
 * All tools available for selection in the sidebar.
 * Hardcoded at build time — the tool list is static compiled code,
 * not user data, so no RPC is needed to populate it.
 *
 * When adding a new tool: add a ToolId to shared/types.ts, add an
 * entry here, and add a matching entry to TOOL_REGISTRY in server/tools.ts.
 */
export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: "google_search",
    name: "Google Search",
    description: "Ground responses in live web search results",
  },
];
```

### Server — `server/tools.ts` (replaces current TOOL_REGISTRY)

```ts
import type { ToolId } from "../shared/types";
import type { GeminiFunctionDeclaration } from "./types";

/**
 * Internal discriminated union representing a tool entry in the registry.
 * Not exported — only buildGeminiPayload needs to act on the kind distinction.
 *
 * The Gemini REST API places grounding tools ({ google_search: {} }) and
 * function-calling tools ({ function_declarations: [...] }) as separate
 * entries in the same tools array. buildGeminiPayload splits on `kind`
 * to assemble each correctly.
 */
type GeminiTool =
  | { kind: "grounding"; id: ToolId }
  | { kind: "function"; declaration: GeminiFunctionDeclaration };

/**
 * Server-side tool registry. Maps every ToolId to its payload construction data.
 * Record<ToolId, GeminiTool> enforces at compile time that every ToolId has
 * a matching server implementation — adding a new ToolId without a registry
 * entry is a type error.
 */
export const TOOL_REGISTRY: Record<ToolId, GeminiTool> = {
  google_search: { kind: "grounding", id: "google_search" },
};
```

---

## 3. GeminiRequest and buildGeminiPayload

### `GeminiRequest` (server/types.ts)

`tools` changes from `GeminiFunctionDeclaration[]` to `ToolId[]`. Resolution happens inside `buildGeminiPayload` — `GeminiRequest` stays close to the caller's vocabulary (IDs) rather than the payload's vocabulary (shaped objects).

```ts
export interface GeminiRequest {
  apiKey: string;
  modelName?: string;
  systemPrompt?: string;
  userTexts: string[];
  inlineData?: GeminiInlineData[];
  /** Tool IDs to enable. Resolved against TOOL_REGISTRY in buildGeminiPayload. */
  tools?: ToolId[];
  generationConfig?: GeminiGenerationConfig;
}
```

### `buildGeminiPayload` (api.ts)

Imports `TOOL_REGISTRY`, resolves IDs, splits by kind, assembles the correct Gemini payload structure:

```ts
if (req.tools?.length) {
  const entries = req.tools.map((id) => TOOL_REGISTRY[id]);

  const grounding = entries.filter((t) => t.kind === "grounding");
  const functions = entries
    .filter((t) => t.kind === "function")
    .map((t) => t.declaration);

  const toolsPayload = [
    ...grounding.map((t) => ({ [t.id]: {} })),
    ...(functions.length ? [{ function_declarations: functions }] : []),
  ];

  payload.tools = toolsPayload;
}
```

Note: `buildGeminiPayload` was previously a pure function with no external imports. Importing `TOOL_REGISTRY` breaks that purity, but keeps `GeminiRequest` cleaner and avoids a resolution step in every caller. The tradeoff is accepted.

### SSI custom function (`customFunctions.ts`)

Currently pulls `GeminiFunctionDeclaration` objects directly from the old `TOOL_REGISTRY`. Updated to filter for `kind: "function"` entries and pass IDs to `invokeGemini`:

```ts
const resolvedToolIds = flattenArg(toolNames).map((name) => {
  const entry = TOOL_REGISTRY[name as ToolId];
  if (!entry || entry.kind !== "function")
    throw new Error(`unknown function tool '${name}'`);
  return name as ToolId;
});

return invokeGemini({
  userTexts: flattenArg(userTexts),
  systemPrompt: systemPrompt || undefined,
  tools: resolvedToolIds.length ? resolvedToolIds : undefined,
});
```

---

## 4. Inference Chain

`tools?: ToolId[]` threads through each layer with minimal changes:

```
RunConfig.tools?: ToolId[]
  └─ runBatchAI         passes config.tools to runInference
       └─ runInference  gains tools?: ToolId[] parameter, passes to invokeGemini
            └─ invokeGemini / callGeminiAPI  GeminiRequest.tools already ToolId[]
                 └─ buildGeminiPayload  resolves IDs → assembles payload
```

`runInference` signature change:
```ts
export function runInference(
  userPrompts: unknown[],
  driveLinks: unknown[] | undefined,
  systemPrompt: unknown,
  tools?: ToolId[],   // new
): string | null
```

No other signature changes needed in the inference chain.

---

## 5. UI — ConfigureAIRunPanel

### TagList extension

`TagList` currently accepts `string[]` and returns `string[]` — display value equals stored value. Tools need to display `name` ("Google Search") but return `id` ("google_search").

`TagList` already separates display (`textContent`) from stored value (`data-value`). A backward-compatible extension accepts either format:

```ts
constructor(
  container: HTMLElement,
  items: Array<string | { label: string; value: string }>,
  selected: string[] = [],
)
```

Internally normalized to `{ label, value }` pairs. `getValue()` already reads from `data-value` — no change needed. All existing callers (plain `string[]` headers) continue to work unchanged.

**Rule of thumb:** pass `string[]` when label equals value (column headers); pass `{ label, value }[]` when they diverge (tools).

### ConfigureAIRunPanel changes

New field group in template, after output column, before row range:

```html
<div class="field-group">
  <span class="field-label">Tools <span class="optional">(optional)</span></span>
  <div id="tools-list" class="tag-list"></div>
</div>
```

Tools populated synchronously on mount (no async, unlike headers):

```ts
this.toolsList = new TagList(
  container.querySelector("#tools-list")!,
  TOOL_CATALOG.map((t) => ({ label: t.name, value: t.id })),
  preset.tools ?? [],
);
```

`assembleRunConfig` gains:
```ts
const tools = this.toolsList?.getValue() as ToolId[];
// ...
tools: tools?.length ? tools : undefined,
```

`SavedState` picks up `tools` naturally via `Required<Omit<RunConfig, "rowRange">>` — defaults to `[]` in `unmount()`.

---

## 6. Recipe Compatibility

Tools flow through the recipe prep cycle to preserve the **single-source-of-truth invariant**: `preppedRunConfig` must be assembled entirely from `PrepRecipeResult`, never from local form state.

Tools require no server-side processing during prep (they aren't written to the sheet). `prepRecipe` echoes them from params to result unchanged:

```ts
return {
  rowRange: { ... },
  colNames: { ... },
  tools: params.tools,  // pass-through
};
```

Recipe panel assembles `preppedRunConfig`:
```ts
const preppedRunConfig: Partial<RunConfig> = {
  userPromptCols: result.colNames.userPrompts ?? [],
  // ...other cols from result...
  rowRange: result.rowRange,
  tools: result.tools,  // from result, not form state
};
```

`RecipeParams` type scaffolding for future tool UI in recipes is deferred — the `tools` fields on `PrepRecipeParams` and `PrepRecipeResult` are sufficient to wire it up when needed.

---

## 7. Add-a-Tool Checklist

When adding a new tool in the future:

1. Add its ID to `ToolId` in `src/shared/types.ts`
2. Add a `TOOL_REGISTRY` entry in `src/server/tools.ts` — compile error if skipped (`Record<ToolId, GeminiTool>` enforces completeness)
3. Add a `TOOL_CATALOG` entry in `src/client/tools.ts`

For function-calling tools, also:

4. Implement the function execution logic
5. Extend `invokeGemini` / `callGeminiAPI` with the multi-turn loop

---

## Files Touched

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `ToolId`; add `tools` to `RunConfig`, `PrepRecipeParams`, `PrepRecipeResult`; remove moved types |
| `src/server/types.ts` | New file — absorbs `AppConfig`, `GeminiRequest` (updated), `GeminiInlineData`, `GeminiFunctionDeclaration`, `GeminiGenerationConfig` |
| `src/server/tools.ts` | Replace `TOOL_REGISTRY` with unified `Record<ToolId, GeminiTool>` |
| `src/server/api.ts` | Update `buildGeminiPayload` to import `TOOL_REGISTRY` and resolve tool IDs |
| `src/server/customFunctions.ts` | Update tool resolution to filter `kind: "function"` |
| `src/server/inference.ts` | Add `tools?: ToolId[]` parameter |
| `src/server/index.ts` | Pass `config.tools` to `runInference`; echo tools in `prepRecipe` |
| `src/client/types.ts` | Add `RecipeParams`, `RecipeFieldConfig` (moved from shared) |
| `src/client/tools.ts` | New file — `ToolCatalogEntry`, `TOOL_CATALOG` |
| `src/client/components/tag-list.ts` | Extend to accept `Array<string \| { label, value }>` |
| `src/client/panels/configure-ai-run.ts` | Add tools `TagList`, update `assembleRunConfig` and `SavedState` |
