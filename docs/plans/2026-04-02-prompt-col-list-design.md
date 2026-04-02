# PromptColList — Design Document

## Problem

`ConfigureAIRunPanel` still renders two separate `TokenInput` pickers — "User prompt columns"
(text kind) and "Drive file columns" (file kind) — and merges them text-first on save. This
discards the ordering that `RunConfig.promptCols: PromptColumnSpec[]` is designed to preserve.
The data layer (Phase 2 of the ordered-parts refactor) is complete; this is the UI layer fix.

## Solution

Replace the two `TokenInput` pickers with a single `PromptColList` component: an ordered list
of rows where each row represents one `PromptColumnSpec`. Users can add, remove, and reorder
rows. The system prompt and output column fields are unchanged.

## Component: `PromptColList`

**File:** `src/client/components/prompt-col-list.ts`

**Constructor:** `(container: HTMLElement, headers: string[], initialValue?: PromptColumnSpec[])`

**Public API:**
- `getValue(): PromptColumnSpec[]` — returns only rows with a column selected, in declared order
- `destroy(): void` — destroys all child `TokenInput` instances and removes the component

### State

A plain mutable array of row objects:

```ts
interface PromptRow {
  tokenInput: TokenInput;   // manages column selection for this row
  kind: "text" | "file";
  el: HTMLElement;          // the row's root DOM element
}
```

On any mutation (add, remove, move), all rows are torn down and re-rendered from the
current state array. With the 1–5 rows typical in practice, full re-render is negligible.

### Row Layout

Each row uses two lines to avoid cramping in the ~268px sidebar:

```
Line 1: TokenInput (single-select, full width) — column picker
Line 2: [Text pill] [File pill]   (right-aligned) [↑] [↓] [×]
```

- **Line 1** — a `TokenInput` with `multi: false`, constructed with the full `headers` array.
  Empty state shows `[+ Add]`; selected state shows the column chip with its own `×` to
  re-open the picker. The two `×` buttons are visually distinct: the chip `×` is inline in
  the blue chip on line 1; the row `×` is a gray button on line 2.

- **Line 2** — kind toggle uses `.tag` / `.tag.selected` pill buttons ("Text" / "File") —
  the same visual language used throughout the panel. Action buttons `↑` `↓` `×` sit
  right-aligned. `↑` is disabled on the first row; `↓` is disabled on the last.

### Add Row

A full-width `+ Add column` ghost button sits below the list. Clicking it appends a new
empty row (no column selected, kind defaults to `"text"`) and re-renders.

### getValue()

Iterates `rows`, calls `tokenInput.getValue()[0]` for each, skips rows where the value is
empty or undefined, and returns `PromptColumnSpec[]` in the current order.

## CSS

New classes added to `sidebar.css`:

```css
.pcol-list { display: flex; flex-direction: column; gap: 8px; }

.pcol-row { display: flex; flex-direction: column; gap: 4px; }

/* Line 2 */
.pcol-row-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pcol-kind-pills { display: flex; gap: 4px; }

/* Spacer that pushes action buttons to the right */
.pcol-kind-pills + .pcol-spacer { flex: 1; }

.pcol-btn-up,
.pcol-btn-down,
.pcol-btn-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 2px 4px;
  line-height: 1;
}
.pcol-btn-up:hover, .pcol-btn-down:hover { color: var(--primary-blue); }
.pcol-btn-remove:hover { color: #d93025; }
.pcol-btn-up:disabled, .pcol-btn-down:disabled { opacity: 0.25; cursor: default; }

.pcol-add-btn {
  width: 100%;
  margin-top: 4px;
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 5px 8px;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  box-sizing: border-box;
}
.pcol-add-btn:hover { border-color: var(--primary-blue); color: var(--primary-blue); }
```

The kind toggle reuses existing `.tag` and `.tag.selected` — no new pill styles needed.

## Integration into `configure-ai-run.ts`

### Fields removed
- `userPromptList: TokenInput | null`
- `driveFileList: TokenInput | null`

### Field added
- `promptColList: PromptColList | null`

### `loadHeaders()`
Replace:
```ts
const presetTextCols = preset.promptCols?.filter(...).map(...) ?? [];
const presetFileCols = preset.promptCols?.filter(...).map(...) ?? [];
this.userPromptList = new TokenInput(..., { selected: presetTextCols });
this.driveFileList  = new TokenInput(..., { selected: presetFileCols });
```
With:
```ts
this.promptColList = new PromptColList(
  container.querySelector("#prompt-col-list")!,
  headers,
  preset.promptCols,
);
```
`preset.promptCols` is already an ordered `PromptColumnSpec[]` — no splitting needed.

### `unmount()` / `currentPreset()` / `assembleRunConfig()`
Replace the two-array merge:
```ts
promptCols: [
  ...this.userPromptList.getValue().map((col) => ({ col, kind: "text" as const })),
  ...(this.driveFileList?.getValue() ?? []).map((col) => ({ col, kind: "file" as const })),
],
```
With:
```ts
promptCols: this.promptColList?.getValue() ?? [],
```

### Validation
`assembleRunConfig()` keeps its existing guard — `if (promptCols.length === 0)` alert —
unchanged. `getValue()` already filters out empty rows.

### Template
Replace:
```html
<div class="field-group">
  <span class="field-label">User prompt columns <span class="required">*</span></span>
  <div id="user-prompt-cols" class="tag-list"></div>
</div>
<div class="field-group">
  <span class="field-label">Drive file columns <span class="optional">(optional)</span></span>
  <div id="drive-file-cols" class="tag-list"></div>
</div>
```
With:
```html
<div class="field-group">
  <span class="field-label">Prompt columns <span class="required">*</span></span>
  <div id="prompt-col-list"></div>
</div>
```

## Recipe System

No changes required. `RecipePanel.buildRunConfig()` already returns
`promptCols: PromptColumnSpec[]` in the recipe's intended order and passes it to
`ConfigureAIRunPanel` via navigation. Previously `loadHeaders()` split this array apart,
losing the order. With `PromptColList`, `preset.promptCols` is passed directly as
`initialValue` — order preserved end-to-end.

## Files Touched

| File | Change |
|---|---|
| `src/client/components/prompt-col-list.ts` | New component |
| `src/client/sidebar.css` | Add `.pcol-*` styles (~35 lines) |
| `src/client/panels/configure-ai-run.ts` | Replace 2 `TokenInput` fields with `PromptColList`; update template, `loadHeaders`, `unmount`, `currentPreset`, `assembleRunConfig` |
| `__tests__/configure-ai-run.test.ts` | Update any tests that reference `userPromptList` / `driveFileList` |

No changes to `shared/types.ts`, `server/`, `recipe.ts`, or `recipes.ts`.

## Implementation Entry Point

Start by reading:
- This document
- `src/client/components/token-input.ts` — component to embed per row
- `src/client/panels/configure-ai-run.ts` — panel to update
- `src/client/sidebar.css` — styles to extend

Build and verify in this order:
1. `PromptColList` component with CSS
2. Integration into `configure-ai-run.ts`
3. Manual smoke test: add rows, reorder, verify `getValue()` order matches display order
4. Recipe handoff smoke test: navigate from a recipe's Cook button, verify `promptCols` preset renders in correct order
