# Dynamic Column Mapping for Run AI — Design

**Date:** 2026-02-24
**Status:** Approved

## Problem

`runBatchAI` currently requires exact hardcoded column headers (`source_drive`, `system_prompt`, `user_prompt`, `ai_inference`) defined in `CONFIG.COLUMNS`. Users cannot use the tool without renaming their columns to match. The `AIMode` ("TEXT" | "FILE") binary forces a choice between text and Drive file input, preventing mixed requests even though `runInference` already supports them natively.

## Goal

Replace the hardcoded column map with a sidebar-driven flow where users select their column mappings at execution time. Remove `AIMode`, `ColumnMap`, `ColumnConfig`, and `CONFIG.COLUMNS` entirely.

---

## Section 1: Types & Data Contract

### Remove from `types.ts`
- `AIMode`
- `ColumnMap`
- `ColumnConfig`
- `AppConfig.COLUMNS`

### Remove from `config.ts`
- `CONFIG.COLUMNS`

### Add to `types.ts`

```ts
export interface RunConfig {
  userPromptCols: string[];    // required; values concatenated as userTexts
  driveFileCols?: string[];    // optional; values passed as driveLinks
  systemPromptCol?: string;    // optional; single column, value used as systemPrompt
  outputCol: string;           // required; created if not found in headers
  rowRange?: { start: number; end: number }; // 1-based, inclusive; overrides sheet selection
}
```

Only `userPromptCols` and `outputCol` are required. Empty/undefined optional fields mean "not selected" — not an error.

---

## Section 2: `runInference` Signature Update

Optional columns should be represented as optional in code. Update `runInference` to use optional parameters and add explicit guards:

```ts
export function runInference(
  userPrompts: unknown,
  driveLinks?: unknown,
  systemPrompt?: unknown,
): string | null {
  const userTexts = flattenArg(userPrompts);
  if (userTexts.length === 0) return null;

  try {
    const inlineData: GeminiInlineData[] = driveLinks !== undefined
      ? flattenArg(driveLinks).filter(isValidDriveLink).map((link) => fetchAndEncodeFile(extractId(link)))
      : [];

    return invokeGemini({
      systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
      userTexts,
      inlineData: inlineData.length ? inlineData : undefined,
    });
  } catch (e) {
    return "Error: " + (e as Error).message;
  }
}
```

---

## Section 3: Sidebar & Server Interface

### New server function: `getSheetHeaders()`

Reads the first row of the active sheet and returns `string[]`. Called by the sidebar on load to populate column pickers. Must be exported from `index.ts` and have a global stub in the Rollup footer.

### Sidebar flow

"Run AI Inference" no longer dispatches via `runTool`. Clicking it reveals an inline config panel within the sidebar. On open, the panel calls `getSheetHeaders()` and renders column pickers once headers are returned.

**Config panel fields:**

| Field | UI control | Required |
|---|---|---|
| User prompt columns | Checkbox list | Yes (≥1) |
| Drive file columns | Checkbox list | No |
| System prompt column | Single-select dropdown (with empty/none option) | No |
| Output column | Dropdown of existing headers + "New column..." option revealing a text input pre-filled with `ai_` | Yes |
| Row range | Radio: "Use sheet selection" (default) / "Specify range" (start + end number inputs) | — |

- If `getSheetHeaders()` returns `[]`: show "No columns found — add headers to your sheet first" and disable Run
- **Run** collects values into a `RunConfig` and calls `google.script.run.runBatchAI(config)` directly (not via `runTool`)
- **Cancel** collapses the panel back to the tool list

### Removals
- `showSourceDialog` (function + `TOOLS` entry)
- `handleDialogSelection`
- `dialog.ts` and its `HTML_TEMPLATE` export

---

## Section 4: `runBatchAI` Implementation

### Signature

```ts
export function runBatchAI(config: RunConfig): void
```

### Steps

1. **Read headers** — `sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]`
2. **Resolve column indices** — for each selected column name, find its index in the header row
3. **Validate** — any column the user explicitly selected must be present in the sheet headers. This includes optional fields if they were set:
   - `userPromptCols` missing → `ui.alert` listing missing names, return early
   - `driveFileCols` selected but missing → same error
   - `systemPromptCol` selected but missing → same error
   - Unset optional fields (`driveFileCols` undefined/empty, `systemPromptCol` undefined) → silently skip
4. **Resolve output column** — if `outputCol` not found, append it as a new header in the next empty column; record that index
5. **Determine row range** — use `config.rowRange` if present; otherwise fall back to `sheet.getActiveRange()`
6. **Loop over rows** — for each row:
   - Collect values at all `userPromptCols` indices → `userPrompts`
   - Collect values at all `driveFileCols` indices if set → `driveLinks`
   - Collect value at `systemPromptCol` index if set → `systemPrompt`
   - Call `runInference(userPrompts, driveLinks, systemPrompt)`
   - If result is `null`, skip; otherwise write to output column cell and flush

### Pure helper: `resolveColumns`

Extract column resolution into a testable pure function:

```ts
function resolveColumns(headers: string[], names: string[]): number[]
```

Returns an array of indices (same order as `names`). Returns `-1` for any name not found. Used inside `runBatchAI` for validation and index lookup.

---

## Section 5: Error Handling Summary

| Scenario | Behavior |
|---|---|
| `getSheetHeaders()` on empty sheet | Returns `[]`; sidebar disables Run |
| Selected column not found at execution | `ui.alert` listing missing columns, return early |
| Unset optional column | Silently skipped |
| `outputCol` not found | Append as new column header, continue |
| Per-row inference failure | Write `"Error: ..."` string to output cell |
| Server throw from sidebar | Existing `withFailureHandler` surfaces message |

---

## Section 6: Testing

- **`runInference`** — update existing tests to use optional param signature; no behavioral changes
- **`resolveColumns`** — new unit tests: all found, partial miss, empty input, empty headers
- **`runBatchAI` / `getSheetHeaders()`** — remain untested per existing pattern for SpreadsheetApp-coupled functions (see `docs/plans/2026-02-18-testing-coverage-design.md`)
- **Sidebar** — manual testing in GAS; no unit tests

---

## Files Touched

| File | Change |
|---|---|
| `src/shared/types.ts` | Remove `AIMode`, `ColumnMap`, `ColumnConfig`, `AppConfig.COLUMNS`; add `RunConfig` |
| `src/server/config.ts` | Remove `COLUMNS` from `CONFIG` and `AppConfig` |
| `src/server/inference.ts` | Update `runInference` to optional params with explicit guards |
| `src/server/index.ts` | Replace `runBatchAI(mode)` with `runBatchAI(config)`; add `getSheetHeaders()`; remove `showSourceDialog`, `handleDialogSelection`; remove `dialog.ts` import |
| `src/server/dialog.ts` | Delete |
| `src/Sidebar.html` | Replace "Run AI Inference" button with inline config panel |
| `rollup.config.js` | Add `getSheetHeaders` global stub; remove `handleDialogSelection`, `showSourceDialog` stubs |
| `__tests__/inference.test.ts` | Update param signatures |
| `__tests__/` | Add `resolveColumns` unit tests |
