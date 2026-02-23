# Consolidate Gemini Call Path Design

**Date:** 2026-02-23
**Status:** Approved

## Context

`SSI` (custom function) and `runBatchAI` (menu tool) each independently look up `GEMINI_API_KEY` from `ScriptProperties` then call `callGeminiAPI`. Any future Gemini-calling feature repeats this pattern. Three related problems are addressed together:

1. **No single Gemini entry point** — callers independently own auth resolution and the API call
2. **`flattenArg` and `TOOL_REGISTRY` are misplaced** — both live in `customFunctions.ts` but belong in dedicated locations
3. **No unified inference handler** — input normalization (text casting, Drive file encoding) is inlined in `runBatchAI`'s loop body with no reusable abstraction

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

The signature takes `Omit<GeminiRequest, "apiKey">` — callers pass `userTexts`, `systemPrompt`, `inlineData`, `tools`, etc. freely. No column mapping or mode logic is encoded here.

`callGeminiAPI` is unchanged — `apiKey: string` stays required in `GeminiRequest`. All existing `api.test.ts` tests continue to pass an explicit key and require no changes.

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

`customFunctions.ts` imports it from `./utils`.

### 3. `src/server/tools.ts` — new module for `TOOL_REGISTRY`

```typescript
import type { GeminiFunctionDeclaration } from "../shared/types";

export const TOOL_REGISTRY: Record<string, GeminiFunctionDeclaration> = {};
```

`customFunctions.ts` imports `TOOL_REGISTRY` from `./tools`.

### 4. `src/server/inference.ts` — new unified inference handler

Single function that accepts raw cell values, normalizes them, executes an `invokeGemini` call, and writes the result to the output cell. Menu-only — does not return a value.

```typescript
export function runInference(
  userPrompts: unknown,
  driveLinks: unknown,
  systemPrompt: unknown,
  outputCell: GoogleAppsScript.Spreadsheet.Range,
): void {
  try {
    const userTexts = flattenArg(userPrompts);

    const inlineData: GeminiInlineData[] = flattenArg(driveLinks)
      .filter(isValidDriveLink)
      .map((link) => fetchAndEncodeFile(extractId(link)));

    const result = invokeGemini({
      systemPrompt: flattenArg(systemPrompt)[0] ?? undefined,
      userTexts,
      inlineData: inlineData.length ? inlineData : undefined,
    });

    outputCell.setValue(result);
  } catch (e) {
    outputCell.setValue("Error: " + (e as Error).message);
  }
}
```

**Input contract:**
- `userPrompts` — any cell-origin value: scalar string, 2D array from a range, or null. `flattenArg` normalizes to `string[]`.
- `driveLinks` — same. Invalid or non-Drive strings are silently filtered; valid links are encoded via `fetchAndEncodeFile`. Pass null/undefined for text-only calls.
- `systemPrompt` — scalar or range; first non-empty string is used. Pass null/undefined to omit.
- `outputCell` — a `Range` object pointing at the cell to receive the result or error.

**Error handling:** all errors (missing API key, network failure, file too large, etc.) are written to `outputCell` as `"Error: <message>"`. This matches the existing per-row behavior in `runBatchAI`.

**Behavior change vs. current `runBatchAI` TEXT mode:** the existing check `sourceText.length <= 5 || sourceText.includes("Error")` is dropped. `runInference` passes whatever text it receives to the model. This validation was a heuristic guard that belongs at the call site if still needed.

### 5. `customFunctions.ts` — thin wrapper

```typescript
import { invokeGemini } from "./api";
import { flattenArg } from "./utils";
import { TOOL_REGISTRY } from "./tools";

export { TOOL_REGISTRY };

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

No behavior change. `SSI` does not use `runInference` — it calls `invokeGemini` directly because it returns a value to the calling cell rather than writing to a Range.

### 6. `index.ts` — `runBatchAI` simplified loop

The API key block is removed. The loop body delegates to `runInference`, passing the appropriate cell values based on mode. Column mapping and mode branching remain in `runBatchAI`:

```typescript
for (let i = 0; i < dataValues.length; i++) {
  const row = dataValues[i];
  const usrPrompt = row[map.user_prompt] as string;
  const realRowIndex = range.getRow() + i;

  if (!usrPrompt) continue;

  SpreadsheetApp.getActive().toast(`Processing Row ${realRowIndex}...`, "AI Agent", -1);

  const userPrompts = mode === "TEXT"
    ? [usrPrompt, row[map.source_text]]
    : [usrPrompt];
  const driveLinks = mode === "FILE" ? row[map.source_drive] : null;

  runInference(
    userPrompts,
    driveLinks,
    row[map.sys_prompt],
    sheet.getRange(realRowIndex, map.output + 1),
  );

  processed++;
  SpreadsheetApp.flush();
}
```

The per-row `try/catch` is removed — `runInference` handles its own errors and writes them to the output cell.

### 7. Module dependency graph (after)

```
index.ts          →  inference.ts (runInference)
inference.ts      →  api.ts (invokeGemini)
                  →  drive.ts (fetchAndEncodeFile)
                  →  utils.ts (flattenArg, isValidDriveLink, extractId)
customFunctions   →  api.ts (invokeGemini)
                  →  utils.ts (flattenArg)
                  →  tools.ts (TOOL_REGISTRY)
api.ts            →  config.ts (unchanged)
tools.ts          →  types.ts (GeminiFunctionDeclaration)
```

`callGeminiAPI` remains exported from `api.ts` for tests.

### 8. Tests

| File | Changes |
|---|---|
| `api.test.ts` | Add `invokeGemini` block: resolves key from mocked `PropertiesService`, throws on missing key, passes params through. Existing tests unchanged. |
| `utils.test.ts` | Add `flattenArg` block: scalar, vertical range, horizontal range, null, empty-cell filtering. |
| `__tests__/inference.test.ts` (new) | Mock `UrlFetchApp`, `PropertiesService`, `DriveApp`, `Utilities` before import. Cases: scalar userPrompts; range userPrompts; valid drive link → encoded inlineData; invalid drive link → filtered; systemPrompt used; systemPrompt omitted; error written to output cell. |
| `customFunctions.test.ts` | No changes — `PropertiesService` mock already in place; all existing tests pass as-is. |

## What This Does Not Change

- `GeminiRequest` interface — `apiKey: string` stays required
- `buildGeminiPayload` — unchanged pure function
- `SSI` public interface and `[SSI Error: ...]` format
- `runBatchAI` column mapping, mode branching, header validation, progress toasts
- Rollup footer stubs and `appsscript.json` — no new GAS entry points
