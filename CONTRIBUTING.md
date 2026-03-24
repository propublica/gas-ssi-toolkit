# Contributing

## Branch Workflow

```
feature-branch → develop   (PR + code review)
develop        → main      (PR = release gate)
```

Feature work happens on branches, merged to `develop` via PR. When ready to ship, `develop` is merged to `main` via a PR containing manual QA instructions — that merge is the release gate.

## Adding Features

### Adding a new Gemini tool

See [Tool System](docs/architecture.md#tool-system) in the architecture docs — it's a three-file change.

### Adding a recipe

Recipes are defined in `src/client/recipes.ts` as entries in the `RECIPES` array. Each `RecipeDefinition` describes the recipe's display metadata, the form fields shown during prep, and how those fields map to a `RunConfig` passed to Run AI. Adding a recipe is entirely client-side and requires no server changes — it's one of the most accessible contributions to make.

### Exposing a new server function

See [Build Pipeline](docs/architecture.md#build-pipeline) in the architecture docs — you must both export from `index.ts` and add a footer stub in `rollup.config.js`. If the function is callable from the client, also update `src/client/google.d.ts`.

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
