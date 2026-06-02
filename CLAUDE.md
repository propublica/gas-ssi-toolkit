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
npm run deploy              # Build + clasp push to HEAD (development)
npm run deploy:watch        # Continuous build + push watch
npm run clasp:open          # Open the Apps Script editor in browser
npm run clasp:logs          # Tail execution logs from Apps Script
npm run clasp:login         # Authenticate clasp (required before first deploy)
```

> **Note for Claude:** `scripts/release.sh` is a human-only operation and must never be invoked by Claude. It is enforced via a deny rule in `.claude/settings.local.json`.

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

**If the function is also called from the client, add a third step:**
3. Add it to `src/client/google.d.ts`

`google.d.ts` is hand-maintained — it is not auto-generated from server code. If you skip step 3, the client will typecheck against stale declarations and only fail at runtime.

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

### Module Dependency Graph

**Server:**
```
src/server/index.ts          (entry point — menu, 4 tool orchestrators, UI handlers, re-exports custom functions)
├── src/server/config.ts         (CONFIG object: API key property name, model name, size limits)
├── src/server/api.ts            (callGeminiAPI, buildGeminiPayload, invokeGemini — pure HTTP adapter via UrlFetchApp;
│                                 buildGeminiPayload resolves ToolId[] via TOOL_REGISTRY, splits grounding vs function tools)
├── src/server/inference.ts      (runInference — unified inference handler for menu-triggered AI calls; no SpreadsheetApp dep;
│                                 returns string|null, null signals caller to skip the row)
├── src/server/tools.ts          (TOOL_REGISTRY: Record<ToolId, GeminiTool> — exhaustive at compile time; adding a ToolId
│                                 without a registry entry is a type error)
├── src/server/types.ts          (server-only types: AppConfig, GeminiRequest, GeminiTool discriminated union,
│                                 GeminiInlineData, GeminiFunctionDeclaration, DriveFileInfo; never imported by client)
├── src/server/drive.ts          (extractTextUniversal, fetchAndEncodeFile, checkDriveService)
├── src/server/rich-text.ts      (CellContent, TextRange interfaces; buildRichInferenceCellContent, buildRichGroundingCellContent —
│                                 pure layer between GeminiResponse and Sheets cell content; no GAS globals)
├── src/server/customFunctions.ts  (SSI — Sheets custom function; calls invokeGemini directly; always returns string,
│                                 uses "[SSI Error: ...]" format)
├── src/server/utils.ts          (extractId, isValidDriveLink, createSeededRandom, getAllFilesRecursive, sampleRows,
│                                 truncateText, findOrCreateColumn, writeColumn, flattenArg)
└── src/shared/types.ts          (RPC boundary ONLY — ToolId union, RunConfig, PrepRecipeParams, PrepRecipeResult,
                                  ImportDriveLinksConfig, ExtractTextConfig; all with optional tools?: ToolId[])
