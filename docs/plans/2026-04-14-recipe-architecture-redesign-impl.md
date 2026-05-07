# Recipe Architecture Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the tri-purpose `ColumnDef` model with three focused structures — `UserInput[]` (journalist form), `prepTemplate: PrepColSpec[]` (spreadsheet prep), and `runTemplate: Partial<RunConfig>` (AI run config).

**Architecture:** `RecipeDefinition` is split into independent sections: `inputs` drives `RecipePanel` rendering, `prepTemplate` drives `prepRecipe()` on the server, and `runTemplate` is passed directly to `ConfigureAIRunPanel` as presets after cook. Inputs bind to columns via `inputId` references in fill strategies. Template interpolation (`{{inputId}}`) is extracted to a pure `interpolateTemplate()` helper in `utils.ts` for testability.

**Tech Stack:** TypeScript, Jest/ts-jest, Google Apps Script (server), vanilla DOM (client panel).

**Worktree:** `.worktrees/recipe-architecture-redesign` on branch `feature/recipe-architecture-redesign`

---

### Task 1: Add `interpolateTemplate` to `utils.ts`

This is the only genuinely new logic. Extract it first so it's testable in isolation before we wire it into `prepRecipe`.

**Files:**
- Modify: `src/server/utils.ts`
- Modify: `__tests__/utils.test.ts`

**Step 1: Write the failing tests**

Add to the bottom of `__tests__/utils.test.ts`:

```ts
import { interpolateTemplate } from "../src/server/utils";

describe("interpolateTemplate", () => {
  it("replaces a single {{inputId}} with the corresponding value", () => {
    expect(interpolateTemplate("Hello {{name}}", { name: "world" })).toBe("Hello world");
  });

  it("replaces multiple placeholders in one string", () => {
    expect(
      interpolateTemplate("{{a}} and {{b}}", { a: "foo", b: "bar" }),
    ).toBe("foo and bar");
  });

  it("replaces the same placeholder multiple times", () => {
    expect(interpolateTemplate("{{x}} {{x}}", { x: "hi" })).toBe("hi hi");
  });

  it("leaves unknown placeholders as empty string", () => {
    expect(interpolateTemplate("{{missing}}", {})).toBe("");
  });

  it("returns the string unchanged when no placeholders present", () => {
    expect(interpolateTemplate("no placeholders", { x: "y" })).toBe("no placeholders");
  });
});
```

**Step 2: Run to confirm failure**

```bash
npx jest __tests__/utils.test.ts -t "interpolateTemplate"
```

Expected: FAIL — `interpolateTemplate` is not exported.

**Step 3: Implement in `src/server/utils.ts`**

Add at the bottom of the file (before any closing braces):

```ts
export function interpolateTemplate(template: string, inputValues: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, id: string) => inputValues[id] ?? "");
}
```

**Step 4: Run to confirm passing**

```bash
npx jest __tests__/utils.test.ts -t "interpolateTemplate"
```

Expected: 5 tests passing.

**Step 5: Run full suite to check for regressions**

```bash
npm test
```

Expected: 433 tests passing (428 + 5 new).

**Step 6: Commit**

```bash
git add src/server/utils.ts __tests__/utils.test.ts
git commit -m "feat: add interpolateTemplate utility for recipe template strategy"
```

---

### Task 2: Update shared types

This is the RPC boundary change. After this commit TypeScript will report errors in `server/index.ts` and `client/panels/recipe.ts` — that is expected and will be fixed in Tasks 3 and 4.

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Update `ColStrategy`**

Replace the existing `ColStrategy` type:

```ts
// Before
export type ColStrategy =
  | { kind: "list-drive-folder"; url: string }
  | { kind: "fill-value"; value: string }
  | { kind: "create-empty" };

// After
export type ColStrategy =
  | { kind: "list-drive-folder"; inputId: string }
  | { kind: "fill-value"; value: string }
  | { kind: "template"; template: string }
  | { kind: "create-empty" };
```

**Step 2: Update `PrepRecipeParams`**

```ts
// Before
export interface PrepRecipeParams {
  cols: PrepColSpec[];
}

// After
export interface PrepRecipeParams {
  cols: PrepColSpec[];
  inputValues: Record<string, string>;
}
```

