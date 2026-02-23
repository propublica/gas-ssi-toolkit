# Consolidate Gemini Call Path Design

**Date:** 2026-02-23
**Status:** Approved

## Context

`SSI` (custom function) and `runBatchAI` (menu tool) each independently look up `GEMINI_API_KEY` from `ScriptProperties` then call `callGeminiAPI`. Any future Gemini-calling feature repeats this pattern. Two related problems are addressed together:

1. **No single Gemini entry point** — callers independently own auth resolution and the API call
2. **`flattenArg` and `TOOL_REGISTRY` are misplaced** — both live in `customFunctions.ts` but belong in dedicated locations

## Design

### 1. `api.ts` — add `invokeGemini`

New exported function that owns auth resolution and delegates to `callGeminiAPI`:

```typescript
export function invokeGemini(params: Omit<GeminiRequest, "apiKey">): string {
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
  if (!apiKey) throw new Error(`${CONFIG.API_KEY_PROPERTY} script property not set`);
  return callGeminiAPI({ apiKey, ...params });
}
```

The signature takes `Omit<GeminiRequest, "apiKey">` — callers pass `userTexts`, `systemPrompt`, `inlineData`, `tools`, etc. freely. No column mapping or mode logic is encoded here; those remain the caller's responsibility.

`callGeminiAPI` is unchanged — `apiKey: string` stays required in `GeminiRequest`. All existing `api.test.ts` tests pass an explicit key and require no changes. New `invokeGemini` tests are added to `api.test.ts`, mocking `PropertiesService` as a `globalThis` property before imports (the same pattern already used in `customFunctions.test.ts`).

### 2. `utils.ts` — add `flattenArg`

`flattenArg` moves from `customFunctions.ts` to `utils.ts` and is exported:

```typescript
export function flattenArg(val: unknown): string[] {
  if (!Array.isArray(val)) return val != null ? [String(val)] : [];
  return (val as unknown[][])
    .flat()
    .filter((v) => v !== "" && v != null)
    .map(String);
}
```

`customFunctions.ts` imports it from `./utils`. `utils.test.ts` gains a `flattenArg` describe block covering: scalar string, vertical range (`[[v1],[v2]]`), horizontal range (`[[v1,v2]]`), null input, and empty-cell filtering.

### 3. `src/server/tools.ts` — new module for `TOOL_REGISTRY`

```typescript
import type { GeminiFunctionDeclaration } from "../shared/types";

export const TOOL_REGISTRY: Record<string, GeminiFunctionDeclaration> = {};
```

`customFunctions.ts` imports `TOOL_REGISTRY` from `./tools`. This gives tool declarations a dedicated home as concrete use cases are added. No behavior change.

### 4. `customFunctions.ts` — thin wrapper

```typescript
import { invokeGemini } from "./api";
import { flattenArg } from "./utils";
import { TOOL_REGISTRY } from "./tools";

export function SSI(userTexts: unknown, systemPrompt?: string, toolNames?: unknown): string {
  try {
    const resolvedTools = flattenArg(toolNames).map((name) => {
      const decl = TOOL_REGISTRY[name];
      if (!decl) throw new Error(`unknown tool '${name}'`);
      return decl;
    });
    return invokeGemini({
      systemPrompt: systemPrompt || undefined,
      userTexts: flattenArg(userTexts),
      tools: resolvedTools.length ? resolvedTools : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `[SSI Error: ${msg}]`;
  }
}
```

No behavior change. The `try/catch` → error string contract is preserved.

### 5. `index.ts` — `runBatchAI` calls `invokeGemini`

Replace the API key lookup and `callGeminiAPI` calls. The column mapping, mode branching, and all other logic in `runBatchAI` are untouched:

```typescript
// Before
const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
if (!apiKey) { ui.alert(...); return; }
// ...
result = callGeminiAPI({ apiKey, systemPrompt, userTexts: [usrPrompt, sourceText] });
result = callGeminiAPI({ apiKey, systemPrompt, userTexts: [usrPrompt], inlineData });

// After
result = invokeGemini({ systemPrompt, userTexts: [usrPrompt, sourceText] });
result = invokeGemini({ systemPrompt, userTexts: [usrPrompt], inlineData });
```

The upfront `ui.alert` for a missing key is removed. A missing key now throws inside `invokeGemini` and is caught by the existing per-row `try/catch`, writing `"Error: GEMINI_API_KEY script property not set"` to the first affected output cell. This is a minor UX change — the key-missing case is a configuration error that should be caught during setup.

`callGeminiAPI` is no longer imported in `index.ts`.

### 6. Module dependency graph (after)

```
index.ts          →  api.ts (invokeGemini)
customFunctions   →  api.ts (invokeGemini)
                  →  utils.ts (flattenArg)
                  →  tools.ts (TOOL_REGISTRY)
api.ts            →  config.ts (unchanged)
tools.ts          →  types.ts (GeminiFunctionDeclaration)
```

`callGeminiAPI` remains exported from `api.ts` for tests and any caller that needs to supply its own key.

### 7. Tests

| File | Changes |
|---|---|
| `api.test.ts` | Add `invokeGemini` block: resolves key from mocked `PropertiesService`, throws on missing key, passes params through to `callGeminiAPI`. Existing tests unchanged. |
| `utils.test.ts` | Add `flattenArg` block: scalar, vertical range, horizontal range, null, empty-cell filtering. |
| `customFunctions.test.ts` | No changes — `PropertiesService` mock already in place; all existing tests pass as-is. |

Coverage thresholds: add entry for `src/server/tools.ts` in `jest.config.cjs`.

## What This Does Not Change

- `GeminiRequest` interface — `apiKey: string` stays required
- `buildGeminiPayload` — unchanged pure function
- `SSI` public interface and `[SSI Error: ...]` format
- `runBatchAI` column mapping, mode branching, header validation, progress toasts, per-row error handling
- Rollup footer stubs and `appsscript.json` — no new GAS entry points
