# Contributing

## Branch Workflow

```
feature-branch → develop   (PR + code review)
develop        → main      (PR = release gate)
```

Feature work happens on branches, merged to `develop` via PR. When ready to ship, `develop` is merged to `main` via a PR containing manual QA instructions — that merge is the release gate.

## Adding Features

### Adding a new Gemini tool

The Gemini tool system spans three layers, linked by `ToolId` (a string union in `src/shared/types.ts`). `ToolId` is the only tool concept that crosses the `google.script.run` RPC boundary.

**To add a new Gemini tool, touch exactly three files:**

1. `src/shared/types.ts` — add the string literal to `ToolId`
2. `src/server/tools.ts` — add a `GeminiTool` entry to `TOOL_REGISTRY` (`Record<ToolId, GeminiTool>` enforces exhaustiveness at compile time — omitting an entry is a type error)
3. `src/client/tools.ts` — add a `ToolCatalogEntry` to `TOOL_CATALOG` for sidebar display

`GeminiTool` is a discriminated union: `{ kind: "grounding" }` produces `{ [id]: {} }` in the Gemini REST payload; `{ kind: "function" }` produces `{ function_declarations: [...] }`.

### Adding a recipe

Recipes are defined in `src/client/recipes.ts` as entries in the `RECIPES` array. Each `RecipeDefinition` describes the recipe's display metadata, the form fields shown during prep, and how those fields map to a `RunConfig` passed to Run AI. Adding a recipe is entirely client-side and requires no server changes — it's one of the most accessible contributions to make.

### Exposing a new server function

Apps Script has no module system — it only sees top-level global functions. Rollup wraps everything in an IIFE assigned to `_GASEntry`, and `rollup.config.js`'s `footer` field appends plain global stubs that delegate into it (e.g. `function onOpen(e) { _GASEntry.onOpen(e); }`).

**To expose a new function to Apps Script, you must do both:**

1. `export` it from `src/server/index.ts`
2. Add a matching global stub in the `footer` of `rollup.config.js`

Skipping step 2 means Apps Script can't discover or call the function. If the function is also called from the client, also add it to `src/client/google.d.ts` — that file is **not auto-generated**, so a client-callable function typechecks against stale declarations and only fails at runtime if you skip this.

## Testing

Tests live in `__tests__/`. Run them with:

```bash
npm test                    # all tests
npm run test:watch          # watch mode
npm run test:coverage       # with per-file coverage thresholds
```

### Mocking GAS globals

Apps Script globals (`UrlFetchApp`, `DriveApp`, `SpreadsheetApp`, etc.) must be set on `globalThis` **before** importing the module under test, because imports execute immediately:

```ts
(globalThis as any).UrlFetchApp = { fetch: jest.fn() };
const { callGeminiAPI } = await import("../src/server/api");
```

### Mocking `google.script.run`

Capture the success/failure handlers registered by the function under test, then invoke them manually to simulate GAS callbacks:

```ts
const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  myServerFunction: jest.fn(),
};
(globalThis as unknown as { google: unknown }).google = { script: { run: mockRun } };

let capturedSuccess: (v: unknown) => void;
mockRun.withSuccessHandler.mockImplementation((fn) => {
  capturedSuccess = fn;
  return mockRun;
});
// Later: capturedSuccess(mockValue) to simulate a successful GAS response.
```

### Coverage

Coverage is enforced per-file. Run `npm run test:coverage` to check thresholds. Two files are excluded from coverage collection:

- `src/server/index.ts` — deeply coupled to SpreadsheetApp UI globals, not unit-tested.
- `src/client/sidebar-entry.ts` — calls `init()` immediately at module load time, before `beforeEach` can set up the DOM.

## Code Style

Follows the Google TypeScript Style Guide, enforced by ESLint + Prettier + pre-commit hooks:

- Named exports only (no default exports)
- `const` by default; no `var`, no `namespace`
- `===` always; avoid `any` (prefer `unknown`)
- UpperCamelCase for types/interfaces, lowerCamelCase for functions/variables, CONSTANT_CASE for constants
- Semicolons required, double quotes, trailing commas
- Explicit return types on exported functions
- Prefix unused parameters with `_`

Run `npm run lint:fix` and `npm run format` before pushing.