```

**Client:**
```
src/client/sidebar-entry.ts  (thin init — instantiates all panels, creates Router, calls router.start("tool-list"))
└── src/client/router.ts         (Router class — push/pop navigation stack)
└── src/client/services.ts       (GAS boundary — wraps google.script.run as Promises)
└── src/client/types.ts          (PanelId, Panel<P,S>, NavigationContext, RecipeDefinition, RecipeParams,
│                                 RecipeFieldConfig interfaces — client-only UI types)
└── src/client/tools.ts          (TOOL_CATALOG: ToolCatalogEntry[] — display metadata for sidebar TagList;
│                                 hardcoded at build time, no RPC needed)
└── src/client/recipes.ts        (RECIPES registry — RecipeDefinition[] for all standard recipes)
└── src/client/job-store.ts      (JobStore class — tracks active jobs, polls getJobProgress, notifies subscribers)
└── src/client/panels/
│   ├── tool-list.ts             (ToolListPanel — entry screen, dispatches to tool or recipes)
│   ├── configure-ai-run.ts      (ConfigureAIRunPanel — column mapping, row range, tool selection, AI run)
│   ├── import-drive-links.ts    (ImportDriveLinksPanel — Drive folder import UI; mime-type filter, output column)
│   ├── extract-text.ts          (ExtractTextPanel — text extraction UI; source/output column, row range)
│   ├── recipes-list.ts          (RecipesListPanel — browsable list of recipes)
│   └── recipe.ts                (RecipePanel — generic panel driven by RecipeParams; prep → cook flow)
└── src/client/components/       (reusable UI components)
    ├── tag-list.ts              (TagList — multi-select tag chips; accepts string[] or {label,value}[] items)
    ├── single-tag-list.ts       (SingleTagList — exclusive-select tag chips)
    ├── row-range.ts             (RowRange — start/end row inputs)
    ├── lockable-field.ts        (LockableField — value + lock/unlock toggle; optional onUnlock callback)
    ├── recipe-prep-cook.ts      (RecipePrepCook — 4-state machine: idle/prepping/prep-complete/cooking)
    ├── panel-loader.ts          (PanelLoader — drives panel loading skeleton: progress bar, spinner, message)
    ├── job-indicator.ts         (JobIndicator — renders active/failed jobs to #job-strip; persists across navigation)
    ├── token-input.ts           (TokenInput — searchable chip field for column selection; multi or single-select;
    │                             supports includeNew for new column creation; use when item count is 8+ or items are
    │                             dynamic headers. Prefer TagList when count is small and all options benefit from
    │                             simultaneous display, e.g. the Tools section with ~5 fixed entries.)
    └── prompt-col-list.ts       (PromptColList — ordered list of PromptColumnSpec rows; each row pairs a
                                  TokenInput column picker with a text/file kind toggle and reorder controls)
    └── src/shared/types.ts

src/client/google.d.ts       (compile-time type stub for google.script.run — uses declare global{} pattern)
src/client/sidebar.css       (sidebar styles — inlined into dist/Sidebar.html at build time)
src/Sidebar.html             (sidebar template — {{STYLES}} and {{SCRIPTS}} placeholders replaced at build time)
```

### Tool System

The Gemini tool system spans three layers. `ToolId` (a string union in `shared/types.ts`) is the RPC boundary — it's the only tool concept that crosses `google.script.run`.

**To add a new tool, touch exactly three files:**
1. **`src/shared/types.ts`** — add the string literal to `ToolId`
2. **`src/server/tools.ts`** — add a `GeminiTool` entry to `TOOL_REGISTRY` (`Record<ToolId, GeminiTool>` enforces exhaustiveness at compile time)
3. **`src/client/tools.ts`** — add a `ToolCatalogEntry` to `TOOL_CATALOG` for sidebar display

**`GeminiTool` discriminated union** (in `server/types.ts`):
- `{ kind: "grounding"; id: ToolId }` — produces `{ [id]: {} }` in the Gemini REST payload (e.g. `google_search`, `url_context`, `code_execution`)
- `{ kind: "function"; declaration: GeminiFunctionDeclaration }` — produces `{ function_declarations: [...] }` in the payload

`buildGeminiPayload` in `api.ts` resolves `ToolId[]` via `TOOL_REGISTRY`, splits by `kind`, and assembles both shapes into the `tools` array of the REST request.

**Propagation path:** `ConfigureAIRunPanel` (UI TagList) → `RunConfig.tools` → `runBatchAI` → `runInference(tools?)` → `invokeGemini` → `callGeminiAPI` → `buildGeminiPayload`. For recipes: `RecipePanel` → `PrepRecipeParams.cols + inputValues` → server resolves `inputId` references and writes columns → `PrepRecipeResult.rowRange` → client calls `buildRunTemplate(prepTemplate)` (derives `promptCols`/`systemPromptCol`/`outputCol` from `RecipeColumn.role`) merged with `definition.settings` and `rowRange` → `preppedRunConfig`.

Source files use relative imports (e.g. `../shared/types`). The `@server/*` and `@shared/*` aliases are **Jest-only** (mapped in `jest.config.cjs`) and are not available in TypeScript source.

Only `index.ts` should reference Google Apps Script UI services (SpreadsheetApp, HtmlService, PropertiesService). On the client side, only `services.ts` calls `google.script.run` (wrapping each call as a Promise); `sidebar-entry.ts` is a thin init file that creates the Router and calls `router.start()`.

### Recipe System

Recipes are journalist-facing presets that automate column setup and launch a Run AI. Each `RecipeDefinition` in `src/client/recipes.ts` has four parts:

| Field | Type | Purpose |
|-------|------|---------|
| `inputs` | `RecipeInput[]` | Journalist-facing form fields rendered by `RecipePanel` |
| `prepTemplate` | `RecipeColumn[]` | Column definitions sent to `prepRecipe()` on the server |
| `settings` | `RecipeSettings?` | Non-column `RunConfig` fields (tools, markdown, grounding, etc.) |
| Discovery fields | `id`, `name`, `icon`, `description`, `intro?` | Rendered in the recipes list and recipe header |

**`RecipeColumn`** (`src/client/types.ts`) = `PrepColSpec` + optional `role?: ColumnRole`. The `role` is client-only — `buildRunTemplate()` in `recipe.ts` maps roles to `promptCols`, `systemPromptCol`, and `outputCol` at cook time. Roles: `"file-prompt"` | `"text-prompt"` | `"system-prompt"` | `"output"`.

**`FillStrategy`** (`src/shared/types.ts`) controls how `prepRecipe()` populates each column:
- `{ kind: "fill-value"; value: string }` — writes a static string to every row
- `{ kind: "list-drive-folder"; inputId: string }` — lists files from the folder URL in `inputValues[inputId]`
- `{ kind: "create-empty" }` — creates the column with no content
- `{ kind: "template"; template: string }` — interpolates `{{inputId}}` placeholders; supports Mustache-style conditionals `{{#inputId}}...{{/inputId}}` (block is omitted when the input is empty)

**`RecipeInput.id`** must be camelCase or underscore_separated — no hyphens. The template interpolation regex uses `\w+` which does not match `-`.

**To add a new recipe:** add an entry to `RECIPES` in `src/client/recipes.ts`. No other files need changing unless you need a new `FillStrategy` kind.

### TypeScript Configuration

Two tsconfigs for two build environments:

- **`tsconfig.json`** — server build. Targets ES2019, no DOM lib, excludes `src/client/`.
- **`tsconfig.client.json`** — client build and client tests. Extends base, adds `"lib": ["ES2019", "DOM"]`, sets `rootDir: "."` (covers both `src/` and `__tests__/`). Includes precise file patterns: `src/client/**/*.ts`, `src/shared/**/*.ts`, and the client-side test files.

`npm run typecheck` runs both: `tsc --noEmit && tsc -p tsconfig.client.json --noEmit`.

**Jest transform:** `jest.config.cjs` uses a single transform rule — `tsconfig.client.json` for all `.ts` files. This avoids a ts-jest static `_cachedConfigSets` bug where multiple transformer instances sharing one Jest worker (common on CI with few CPUs) would reuse the first-cached ConfigSet regardless of per-transform tsconfig options, causing client files to compile without DOM types. Server code compiles cleanly under `tsconfig.client.json` since it never references DOM globals.

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

**Coverage:** Run `npm run test:coverage` to collect coverage and enforce per-file thresholds. Coverage is opt-in — the pre-commit hook runs `jest --bail` without `--coverage`.

Two files are excluded from coverage collection entirely:
- `src/server/index.ts` — the four tool orchestrators are deeply coupled to SpreadsheetApp UI globals and are not unit-tested.
- `src/client/sidebar-entry.ts` — contains only `init()`, which is called immediately at module load time (before `beforeEach` can set up the DOM) and has no exports to test in isolation.

See `docs/plans/2026-02-18-testing-coverage-design.md` for full rationale.

**CI:** `.github/workflows/lint-typecheck-format-test.yml` runs on push to `main` and PRs targeting `main`: lint → typecheck → format check → test with coverage.

### Tool 4 — Spreadsheet Column Requirements

`runBatchAI` maps column headers by name via `RunConfig` (user-selected in the sidebar — no hardcoded column names). The user selects which columns serve as user prompt inputs, drive file inputs, system prompt, and output. `runBatchAI` calls `resolveColumns` to locate them by header string and `findOrCreateColumn` to create the output column if absent.

The Gemini API key must be set as a Script Property (`GEMINI_API_KEY`) in Apps Script > Project Settings > Script Properties before Tool 4 will run.

### Key Constraints

- **Apps Script runtime is V8** — tsconfig targets ES2019
- **No Node.js built-ins** — everything runs on Google's servers
- `appsscript.json` must be in `dist/` for clasp push (the build script copies it)
- Drive Advanced Service must be enabled in the Apps Script editor AND declared in `appsscript.json`
- `PropertiesService.getScriptProperties()` is available in custom functions once the add-on has been authorized by the user (opening the menu triggers authorization)
- `.clasp.json` is committed to the repo and points to the single add-on script project

## GitHub

### Docker Sandbox authentication

> Non-sandbox setups (local dev, direct `gh` auth) can use `gh pr create`, `gh` CLI, or any standard approach and can skip this section.

The sandbox proxy intercepts outbound requests to `api.github.com` and `github.com` and injects the real GitHub token at the network level — the actual credential never enters the sandbox. `GH_TOKEN` inside the sandbox holds a sentinel placeholder (`gho_sbxproxymanaged...`), not the real token, which is why `gh auth status` reports "The token in GH_TOKEN is invalid." That's expected and doesn't affect git or curl operations.

The proxy MITM-inspects TLS using a trusted CA (`Docker Sandboxes Proxy CA` is in the system cert store), so no `-k` flag is needed for curl calls to GitHub.

**Why `gh` CLI doesn't work here (even though it uses the REST API):** `gh` fails at the network layer, not the auth layer. The sandbox routes all traffic through an HTTP proxy at `localhost:3128`. curl (libcurl) successfully tunnels through it; `gh`'s Go `net/http` client fails to establish the CONNECT tunnel and reports "error connecting to localhost." The proxy's credential injection only fires once the tunnel is up — `gh` never gets that far. (`gh auth status` has a separate, earlier failure: it validates `GH_TOKEN` locally and rejects the sentinel before making any network call.)

**Why `git push`/`git pull` work fine (HTTPS remotes only):** Git uses libcurl for HTTPS transport — the same library curl uses — so it tunnels through the proxy correctly and gets credentials injected transparently. No `git config credential.*` setup is needed. Make sure your remote uses HTTPS, not SSH:

```bash
git remote set-url origin https://github.com/propublica/gas-ssi-toolkit.git
```

SSH remotes (`git@github.com:...`) require additional host-side setup (SSH agent forwarding + network policy changes) and don't work out of the box — see the [Docker Sandbox credentials docs](https://docs.docker.com/ai/sandboxes/security/credentials/#ssh-agent).

If `git push` does fail with `fatal: could not read Username`, it means the sandbox secret hasn't been set on the host yet. Fix by running on the host:

```bash
sbx secret set <sandbox-name> github -t "$(gh auth token)"
```

where `<sandbox-name>` is the value of `$SANDBOX_VM_ID` inside the sandbox.

### Branch Naming

All feature and fix branches must follow this format:

```
AI-{issue-number}-short-description
```

Examples: `AI-42-add-token-input`, `AI-107-fix-recipe-prep-crash`

Linear's GitHub integration auto-detects branches with the issue ID pattern and links them to the issue on the Linear side. This is a public repo — no Linear URLs go in PR bodies. The branch name alone is sufficient to trigger the integration; no additional issue reference is needed in the PR body.

**When creating a new branch:** Ask for the Linear issue ID if none is evident from context. Suggest the `AI-{n}-description` name before running `git checkout -b`.

**When creating a PR:** Check the branch name against `AI-\d+`. If absent, pause and say:

> "This branch name doesn't contain a Linear issue ID (`AI-123-...`). Is there an associated Linear issue? If not, say 'no issue' to proceed."

Wait for confirmation before creating the PR.

### Creating PRs

> Non-sandbox setups (local dev, direct `gh` auth) can use `gh pr create` and skip this section.

**Step 1 — Branch name check**

Run `git branch --show-current`. If the output does not match `AI-\d+` (e.g. `AI-42-my-feature`), warn and wait for confirmation. See [Branch Naming](#branch-naming).

**Step 2 — Build the PR body**

Read `.github/PULL_REQUEST_TEMPLATE.md` to get the section structure. Assemble the body:

- **Summary:** 2–4 bullets from `git log <base>..HEAD --oneline` and `git diff <base>..HEAD`. Focus on motivation and impact — not just a restatement of commit titles. Use `develop` as `<base>` for PRs targeting develop, `main` for PRs targeting main.

- **Manual QA — two parts in this order:**
  1. *Feature-specific steps* — numbered steps a human can follow to manually verify this PR's specific changes. Write from the diff. Be concrete (name the menu item, the sidebar panel, the column, etc.).
  2. *Regression checklist* — paste the 7-item checklist from the template verbatim. For PRs targeting `develop`, prepend:
     ```
     > Targeting `develop` — mark regression items N/A unless you're able to test end-to-end.
     ```

- **Notes:** Fill in only if a reviewer needs specific information (migration steps, known limitations, deploy dependencies). Otherwise leave the HTML comment placeholder from the template unchanged.

**Step 3 — Create the PR**

Use curl — the sandbox proxy injects credentials automatically. Use Python to assemble the JSON payload so the body is correctly escaped:

```bash
curl -s -X POST \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/propublica/gas-ssi-toolkit/pulls \
  -d "$(python3 -c "
import json
body = '''<assembled body — paste the populated template here as a Python triple-quoted string>'''
print(json.dumps({'title': '<PR title>', 'head': '<branch-name>', 'base': 'develop', 'body': body}))
")" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('html_url') or d)"
```

PRs target `develop` by default; use `"base": "main"` for hotfixes.

## Code Style

Follows Google TypeScript Style Guide (enforced by ESLint + Prettier + pre-commit hooks via husky/lint-staged):

- Named exports only (no default exports)
- `const` by default, no `var`, no `namespace`
- `===` always, avoid `any` (prefer `unknown`)
- UpperCamelCase for types/interfaces, lowerCamelCase for functions/variables, CONSTANT_CASE for constants
- Semicolons required, double quotes (Prettier), trailing commas
- Explicit return types on functions (ESLint warning)
- Prefix unused parameters with `_`

## CSS Conventions

All sidebar styles live in `src/client/sidebar.css`. Use CSS custom properties — don't hardcode values.

**Font sizes** — pick the closest token, don't use raw px:

| Token | Value | Typical use |
|---|---|---|
| `--font-size-100` | 11px | Labels, badges, small metadata |
| `--font-size-200` | 12px | Helper text, tag chips, intro copy |
| `--font-size-300` | 14px | Body text, inputs, buttons (default) |
| `--font-size-400` | 16px | Panel titles |
| `--font-size-500` | 18px | Icons |

**Font family** — browsers don't inherit `font-family` on form elements. Any new `input`, `button`, `textarea`, or `select` must explicitly set `font-family: var(--font-family)`.

**Colors** — prefer variables over hardcoded hex:
- `--text-main` — primary text
- `--text-secondary` — secondary/muted text
- `--primary-blue` — interactive blue (`#1a73e8`)
- `--border-color` — borders and dividers
