# Design: Sidebar Feature Parity

**Date:** 2026-02-18
**Status:** Approved

## Background

The Apps Script web IDE source (`updated_code.gs` + `updated_sidebar.html`) has diverged ahead of the TypeScript source in `src/`. The primary UX change is replacing the multi-item custom menu with a single persistent sidebar that surfaces all four tools. All four tool implementations and all helper logic are behaviorally identical between the two sources.

## User-Facing Changes

| Before | After |
|--------|-------|
| `⚡ SSI Tools` menu with 5 items (Quickstart, 4 tools) | `⚡ SSI Toolkit` menu with 1 item: `🚀 Open SSI Toolkit` |
| Quickstart opens a redirect modal | User Guide link lives in sidebar as a plain `<a>` tag |
| Tools triggered from menu items | Tools triggered from sidebar buttons with loading state |
| No persistent UI panel | Sidebar stays open while user works |

## Components

### `src/server/index.ts`

**`onOpen()`** — rewritten to a single menu item:

```typescript
SpreadsheetApp.getUi()
  .createMenu("⚡ SSI Toolkit")
  .addItem("🚀 Open SSI Toolkit", "showSidebar")
  .addToUi();
```

**`openQuickstartDoc()`** — removed. The user guide URL is a plain anchor in the sidebar HTML; no server round-trip needed.

**`showSidebar()`** — new function:

```typescript
export function showSidebar(): void {
  const html = HtmlService.createTemplateFromFile("Sidebar");
  const output = html.evaluate().setTitle("SSI Toolkit").setWidth(300);
  SpreadsheetApp.getUi().showSidebar(output);
}
```

**`runTool()`** — new dispatcher used by sidebar buttons:

```typescript
const TOOLS: Record<string, () => void> = {
  importDriveLinks,
  showSourceDialog,
  sampleRowsToEvaluation,
  extractTextFromSelection,
};

export function runTool(functionName: string): void {
  const fn = TOOLS[functionName];
  if (!fn) throw new Error("Function not found: " + functionName);
  fn();
}
```

### `src/Sidebar.html` (new file)

Standalone HTML file for the sidebar UI. Must be a separate file (not an inlined string) because `HtmlService.createTemplateFromFile('Sidebar')` resolves by filename in the deployed Apps Script project.

Sections:

- User Guide link card (direct `<a href>` — no server call)
- Main Tools: Import Drive Links, Run AI Inference
- Extras: Sample Rows, Extract Text
- Footer: version/branding string
- Client-side `run(fn)` JS: calls `google.script.run.runTool(fn)` with loading state and error handling

### `rollup.config.js`

Footer stubs delta:

- Add: `function showSidebar()`, `function runTool(fn)`
- Remove: `function openQuickstartDoc()`

### Build scripts (`package.json`)

Extend `build` and `build:watch` to copy `src/Sidebar.html` to `dist/` alongside `appsscript.json`:

```
"build": "rimraf dist && rollup -c && cp appsscript.json dist/ && cp src/Sidebar.html dist/"
"build:watch": "mkdir -p dist && cp appsscript.json dist/ && cp src/Sidebar.html dist/ && rollup -c --watch"
```

### `__tests__/menu.test.ts`

- Update `onOpen` tests: new menu label `⚡ SSI Toolkit`, single `addItem` call for `showSidebar`
- Remove `openQuickstartDoc` describe block
- Add `showSidebar` tests: mock `HtmlService.createTemplateFromFile`, assert `showSidebar` called on UI
- Add `runTool` tests: assert known function names dispatch correctly, assert unknown name throws

## Files Changed

| File | Change |
|------|--------|
| `src/server/index.ts` | Update `onOpen`; remove `openQuickstartDoc`; add `showSidebar`, `runTool` |
| `src/Sidebar.html` | New file |
| `rollup.config.js` | Update footer stubs |
| `package.json` | Update `build` and `build:watch` scripts |
| `__tests__/menu.test.ts` | Update/replace menu and quickstart tests |

## Files Unchanged

`config.ts`, `api.ts`, `drive.ts`, `utils.ts`, `dialog.ts`, `types.ts`, all other tests — no behavioral changes to the four tools or any helpers.
