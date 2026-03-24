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

**To expose a new function to Apps Script, you must do both:**
1. `export` it from `src/server/index.ts`
2. Add a matching global stub in the `footer` of `rollup.config.js`

Skipping step 2 means Apps Script can't discover or call the function. If the function is also called from the client, also add it to `src/client/google.d.ts`.

**Client bundle** — `src/client/sidebar-entry.ts` → `dist/Sidebar.html`:

HtmlService can only serve `.html` files. A custom Rollup plugin inlines all JS and CSS at build time: it compiles the client bundle, reads `src/Sidebar.html` and `src/client/sidebar.css`, replaces `{{STYLES}}` and `{{SCRIPTS}}` placeholders, and emits `dist/Sidebar.html`.

`appsscript.json` is copied into `dist/` as part of the build — clasp requires the manifest alongside the bundled JS.

## `google.d.ts` — Hand-Maintained

`src/client/google.d.ts` is the TypeScript declaration for `google.script.run`. It is **not auto-generated** — it must be manually updated whenever a server function is added or removed. If you skip this, the client will typecheck against stale declarations and only fail at runtime.

## Tool System

The Gemini tool system spans three layers, linked by `ToolId` (a string union in `src/shared/types.ts`). `ToolId` is the only tool concept that crosses the `google.script.run` RPC boundary.

**To add a new Gemini tool, touch exactly three files:**
1. `src/shared/types.ts` — add the string literal to `ToolId`
2. `src/server/tools.ts` — add a `GeminiTool` entry to `TOOL_REGISTRY` (`Record<ToolId, GeminiTool>` enforces exhaustiveness at compile time — omitting an entry is a type error)
3. `src/client/tools.ts` — add a `ToolCatalogEntry` to `TOOL_CATALOG` for sidebar display

`GeminiTool` is a discriminated union: `{ kind: "grounding" }` produces `{ [id]: {} }` in the Gemini REST payload; `{ kind: "function" }` produces `{ function_declarations: [...] }`.

## Panel / Router System

The client uses a lightweight navigation system: `Router` (`src/client/router.ts`) manages a push/pop navigation stack, and each `Panel` implementation handles its own render and state.

**Recipes** are a workflow layer built on top of Run AI. Each `RecipeDefinition` in `src/client/recipes.ts` describes display metadata, the form fields shown during prep, and how those fields map to a `RunConfig`. The generic `RecipePanel` drives a four-state prep/cook machine: the user fills in parameters (prep), the server writes any required columns and returns a fully assembled `RunConfig` (prep-complete), and the user launches the AI run (cooking). The `preppedRunConfig` comes entirely from the server response — not from client form state — making it the single source of truth for what gets executed.

## TypeScript Configuration

Two tsconfigs cover the two build environments:

- `tsconfig.json` — server build. Targets ES2019, no DOM lib.
- `tsconfig.client.json` — client build and all tests. Adds `"lib": ["ES2019", "DOM"]`.

Do **not** add `"node"` to `tsconfig.client.json` — it causes `MimeType` collisions with the `google-apps-script` types. Use triple-slash directives (`/// <reference types="node" />`) in individual files that need Node.js types.
