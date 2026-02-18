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
npm run build          # Clean build to dist/ (rimraf + rollup + copy appsscript.json)
npm test               # Run Jest tests
npm run test:watch     # Jest in watch mode
npm run lint           # ESLint on src/
npm run lint:fix       # ESLint with auto-fix
npm run format         # Prettier on src/
npm run deploy:dev     # Build + clasp push to dev script
npm run deploy:prod    # Build + clasp push to prod script
```

Run a single test file: `npx jest __tests__/utils.test.ts`
Run a single test by name: `npx jest -t "extractId"`

## Architecture

### Build Pipeline

`src/server/index.ts` → Rollup (IIFE format, assigned to `_GASEntry`) → `dist/index.js`

Apps Script has no module system — it only sees top-level functions in the global scope. Rollup wraps everything in an IIFE assigned to `_GASEntry`, so exports from `index.ts` are not directly visible. The `footer` field in `rollup.config.js` bridges this gap by appending plain global function stubs that delegate into the IIFE:

```js
function onOpen(e) { _GASEntry.onOpen(e); }
function showSourceDialog() { _GASEntry.showSourceDialog(); }
// ... one stub per public entry point
```

**To expose a new function to Apps Script, you must do both:**
1. `export` it from `src/server/index.ts`
2. Add a matching global stub in the `footer` of `rollup.config.js`

If you skip step 2, the function will exist in the bundle but Apps Script won't be able to discover or call it.

### Module Dependency Graph

```
index.ts  (entry point — menu, 4 tool orchestrators, UI handlers)
├── config.ts   (CONFIG object: API key property name, model, column names, limits)
├── api.ts      (callGeminiAPI — text or multimodal via UrlFetchApp + base64)
├── drive.ts    (extractTextUniversal, checkDriveService — OCR via Drive Advanced Service)
├── dialog.ts   (HTML_TEMPLATE string for AI mode selection modal)
├── utils.ts    (extractId, isValidDriveLink, createSeededRandom, getAllFilesRecursive)
└── types.ts    (shared interfaces: AppConfig, AIMode, ColumnMap, AIContext variants)
```

Only `index.ts` should reference Google Apps Script UI services (SpreadsheetApp, HtmlService, PropertiesService). Other modules use injected values or specific GAS globals documented in their headers.

### Testing

Jest with ts-jest preset. Tests live in `__tests__/`. Path aliases `@server/*` and `@shared/*` are mapped in `jest.config.cjs`.

**Pattern for mocking GAS globals:** Declare mocks (UrlFetchApp, DriveApp, SpreadsheetApp, etc.) as `globalThis` properties **before** importing the module under test, since imports execute immediately.

### Key Constraints

- **Apps Script runtime is V8** — tsconfig targets ES2019
- **No Node.js built-ins** — everything runs on Google's servers
- `appsscript.json` must be in `dist/` for clasp push (the build script copies it)
- Drive Advanced Service must be enabled in the Apps Script editor AND declared in `appsscript.json`
- `PropertiesService` is not available in custom functions (only in menu-triggered functions)
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
