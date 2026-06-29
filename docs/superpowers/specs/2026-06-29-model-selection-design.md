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
| `gemini-3.1-flash-lite` | Flash Lite | Translation, transcription, lightweight data extraction, document processing at scale. Use when cost and speed matter most. |
| `gemini-3.5-flash` | Flash | Rapid agentic loops, complex coding cycles, and iterative multi-step tasks. A great all-rounder. |
| `gemini-3.1-pro-preview` | Pro Preview | Precise tool usage and reliable multi-step execution where accuracy and reasoning depth matter most. |

`gemini-3.1-flash-lite` is the default (matches current `CONFIG.MODEL_NAME`). When `RunConfig.model` is absent, `callGeminiAPI` already falls back to `CONFIG.MODEL_NAME` — no change needed there.

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
  { id: "gemini-3.1-flash-lite", name: "Flash Lite", description: "..." },
  { id: "gemini-3.5-flash",      name: "Flash",      description: "..." },
  { id: "gemini-3.1-pro-preview", name: "Pro Preview", description: "..." },
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

A new non-collapsible "Model" field group is added above the Tools section. It uses `SingleTagList` for exclusive chip selection across the three models, with a `field-helper` paragraph below that updates to show the selected model's description when the selection changes.

`SavedState` gains a `model?: ModelId` field. On mount, the preset is restored from `savedState?.model ?? params?.model`, defaulting to `gemini-3.1-flash-lite` if neither is set. `assembleRunConfig` reads the selected model and includes it in the returned `RunConfig`.

### Recipes

Since `RecipeSettings` is `Pick<RunConfig, "tools" | "applyMarkdown" | "includeGrounding" | "prefixWithColName">`, adding `"model"` to that union is the only change. Any recipe can then set `settings: { model: "gemini-3.1-pro-preview" }` and it flows through `buildRunConfig()` into the preppedRunConfig automatically.

## Files changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `ModelId`; add `model?: ModelId` to `RunConfig`; add `"model"` to `RecipeSettings` Pick |
| `src/client/models.ts` | New file — `ModelCatalogEntry` interface + `MODEL_CATALOG` array |
| `src/client/panels/configure-ai-run.ts` | Model selector UI; `SavedState` update; preset restore; `assembleRunConfig` update |
| `src/server/index.ts` | Spread `modelName: config.model` onto `GeminiRequest` at request assembly site |

## Testing

- `configure-ai-run` tests: verify model chip renders, selection flows into `assembleRunConfig` output, savedState round-trips correctly
- Update any `RunConfig` fixtures in existing tests to account for the new optional `model` field (no breakage expected — field is optional)
- No server-side test changes needed (the one-line change in `index.ts` is covered by the existing integration surface)

## Out of scope

- Per-model generation config (temperature, token limits) — deferred
- Inline citation injection for grounding (tracked separately, see #119)
- Interactions API migration (tracked in #119)
