# Import Drive Links Panel — Design

**Date:** 2026-03-18
**Status:** Approved

## Overview

Rebuild the "Import Drive Links" tool as a first-class sidebar panel, replacing the legacy `ui.prompt()` dialog flow with a panel-based UX consistent with `ConfigureAIRunPanel` and `RecipePanel`. Remove all code supporting the old dialog-driven path.

## Goals

- Collect folder URL, output column, and optional file type filters in the sidebar before running
- Route the `btn-import-drive-links` button to a panel (`nav.navigate`) instead of dispatching immediately
- Delete the old `importDriveLinks` server function and its `runTool` dispatcher entry
- Lay down patterns that support future Extra tool panels (Sample Rows, Extract Text)

## Architecture

### New files

- `src/client/panels/import-drive-links.ts` — `ImportDriveLinksPanel` class

### Modified files

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `ImportDriveLinksConfig` interface |
| `src/server/index.ts` | Replace old `importDriveLinks` with new panel-driven version; remove from `runTool` dispatcher |
| `src/server/utils.ts` | Add optional `mimeTypePrefixes?: string[]` param to `getAllFilesRecursive` |
| `src/client/types.ts` | Add `"import-drive-links"` to `PanelId` union |
| `src/client/services.ts` | Add `importDriveLinks(config, jobId?)` service wrapper |
| `src/client/panels/tool-list.ts` | Change Import Drive Links button to `nav.navigate("import-drive-links")` |
| `src/client/sidebar-entry.ts` | Register `ImportDriveLinksPanel` in the panels Map |
| `src/client/google.d.ts` | Add `importDriveLinks` declaration |
| `rollup.config.js` | Add global stub for `importDriveLinks` |

## Data Flow

```
ImportDriveLinksPanel
  → validate (folderUrl required, outputCol required)
  → jobStore.dispatch(jobId, "Import Drive Links", importDriveLinks(config, jobId))
  → services.importDriveLinks(config, jobId)
  → google.script.run.importDriveLinks(config, jobId)
  → server: extractId → DriveApp.getFolderById → getAllFilesRecursive (with mimeType filter)
  → findOrCreateColumn → writeColumn
```

## RPC Config Type (`shared/types.ts`)

```ts
export interface ImportDriveLinksConfig {
  folderUrl: string;
  outputCol: string;
  mimeTypes?: string[]; // MIME type prefix strings; absent = all files
}
```

## Server Function (`index.ts`)

Replaces the old `importDriveLinks` (which used `ui.prompt()` dialogs):

```ts
export function importDriveLinks(config: ImportDriveLinksConfig, jobId?: string): void {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const folderId = extractId(config.folderUrl);

  if (jobId) {
    writeJobProgress(CacheService.getUserCache(), jobId, { message: "Scanning folder..." });
  }

  const parentFolder = DriveApp.getFolderById(folderId);
  const allFiles: DriveFileInfo[] = [];
  getAllFilesRecursive(parentFolder, allFiles, config.mimeTypes);

  const col = findOrCreateColumn(sheet, config.outputCol, SpreadsheetApp.WrapStrategy.CLIP);
  writeColumn(sheet, col, allFiles.map((f) => f.url));
}
```

Error handling: exceptions propagate to the client via `jobStore`, which surfaces them as alerts.

## `getAllFilesRecursive` Change (`utils.ts`)

Add optional `mimeTypePrefixes?: string[]` third param. When present, only files whose `getMimeType()` starts with one of the prefix strings are included:

```ts
export function getAllFilesRecursive(
  folder: GoogleAppsScript.Drive.Folder,
  fileList: DriveFileInfo[],
  mimeTypePrefixes?: string[],
): void {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const mime = file.getMimeType();
    if (!mimeTypePrefixes || mimeTypePrefixes.some((p) => mime.startsWith(p))) {
      fileList.push({ url: file.getUrl() });
    }
  }
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    getAllFilesRecursive(subfolders.next(), fileList, mimeTypePrefixes);
  }
}
```

## Panel UX

```
┌─────────────────────────────────────┐
│ ← Back    📂 Import Drive Links     │
├─────────────────────────────────────┤
│  [PanelLoader — loading columns]    │
│                                     │
│ Drive Folder *                      │
│ [text input: paste URL or ID      ] │
│                                     │
│ Output Column *                     │
│ [SingleTagList w/ includeNew:true ] │
│                                     │
│ File Types  (optional)              │
│ [Docs] [Sheets] [PDFs]              │
│ [Images] [Audio] [Video]            │
│                                     │
│         [ Import Links ]            │
└─────────────────────────────────────┘
```

The entire form is hidden behind `PanelLoader` until `getSheetHeaders()` resolves (same pattern as `ConfigureAIRunPanel`). The file type TagList uses fixed options; the output column uses `SingleTagList` with `includeNew: true`.

### File Type → MIME Prefix Map

| Label | Prefix sent to server |
|---|---|
| Google Docs | `application/vnd.google-apps.document` |
| Google Sheets | `application/vnd.google-apps.spreadsheet` |
| PDFs | `application/pdf` |
| Images | `image/` |
| Audio | `audio/` |
| Video | `video/` |

When no file types are selected, `mimeTypes` is omitted from the config and all files are imported.

## Panel Saved State

```ts
type SavedState = {
  folderUrl: string;
  outputCol: string;
  mimeTypes: string[];
};
```

Restored on back navigation so the user doesn't lose their inputs.

## Cleanup

- Remove old `importDriveLinks` body (dialog-driven, used `ui.prompt()`)
- Remove `importDriveLinks` entry from `runTool` TOOLS dispatcher in `index.ts`
- Change `btn-import-drive-links` in `ToolListPanel` from `dispatchTool()` to `nav.navigate("import-drive-links")`
- No menu changes needed — the menu already only has "Open SSI Toolkit"
