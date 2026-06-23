# Format Markdown Sidebar Button — Design Spec

| Field | Value |
|---|---|
| Feature | Move Format Markdown entry point from menu item to sidebar Extras button |
| Author | Aaron Brezel |
| Date | 2026-06-23 |
| Status | Draft |

---

## Overview

Move the "Format Markdown" entry point from the SSI Toolkit menu to a button in the sidebar's existing Extras section on the tool-list homepage. The server function (`formatMarkdownSelection`) is unchanged — it still reads the active sheet selection, applies markdown rich-text formatting in-place, and shows a native Sheets `ui.alert()` for both the result count and the "nothing selected" case.

---

## Motivation

The menu item pattern is appropriate for standalone actions with no sidebar involvement. Format Markdown is more naturally discovered alongside the other Extras tools (Import Drive Links, Sample Rows, Extract Text) in the sidebar, where journalists are already working.

---

## What Changes

| File | Change |
|---|---|
| `src/server/index.ts` | Remove `"📝 Format Markdown"` / `"formatMarkdownSelection"` `addItem` call from `onOpen()` |
| `src/client/services.ts` | Add `formatMarkdownSelection(): Promise<void>` following the existing `google.script.run` wrapper pattern |
| `src/client/google.d.ts` | Add `formatMarkdownSelection(): void` to `GoogleScriptRun` interface |
| `src/client/panels/tool-list.ts` | Add `#btn-format-markdown` button to existing Extras section; wire click handler |
| `rollup.config.js` | No change — stub stays; `google.script.run` needs it to resolve the function |

---

## Detail

### Button markup (added to Extras section in `tool-list.ts` template)

```html
<button id="btn-format-markdown" class="tool-btn">
  <span class="icon">📝</span> Format Markdown
</button>
```

Placed after the existing Extract Text button, consistent with the Extras ordering.

### Event wiring (`wireEvents` in `tool-list.ts`)

```typescript
container.querySelector("#btn-format-markdown")?.addEventListener("click", () => {
  formatMarkdownSelection().catch((err: Error) => globalThis.alert("Error: " + err.message));
});
```

Imports `formatMarkdownSelection` from `../services`.

### Service function (`services.ts`)

```typescript
export function formatMarkdownSelection(): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .formatMarkdownSelection();
  });
}
```

### Type declaration (`google.d.ts`)

```typescript
formatMarkdownSelection(): void;
```

Added to `GoogleScriptRun` alongside the other no-arg void methods.

---

## Behavior

- User selects cells in the sheet, clicks "📝 Format Markdown" in the sidebar Extras section
- `formatMarkdownSelection()` runs server-side: reads `SpreadsheetApp.getActiveRange()`, applies rich-text formatting, shows `ui.alert("Formatted N cell(s).")`
- If no range selected (rare — Sheets always maintains a selection): `ui.alert("Select one or more cells first.")`
- On unexpected error: sidebar catches the rejected promise and calls `globalThis.alert("Error: " + err.message)`

---

## Non-Goals

- No change to `formatMarkdownSelection()` server logic
- No inline sidebar feedback (keeping `ui.alert()` for consistency with the current implementation)
- Menu item is removed entirely — not kept as a secondary entry point
