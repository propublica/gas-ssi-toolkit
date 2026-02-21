# GEMINI Custom Function Design

**Date:** 2026-02-21
**Status:** Approved

## Context

The existing Tool 4 (`runBatchAI`) calls `callGeminiAPI` from a menu-triggered function with full access to `PropertiesService`. This design adds a `GEMINI` Sheets custom function that exposes the same API capability directly from a cell formula, mirroring the `GeminiRequest` interface as closely as makes sense from a spreadsheet user's perspective.

Key constraints for custom functions:
- Cannot display UI (no `SpreadsheetApp.getUi()`, no dialogs)
- `PropertiesService.getScriptProperties()` is available when the add-on has been authorized — the existing `GEMINI_API_KEY` script property is reused
- Errors must be returned as strings rather than thrown (thrown exceptions show as generic script errors in the cell)
- Range arguments arrive as 2D arrays; single-cell arguments arrive as raw scalars

## Design

### 1. `GeminiRequest.inlineData` — upgrade to array

`inlineData` changes from `GeminiInlineData` (singular) to `GeminiInlineData[]` (plural). The Gemini API supports multiple `inline_data` parts in a single user message; the interface should reflect this.

```typescript
// src/shared/types.ts
export interface GeminiRequest {
  apiKey: string;
  modelName?: string;
  systemPrompt?: string;
  userTexts: string[];
  inlineData?: GeminiInlineData[];  // was: GeminiInlineData
  tools?: GeminiFunctionDeclaration[];
  generationConfig?: GeminiGenerationConfig;
}
```

`buildGeminiPayload` loops over the array:
```typescript
req.inlineData?.forEach((d) => parts.push({ inline_data: d }));
```

`runBatchAI` wraps its single file in an array:
```typescript
inlineData: [fetchAndEncodeFile(extractId(link))]
```

### 2. `src/server/customFunctions.ts` — new module

**Function signature:**

```typescript
/**
 * Call the Gemini API from a spreadsheet cell.
 *
 * @param {string|Array} userTexts  One or more text parts for the user message.
 *   Pass a single string, a cell reference, or a range/array literal.
 * @param {string|Array?} inlineData  Drive URL(s) or file ID(s) to attach as
 *   inline data. Pass a single URL, a cell reference, or a range/array literal.
 * @param {string?} systemPrompt  System-level instruction for the model.
 * @param {string|Array?} toolNames  Names of pre-registered tools to enable.
 * @return {string} The model's text response, or an error string on failure.
 * @customfunction
 */
export function GEMINI(
  userTexts: unknown,
  inlineData?: unknown,
  systemPrompt?: string,
  toolNames?: unknown,
): string
```

**Input normalization:**

GAS passes single-cell references as raw scalars and ranges as 2D arrays. A shared helper normalizes both:

```typescript
function flattenArg(val: unknown): string[] {
  if (!Array.isArray(val)) return val != null ? [String(val)] : [];
  return (val as unknown[][]).flat()
    .filter((v) => v !== "" && v != null)
    .map(String);
}
```

Array literals (`{A1,B1,C1}`) are expected to arrive as `[[v1, v2, v3]]` (matching horizontal range behavior) and are handled by the same helper. This should be verified manually after deployment.

**Tool registry:**

```typescript
const TOOL_REGISTRY: Record<string, GeminiFunctionDeclaration> = {
  // Populated as concrete tool use cases are designed.
};
```

Unknown tool names cause the function to return `"[GEMINI Error: unknown tool 'name']"` rather than silently dropping them.

**API key:**

```typescript
const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
if (!apiKey) return "[GEMINI Error: GEMINI_API_KEY script property not set]";
```

Reuses the same script property as Tool 4. If the property is missing, an actionable error string is returned.

**Error handling:**

All errors are caught and returned as `"[GEMINI Error: ...]"` strings. Custom functions display return values in the cell — thrown exceptions produce unhelpful generic error messages.

### 3. Wiring

Per CLAUDE.md's two-step rule for exposing functions to Apps Script:

1. Re-export `GEMINI` from `src/server/index.ts`:
   ```typescript
   export { GEMINI } from "./customFunctions";
   ```

2. Add a global stub to the `footer` in `rollup.config.js`:
   ```js
   function GEMINI(userTexts, inlineData, systemPrompt, toolNames) {
     return _GASEntry.GEMINI(userTexts, inlineData, systemPrompt, toolNames);
   }
   ```

### 4. Tests — `__tests__/customFunctions.test.ts`

All GAS globals (`UrlFetchApp`, `DriveApp`, `Utilities`, `PropertiesService`) are mocked before imports, following the existing pattern in `api.test.ts` and `drive.test.ts`.

Test cases:
- Single string `userTexts` → flattened to `["text"]`, correct payload
- Vertical range `userTexts` (`[[v1],[v2]]`) → flattened to `[v1, v2]`
- Horizontal range `userTexts` (`[[v1, v2]]`) → flattened to `[v1, v2]`
- Empty cells filtered from ranges
- `inlineData` with two Drive URLs → two `inline_data` parts in payload
- `inlineData` omitted → no `inline_data` parts
- `systemPrompt` passed → correct `system_instruction` in payload
- `systemPrompt` omitted → default system prompt used
- Known tool name → `tools` present in payload
- Unknown tool name → returns `"[GEMINI Error: unknown tool ...]"`
- Missing API key → returns `"[GEMINI Error: GEMINI_API_KEY ...]"`
- `UrlFetchApp` error → returns `"[GEMINI Error: ...]"`
- Happy path → correct text response

### 5. Updated coverage thresholds

`jest.config.cjs` gains a threshold entry for `src/server/customFunctions.ts`:
```js
"./src/server/customFunctions.ts": {
  statements: 90,
  branches: 85,
  functions: 100,
},
```

## What This Does Not Include

- Caching via `CacheService` — Sheets caches custom function results automatically for identical inputs; explicit caching is deferred unless quota issues arise in practice
- Array literal `{...}` argument behavior — must be verified manually after deployment; the implementation handles the expected shape but GAS docs don't officially specify this case
- Tool implementations — the registry is empty at launch; tools are added as concrete use cases are designed
- `modelName` and `generationConfig` parameters — omitted from the custom function signature for simplicity; the function uses `CONFIG.MODEL_NAME` and default generation config
