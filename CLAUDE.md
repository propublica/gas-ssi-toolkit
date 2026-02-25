# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Google Apps Script add-on for Google Sheets that provides four tools via a custom menu ("SSI Tools"):
1. **Import Drive Links** — recursively list files from a Drive folder
2. **Extract Text** — pull text from Docs/PDFs/images (OCR via temporary Doc conversion)
3. **Sample Rows** — reproducible dataset sampling with seeded Fisher-Yates shuffle
4. **Run AI** — batch Gemini API inference on selected rows (text or multimodal file mode)

Built with TypeScript, bundled by Rollup into a single IIFE, deployed via clasp.

## Commands

```bash
npm run build               # Clean build to dist/ (rimraf + rollup + copy appsscript.json)
npm run build:watch         # Continuous rebuild on file changes
npm test                    # Run Jest tests
npm run test:watch          # Jest in watch mode
npm run test:coverage       # Run Jest with coverage + enforce per-file thresholds
npm run lint                # ESLint on src/
npm run lint:fix            # ESLint with auto-fix
npm run format              # Prettier on src/ (rewrites files)
npm run format:check        # Check Prettier formatting without modifying files
npm run typecheck           # TypeScript type check without building (server + client tsconfigs)
npm run deploy:dev          # Build + clasp push to dev script
npm run deploy:prod         # Build + clasp push to prod script
npm run deploy:watch:dev    # Continuous build + clasp push watch (dev)
npm run deploy:watch:prod   # Continuous build + clasp push watch (prod)
npm run clasp:open          # Open the Apps Script editor in browser
npm run clasp:logs          # Tail execution logs from Apps Script
npm run clasp:login         # Authenticate clasp (required before first deploy)
```

Run a single test file: `npx jest __tests__/utils.test.ts`
Run a single test by name: `npx jest -t "extractId"`

## Architecture

### Build Pipeline

The build produces two outputs via a `rollup.config.js` array:

**Config 1 — Server bundle:**

`src/server/index.ts` → Rollup (IIFE format, assigned to `_GASEntry`) → `dist/index.js`

Apps Script has no module system — it only sees top-level functions in the global scope. Rollup wraps everything in an IIFE assigned to `_GASEntry`, so exports from `index.ts` are not directly visible. The `footer` field in `rollup.config.js` bridges this gap by appending plain global function stubs that delegate into the IIFE:

```js
function onOpen(e) { _GASEntry.onOpen(e); }
function showSidebar() { _GASEntry.showSidebar(); }
// ... one stub per public entry point
```

**To expose a new function to Apps Script, you must do both:**
1. `export` it from `src/server/index.ts`
2. Add a matching global stub in the `footer` of `rollup.config.js`

If you skip step 2, the function will exist in the bundle but Apps Script won't be able to discover or call it.

**Custom functions (callable from spreadsheet cells) require one extra step:**
3. Add a JSDoc comment with `@customfunction` directly on the stub in `rollup.config.js`

The TypeScript-level JSDoc is compiled away by Rollup and does not appear on the global stub. Google Sheets only registers a function as a custom function when `@customfunction` is present in a JSDoc comment on the **global** declaration — the one in the footer. Without it the function executes correctly when called explicitly but does not appear in autocomplete and is not recognized as a custom function by Sheets.

**Config 2 — Client bundle → `dist/Sidebar.html`:**

`src/client/sidebar-entry.ts` → Rollup (IIFE) → `inlineSidebarHtml` plugin → `dist/Sidebar.html`

HtmlService can only serve `.html` files — all JavaScript and CSS must be inlined at build time. The custom `inlineSidebarHtml` Rollup plugin handles this:
1. Compiles `sidebar-entry.ts` to an intermediate JS chunk
2. Reads `src/Sidebar.html` (the template), `src/client/sidebar.css`
3. Replaces `{{STYLES}}` with `<style>…css…</style>` and `{{SCRIPTS}}` with `<script>…js…</script>`
4. Emits `dist/Sidebar.html` as an asset
5. Deletes the intermediate `.js` chunk so clasp never pushes it as a `.gs` file