**Step 3: Confirm expected typecheck errors**

```bash
npm run typecheck 2>&1 | grep "error TS"
```

Expected: errors in `src/server/index.ts` (reads `strategy.url`) and `src/client/panels/recipe.ts` (sends `{ url }` in payload). No errors elsewhere.

**Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: update ColStrategy and PrepRecipeParams for inputId-based binding"
```

---

### Task 3: Update `prepRecipe()` in `server/index.ts`

Fix the server-side breakage from Task 2. The key changes: resolve `inputId` from `inputValues` for `list-drive-folder`, and handle the new `template` strategy using `interpolateTemplate`.

**Files:**
- Modify: `src/server/index.ts`

**Step 1: Update the function signature and `list-drive-folder` handling**

In `prepRecipe`, the parameter is already `PrepRecipeParams`. Update the destructuring and Pass 1:

```ts
// Add inputValues to the destructured params:
export function prepRecipe({ cols, inputValues }: PrepRecipeParams): PrepRecipeResult {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  let numRows = 1;

  // Pass 1: scan Drive folders, cache results, determine numRows
  const folderCache = new Map<string, string[]>();
  for (const col of cols) {
    if (col.strategy.kind === "list-drive-folder") {
      const url = inputValues[col.strategy.inputId] ?? "";  // ← resolve inputId
      if (!folderCache.has(url)) {
        const folder = DriveApp.getFolderById(extractId(url));
        const files: { url: string }[] = [];
        getAllFilesRecursive(folder, files);
        folderCache.set(url, files.map((f) => f.url));
      }
      numRows = Math.max(numRows, folderCache.get(url)!.length || 1);
    }
  }
```

**Step 2: Update Pass 2 to handle `template` and the updated `list-drive-folder`**

```ts
  // Pass 2: write all columns
  for (const col of cols) {
    const colIdx = findOrCreateColumn(sheet, col.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
    switch (col.strategy.kind) {
      case "list-drive-folder": {
        const url = inputValues[col.strategy.inputId] ?? "";  // ← resolve inputId
        const urls = folderCache.get(url) ?? [];
        writeColumn(sheet, colIdx, urls, SpreadsheetApp.WrapStrategy.CLIP);
        break;
      }
      case "fill-value":
        writeColumn(
          sheet,
          colIdx,
          Array(numRows).fill(col.strategy.value) as string[],
          SpreadsheetApp.WrapStrategy.CLIP,
        );
        break;
      case "template": {                                       // ← new
        const resolved = interpolateTemplate(col.strategy.template, inputValues);
        writeColumn(
          sheet,
          colIdx,
          Array(numRows).fill(resolved) as string[],
          SpreadsheetApp.WrapStrategy.CLIP,
        );
        break;
      }
      case "create-empty":
        // column created above; nothing to write
        break;
    }
  }
```

Make sure `interpolateTemplate` is imported at the top of `index.ts`:

```ts
import { /* existing imports */, interpolateTemplate } from "./utils";
```

**Step 3: Confirm server typecheck passes**

```bash
tsc --noEmit 2>&1 | grep "error TS"
```

Expected: no errors in server files. Client errors may still exist (fixed in Task 4).

**Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: update prepRecipe to resolve inputId refs and handle template strategy"
```

---

### Task 4: Update client types and `RecipeDefinition`

Replace the `ColumnDef` cluster with `UserInput` and update `RecipeDefinition` to use `inputs`, `prepTemplate`, `runTemplate`.

**Files:**
- Modify: `src/client/types.ts`

**Step 1: Remove the old recipe UI types**

Delete these interfaces/types entirely from `src/client/types.ts`:
- `RecipeFieldConfig`
- `ColStrategyKind`
- `ColRole`
- `AppendField`
- `RecipeSettings`
- `ColumnDef`
- `RecipeParams`

**Step 2: Add `UserInput` and update `RecipeDefinition`**

Add after the loading/progress types block:

```ts
// ── Recipe UI types ─────────────────────────────────────────────
// These are client-only — they define the journalist-facing form, not RPC payloads.

export interface UserInput {
  id: string;
  label: string;
  required?: boolean;
  helperText?: string;
  placeholder?: string;
}

export interface RecipeDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  inputs: UserInput[];
  prepTemplate: PrepColSpec[];
  runTemplate: Partial<RunConfig>;
}
```

Add the necessary imports at the top of the file (if not already present):

```ts
import type { PrepColSpec, RunConfig } from "../shared/types";
```

**Step 3: Run typecheck — expect client panel errors**

```bash
tsc -p tsconfig.client.json --noEmit 2>&1 | grep "error TS"
```

Expected: errors in `src/client/panels/recipe.ts` and `src/client/recipes.ts` (reference removed types). Fixed in Tasks 5 and 6.

**Step 4: Commit**

```bash
git add src/client/types.ts
git commit -m "feat: replace ColumnDef cluster with UserInput; update RecipeDefinition"
```

---

### Task 5: Rewrite `RecipePanel` and its tests

This is the largest task. The panel now renders `inputs[]` only — no column cards, no lockable fields per column. `buildPrepParams` collects `inputValues` from the form and forwards `prepTemplate`. `buildRunConfig` spreads `runTemplate` + `rowRange`.

**Files:**
- Rewrite: `src/client/panels/recipe.ts`
- Rewrite: `__tests__/panels/recipe.test.ts`

**Step 1: Rewrite the tests first**

Replace the entire contents of `__tests__/panels/recipe.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import { RecipePanel } from "../../src/client/panels/recipe";
import * as services from "../../src/client/services";
import type { PrepRecipeResult, RunConfig } from "../../src/shared/types";
import type { RecipeDefinition, NavigationContext } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return {
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  };
}

const baseDefinition: RecipeDefinition = {
  id: "test-recipe",
  name: "Test Recipe",
  icon: "🧪",
  description: "A test recipe",
  inputs: [
    { id: "folder", label: "Drive Folder", required: true, placeholder: "Paste folder URL" },
    { id: "question", label: "What are you looking for?" },
  ],
  prepTemplate: [
    { colTitle: "Drive Link",  strategy: { kind: "list-drive-folder", inputId: "folder" } },
    { colTitle: "User Prompt", strategy: { kind: "template", template: "Summarize. Focus on: {{question}}" } },
    { colTitle: "Output",      strategy: { kind: "create-empty" } },
  ],
  runTemplate: {
    promptCols: [
      { col: "Drive Link",  kind: "file" },
      { col: "User Prompt", kind: "text" },
    ],
    outputCol: "Output",
    tools: ["google_search"],
  },
};

const mockResult: PrepRecipeResult = { rowRange: { start: 2, end: 11 } };

function mount(definition = baseDefinition, savedState?: unknown) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipePanel();
  panel.mount(container, nav, definition, savedState as never);
  return { container, nav, panel };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

// ── rendering ──────────────────────────────────────────────────

describe("rendering", () => {
  it("renders one input field per UserInput", () => {
    const { container } = mount();
    expect(container.querySelectorAll(".recipe-input-field")).toHaveLength(2);
  });

  it("renders the label for each input", () => {
    const { container } = mount();
    const labels = Array.from(container.querySelectorAll(".recipe-input-label")).map(
      (el) => el.textContent,
    );
    expect(labels).toContain("Drive Folder");
    expect(labels).toContain("What are you looking for?");
  });

  it("renders placeholder on the input element", () => {
    const { container } = mount();
    const input = container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!;
    expect(input.placeholder).toBe("Paste folder URL");
  });

  it("does not render column section cards", () => {
    const { container } = mount();
    expect(container.querySelector(".recipe-section-card")).toBeNull();
  });
});

// ── prep flow ──────────────────────────────────────────────────

describe("Prep flow", () => {
  beforeEach(() => mockPrepRecipe.mockClear());

  it("calls prepRecipe with prepTemplate and collected inputValues", async () => {
    mockPrepRecipe.mockResolvedValue(mockResult);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/drive/folders/abc";
    container.querySelector<HTMLInputElement>('[data-input-id="question"]')!.value =
      "fraud patterns";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith({
      cols: baseDefinition.prepTemplate,
      inputValues: { folder: "https://drive.google.com/drive/folders/abc", question: "fraud patterns" },
    });
  });

  it("shows alert and does not call prepRecipe when required input is empty", async () => {
    const alertMock = jest.fn();
    globalThis.alert = alertMock;
    const { container } = mount();
    // leave 'folder' empty
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(mockPrepRecipe).not.toHaveBeenCalled();
  });
});

// ── cook flow ──────────────────────────────────────────────────

describe("Cook flow", () => {
  it("navigates to configure-ai-run with runTemplate merged with rowRange", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const { container, nav } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/drive/folders/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith("configure-ai-run", {
      ...baseDefinition.runTemplate,
      rowRange: { start: 2, end: 5 },
    });
  });
});

// ── saved state ────────────────────────────────────────────────

describe("unmount / saved state", () => {
  it("unmount returns inputValues and prepComplete: false when not prepped", () => {
    const { container, panel } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "my-url";
    const state = panel.unmount();
    expect(state).toMatchObject({
      inputValues: { folder: "my-url", question: "" },
      prepComplete: false,
    });
  });

  it("restores input values from savedState", () => {
    const savedState = {
      inputValues: { folder: "restored-url", question: "restored-question" },
      prepComplete: false,
    };
    const { container } = mount(baseDefinition, savedState);
    expect(
      container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value,
    ).toBe("restored-url");
  });

  it("mounts with savedState prepComplete: true — Cook is enabled", () => {
    const savedState = {
      inputValues: {},
      prepComplete: true,
      preppedRunConfig: { outputCol: "Output", promptCols: [] } as Partial<RunConfig>,
    };
    const { container } = mount(baseDefinition, savedState);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});
```

**Step 2: Run tests to confirm they all fail**

```bash
npx jest __tests__/panels/recipe.test.ts
```

Expected: FAIL — tests reference new API that doesn't exist yet.

**Step 3: Rewrite `src/client/panels/recipe.ts`**

Replace the entire file:

```ts
import type { NavigationContext, Panel, RecipeDefinition, UserInput } from "../types";
import type { PrepRecipeParams, PrepRecipeResult, RunConfig } from "../../shared/types";
import { RecipePrepCook } from "../components/recipe-prep-cook";
import { prepRecipe } from "../services";

type SavedState = {
  inputValues: Record<string, string>;
  prepComplete: boolean;
  preppedRunConfig?: Partial<RunConfig>;
};

export class RecipePanel implements Panel<RecipeDefinition, SavedState> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private prepCook: RecipePrepCook | null = null;
  private preppedRunConfig: Partial<RunConfig> | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    definition?: RecipeDefinition,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.preppedRunConfig = savedState?.preppedRunConfig ?? null;

    container.innerHTML = this.template(definition);
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());

    this.restoreInputValues(container, definition?.inputs ?? [], savedState?.inputValues ?? {});
    this.mountPrepCook(container, savedState?.prepComplete ?? false);
  }

  unmount(): SavedState {
    const inputs = this.definition?.inputs ?? [];
    const inputValues: Record<string, string> = {};
    for (const input of inputs) {
      const el = document.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      inputValues[input.id] = el?.value ?? "";
    }
    return {
      inputValues,
      prepComplete: this.prepCook?.isPrepComplete() ?? false,
      preppedRunConfig: this.preppedRunConfig ?? undefined,
    };
  }

  private restoreInputValues(
    container: HTMLElement,
    inputs: UserInput[],
    savedValues: Record<string, string>,
  ): void {
    for (const input of inputs) {
      const el = container.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      if (el && savedValues[input.id]) el.value = savedValues[input.id];
      el?.addEventListener("input", () => this.prepCook?.reset());
    }
  }

  private mountPrepCook(container: HTMLElement, prepComplete: boolean): void {
    this.prepCook = new RecipePrepCook(container.querySelector("#prep-cook-container")!, {
      onPrep: async (): Promise<void> => {
        const params = this.buildPrepParams();
        if (!params) throw null;
        const result = await prepRecipe(params);
        this.preppedRunConfig = this.buildRunConfig(result);
      },
      onCook: (): void => {
        if (this.preppedRunConfig) {
          this.nav?.navigate("configure-ai-run", this.preppedRunConfig);
        }
      },
      prepComplete,
    });
  }

  private buildPrepParams(): PrepRecipeParams | null {
    const inputs = this.definition?.inputs ?? [];
    const inputValues: Record<string, string> = {};

    for (const input of inputs) {
      const el = document.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      const value = el?.value.trim() ?? "";
      if (input.required && !value) {
        globalThis.alert(`Please fill in "${input.label}".`);
        return null;
      }
      inputValues[input.id] = value;
    }

    return {
      cols: this.definition?.prepTemplate ?? [],
      inputValues,
    };
  }

  private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
    return {
      ...this.definition?.runTemplate,
      rowRange: result.rowRange,
    };
  }

  private template(definition: RecipeDefinition | undefined | null): string {
    const inputs = definition?.inputs ?? [];
    const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";

    const inputsHtml = inputs
      .map((input) => {
        const requiredMark = input.required ? ` <span class="required">*</span>` : "";
        const helperHtml = input.helperText
          ? `<p class="field-helper">${input.helperText}</p>`
          : "";
        return `
          <div class="recipe-input-field">
            <label class="recipe-input-label">${input.label}${requiredMark}</label>
            ${helperHtml}
            <input
              data-input-id="${input.id}"
              type="text"
              class="text-input"
              placeholder="${input.placeholder ?? ""}"
            />
          </div>`;
      })
      .join("");

    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">${title}</span>
      </div>
      ${inputsHtml}
      <div id="prep-cook-container"></div>
    `;
  }
}
```

**Step 4: Run the recipe panel tests**

```bash
npx jest __tests__/panels/recipe.test.ts
```

Expected: all tests passing.

**Step 5: Run full suite**

```bash
npm test
```

Expected: all tests passing (count will differ from baseline due to removed + added tests).

**Step 6: Commit**

```bash
git add src/client/panels/recipe.ts __tests__/panels/recipe.test.ts
git commit -m "feat: rewrite RecipePanel to render UserInput[] and use prepTemplate/runTemplate"
```

---

### Task 6: Rewrite `RECIPES` registry

Update the document-summarization recipe to use the new `RecipeDefinition` shape.

**Files:**
- Rewrite: `src/client/recipes.ts`

**Step 1: Rewrite the file**

```ts
import type { RecipeDefinition } from "./types";

