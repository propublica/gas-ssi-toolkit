# Architecture

The codebase has two separate TypeScript environments with a hard boundary between them.

## Server and Client

**Server** (`src/server/`) runs on Google's infrastructure (V8, ES2019). `index.ts` is the only file that touches Apps Script UI globals (`SpreadsheetApp`, `HtmlService`, `PropertiesService`). Everything else — API calls, Drive operations, utilities — is written as pure functions, which keeps them unit-testable.

**Client** (`src/client/`) runs in the browser inside the sidebar HtmlService iframe. `services.ts` is the only file that calls `google.script.run` — it wraps each call as a Promise so the rest of the client never touches the GAS boundary directly.

When adding new functionality, keep this layering intact: GAS globals belong in `index.ts`, `google.script.run` calls belong in `services.ts`, and business logic belongs in pure modules.

## Build Pipeline

The build produces two outputs from a single `rollup.config.js` array.

**Server bundle** — `src/server/index.ts` → `dist/index.js` (IIFE format):

Apps Script has no module system — it only sees top-level global functions. Rollup wraps everything in an IIFE assigned to `_GASEntry`. The `footer` field in `rollup.config.js` appends plain stubs that delegate into the IIFE:

```js
function onOpen(e) { _GASEntry.onOpen(e); }
```

**Client bundle** — `src/client/sidebar-entry.ts` → `dist/Sidebar.html`:

HtmlService can only serve `.html` files. A custom Rollup plugin inlines all JS and CSS at build time: it compiles the client bundle, reads `src/Sidebar.html` and `src/client/sidebar.css`, replaces `{{STYLES}}` and `{{SCRIPTS}}` placeholders, and emits `dist/Sidebar.html`.

`appsscript.json` is copied into `dist/` as part of the build — clasp requires the manifest alongside the bundled JS.

## Panel / Router System

The client uses a lightweight navigation system: `Router` (`src/client/router.ts`) manages a push/pop navigation stack, and each `Panel` implementation handles its own render and state. Recipes are a workflow layer built on top of Run AI, driven by a generic `RecipePanel` that walks the user through a prep step (filling in inputs, writing spreadsheet columns) before launching an AI run.

## Historical Design Records

`docs/plans/` and `docs/superpowers/` (its `specs/` and `plans/` subdirectories) hold dated design docs and implementation plans written before past features and refactors. They're a record of *why* a decision was made, not maintained documentation — treat each one as frozen at the date in its filename, not a description of the current codebase.