The `src/Sidebar.html` template is also read at test time by `__tests__/helpers/sidebar-fixtures.ts` to keep DOM fixtures structurally in sync with the real template.

### Module Dependency Graph

**Server:**
```
src/server/index.ts          (entry point — menu, 4 tool orchestrators, UI handlers, re-exports custom functions)
├── src/server/config.ts         (CONFIG object: API key property name, model, column names, limits)
├── src/server/api.ts            (callGeminiAPI, buildGeminiPayload — pure HTTP adapter via UrlFetchApp)
├── src/server/drive.ts          (extractTextUniversal, fetchAndEncodeFile, checkDriveService)
├── src/server/dialog.ts         (HTML_TEMPLATE string for AI mode selection modal)
├── src/server/utils.ts          (extractId, isValidDriveLink, createSeededRandom, getAllFilesRecursive, sampleRows, truncateText)
├── src/server/customFunctions.ts  (SSI — Sheets custom function; TOOL_REGISTRY for named tool declarations)
└── src/shared/types.ts          (shared interfaces: AppConfig, AIMode, ColumnMap, GeminiRequest, etc.)
```

**Client:**
```
src/client/sidebar-entry.ts  (thin init — creates Router, registers panels, calls router.start())
└── src/client/router.ts         (Router class — push/pop navigation stack)
└── src/client/services.ts       (GAS boundary — wraps google.script.run as Promises, header cache)
└── src/client/panels/           (panel classes — mount/unmount lifecycle)
└── src/client/components/       (reusable UI components — TagList, SingleTagList, RowRange, LockableField)
    └── src/shared/types.ts

src/client/google.d.ts       (compile-time type stub for google.script.run — uses declare global{} pattern)
src/client/sidebar.css       (sidebar styles — inlined into dist/Sidebar.html at build time)
src/Sidebar.html             (sidebar template — {{STYLES}} and {{SCRIPTS}} placeholders replaced at build time)
```

Source files use relative imports (e.g. `../shared/types`). The `@server/*` and `@shared/*` aliases are **Jest-only** (mapped in `jest.config.cjs`) and are not available in TypeScript source.

Only `index.ts` should reference Google Apps Script UI services (SpreadsheetApp, HtmlService, PropertiesService). On the client side, only `services.ts` calls `google.script.run` (wrapping each call as a Promise); `sidebar-entry.ts` is a thin init file that creates the Router and calls `router.start()`.

### TypeScript Configuration

Two tsconfigs for two build environments:

- **`tsconfig.json`** — server build. Targets ES2019, no DOM lib, excludes `src/client/`.
- **`tsconfig.client.json`** — client build and client tests. Extends base, adds `"lib": ["ES2019", "DOM"]`, sets `rootDir: "."` (covers both `src/` and `__tests__/`). Includes precise file patterns: `src/client/**/*.ts`, `src/shared/**/*.ts`, and the three client-side test files.

`npm run typecheck` runs both: `tsc --noEmit && tsc -p tsconfig.client.json --noEmit`.

**Note on types:** `tsconfig.client.json` uses `"types": ["google-apps-script", "jest"]` — do **not** add `"node"` here, as it causes `MimeType` collisions with the google-apps-script types. When a file needs Node.js types (e.g. `readFileSync`), use a triple-slash directive at the top of that file: `/// <reference types="node" />`.

### Testing

Jest with ts-jest preset. Tests live in `__tests__/`. Path aliases `@server/*` and `@shared/*` are mapped in `jest.config.cjs`.

**Pattern for mocking GAS globals:** Declare mocks (UrlFetchApp, DriveApp, SpreadsheetApp, etc.) as `globalThis` properties **before** importing the module under test, since imports execute immediately.