export const RECIPES: RecipeDefinition[] = [
  {
    id: "document-summarization",
    name: "Document Summarization",
    icon: "📄",
    description: "Summarize each file in a Google Drive folder",
    inputs: [
      {
        id: "folder",
        label: "Drive Folder",
        required: true,
        helperText: "Make sure you have access to this folder",
        placeholder: "Paste Google Drive folder URL",
      },
    ],
    prepTemplate: [
      {
        colTitle: "Drive Link",
        strategy: { kind: "list-drive-folder", inputId: "folder" },
      },
      {
        colTitle: "System Prompt",
        strategy: {
          kind: "fill-value",
          value:
            "You are an expert document analyst. Produce clear, structured summaries " +
            "focusing on key themes, main arguments, important data points, and actionable conclusions.",
        },
      },
      {
        colTitle: "User Prompt",
        strategy: {
          kind: "fill-value",
          value:
            "Please summarize the attached document. Include the main topics, key findings, " +
            "and important conclusions. The document file will be attached as inline data.",
        },
      },
      {
        colTitle: "AI_Summarization",
        strategy: { kind: "create-empty" },
      },
    ],
    runTemplate: {
      promptCols: [
        { col: "Drive Link", kind: "file" },
        { col: "User Prompt", kind: "text" },
      ],
      systemPromptCol: "System Prompt",
      outputCol: "AI_Summarization",
    },
  },
];
```

**Step 2: Run full typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 3: Run full suite**

```bash
npm test
```

Expected: all tests passing.

**Step 4: Run lint**

```bash
npm run lint
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/client/recipes.ts
git commit -m "feat: rewrite RECIPES registry under new RecipeDefinition shape"
```

---

### Task 7: Final verification

**Step 1: Full typecheck**

```bash
npm run typecheck
```

Expected: clean.

**Step 2: Full test suite with coverage**

```bash
npm run test:coverage
```

Expected: all thresholds met, all tests passing.

**Step 3: Build**

```bash
npm run build
```

Expected: clean build, no rollup errors.

**Step 4: Lint + format check**

```bash
npm run lint && npm run format:check
```

Expected: clean.
