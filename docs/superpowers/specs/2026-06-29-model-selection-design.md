# Model Selection Design

**Date:** 2026-06-29
**Branch:** feature/model-selection
**Related issue:** none (companion Interactions API migration tracked in #119)

## Overview

Users currently have no way to choose which Gemini model runs their AI inference — the model is hardcoded in `CONFIG.MODEL_NAME`. This PR adds a model selector to the ConfigureAIRunPanel sidebar and threads the selection through `RunConfig` to the Gemini API call. Recipes can also pre-set a model via `settings.model`.

The feature is intentionally narrow: no per-model configuration knobs, no user-editable generation config. Model selection is the only new surface.

## Models supported

| ID | Display name | Best for |
|----|-------------|----------|
| `gemini-3.1-flash-lite` | Gemini 3.1 Flash Lite | Translation, transcription, lightweight data extraction, document processing at scale. Use when cost and speed matter most. |
| `gemini-3.5-flash` | Gemini 3.5 Flash | Rapid agentic loops, complex coding cycles, and iterative multi-step tasks. A great all-rounder. |
| `gemini-3.1-pro-preview` | Gemini 3.1 Pro Preview | Precise tool usage and reliable multi-step execution where accuracy and reasoning depth matter most. |

`gemini-3.1-flash-lite` is the default (matches current `CONFIG.MODEL_NAME`, which is renamed to `CONFIG.DEFAULT_MODEL` to reflect its new role as a fallback). When `RunConfig.model` is absent, `callGeminiAPI` falls back to `CONFIG.DEFAULT_MODEL`.

## Architecture

### Types (`src/shared/types.ts`)

Add `ModelId` alongside `ToolId` — both cross the RPC boundary:

```typescript
export type ModelId = "gemini-3.1-flash-lite" | "gemini-3.5-flash" | "gemini-3.1-pro-preview";
```

Add `model?: ModelId` to `RunConfig`. Add `"model"` to the `RecipeSettings` Pick — recipes get model presetting at no extra cost.

### Client catalog (`src/client/models.ts`)

New file, same pattern as `src/client/tools.ts`:

```typescript
export interface ModelCatalogEntry {
  id: ModelId;
  name: string;
  description: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  { id: "gemini-3.1-flash-lite",  name: "Gemini 3.1 Flash Lite",  description: "..." },
  { id: "gemini-3.5-flash",       name: "Gemini 3.5 Flash",       description: "..." },
  { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", description: "..." },
];
```

No RPC needed — the catalog is static compiled-in data.

### Server thread-through (`src/server/index.ts`)

`GeminiRequest.modelName?: string` already exists and is already used by `callGeminiAPI` / `callGeminiAPIBatch`. The only change is at the request assembly site in `runBatchAI` (currently line ~481):

```typescript
// Before
requests.push({ ...req, apiKey });

// After
requests.push({ ...req, apiKey, modelName: config.model });
```

`callGeminiAPI` already handles `req.modelName ?? CONFIG.MODEL_NAME`, so the fallback to the default model is automatic. No changes to `api.ts`, `inference.ts`, or `server/types.ts`.

### UI (`src/client/panels/configure-ai-run.ts`)

A new collapsible "Model" field group is added above the Tools section, following the same pattern as the Tools collapsible. When collapsed, a summary line shows the currently selected model name (e.g. "Gemini 3.1 Flash Lite"). When expanded, three chips are rendered directly from `MODEL_CATALOG.map()` (not via `SingleTagList` — `SingleTagList` only supports strings as both display text and data-value, but model chips need separate IDs and display names). Click handlers enforce exclusive selection by toggling the `.selected` class, with a `field-helper` paragraph below that updates to show the selected model's description when the selection changes.

`SavedState` gains `model?: ModelId` and `modelExpanded?: boolean` fields. On mount, the preset is restored from `savedState?.model ?? params?.model`, defaulting to `gemini-3.1-flash-lite` if neither is set. `assembleRunConfig` reads the selected model and includes it in the returned `RunConfig`.

### Recipes

Since `RecipeSettings` is `Pick<RunConfig, "tools" | "applyMarkdown" | "includeGrounding" | "prefixWithColName">`, adding `"model"` to that union is the only change. Any recipe can then set `settings: { model: "gemini-3.1-pro-preview" }` and it flows through `buildRunConfig()` into the preppedRunConfig automatically.

## Files changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `ModelId`; add `model?: ModelId` to `RunConfig`; add `"model"` to `RecipeSettings` Pick |
| `src/server/types.ts` | Rename `AppConfig.MODEL_NAME` → `AppConfig.DEFAULT_MODEL` |
| `src/server/config.ts` | Rename `MODEL_NAME` → `DEFAULT_MODEL` in the `CONFIG` object |
| `src/server/api.ts` | Update `CONFIG.MODEL_NAME` reference → `CONFIG.DEFAULT_MODEL` |
| `src/client/models.ts` | New file — `ModelCatalogEntry` interface + `MODEL_CATALOG` array |
| `src/client/panels/configure-ai-run.ts` | Collapsible model selector UI; `SavedState` update; preset restore; `assembleRunConfig` update |
| `src/server/index.ts` | Spread `modelName: config.model` onto `GeminiRequest` at request assembly site |

## Testing

- `configure-ai-run` tests: verify model chip renders, selection flows into `assembleRunConfig` output, savedState round-trips correctly
- Update any `RunConfig` fixtures in existing tests to account for the new optional `model` field (no breakage expected — field is optional)
- No server-side test changes needed (the one-line change in `index.ts` is covered by the existing integration surface)

## Out of scope

- Per-model generation config (temperature, token limits) — deferred
- Inline citation injection for grounding (tracked separately, see #119)
- Interactions API migration (tracked in #119)
