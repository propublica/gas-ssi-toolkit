# Extract Text Panel — Design

**Date:** 2026-03-20
**Status:** Approved

## Overview

Rebuild the "Extract Text" tool as a first-class sidebar panel, replacing the legacy active-selection-based flow with a panel-based UX consistent with `ConfigureAIRunPanel` and `ImportDriveLinksPanel`. Remove all code supporting the old selection-driven path.

## Goals

- Collect source column, output column, and row range in the sidebar before running
- Route the `btn-extract-text` button to a panel (`nav.navigate`) instead of dispatching immediately via `runTool`
- Delete the old `extractTextFromSelection` server function and its `runTool` dispatcher entry

## Architecture

### New files

- `src/client/panels/extract-text.ts` — `ExtractTextPanel` class

### Modified files

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `ExtractTextConfig` interface |
| `src/server/index.ts` | Replace old `extractTextFromSelection` with new `extractText(config)`; remove from `runTool` dispatcher |
| `src/client/types.ts` | Add `"extract-text"` to `PanelId` union |
| `src/client/services.ts` | Add `extractText(config, jobId?)` service wrapper |
| `src/client/panels/tool-list.ts` | Change Extract Text button to `nav.navigate("extract-text")` |
| `src/client/sidebar-entry.ts` | Register `ExtractTextPanel` in the panels Map |
| `src/client/google.d.ts` | Add `extractText` declaration |
| `rollup.config.js` | Update global stub from `extractTextFromSelection(jobId)` → `extractText(config, jobId)` |

## Data Flow

```
ExtractTextPanel
  → validate (sourceCol required, outputCol required)
  → jobStore.dispatch(jobId, "Extract Text", extractText(config, jobId))
  → services.extractText(config, jobId)
  → google.script.run.extractText(config, jobId)
  → server: resolve sourceCol → loop rows → extractTextUniversal(fileId)
  → findOrCreateColumn → cell.setValue (per row, flushed immediately)
```

## RPC Config Type (`shared/types.ts`)

```ts
export interface ExtractTextConfig {
  sourceCol: string;  // Column header containing Drive links
  outputCol: string;  // Column header for extracted text output (may be new)
  startRow: number;
  endRow: number;
}
```

## Server Function (`index.ts`)

Replaces the old `extractTextFromSelection` (which read from `SpreadsheetApp.getActiveRange()`):

```ts
export function extractText(config: ExtractTextConfig, jobId?: string): void {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] as string[];
  const sourceColIdx = headers.indexOf(config.sourceCol);

  if (sourceColIdx === -1) {
    throw new Error(`Column "${config.sourceCol}" not found`);
  }

  const outputCol = findOrCreateColumn(sheet, config.outputCol, SpreadsheetApp.WrapStrategy.WRAP);
  const total = config.endRow - config.startRow + 1;

  for (let i = 0; i < total; i++) {
    const rowIdx = config.startRow + i; // 1-based data row
    const cellValue = sheet.getRange(rowIdx + 1, sourceColIdx + 1).getValue() as string;

    if (jobId) {
      writeJobProgress(CacheService.getUserCache(), jobId, {
        message: `Extracting row ${i + 1} of ${total}...`,
        current: i + 1,
        total,
      });
    }

    if (!isValidDriveLink(cellValue)) {
      continue;
    }

    const fileId = extractId(cellValue);
    const text = extractTextUniversal(fileId);
    const truncated = truncateText(text, 49000);
    sheet.getRange(rowIdx + 1, outputCol).setValue(truncated);
    SpreadsheetApp.flush();
  }
}
```

Error handling: exceptions propagate to the client via `jobStore`, which surfaces them as alerts.

### `extractTextUniversal` (`drive.ts`)

No changes to the function signature or logic. A comment marks where a file size guard would slot in, before the `Drive.Files.create()` call for PDFs and images:

```ts
// TODO: enforce a max file size here if needed (e.g. blob.getBytes().length > MAX_BYTES)
```

## Panel UX

```
┌─────────────────────────────────────┐
│ ← Back    📜 Extract Text           │
├─────────────────────────────────────┤
│  [PanelLoader — loading columns]    │
│                                     │
│ Source Column *                     │
│ [SingleTagList — existing cols only]│
│                                     │
│ Output Column *                     │
│ [SingleTagList w/ includeNew:true ] │
│                                     │
│ Row Range *                         │
│ [RowRange — start / end inputs    ] │
│                                     │
│ ℹ Supported file types: Google      │
│   Docs, PDFs, and images (JPEG,     │
│   PNG, GIF, WebP, etc.)             │
│   Google Docs are read directly.    │
│   PDFs and images are processed     │
│   using Google Drive's native OCR.  │
│   Output is truncated at 49,000     │
│   characters.                       │
│                                     │
│         [ Extract Text ]            │
└─────────────────────────────────────┘
```

The entire form is hidden behind `PanelLoader` until `getSheetHeaders()` resolves (same pattern as `ConfigureAIRunPanel` and `ImportDriveLinksPanel`). Extract Text button is disabled until both source and output columns are selected.

## Panel Saved State

```ts
type SavedState = {
  sourceCol: string;
  outputCol: string;
  startRow: number;
  endRow: number;
};
```

Restored on back navigation so the user doesn't lose their inputs.

## Cleanup

- Remove old `extractTextFromSelection` body (selection-driven, used `SpreadsheetApp.getActiveRange()`)
- Remove `extractTextFromSelection` entry from `runTool` TOOLS dispatcher in `index.ts`
- Update `rollup.config.js` footer stub
- Update `google.d.ts` declaration
- Change `btn-extract-text` in `ToolListPanel` from `dispatchTool()` to `nav.navigate("extract-text")`
- Once Sample Rows is also migrated, `runTool` becomes dead code — delete the function, its GAS stub, and its `google.d.ts` declaration
