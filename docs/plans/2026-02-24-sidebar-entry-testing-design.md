# Sidebar Entry Point Testing Design

**Date:** 2026-02-24
**Status:** Approved

## Goals

1. Test the callback logic inside `sidebar-entry.ts` (success/failure handlers for `showAIPanel`,
   `dispatchTool`, and `runAI`).
2. Eliminate duplicated DOM fixture setup across test files by extracting a shared fixture module.
3. Update `jest.config.cjs` so `sidebar-entry.ts` is included in coverage collection with
   per-file thresholds.

## Out of Scope

- Testing `init()` — it is private and contains only `addEventListener` wiring with no branching
  logic. Excluded for the same reason server-side listener orchestration is excluded.

---

## File Structure

### New files

```
__tests__/
  helpers/
    sidebar-fixtures.ts       ← shared HTML string + setup utilities
  sidebar-entry.test.ts       ← tests for exported entry point functions
```

### Modified files

```
src/client/sidebar-entry.ts   ← export showAIPanel, hideAIPanel, dispatchTool, runAI
__tests__/sidebar.test.ts     ← replace local setup helpers with imports from fixtures
jest.config.cjs               ← remove sidebar-entry.ts exclusion, add transform rules, add threshold
```

---

## `__tests__/helpers/sidebar-fixtures.ts`

Exports three things used by both test files.

### `FULL_SIDEBAR_HTML`

A string containing the complete sidebar DOM — both panels and all config form elements:

```
#tool-list          (tool list panel)
#ai-panel           (AI config panel wrapper)
  #no-headers-msg
  #config-form
    #user-prompt-cols
    #drive-file-cols
    #system-prompt-col
    #output-col
    #new-col-input
    input[name="row-range"] × 2  (selection + range radios)
    #range-inputs
      #row-start
      #row-end
#btn-import-drive-links
#btn-run-ai
#btn-sample-rows
#btn-extract-text
#back-btn
#cancel-btn
#run-btn
```

### `setupConfigPanel(headers: string[]): void`

Sets `document.body.innerHTML = FULL_SIDEBAR_HTML`, then calls `buildTagList` and
`buildSingleTagList` to populate all four tag containers with the given headers.

### `setupWithSelections(opts): void`

Calls `setupConfigPanel`, then uses `applyPreset` to pre-select values. Promoted from
the local helper that currently lives inside the `assembleRunConfig` describe block.

```typescript
interface SetupOpts {
  headers?: string[];           // defaults to ["col_a", "col_b", "col_c", "source_drive", ...]
  userPrompt?: string[];
  drive?: string[];
  system?: string;
  output?: string;
  newOutputName?: string;
  rowRange?: { start: number; end: number };
}
```

---

## `src/client/sidebar-entry.ts` changes

Export the four testable functions. `init` stays private.

```typescript
export function showAIPanel(preset?: Partial<RunConfig>): void { … }
export function hideAIPanel(): void { … }
export function dispatchTool(e: MouseEvent, fn: string): void { … }
export function runAI(): void { … }
```

---

## `__tests__/sidebar-entry.test.ts`

### Mock setup

Imports `mockRun` object (defined at top of file, set on `globalThis` before any imports).
`globalThis.alert = jest.fn()` for failure handler tests.

### Callback capture pattern

```typescript
let capturedSuccess: (v: unknown) => void;
let capturedFailure: (e: Error) => void;

beforeEach(() => {
  mockRun.withSuccessHandler.mockImplementation((fn) => { capturedSuccess = fn; return mockRun; });
  mockRun.withFailureHandler.mockImplementation((fn) => { capturedFailure = fn; return mockRun; });
});
```

### Test cases per function

#### `showAIPanel()`

| Test | What it asserts |
|---|---|
| hides tool-list, shows ai-panel | display values after call |
| calls getSheetHeaders | `mockRun.getSheetHeaders` called once |
| success with headers → shows config-form, builds tag lists | `#config-form` visible; tag buttons present |
| success with headers + preset → calls applyPreset | tags pre-selected per preset |
| success with empty headers → shows no-headers-msg | `#no-headers-msg` visible, `#config-form` hidden |
| failure → alerts, calls hideAIPanel | alert called with message; `#tool-list` visible |

#### `hideAIPanel()`

| Test | What it asserts |
|---|---|
| hides ai-panel, shows tool-list | display values |

#### `dispatchTool(e, fn)`

| Test | What it asserts |
|---|---|
| adds loading class + sets button text | class present; innerHTML changed |
| calls runTool with fn | `mockRun.runTool` called with correct arg |
| success → removes loading, restores innerHTML | class absent; innerHTML restored |
| failure → alerts, removes loading, restores innerHTML | alert called; class absent; HTML restored |

#### `runAI()`

| Test | What it asserts |
|---|---|
| returns early when assembleRunConfig returns null | `runBatchAI` not called |
| disables run-btn, sets text to "Running..." | button disabled; textContent |
| calls runBatchAI with config | `mockRun.runBatchAI` called with correct RunConfig |
| success → re-enables button, hides ai-panel | button enabled; `#tool-list` visible |
| failure → alerts, re-enables button | alert called; button enabled |

---

## `__tests__/sidebar.test.ts` changes

Replace the four local setup helpers with imports from `sidebar-fixtures.ts`:

| Removed | Replaced by |
|---|---|
| `buildTagList.makeContainer()` | inline one-liner (simple enough, not shared) |
| `buildSingleTagList.makeContainer()` | inline one-liner |
| `applyPreset.setupPanel(headers)` | `setupConfigPanel(headers)` from fixtures |
| `assembleRunConfig.PANEL_HTML + setupWithSelections()` | `setupWithSelections()` from fixtures |

Test logic (assertions, selections) is unchanged.

---

## `jest.config.cjs` changes

### `collectCoverageFrom`

Remove `!src/client/sidebar-entry.ts`.

### `transform`

Add two new routing rules alongside the existing `sidebar.test.ts` rule:

```javascript
"^.+/__tests__/sidebar-entry\\.test\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
"^.+/__tests__/helpers/sidebar-fixtures\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
```

### `coverageThreshold`

Add a block for `sidebar-entry.ts`. Thresholds are set ~5 points below observed coverage
after the tests are written. `init()` and its inner arrow functions remain untested, so
functions coverage will land in the 60–70% range. The implementation plan includes a
dedicated step to run `npm run test:coverage`, read the actuals, and lock in the thresholds.

---

## Testing Environment

Jest + ts-jest + jsdom (existing setup). No new dependencies.