**Client-side mock pattern:** For `google.script.run`, capture the success/failure handlers registered by the function under test:

```ts
const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  getSheetHeaders: jest.fn(),
  // ...
};
(globalThis as unknown as { google: unknown }).google = { script: { run: mockRun } };

let capturedSuccess: (v: unknown) => void;
beforeEach(() => {
  mockRun.withSuccessHandler.mockImplementation((fn) => { capturedSuccess = fn; return mockRun; });
});
// Then invoke capturedSuccess(...) / capturedFailure(...) to simulate GAS callbacks.
```

**Shared DOM fixtures:** `__tests__/helpers/sidebar-fixtures.ts` exports:
- `FULL_SIDEBAR_HTML` — the sidebar HTML template read from `src/Sidebar.html` at test time (placeholders stripped), so tests stay structurally in sync with the real template without manual drift.
- `setupConfigPanel(headers?)` — sets `document.body.innerHTML` and populates all tag containers.
- `setupWithSelections(opts)` — calls `setupConfigPanel` then pre-selects values via `applyPreset`.

The `__tests__/helpers/` directory is excluded from test discovery via `testPathIgnorePatterns` in `jest.config.cjs`.

**Coverage:** Run `npm run test:coverage` to collect coverage and enforce per-file thresholds. Coverage is opt-in — the pre-commit hook runs `jest --bail` without `--coverage`.

Two boundary files are excluded from high thresholds:
- `src/server/index.ts` — excluded from coverage collection entirely. The four tool orchestrators are deeply coupled to SpreadsheetApp UI globals and are not unit-tested.
- `src/client/sidebar-entry.ts` — included in collection with lower per-file thresholds. The four exported functions (`showAIPanel`, `hideAIPanel`, `dispatchTool`, `runAI`) are fully tested. `init()` and its inner `addEventListener` arrow functions run at module load time before `beforeEach` sets up the DOM, so they are never invoked.

See `docs/plans/2026-02-18-testing-coverage-design.md` and `docs/plans/2026-02-24-sidebar-entry-testing-design.md` for full rationale.

**CI:** `.github/workflows/lint-typecheck-format-test.yml` runs on push to `main` and PRs targeting `main`: lint → typecheck → format check → test with coverage.

### Tool 4 — Spreadsheet Column Requirements

`runBatchAI` maps column headers by name. The active sheet must contain these exact headers (case-sensitive):

| Config key | Column header |
| --- | --- |
| `SOURCE_DRIVE` | `source_drive` |
| `SOURCE_TEXT` | `source_text` |
| `SYS_PROMPT` | `system_prompt` |
| `USER_PROMPT` | `user_prompt` |
| `OUTPUT` | `ai_inference` |

The Gemini API key must be set as a Script Property (`GEMINI_API_KEY`) in Apps Script > Project Settings > Script Properties before Tool 4 will run.

### Key Constraints

- **Apps Script runtime is V8** — tsconfig targets ES2019
- **No Node.js built-ins** — everything runs on Google's servers
- `appsscript.json` must be in `dist/` for clasp push (the build script copies it)
- Drive Advanced Service must be enabled in the Apps Script editor AND declared in `appsscript.json`
- `PropertiesService.getScriptProperties()` is available in custom functions once the add-on has been authorized by the user (opening the menu triggers authorization)
- `.clasp.json` is generated at deploy time by copying `.clasp.dev.json` or `.clasp.prod.json`

## Code Style

Follows Google TypeScript Style Guide (enforced by ESLint + Prettier + pre-commit hooks via husky/lint-staged):

- Named exports only (no default exports)
- `const` by default, no `var`, no `namespace`
- `===` always, avoid `any` (prefer `unknown`)
- UpperCamelCase for types/interfaces, lowerCamelCase for functions/variables, CONSTANT_CASE for constants
- Semicolons required, double quotes (Prettier), trailing commas
- Explicit return types on functions (ESLint warning)
- Prefix unused parameters with `_`
