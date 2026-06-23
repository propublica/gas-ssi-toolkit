# Format Markdown — Design Spec

| Field | Value |
|---|---|
| Feature | Format Markdown — in-place markdown → Sheets rich text |
| Author | Aaron Brezel |
| Date | 2026-06-23 |
| Status | Draft |

---

## Overview

A new SSI Toolkit menu item that converts markdown syntax in a user-selected cell range into Google Sheets rich text (bold, italic, strikethrough, inline code, hyperlinks, multi-level headings, bullets). Formatting is applied in-place — the cell text is stripped of markdown syntax and styled using `setRichTextValue()`.

This extends the existing `parseMarkdown` + `toCellValue` pipeline that already powers the Run AI output path. No new sidebar panel; the user selects a range, clicks the menu item, done.

---

## Motivation

`parseMarkdown()` in `rich-text.ts` already handles the core markdown subset for AI output. Journalists who type or paste markdown into cells manually (from a CMS export, notes, etc.) currently have no way to apply that formatting without running an AI job. This feature makes the parser available as a standalone formatting action.

---

## What Is and Is Not Supported

Google Sheets `newTextStyle()` supports per-character: bold, italic, strikethrough, font family, font size, foreground color, underline, and link URL. This feature uses a subset of those.

**Supported markdown → Sheets mapping:**

| Markdown syntax | Sheets rendering | Notes |
|---|---|---|
| `**text**` | Bold | Existing |
| `*text*` | Italic | Existing |
| `[text](url)` | Hyperlink | Existing |
| `* item` / `- item` | `• item` prefix | Existing |
| `# Heading` | Bold, fontSize 18 | h1 — extended |
| `## Heading` | Bold, fontSize 16 | h2 — extended |
| `### Heading` | Bold, fontSize 14 | h3 — extended |
| `#### Heading` and deeper | Bold only | h4–h6 — existing behavior |
| `~~text~~` | Strikethrough | New |
| `` `code` `` | Courier New font family | New |

**Not supported** (no meaningful Sheets equivalent): tables, horizontal rules (`---`), numbered lists (no list-level concept in Sheets — the `1.` prefix is preserved as plain text), fenced code blocks.

---

## Architecture

### Principle

Reuse the existing `CellContent` / `TextRange` / `parseMarkdown` / `toCellValue` pipeline. Changes are additive — no existing behavior changes for the Run AI path.

### Data flow

```
User selects range → "📐 SSI Toolkit > 📝 Format Markdown" menu item
  → formatMarkdownSelection() [index.ts]
    → getActiveRange() / validate selection
    → for each non-empty cell:
        parseMarkdown(cell.getValue()) [rich-text.ts] → CellContent
        toCellValue(content) [index.ts] → RichTextValue
        cell.setRichTextValue(richTextValue)
    → ui.alert() with result count
```

### Code smell: TextRange ↔ toCellValue coupling

`TextRange` (data model, in `rich-text.ts`) and `toCellValue` (renderer, in `index.ts`) are semantically coupled: adding a style field requires touching both. The split is intentional — `rich-text.ts` is GAS-free for testability; `toCellValue` uses `SpreadsheetApp`. This is an acceptable tradeoff at current scale. Mitigation: `toCellValue` destructures all `TextRange` fields explicitly, making the full contract visible in one place.

---

## File Changes

### 1. `src/server/rich-text.ts`

**`TextRange` interface** — add three optional fields:

```typescript
export interface TextRange {
  startIndex: number;
  endIndex: number;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;   // new
  fontFamily?: string;       // new — "Courier New" for inline code
  fontSize?: number;         // new — 18/16/14 for h1/h2/h3
  url?: string;
}
```

**`parseMarkdown()`** — change from private to exported. Extend with three new patterns (processed before plain-character fallback):

