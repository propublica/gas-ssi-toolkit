# SSI Toolkit

Google Apps Script add-on built with TypeScript, bundled by Rollup, and deployed via clasp. It exposes a spreadsheet inference toolkit to Google Sheets. All source lives locally — the build pipeline compiles and pushes to Apps Script. Avoid making changes in the online Apps Script editor; they'll be overwritten on the next deploy.

## Prerequisites

- Node.js 22+
- Apps Script API enabled at [script.google.com/home/usersettings](https://script.google.com/home/usersettings)
- The SSI Toolkit Apps Script add-on project (script ID in `.clasp.json`)
- A Gemini API key (required for the Run AI tool)

## Setup

```bash
npm install
npm run clasp:login          # authenticate with Google
```

Set `GEMINI_API_KEY` as a Script Property in Apps Script > Project Settings > Script Properties, then deploy:

```bash
npm run deploy               # build and push to HEAD
```

## Key Commands

```bash
# Build
npm run build               # clean build to dist/
npm run build:watch         # rebuild on file changes

# Deploy
npm run deploy              # build + push to HEAD (development)
npm run deploy:watch        # continuous build + push watch

# Test
npm test                    # run all tests
npm run test:watch          # watch mode
npm run test:coverage       # with per-file coverage thresholds

# Quality
npm run lint                # ESLint
npm run typecheck           # type-check without building
npm run format:check        # check Prettier formatting

# Utilities
npm run clasp:open          # open Apps Script editor in browser
npm run clasp:logs          # tail execution logs
```

Run a single test file: `npx jest __tests__/api.test.ts`
Run a single test by name: `npx jest -t "extractId"`

## Code Lifecycle

SSI Toolkit uses a single Apps Script project with two deployment states:

**HEAD** is the active development surface. `npm run deploy` pushes your local build here. You can test at HEAD using Apps Script's built-in test deployments (Deploy → Test deployments in the script editor) without affecting anyone who has the add-on installed. The "SSI Toolkit (dev)" Document is pre-populated with useful test data.

**Versioned deployment** is what Marketplace-installed users run. It is a pinned snapshot that only changes when a human explicitly runs `scripts/release.sh` from `main`.

### Branch workflow

```
feature-branch → develop   (PR + code review)
develop        → main      (PR containing manual QA instructions = release gate)
main                       (run ./scripts/release.sh to publish)
```

Feature work happens on branches, merged to `develop` via PR. When ready to ship, `develop` is merged to `main` via a PR containing manual QA instructions — that merge is the release gate. Only then is `scripts/release.sh` run from `main`, which builds and pushes to HEAD, snapshots it as a new immutable version, and repoints the Marketplace deployment.

```zsh
./scripts/release.sh  → builds, pushes to HEAD, and promotes to Marketplace (human-only, main only)
```

`scripts/release.sh` enforces the `main` requirement — it will exit with an error if run from any other branch.

> **Note for future contributors:** This pipeline assumes a single developer. `npm run deploy` pushes to a shared HEAD — concurrent development will cause conflicts. This should be revisited before a second developer joins the project.

## Build Pipeline

The build produces two outputs from a single `rollup.config.js` array:

**Server** — `src/server/index.ts` → `dist/index.js` (IIFE format). Apps Script has no module system and only discovers top-level global functions. The Rollup `footer` field appends plain stubs that delegate into the IIFE:

```js
function onOpen() { _GASEntry.onOpen(); }
```

To expose a new function to Apps Script, you must both `export` it from `index.ts` and add a matching stub in the `rollup.config.js` footer. Skipping the stub means Apps Script can't find it.

**Client** — `src/client/sidebar-entry.ts` → `dist/Sidebar.html`. HtmlService only serves `.html` files, so all JS and CSS must be inlined at build time. A custom Rollup plugin handles this: it compiles the client bundle, reads `src/Sidebar.html` and `src/client/sidebar.css`, replaces `{{STYLES}}` and `{{SCRIPTS}}` placeholders, and emits the final HTML asset.

`appsscript.json` is copied into `dist/` as part of the build — clasp needs the manifest alongside the bundled JS.

## Architecture

The codebase has two separate TypeScript environments with a hard boundary between them:

**Server** (`src/server/`) runs on Google's infrastructure. `index.ts` is the only file that touches Apps Script UI globals (`SpreadsheetApp`, `HtmlService`, `PropertiesService`). Everything else — API calls, Drive operations, utilities — is written as pure functions with no GAS globals, which keeps them testable.

**Client** (`src/client/`) runs in the browser inside the sidebar HtmlService iframe. `services.ts` is the connective tissue between server and client — it wraps every `google.script.run` call as a Promise so the rest of the client code never touches the GAS boundary directly.

`google.script.run` is injected by GAS's HtmlService at runtime and exposes whatever functions exist in the global scope of the deployed script — meaning the footer stubs from `rollup.config.js`. There are no built-in TypeScript types for it, so `src/client/google.d.ts` is a hand-maintained declaration file that tells the compiler what's available. It is not auto-generated: if you add a new server function and forget to update `google.d.ts`, the client will typecheck against stale declarations and only fail at runtime.

The client uses a lightweight panel/router system: `Router` manages a navigation stack, and each `Panel` implementation handles its own render and state. `recipes.ts` holds the registry of named recipes that drive the `RecipePanel` generic panel.

When adding new functionality, keep this layering intact — GAS globals in `index.ts`, `google.script.run` in `services.ts`, business logic in pure modules that can be unit tested.

## Testing

Jest with ts-jest. Tests live in `__tests__/`.

**Mocking GAS globals:** Set properties on `globalThis` *before* importing the module under test, since imports execute immediately:

```ts
(globalThis as any).UrlFetchApp = { fetch: jest.fn() };
const { callGeminiAPI } = await import("../src/server/api");
```

**Mocking `google.script.run`:** Capture the success/failure handlers registered by the function under test, then invoke them manually to simulate GAS callbacks:

```ts
let capturedSuccess: (v: unknown) => void;
mockRun.withSuccessHandler.mockImplementation((fn) => {
  capturedSuccess = fn;
  return mockRun;
});
// later: capturedSuccess(mockValue)
```

Coverage is enforced per-file — run `npm run test:coverage` to check thresholds.