- `~~text~~` → `{ strikethrough: true }` range. Must be checked before `*` patterns to avoid misparse of `~`.
- `` `code` `` → single-backtick span → `{ fontFamily: "Courier New" }` range.
- Heading match already extracts `#` count (`headingMatch[1].length`). Map depth to `fontSize`: 1→18, 2→16, 3→14, 4+→undefined (bold only, existing behavior). Heading range gains `fontSize` alongside `bold`.

No changes to `processInline` — strikethrough and inline code are block-level only (not nested inside inline spans in the first implementation; can be revisited).

**`buildRichInferenceCellContent`** and **`buildRichGroundingCellContent`** — unchanged. They call `parseMarkdown` internally; the new fields flow through automatically. The Run AI path gains the new features for free.

### 2. `src/server/index.ts`

**`toCellValue()`** — destructure all `TextRange` fields explicitly and extend the style builder:

```typescript
function toCellValue(content: CellContent): GoogleAppsScript.Spreadsheet.RichTextValue {
  const builder = SpreadsheetApp.newRichTextValue().setText(content.text);
  content.ranges.forEach(({ startIndex, endIndex, bold, italic, strikethrough, fontFamily, fontSize, url }) => {
    if (bold || italic || strikethrough || fontFamily || fontSize) {
      const style = SpreadsheetApp.newTextStyle();
      if (bold)        style.setBold(true);
      if (italic)      style.setItalic(true);
      if (strikethrough) style.setStrikethrough(true);
      if (fontFamily)  style.setFontFamily(fontFamily);
      if (fontSize)    style.setFontSize(fontSize);
      builder.setTextStyle(startIndex, endIndex, style.build());
    }
    if (url) builder.setLinkUrl(startIndex, endIndex, url);
  });
  return builder.build();
}
```

**`formatMarkdownSelection()`** — new exported function:

- Get active spreadsheet, sheet, range via `SpreadsheetApp.getActiveRange()`.
- If no range selected, call `ui.alert("Select one or more cells first.")` and return.
- Iterate all cells in the range. Skip cells where `getValue()` returns a non-string or empty string.
- For each qualifying cell: `parseMarkdown(value)` → `toCellValue(content)` → `cell.setRichTextValue(richText)`.
- After the loop, `ui.alert(\`Formatted ${count} cell(s).\`)` (skip if count is 0).
- Wrap in try/catch; on error show `ui.alert(\`Error: ${e.message}\`)`.

**`onOpen()`** — add menu item:

```typescript
SpreadsheetApp.getUi()
  .createMenu("📐 SSI Toolkit")
  .addItem("📐 Open SSI Toolkit", "showSidebar")
  .addItem("📝 Format Markdown", "formatMarkdownSelection")
  .addToUi();
```

### 3. `rollup.config.js`

Add one footer stub alongside the existing ones:

```js
function formatMarkdownSelection() { _GASEntry.formatMarkdownSelection(); }
```

---

## Error Handling

| Condition | Behavior |
|---|---|
| No active range | `ui.alert()` — "Select one or more cells first." |
| All selected cells empty or non-string | Silent skip; alert shows "Formatted 0 cell(s)." |
| `setRichTextValue` throws on a cell | Caught per-cell; falls back to `setValue(parsedText)` (plain text, markdown stripped) |
| Unexpected top-level error | `ui.alert()` with error message |

---

## Testing

`parseMarkdown` is already tested in `__tests__/rich-text.test.ts`. The new features (strikethrough, inline code, h1–h3 sizing) get new test cases there — input markdown string, assert `CellContent.text` and `ranges`.

`toCellValue` and `formatMarkdownSelection` are GAS-coupled and are not unit-tested (same exclusion as the rest of `index.ts`).

---

## Non-Goals

- No undo support (Apps Script has no undo API).
- No preview before applying.
- No output-column mode — if needed later, it's a `RunConfig`-style extension.
- Strikethrough and inline code are not supported inside inline spans (e.g. bold+code nesting). Can be added to `processInline` in a follow-up.
