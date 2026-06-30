# Recipe UX Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three A/B test UX variant panels for the Document Summarization recipe — V1 (4-button), V2 (2-button auto-prep), V3 (didactic step-by-step) — on a dedicated feature branch.

**Architecture:** Three new self-contained panel classes registered alongside the existing `RecipePanel`. A `variant` field on `RecipeDefinition` drives routing in `RecipesListPanel`. Each variant calls `runBatchAI` directly for Cook/Test, bypassing `ConfigureAIRunPanel`. No server code changes.

**Tech Stack:** TypeScript, Rollup IIFE, jsdom (Jest), Google Apps Script V8 runtime (ES2019)

**Spec:** `docs/superpowers/specs/2026-05-06-recipe-ux-variants-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/client/types.ts` | Modify | Add `variant` to `RecipeDefinition`; add panel IDs |
| `src/client/panels/recipe.ts` | Modify | Export `buildRunTemplate` |
| `src/client/recipes.ts` | Modify | Add V1/V2/V3 recipe entries |
| `src/client/panels/recipes-list.ts` | Modify | Route by `definition.variant` |
| `src/client/panels/recipe-v1.ts` | Create | 4-button variant panel |
| `src/client/panels/recipe-v2.ts` | Create | 2-button simplified panel |
| `src/client/panels/recipe-v3.ts` | Create | Didactic step-by-step panel |
| `src/client/sidebar-entry.ts` | Modify | Register 3 new panels |
| `__tests__/panels/recipe-v1.test.ts` | Create | V1 panel tests |
| `__tests__/panels/recipe-v2.test.ts` | Create | V2 panel tests |
| `__tests__/panels/recipe-v3.test.ts` | Create | V3 panel tests |
| `__tests__/panels/recipes-list.test.ts` | Modify | Add variant routing test |

---

### Task 1: Create branch + scaffold types

**Files:**
- Modify: `src/client/types.ts`

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feature/recipe-ux-variants
```

- [ ] **Step 2: Add `variant` to `RecipeDefinition` and new panel IDs to `PanelId`**

In `src/client/types.ts`, update `PanelId`:

```ts
export type PanelId =
  | "tool-list"
  | "configure-ai-run"
  | "recipes-list"
  | "recipe"
  | "recipe-v1"
  | "recipe-v2"
  | "recipe-v3"
  | "import-drive-links"
  | "extract-text";
```

Add `variant` to `RecipeDefinition` (after the `intro?` field):

```ts
export interface RecipeDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  intro?: string;
  /** Routes RecipesListPanel to the appropriate variant panel. Absent = standard RecipePanel. */
  variant?: "v1" | "v2" | "v3";
  inputs: RecipeInput[];
  prepTemplate: RecipeColumn[];
  settings?: RecipeSettings;
}
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/client/types.ts
git commit -m "feat: add variant field to RecipeDefinition and recipe-v1/v2/v3 PanelIds"
```

---

### Task 2: Export `buildRunTemplate` and add recipe entries

**Files:**
- Modify: `src/client/panels/recipe.ts` (line 17)
- Modify: `src/client/recipes.ts`

- [ ] **Step 1: Export `buildRunTemplate` from `recipe.ts`**

Change line 17 of `src/client/panels/recipe.ts` from:

```ts
function buildRunTemplate(cols: RecipeColumn[]): Partial<RunConfig> {
```

to:

```ts
export function buildRunTemplate(cols: RecipeColumn[]): Partial<RunConfig> {
```

- [ ] **Step 2: Add V1, V2, V3 recipe entries to `recipes.ts`**

Append the following three entries to the `RECIPES` array in `src/client/recipes.ts`. They share the same `prepTemplate` and `inputs` as the original Document Summarization recipe but carry a `variant` field:

```ts
  {
    id: "document-summarization-v1",
    name: "Document Summarization (V1)",
    icon: "📄",
    variant: "v1" as const,
    description: "Summarize Drive files — 4-button flow with inline Test and Cook",
    intro:
      "This recipe reads every file in a Drive folder and generates a tight, scannable summary for each one. " +
      "Prep sets up your columns, then Test a single row, Cook everything, or Configure AI for full control.",
    inputs: [
      {
        id: "folder",
        label: "Drive Folder",
        required: true,
        helperText: "The folder of documents to summarize. Make sure you have access.",
        placeholder: "Paste Google Drive folder URL",
      },
      {
        id: "docType",
        label: "Document Type",
        required: false,
        helperText: "Helps the AI read the document — legal language reads differently than a financial disclosure",
        placeholder: "e.g. court docket, email",
      },
      {
        id: "focus",
        label: "Area of Interest",
        required: false,
        helperText: "The AI will prioritize this above all else in the summary",
        placeholder: "e.g. specific people, financial fraud",
      },
    ],
    prepTemplate: [
      {
        colTitle: "System Prompt",
        fillStrategy: {
          kind: "template",
          template:
            "Role: You are a specialized Briefing Assistant. Your goal is to distill complex documents into ultra-concise, scannable summaries.\n\n" +
            'Tone: Objective, professional, and dense with information but sparse with "fluff" words.\n\n' +
            "Guidelines:\n" +
            '  - Prioritize Utility: Focus on information that helps a user decide: "Do I need to open the full file?"\n' +
            "  - Structure: Always start with a 1-sentence bottom line (no label or prefix — just the sentence). Follow with 3-5 high-impact bullet points.\n" +
            "  - Constraint: Keep the entire output under 150 words.\n" +
            "{{#docType}}  - Document type: {{docType}}\n{{/docType}}" +
            "{{#focus}}  - Area of interest: {{focus}} — prioritize this above all else.\n{{/focus}}",
        },
        role: "system-prompt",
      },
      {
        colTitle: "Drive Link",
        fillStrategy: { kind: "list-drive-folder", inputId: "folder" },
        role: "file-prompt",
      },
      {
        colTitle: "AI_Summarization",
        fillStrategy: { kind: "create-empty" },
        role: "output",
      },
    ],
  },
  {
    id: "document-summarization-v2",
    name: "Document Summarization (V2)",
    icon: "📄",
    variant: "v2" as const,
    description: "Summarize Drive files — one-click Test or Cook, no prep step",
    intro:
      "This recipe reads every file in a Drive folder and generates a tight, scannable summary for each one. " +
      "Test runs on the first 10 rows so you can check quality. Cook processes everything in one shot.",
    inputs: [
      {
        id: "folder",
        label: "Drive Folder",
        required: true,
        helperText: "The folder of documents to summarize. Make sure you have access.",
        placeholder: "Paste Google Drive folder URL",
      },
      {
        id: "docType",
        label: "Document Type",
        required: false,
        helperText: "Helps the AI read the document — legal language reads differently than a financial disclosure",
        placeholder: "e.g. court docket, email",
      },
      {
        id: "focus",
        label: "Area of Interest",
        required: false,
        helperText: "The AI will prioritize this above all else in the summary",
        placeholder: "e.g. specific people, financial fraud",
      },
    ],
    prepTemplate: [
      {
        colTitle: "System Prompt",
        fillStrategy: {
          kind: "template",
          template:
            "Role: You are a specialized Briefing Assistant. Your goal is to distill complex documents into ultra-concise, scannable summaries.\n\n" +
            'Tone: Objective, professional, and dense with information but sparse with "fluff" words.\n\n' +
            "Guidelines:\n" +
            '  - Prioritize Utility: Focus on information that helps a user decide: "Do I need to open the full file?"\n' +
            "  - Structure: Always start with a 1-sentence bottom line (no label or prefix — just the sentence). Follow with 3-5 high-impact bullet points.\n" +
            "  - Constraint: Keep the entire output under 150 words.\n" +
            "{{#docType}}  - Document type: {{docType}}\n{{/docType}}" +
            "{{#focus}}  - Area of interest: {{focus}} — prioritize this above all else.\n{{/focus}}",
        },
        role: "system-prompt",
      },
      {
        colTitle: "Drive Link",
        fillStrategy: { kind: "list-drive-folder", inputId: "folder" },
        role: "file-prompt",
      },
      {
        colTitle: "AI_Summarization",
        fillStrategy: { kind: "create-empty" },
        role: "output",
      },
    ],
  },
  {
    id: "document-summarization-v3",
    name: "Document Summarization (V3)",
    icon: "📄",
    variant: "v3" as const,
    description: "Summarize Drive files — step-by-step guided setup",
    intro:
      "This recipe walks you through each stage of setup before running the AI. " +
      "Import your files, configure your prompt, then Test or Cook when you're ready.",
    inputs: [
      {
        id: "folder",
        label: "Drive Folder",
        required: true,
        helperText: "The folder of documents to summarize. Make sure you have access.",
        placeholder: "Paste Google Drive folder URL",
      },
      {
        id: "docType",
        label: "Document Type",
        required: false,
        helperText: "Helps the AI read the document — legal language reads differently than a financial disclosure",
        placeholder: "e.g. court docket, email",
      },
      {
        id: "focus",
        label: "Area of Interest",
        required: false,
        helperText: "The AI will prioritize this above all else in the summary",
        placeholder: "e.g. specific people, financial fraud",
      },
    ],
    prepTemplate: [
      {
        colTitle: "System Prompt",
        fillStrategy: {
          kind: "template",
          template:
            "Role: You are a specialized Briefing Assistant. Your goal is to distill complex documents into ultra-concise, scannable summaries.\n\n" +
            'Tone: Objective, professional, and dense with information but sparse with "fluff" words.\n\n' +
            "Guidelines:\n" +
            '  - Prioritize Utility: Focus on information that helps a user decide: "Do I need to open the full file?"\n' +
            "  - Structure: Always start with a 1-sentence bottom line (no label or prefix — just the sentence). Follow with 3-5 high-impact bullet points.\n" +
            "  - Constraint: Keep the entire output under 150 words.\n" +
            "{{#docType}}  - Document type: {{docType}}\n{{/docType}}" +
            "{{#focus}}  - Area of interest: {{focus}} — prioritize this above all else.\n{{/focus}}",
        },
        role: "system-prompt",
      },
      {
        colTitle: "Drive Link",
        fillStrategy: { kind: "list-drive-folder", inputId: "folder" },
        role: "file-prompt",
      },
      {
        colTitle: "AI_Summarization",
        fillStrategy: { kind: "create-empty" },
        role: "output",
      },
    ],
  },
```

- [ ] **Step 3: Typecheck and test**

```bash
npm run typecheck && npm test
```

Expected: all 489 tests pass, no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/client/panels/recipe.ts src/client/recipes.ts
git commit -m "feat: export buildRunTemplate; add V1/V2/V3 recipe entries"
```

---

### Task 3: Update `RecipesListPanel` routing

**Files:**
- Modify: `src/client/panels/recipes-list.ts`
- Modify: `__tests__/panels/recipes-list.test.ts`

- [ ] **Step 1: Write the failing test**

Add one new test to `__tests__/panels/recipes-list.test.ts`. The existing mock at the top of the file already has two RECIPES entries without `variant`. Add a third mocked entry with `variant: "v1"`:

Replace the mock in `__tests__/panels/recipes-list.test.ts`:

```ts
jest.mock("../../src/client/recipes", () => ({
  RECIPES: [
    {
      id: "doc-sum",
      name: "Document Summarization",
      icon: "📄",
      description: "Summarize files",
      panelId: "recipe",
      params: { driveFolder: { colTitle: "Drive Link" } },
    },
    {
      id: "custom",
      name: "Custom Recipe",
      icon: "🔧",
      description: "Custom",
      panelId: "recipe",
      params: {},
    },
    {
      id: "doc-sum-v1",
      name: "Document Summarization V1",
      icon: "📄",
      description: "V1 variant",
      variant: "v1",
    },
  ],
}));
```

Add this test inside the `describe("RecipesListPanel")` block:

```ts
it("clicking a variant recipe navigates to recipe-v1 when variant is v1", () => {
  const { container, nav } = mount();
  container.querySelector<HTMLButtonElement>("#btn-doc-sum-v1")!.click();
  expect(nav.navigate).toHaveBeenCalledWith(
    "recipe-v1",
    expect.objectContaining({ id: "doc-sum-v1", variant: "v1" }),
  );
});
```

- [ ] **Step 2: Run the new test to verify it fails**

```bash
npx jest __tests__/panels/recipes-list.test.ts -t "variant recipe"
```

Expected: FAIL — navigates to `"recipe"` instead of `"recipe-v1"`.

- [ ] **Step 3: Update `RecipesListPanel` to route by variant**

In `src/client/panels/recipes-list.ts`, change the `navigate` call inside `mount`:

```ts
RECIPES.forEach((recipe) => {
  container
    .querySelector(`#btn-${recipe.id}`)
    ?.addEventListener("click", () =>
      nav.navigate(recipe.variant ? `recipe-${recipe.variant}` : "recipe", recipe),
    );
});
```

- [ ] **Step 4: Run all recipes-list tests**

```bash
npx jest __tests__/panels/recipes-list.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/panels/recipes-list.ts __tests__/panels/recipes-list.test.ts
git commit -m "feat: route RecipesListPanel to recipe-v1/v2/v3 based on variant field"
```

---

### Task 4: Implement `RecipeV1Panel`

**Files:**
- Create: `src/client/panels/recipe-v1.ts`
- Create: `__tests__/panels/recipe-v1.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/panels/recipe-v1.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
  runBatchAI: jest.fn(),
}));

jest.mock("../../src/client/panels/recipe", () => ({
  buildRunTemplate: jest.fn().mockReturnValue({
    promptCols: [{ col: "Drive Link", kind: "file" }],
    systemPromptCol: "System Prompt",
    outputCol: "AI_Summarization",
  }),
}));

import { RecipeV1Panel } from "../../src/client/panels/recipe-v1";
import * as services from "../../src/client/services";
import type { RecipeDefinition, NavigationContext } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;
const mockRunBatchAI = services.runBatchAI as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return {
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  };
}

const baseDefinition: RecipeDefinition = {
  id: "document-summarization-v1",
  name: "Document Summarization V1",
  icon: "📄",
  variant: "v1",
  description: "Test recipe",
  inputs: [
    { id: "folder", label: "Drive Folder", required: true, placeholder: "Paste URL" },
    { id: "focus", label: "Area of Interest" },
  ],
  prepTemplate: [
    { colTitle: "System Prompt", fillStrategy: { kind: "template", template: "Summarize." }, role: "system-prompt" },
    { colTitle: "Drive Link", fillStrategy: { kind: "list-drive-folder", inputId: "folder" }, role: "file-prompt" },
    { colTitle: "AI_Summarization", fillStrategy: { kind: "create-empty" }, role: "output" },
  ],
};

const mockPrepResult = { rowRange: { start: 2, end: 11 } };

function mount(definition = baseDefinition, savedState?: unknown) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipeV1Panel();
  panel.mount(container, nav, definition, savedState as never);
  return { container, nav, panel };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

beforeEach(() => {
  mockPrepRecipe.mockClear();
  mockRunBatchAI.mockClear();
});

describe("initial state", () => {
  it("renders Prep enabled, Test/Cook/Configure disabled", () => {
    const { container } = mount();
    expect(container.querySelector<HTMLButtonElement>("#prep-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(true);
  });

  it("renders one input per definition input", () => {
    const { container } = mount();
    expect(container.querySelectorAll("[data-input-id]")).toHaveLength(2);
  });
});

describe("Prep flow", () => {
  it("calls prepRecipe with cols excluding the output column", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith({
      cols: [
        expect.objectContaining({ colTitle: "System Prompt" }),
        expect.objectContaining({ colTitle: "Drive Link" }),
      ],
      inputValues: expect.objectContaining({ folder: "https://drive.google.com/abc" }),
    });
    const calledCols = mockPrepRecipe.mock.calls[0][0].cols;
    expect(calledCols.every((c: { role?: string }) => c.role !== "output")).toBe(true);
  });

  it("enables Test, Cook, Configure after Prep succeeds", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(false);
  });

  it("shows alert and stays idle when required input is empty", async () => {
    globalThis.alert = jest.fn();
    const { container } = mount();
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(globalThis.alert).toHaveBeenCalledTimes(1);
    expect(mockPrepRecipe).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
  });

  it("returns to idle if Prep fails", async () => {
    mockPrepRecipe.mockRejectedValue(new Error("server error"));
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
  });

  it("resets to idle when an input field changes after prep", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.dispatchEvent(new Event("input"));
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
  });
});

describe("Test flow", () => {
  async function prepAndGetContainer() {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container, nav } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    return { container, nav };
  }

  it("calls runBatchAI with rowRange covering only the first data row", async () => {
    const { container } = await prepAndGetContainer();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 2 } }),
    );
  });

  it("disables all buttons while testing", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    mockRunBatchAI.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#prep-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(true);
  });

  it("returns to prepped state after Test completes", async () => {
    const { container } = await prepAndGetContainer();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});

describe("Cook flow", () => {
  it("calls runBatchAI with the full rowRange", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 11 } }),
    );
  });
});

describe("Configure AI flow", () => {
  it("navigates to configure-ai-run with preppedRunConfig", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    const { container, nav } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#configure-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith(
      "configure-ai-run",
      expect.objectContaining({ outputCol: "AI_Summarization", rowRange: { start: 2, end: 11 } }),
    );
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx jest __tests__/panels/recipe-v1.test.ts
```

Expected: FAIL — `RecipeV1Panel` not found.

- [ ] **Step 3: Create `src/client/panels/recipe-v1.ts`**

```ts
import type { NavigationContext, Panel, RecipeDefinition } from "../types";
import type { PrepRecipeParams, RunConfig } from "../../shared/types";
import { prepRecipe, runBatchAI } from "../services";
import { buildRunTemplate } from "./recipe";

type V1State = "idle" | "prepping" | "prepped" | "testing" | "cooking";

type SavedState = {
  inputValues: Record<string, string>;
  v1State: V1State;
  rowRange?: { start: number; end: number };
  preppedRunConfig?: Partial<RunConfig>;
};

export class RecipeV1Panel implements Panel<RecipeDefinition, SavedState> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private container: HTMLElement | null = null;
  private v1State: V1State = "idle";
  private rowRange: { start: number; end: number } | null = null;
  private preppedRunConfig: Partial<RunConfig> | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    definition?: RecipeDefinition,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.container = container;
    this.v1State = savedState?.v1State ?? "idle";
    this.rowRange = savedState?.rowRange ?? null;
    this.preppedRunConfig = savedState?.preppedRunConfig ?? null;

    container.innerHTML = this.template(definition);
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    this.restoreInputValues(container, definition?.inputs ?? [], savedState?.inputValues ?? {});
    this.wireButtons(container);
    this.applyState(container);
  }

  unmount(): SavedState {
    const inputValues: Record<string, string> = {};
    for (const input of this.definition?.inputs ?? []) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      inputValues[input.id] = el?.value ?? "";
    }
    return { inputValues, v1State: this.v1State, rowRange: this.rowRange ?? undefined, preppedRunConfig: this.preppedRunConfig ?? undefined };
  }

  private restoreInputValues(
    container: HTMLElement,
    inputs: RecipeDefinition["inputs"],
    savedValues: Record<string, string>,
  ): void {
    for (const input of inputs) {
      const el = container.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      if (el && savedValues[input.id]) el.value = savedValues[input.id];
      el?.addEventListener("input", () => {
        this.v1State = "idle";
        this.rowRange = null;
        this.preppedRunConfig = null;
        this.applyState(container);
      });
    }
  }

  private wireButtons(container: HTMLElement): void {
    container.querySelector("#prep-btn")?.addEventListener("click", () => this.handlePrep(container));
    container.querySelector("#test-btn")?.addEventListener("click", () => this.handleTest(container));
    container.querySelector("#cook-btn")?.addEventListener("click", () => this.handleCook(container));
    container.querySelector("#configure-btn")?.addEventListener("click", () => this.handleConfigureAI());
  }

  private applyState(container: HTMLElement): void {
    const prepBtn = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;
    const cookBtn = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    const configBtn = container.querySelector<HTMLButtonElement>("#configure-btn")!;

    prepBtn.disabled = false;
    testBtn.disabled = true;
    cookBtn.disabled = true;
    configBtn.disabled = true;
    prepBtn.textContent = "Prep Recipe";
    testBtn.textContent = "Test ▸ row 2";
    cookBtn.textContent = "Cook ▸ All";
    cookBtn.className = "btn-run";

    switch (this.v1State) {
      case "prepping":
        prepBtn.disabled = true;
        prepBtn.innerHTML = `<span class="btn-spinner"></span>Prepping…`;
        break;
      case "prepped":
        prepBtn.textContent = "Re-prep";
        testBtn.disabled = false;
        cookBtn.disabled = false;
        configBtn.disabled = false;
        break;
      case "testing":
        prepBtn.disabled = true;
        testBtn.disabled = true;
        testBtn.innerHTML = `<span class="btn-spinner"></span>Testing…`;
        cookBtn.disabled = true;
        configBtn.disabled = true;
        break;
      case "cooking":
        prepBtn.disabled = true;
        testBtn.disabled = true;
        cookBtn.disabled = true;
        cookBtn.innerHTML = `<span class="btn-spinner"></span>Cooking…`;
        configBtn.disabled = true;
        break;
    }
  }

  private buildPrepParams(): PrepRecipeParams | null {
    const inputValues: Record<string, string> = {};
    for (const input of this.definition?.inputs ?? []) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      const value = el?.value.trim() ?? "";
      if (input.required && !value) {
        globalThis.alert(`Please fill in "${input.label}".`);
        return null;
      }
      inputValues[input.id] = value;
    }
    return {
      cols: (this.definition?.prepTemplate ?? []).filter((col) => col.role !== "output"),
      inputValues,
    };
  }

  private handlePrep(container: HTMLElement): void {
    const params = this.buildPrepParams();
    if (!params) return;
    this.v1State = "prepping";
    this.applyState(container);
    prepRecipe(params).then(
      (result) => {
        this.rowRange = result.rowRange;
        this.preppedRunConfig = {
          ...buildRunTemplate(this.definition?.prepTemplate ?? []),
          ...this.definition?.settings,
          rowRange: result.rowRange,
        };
        this.v1State = "prepped";
        this.applyState(container);
      },
      (err: Error | null) => {
        if (err !== null) globalThis.alert("Error: " + err.message);
        this.v1State = "idle";
        this.applyState(container);
      },
    );
  }

  private handleTest(container: HTMLElement): void {
    if (!this.rowRange || !this.preppedRunConfig) return;
    const config = {
      ...this.preppedRunConfig,
      rowRange: { start: this.rowRange.start, end: this.rowRange.start },
    } as RunConfig;
    this.v1State = "testing";
    this.applyState(container);
    runBatchAI(config).then(
      () => {
        this.v1State = "prepped";
        this.applyState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.v1State = "prepped";
        this.applyState(container);
      },
    );
  }

  private handleCook(container: HTMLElement): void {
    if (!this.rowRange || !this.preppedRunConfig) return;
    const config = { ...this.preppedRunConfig, rowRange: this.rowRange } as RunConfig;
    this.v1State = "cooking";
    this.applyState(container);
    runBatchAI(config).then(
      () => {
        this.v1State = "prepped";
        this.applyState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.v1State = "prepped";
        this.applyState(container);
      },
    );
  }

  private handleConfigureAI(): void {
    if (this.preppedRunConfig) {
      this.nav?.navigate("configure-ai-run", this.preppedRunConfig);
    }
  }

  private template(definition: RecipeDefinition | undefined | null): string {
    const inputs = definition?.inputs ?? [];
    const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";
    const introHtml = definition?.intro ? `<p class="recipe-intro">${definition.intro}</p>` : "";
    const inputsHtml = inputs
      .map((input) => {
        const mark = input.required
          ? `<span class="required"> *</span>`
          : `<span class="optional"> (optional)</span>`;
        const helper = input.helperText ? `<p class="field-helper">${input.helperText}</p>` : "";
        return `<div class="field-group">
          <span class="field-label">${input.label}${mark}</span>
          ${helper}
          <input data-input-id="${input.id}" type="text" class="text-input" placeholder="${input.placeholder ?? ""}" />
        </div>`;
      })
      .join("");
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">${title}</span>
      </div>
      ${introHtml}
      ${inputsHtml}
      <div class="panel-buttons">
        <button id="prep-btn" class="btn-outline">Prep Recipe</button>
        <button id="test-btn" class="btn-outline" disabled>Test ▸ row 2</button>
        <button id="cook-btn" class="btn-run" disabled>Cook ▸ All</button>
        <button id="configure-btn" class="btn-outline" disabled>Configure AI</button>
      </div>
      <p class="field-helper">
        <strong>Prep</strong> — sets up your spreadsheet columns and imports files from Drive.
        <strong>Test</strong> — runs the AI on the first row only so you can check quality before committing.
        <strong>Cook</strong> — runs the AI on every file. Keep the sidebar open until it finishes.
        <strong>Configure AI</strong> — opens the full settings panel to review or adjust before running.
      </p>`;
  }
}
```

- [ ] **Step 4: Run V1 tests**

```bash
npx jest __tests__/panels/recipe-v1.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/panels/recipe-v1.ts __tests__/panels/recipe-v1.test.ts
git commit -m "feat: add RecipeV1Panel (4-button variant)"
```

---

### Task 5: Implement `RecipeV2Panel`

**Files:**
- Create: `src/client/panels/recipe-v2.ts`
- Create: `__tests__/panels/recipe-v2.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/panels/recipe-v2.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
  runBatchAI: jest.fn(),
}));

jest.mock("../../src/client/panels/recipe", () => ({
  buildRunTemplate: jest.fn().mockReturnValue({
    promptCols: [{ col: "Drive Link", kind: "file" }],
    systemPromptCol: "System Prompt",
    outputCol: "AI_Summarization",
  }),
}));

import { RecipeV2Panel } from "../../src/client/panels/recipe-v2";
import * as services from "../../src/client/services";
import type { RecipeDefinition, NavigationContext } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;
const mockRunBatchAI = services.runBatchAI as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return { navigate: jest.fn(), back: jest.fn(), canGoBack: jest.fn().mockReturnValue(true) };
}

const baseDefinition: RecipeDefinition = {
  id: "document-summarization-v2",
  name: "Document Summarization V2",
  icon: "📄",
  variant: "v2",
  description: "Test recipe",
  inputs: [
    { id: "folder", label: "Drive Folder", required: true, placeholder: "Paste URL" },
    { id: "focus", label: "Area of Interest" },
  ],
  prepTemplate: [
    { colTitle: "System Prompt", fillStrategy: { kind: "template", template: "Summarize." }, role: "system-prompt" },
    { colTitle: "Drive Link", fillStrategy: { kind: "list-drive-folder", inputId: "folder" }, role: "file-prompt" },
    { colTitle: "AI_Summarization", fillStrategy: { kind: "create-empty" }, role: "output" },
  ],
};

function mount(definition = baseDefinition) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipeV2Panel();
  panel.mount(container, nav, definition);
  return { container, nav, panel };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

beforeEach(() => {
  mockPrepRecipe.mockClear();
  mockRunBatchAI.mockClear();
});

describe("initial state", () => {
  it("renders Test and Cook both enabled", () => {
    const { container } = mount();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});

describe("Test flow", () => {
  it("calls prepRecipe then runBatchAI with first 10 data rows", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 50 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledTimes(1);
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 11 } }),
    );
  });

  it("clamps Test rowRange to actual end when fewer than 10 rows exist", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 5 } }),
    );
  });

  it("disables both buttons while testing", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 50 } });
    mockRunBatchAI.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
  });

  it("re-enables both buttons after Test completes", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 50 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });

  it("shows alert and re-enables on error", async () => {
    globalThis.alert = jest.fn();
    mockPrepRecipe.mockRejectedValue(new Error("server error"));
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(globalThis.alert).toHaveBeenCalledWith("Error: server error");
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
  });
});

describe("Cook flow", () => {
  it("calls prepRecipe then runBatchAI with the full rowRange", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 50 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 50 } }),
    );
  });

  it("excludes output column when calling prepRecipe", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 10 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    await flush();
    const calledCols = mockPrepRecipe.mock.calls[0][0].cols;
    expect(calledCols.every((c: { role?: string }) => c.role !== "output")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx jest __tests__/panels/recipe-v2.test.ts
```

Expected: FAIL — `RecipeV2Panel` not found.

- [ ] **Step 3: Create `src/client/panels/recipe-v2.ts`**

```ts
import type { NavigationContext, Panel, RecipeDefinition } from "../types";
import type { PrepRecipeParams, RunConfig } from "../../shared/types";
import { prepRecipe, runBatchAI } from "../services";
import { buildRunTemplate } from "./recipe";

type V2State = "idle" | "testing" | "cooking";

export class RecipeV2Panel implements Panel<RecipeDefinition, { inputValues: Record<string, string> }> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private container: HTMLElement | null = null;
  private v2State: V2State = "idle";

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    definition?: RecipeDefinition,
    savedState?: { inputValues: Record<string, string> },
  ): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.container = container;
    this.v2State = "idle";
    container.innerHTML = this.template(definition);
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    this.restoreInputValues(container, definition?.inputs ?? [], savedState?.inputValues ?? {});
    container.querySelector("#test-btn")?.addEventListener("click", () => this.handleTest(container));
    container.querySelector("#cook-btn")?.addEventListener("click", () => this.handleCook(container));
  }

  unmount(): { inputValues: Record<string, string> } {
    const inputValues: Record<string, string> = {};
    for (const input of this.definition?.inputs ?? []) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      inputValues[input.id] = el?.value ?? "";
    }
    return { inputValues };
  }

  private restoreInputValues(
    container: HTMLElement,
    inputs: RecipeDefinition["inputs"],
    savedValues: Record<string, string>,
  ): void {
    for (const input of inputs) {
      const el = container.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      if (el && savedValues[input.id]) el.value = savedValues[input.id];
    }
  }

  private applyState(container: HTMLElement): void {
    const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;
    const cookBtn = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    testBtn.disabled = false;
    cookBtn.disabled = false;
    testBtn.textContent = "Test ▸ first 10 rows";
    cookBtn.textContent = "Cook ▸ All rows";
    if (this.v2State === "testing") {
      testBtn.disabled = true;
      testBtn.innerHTML = `<span class="btn-spinner"></span>Testing…`;
      cookBtn.disabled = true;
    } else if (this.v2State === "cooking") {
      testBtn.disabled = true;
      cookBtn.disabled = true;
      cookBtn.innerHTML = `<span class="btn-spinner"></span>Cooking…`;
    }
  }

  private buildPrepParams(): PrepRecipeParams | null {
    const inputValues: Record<string, string> = {};
    for (const input of this.definition?.inputs ?? []) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      const value = el?.value.trim() ?? "";
      if (input.required && !value) {
        globalThis.alert(`Please fill in "${input.label}".`);
        return null;
      }
      inputValues[input.id] = value;
    }
    return {
      cols: (this.definition?.prepTemplate ?? []).filter((col) => col.role !== "output"),
      inputValues,
    };
  }

  private handleTest(container: HTMLElement): void {
    const params = this.buildPrepParams();
    if (!params) return;
    this.v2State = "testing";
    this.applyState(container);
    const finish = (): void => {
      this.v2State = "idle";
      this.applyState(container);
    };
    prepRecipe(params)
      .then((result) => {
        const config = {
          ...buildRunTemplate(this.definition?.prepTemplate ?? []),
          ...this.definition?.settings,
          rowRange: { start: result.rowRange.start, end: Math.min(result.rowRange.start + 9, result.rowRange.end) },
        } as RunConfig;
        return runBatchAI(config);
      })
      .then(finish)
      .catch((err: Error) => {
        globalThis.alert("Error: " + err.message);
        finish();
      });
  }

  private handleCook(container: HTMLElement): void {
    const params = this.buildPrepParams();
    if (!params) return;
    this.v2State = "cooking";
    this.applyState(container);
    const finish = (): void => {
      this.v2State = "idle";
      this.applyState(container);
    };
    prepRecipe(params)
      .then((result) => {
        const config = {
          ...buildRunTemplate(this.definition?.prepTemplate ?? []),
          ...this.definition?.settings,
          rowRange: result.rowRange,
        } as RunConfig;
        return runBatchAI(config);
      })
      .then(finish)
      .catch((err: Error) => {
        globalThis.alert("Error: " + err.message);
        finish();
      });
  }

  private template(definition: RecipeDefinition | undefined | null): string {
    const inputs = definition?.inputs ?? [];
    const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";
    const introHtml = definition?.intro ? `<p class="recipe-intro">${definition.intro}</p>` : "";
    const inputsHtml = inputs
      .map((input) => {
        const mark = input.required ? `<span class="required"> *</span>` : `<span class="optional"> (optional)</span>`;
        const helper = input.helperText ? `<p class="field-helper">${input.helperText}</p>` : "";
        return `<div class="field-group">
          <span class="field-label">${input.label}${mark}</span>
          ${helper}
          <input data-input-id="${input.id}" type="text" class="text-input" placeholder="${input.placeholder ?? ""}" />
        </div>`;
      })
      .join("");
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">${title}</span>
      </div>
      ${introHtml}
      ${inputsHtml}
      <div class="panel-buttons">
        <button id="test-btn" class="btn-outline">Test ▸ first 10 rows</button>
        <button id="cook-btn" class="btn-run">Cook ▸ All rows</button>
      </div>
      <p class="field-helper">
        <strong>Test</strong> — sets up columns and runs the AI on the first 10 rows so you can check quality before committing.
        <strong>Cook</strong> — sets up columns and runs the AI on every file in the folder. Keep the sidebar open.
      </p>`;
  }
}
```

- [ ] **Step 4: Run V2 tests**

```bash
npx jest __tests__/panels/recipe-v2.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/panels/recipe-v2.ts __tests__/panels/recipe-v2.test.ts
git commit -m "feat: add RecipeV2Panel (2-button auto-prep variant)"
```

---

### Task 6: Implement `RecipeV3Panel`

**Files:**
- Create: `src/client/panels/recipe-v3.ts`
- Create: `__tests__/panels/recipe-v3.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/panels/recipe-v3.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
  runBatchAI: jest.fn(),
}));

jest.mock("../../src/client/panels/recipe", () => ({
  buildRunTemplate: jest.fn().mockReturnValue({
    promptCols: [{ col: "Drive Link", kind: "file" }],
    systemPromptCol: "System Prompt",
    outputCol: "AI_Summarization",
  }),
}));

import { RecipeV3Panel } from "../../src/client/panels/recipe-v3";
import * as services from "../../src/client/services";
import type { RecipeDefinition, NavigationContext } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;
const mockRunBatchAI = services.runBatchAI as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return { navigate: jest.fn(), back: jest.fn(), canGoBack: jest.fn().mockReturnValue(true) };
}

const baseDefinition: RecipeDefinition = {
  id: "document-summarization-v3",
  name: "Document Summarization V3",
  icon: "📄",
  variant: "v3",
  description: "Test recipe",
  inputs: [
    { id: "folder", label: "Drive Folder", required: true, placeholder: "Paste URL" },
    { id: "docType", label: "Document Type" },
    { id: "focus", label: "Area of Interest" },
  ],
  prepTemplate: [
    { colTitle: "System Prompt", fillStrategy: { kind: "template", template: "{{#docType}}Type: {{docType}}{{/docType}}" }, role: "system-prompt" },
    { colTitle: "Drive Link", fillStrategy: { kind: "list-drive-folder", inputId: "folder" }, role: "file-prompt" },
    { colTitle: "AI_Summarization", fillStrategy: { kind: "create-empty" }, role: "output" },
  ],
};

const step1Result = { rowRange: { start: 2, end: 11 } };

function mount(definition = baseDefinition) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipeV3Panel();
  panel.mount(container, nav, definition);
  return { container, nav, panel };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

beforeEach(() => {
  mockPrepRecipe.mockClear();
  mockRunBatchAI.mockClear();
});

describe("initial state", () => {
  it("step 2 inputs and button are disabled initially", () => {
    const { container } = mount();
    expect(container.querySelector<HTMLButtonElement>("#step2-btn")!.disabled).toBe(true);
    container.querySelectorAll<HTMLInputElement>("[data-step='2'] input").forEach((el) => {
      expect(el.disabled).toBe(true);
    });
  });

  it("step 3 buttons are disabled initially", () => {
    const { container } = mount();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(true);
  });

  it("step 1 folder input and button are enabled initially", () => {
    const { container } = mount();
    expect(container.querySelector<HTMLButtonElement>("#step1-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.disabled).toBe(false);
  });
});

describe("Step 1 import", () => {
  it("calls prepRecipe with only file-prompt columns (no output col)", async () => {
    mockPrepRecipe.mockResolvedValue(step1Result);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith({
      cols: [expect.objectContaining({ colTitle: "Drive Link", role: "file-prompt" })],
      inputValues: { folder: "https://drive.google.com/abc" },
    });
    const calledCols = mockPrepRecipe.mock.calls[0][0].cols;
    expect(calledCols.every((c: { role?: string }) => c.role !== "output")).toBe(true);
    expect(calledCols.every((c: { role?: string }) => c.role !== "system-prompt")).toBe(true);
  });

  it("unlocks step 2 after step 1 import succeeds", async () => {
    mockPrepRecipe.mockResolvedValue(step1Result);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#step2-btn")!.disabled).toBe(false);
  });

  it("shows success status after step 1 import", async () => {
    mockPrepRecipe.mockResolvedValue(step1Result);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    const status = container.querySelector<HTMLElement>("#step1-status");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toContain("10");
  });

  it("does not unlock step 3 after only step 1 completes", async () => {
    mockPrepRecipe.mockResolvedValue(step1Result);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
  });
});

describe("Step 2 import", () => {
  async function completeStep1(container: HTMLElement): Promise<void> {
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
  }

  it("calls prepRecipe with only system-prompt and text-prompt columns", async () => {
    const { container } = mount();
    await completeStep1(container);
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLButtonElement>("#step2-btn")!.click();
    await flush();
    const calledCols = mockPrepRecipe.mock.calls[1][0].cols;
    expect(calledCols.every((c: { role?: string }) => c.role !== "file-prompt")).toBe(true);
    expect(calledCols.every((c: { role?: string }) => c.role !== "output")).toBe(true);
    expect(calledCols.some((c: { role?: string }) => c.role === "system-prompt")).toBe(true);
  });

  it("unlocks step 3 after step 2 import succeeds", async () => {
    const { container } = mount();
    await completeStep1(container);
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLButtonElement>("#step2-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(false);
  });

  it("passes step 2 input values to prepRecipe", async () => {
    const { container } = mount();
    await completeStep1(container);
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLInputElement>('[data-input-id="docType"]')!.value = "court filing";
    container.querySelector<HTMLButtonElement>("#step2-btn")!.click();
    await flush();
    expect(mockPrepRecipe.mock.calls[1][0].inputValues).toMatchObject({ docType: "court filing" });
  });
});

describe("reset behavior", () => {
  async function completeSteps1And2(container: HTMLElement): Promise<void> {
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLButtonElement>("#step2-btn")!.click();
    await flush();
  }

  it("editing step 1 input re-locks step 3 but not step 2", async () => {
    const { container } = mount();
    await completeSteps1And2(container);
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.dispatchEvent(new Event("input"));
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#step2-btn")!.disabled).toBe(false);
  });

  it("editing step 2 input re-locks step 3 only", async () => {
    const { container } = mount();
    await completeSteps1And2(container);
    container.querySelector<HTMLInputElement>('[data-input-id="docType"]')!.dispatchEvent(new Event("input"));
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#step2-btn")!.disabled).toBe(false);
  });

  it("re-running step 1 when step 2 is complete re-unlocks step 3", async () => {
    const { container } = mount();
    await completeSteps1And2(container);
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.dispatchEvent(new Event("input"));
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
  });
});

describe("Step 3 buttons", () => {
  async function fullyPrepped(container: HTMLElement, nav: jest.Mocked<NavigationContext>): Promise<void> {
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLButtonElement>("#step2-btn")!.click();
    await flush();
    void nav; // nav captured by caller
  }

  it("Test calls runBatchAI with only the first data row", async () => {
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container, nav } = mount();
    await fullyPrepped(container, nav);
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 2 } }),
    );
  });

  it("Cook calls runBatchAI with the full rowRange", async () => {
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container, nav } = mount();
    await fullyPrepped(container, nav);
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 11 } }),
    );
  });

  it("Configure AI navigates to configure-ai-run", async () => {
    const { container, nav } = mount();
    await fullyPrepped(container, nav);
    container.querySelector<HTMLButtonElement>("#configure-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith(
      "configure-ai-run",
      expect.objectContaining({ outputCol: "AI_Summarization" }),
    );
  });

  it("Test disables all step 3 buttons while running", async () => {
    mockRunBatchAI.mockReturnValue(new Promise(() => {}));
    const { container, nav } = mount();
    await fullyPrepped(container, nav);
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify tests fail**

```bash
npx jest __tests__/panels/recipe-v3.test.ts
```

Expected: FAIL — `RecipeV3Panel` not found.

- [ ] **Step 3: Create `src/client/panels/recipe-v3.ts`**

```ts
import type { NavigationContext, Panel, RecipeDefinition } from "../types";
import type { PrepRecipeParams, RunConfig } from "../../shared/types";
import { prepRecipe, runBatchAI } from "../services";
import { buildRunTemplate } from "./recipe";

type V3RunState = "idle" | "testing" | "cooking";

export class RecipeV3Panel implements Panel<RecipeDefinition, never> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private container: HTMLElement | null = null;
  private step1Complete = false;
  private step2Complete = false;
  private step3Unlocked = false;
  private rowRange: { start: number; end: number } | null = null;
  private preppedRunConfig: Partial<RunConfig> | null = null;
  private runState: V3RunState = "idle";

  mount(container: HTMLElement, nav: NavigationContext, definition?: RecipeDefinition): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.container = container;
    this.step1Complete = false;
    this.step2Complete = false;
    this.step3Unlocked = false;
    this.rowRange = null;
    this.preppedRunConfig = null;
    this.runState = "idle";

    container.innerHTML = this.template(definition);
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    this.wireInputResets(container, definition);
    this.wireStepButtons(container);
    this.applyLockState(container);
  }

  unmount(): never {
    return undefined as never;
  }

  private getStep1InputIds(): Set<string> {
    const ids = new Set<string>();
    for (const col of this.definition?.prepTemplate ?? []) {
      if (col.fillStrategy.kind === "list-drive-folder") {
        ids.add(col.fillStrategy.inputId);
      }
    }
    return ids;
  }

  private wireInputResets(container: HTMLElement, definition: RecipeDefinition | undefined): void {
    const step1InputIds = this.getStep1InputIds();
    for (const input of definition?.inputs ?? []) {
      const el = container.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      if (step1InputIds.has(input.id)) {
        el?.addEventListener("input", () => {
          this.step3Unlocked = false;
          this.preppedRunConfig = null;
          this.applyLockState(container);
        });
      } else {
        el?.addEventListener("input", () => {
          this.step3Unlocked = false;
          this.preppedRunConfig = null;
          this.applyLockState(container);
        });
      }
    }
  }

  private wireStepButtons(container: HTMLElement): void {
    container.querySelector("#step1-btn")?.addEventListener("click", () => this.handleStep1(container));
    container.querySelector("#step2-btn")?.addEventListener("click", () => this.handleStep2(container));
    container.querySelector("#test-btn")?.addEventListener("click", () => this.handleTest(container));
    container.querySelector("#cook-btn")?.addEventListener("click", () => this.handleCook(container));
    container.querySelector("#configure-btn")?.addEventListener("click", () => this.handleConfigureAI());
  }

  private applyLockState(container: HTMLElement): void {
    const step2Section = container.querySelector<HTMLElement>("[data-step='2']");
    const step3Section = container.querySelector<HTMLElement>("[data-step='3']");

    if (step2Section) {
      const locked = !this.step1Complete;
      step2Section.querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input").forEach((el) => {
        el.disabled = locked;
      });
      const lock = step2Section.querySelector<HTMLElement>(".v3-lock");
      if (lock) lock.hidden = !locked;
    }

    if (step3Section) {
      const locked = !this.step3Unlocked;
      const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;
      const cookBtn = container.querySelector<HTMLButtonElement>("#cook-btn")!;
      const configBtn = container.querySelector<HTMLButtonElement>("#configure-btn")!;
      if (this.runState === "idle") {
        testBtn.disabled = locked;
        cookBtn.disabled = locked;
        configBtn.disabled = locked;
        testBtn.textContent = "Test ▸ row 2";
        cookBtn.textContent = "Cook ▸ All";
      } else if (this.runState === "testing") {
        testBtn.disabled = true;
        testBtn.innerHTML = `<span class="btn-spinner"></span>Testing…`;
        cookBtn.disabled = true;
        configBtn.disabled = true;
      } else if (this.runState === "cooking") {
        testBtn.disabled = true;
        cookBtn.disabled = true;
        cookBtn.innerHTML = `<span class="btn-spinner"></span>Cooking…`;
        configBtn.disabled = true;
      }
      const lock = step3Section.querySelector<HTMLElement>(".v3-lock");
      if (lock) lock.hidden = !locked;
    }
  }

  private buildStep1Params(): PrepRecipeParams | null {
    const step1InputIds = this.getStep1InputIds();
    const inputValues: Record<string, string> = {};
    for (const input of (this.definition?.inputs ?? []).filter((i) => step1InputIds.has(i.id))) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      const value = el?.value.trim() ?? "";
      if (input.required && !value) {
        globalThis.alert(`Please fill in "${input.label}".`);
        return null;
      }
      inputValues[input.id] = value;
    }
    return {
      cols: (this.definition?.prepTemplate ?? []).filter((col) => col.role === "file-prompt"),
      inputValues,
    };
  }

  private buildStep2Params(): PrepRecipeParams | null {
    const step1InputIds = this.getStep1InputIds();
    const inputValues: Record<string, string> = {};
    for (const input of (this.definition?.inputs ?? []).filter((i) => !step1InputIds.has(i.id))) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      const value = el?.value.trim() ?? "";
      if (input.required && !value) {
        globalThis.alert(`Please fill in "${input.label}".`);
        return null;
      }
      inputValues[input.id] = value;
    }
    return {
      cols: (this.definition?.prepTemplate ?? []).filter(
        (col) => col.role === "system-prompt" || col.role === "text-prompt",
      ),
      inputValues,
    };
  }

  private handleStep1(container: HTMLElement): void {
    const params = this.buildStep1Params();
    if (!params) return;
    const btn = container.querySelector<HTMLButtonElement>("#step1-btn")!;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span>Importing…`;
    prepRecipe(params).then(
      (result) => {
        this.rowRange = result.rowRange;
        this.step1Complete = true;
        if (this.step2Complete) {
          this.step3Unlocked = true;
          this.preppedRunConfig = {
            ...buildRunTemplate(this.definition?.prepTemplate ?? []),
            ...this.definition?.settings,
            rowRange: result.rowRange,
          };
        }
        btn.disabled = false;
        btn.textContent = "Re-import Files";
        const status = container.querySelector<HTMLElement>("#step1-status");
        if (status) {
          const count = result.rowRange.end - result.rowRange.start + 1;
          status.textContent = `✓ ${count} file${count !== 1 ? "s" : ""} imported to Drive Link column`;
          status.hidden = false;
        }
        this.applyLockState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        btn.disabled = false;
        btn.textContent = "Import Files";
      },
    );
  }

  private handleStep2(container: HTMLElement): void {
    const params = this.buildStep2Params();
    if (!params) return;
    const btn = container.querySelector<HTMLButtonElement>("#step2-btn")!;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span>Importing…`;
    prepRecipe(params).then(
      () => {
        this.step2Complete = true;
        this.step3Unlocked = true;
        this.preppedRunConfig = {
          ...buildRunTemplate(this.definition?.prepTemplate ?? []),
          ...this.definition?.settings,
          rowRange: this.rowRange!,
        };
        btn.disabled = false;
        btn.textContent = "Re-import Prompt";
        const status = container.querySelector<HTMLElement>("#step2-status");
        if (status) {
          status.textContent = "✓ Prompt written to System Prompt column";
          status.hidden = false;
        }
        this.applyLockState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        btn.disabled = false;
        btn.textContent = "Import Prompt";
      },
    );
  }

  private handleTest(container: HTMLElement): void {
    if (!this.rowRange || !this.preppedRunConfig) return;
    const config = {
      ...this.preppedRunConfig,
      rowRange: { start: this.rowRange.start, end: this.rowRange.start },
    } as RunConfig;
    this.runState = "testing";
    this.applyLockState(container);
    runBatchAI(config).then(
      () => {
        this.runState = "idle";
        this.applyLockState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.runState = "idle";
        this.applyLockState(container);
      },
    );
  }

  private handleCook(container: HTMLElement): void {
    if (!this.rowRange || !this.preppedRunConfig) return;
    const config = { ...this.preppedRunConfig, rowRange: this.rowRange } as RunConfig;
    this.runState = "cooking";
    this.applyLockState(container);
    runBatchAI(config).then(
      () => {
        this.runState = "idle";
        this.applyLockState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.runState = "idle";
        this.applyLockState(container);
      },
    );
  }

  private handleConfigureAI(): void {
    if (this.preppedRunConfig) {
      this.nav?.navigate("configure-ai-run", this.preppedRunConfig);
    }
  }

  private template(definition: RecipeDefinition | undefined | null): string {
    const inputs = definition?.inputs ?? [];
    const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";
    const introHtml = definition?.intro ? `<p class="recipe-intro">${definition.intro}</p>` : "";
    const step1InputIds = new Set(
      (definition?.prepTemplate ?? [])
        .filter((col) => col.fillStrategy.kind === "list-drive-folder")
        .map((col) => (col.fillStrategy as { kind: "list-drive-folder"; inputId: string }).inputId),
    );
    const renderInput = (input: RecipeDefinition["inputs"][number]): string => {
      const mark = input.required ? `<span class="required"> *</span>` : `<span class="optional"> (optional)</span>`;
      const helper = input.helperText ? `<p class="field-helper">${input.helperText}</p>` : "";
      return `<div class="field-group">
        <span class="field-label">${input.label}${mark}</span>
        ${helper}
        <input data-input-id="${input.id}" type="text" class="text-input" placeholder="${input.placeholder ?? ""}" />
      </div>`;
    };
    const step1Inputs = inputs.filter((i) => step1InputIds.has(i.id)).map(renderInput).join("");
    const step2Inputs = inputs.filter((i) => !step1InputIds.has(i.id)).map(renderInput).join("");

    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">${title}</span>
      </div>
      ${introHtml}
      <div data-step="1" class="v3-step">
        <p class="v3-step-label"><strong>Step 1: Import your documents</strong></p>
        <p class="field-helper">Import files from a Drive folder into your spreadsheet. Each file gets its own row.</p>
        ${step1Inputs}
        <button id="step1-btn" class="btn-outline">Import Files</button>
        <p id="step1-status" class="field-helper" hidden></p>
      </div>
      <div data-step="2" class="v3-step">
        <p class="v3-step-label"><strong>Step 2: Set up your prompt</strong> <span class="v3-lock">🔒</span></p>
        <p class="field-helper">Configure how the AI should read and summarize your documents. Customize the prompt to match your document type and area of focus.</p>
        ${step2Inputs}
        <button id="step2-btn" class="btn-outline">Import Prompt</button>
        <p id="step2-status" class="field-helper" hidden></p>
      </div>
      <div data-step="3" class="v3-step">
        <p class="v3-step-label"><strong>Step 3: Run</strong> <span class="v3-lock">🔒</span></p>
        <div class="panel-buttons">
          <button id="test-btn" class="btn-outline">Test ▸ row 2</button>
          <button id="cook-btn" class="btn-run">Cook ▸ All</button>
          <button id="configure-btn" class="btn-outline">Configure AI</button>
        </div>
        <p class="field-helper">
          <strong>Test</strong> — runs the AI on the first row only so you can check quality before committing.
          <strong>Cook</strong> — runs the AI on every file. Keep the sidebar open until it finishes.
          <strong>Configure AI</strong> — opens the full settings panel to review or adjust before running.
        </p>
      </div>`;
  }
}
```

- [ ] **Step 4: Run V3 tests**

```bash
npx jest __tests__/panels/recipe-v3.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/panels/recipe-v3.ts __tests__/panels/recipe-v3.test.ts
git commit -m "feat: add RecipeV3Panel (didactic step-by-step variant)"
```

---

### Task 7: Register panels and build

**Files:**
- Modify: `src/client/sidebar-entry.ts`

- [ ] **Step 1: Register the three new panels**

Update `src/client/sidebar-entry.ts`:

```ts
import { Router } from "./router";
import { ToolListPanel } from "./panels/tool-list";
import { ConfigureAIRunPanel } from "./panels/configure-ai-run";
import { RecipesListPanel } from "./panels/recipes-list";
import { RecipePanel } from "./panels/recipe";
import { RecipeV1Panel } from "./panels/recipe-v1";
import { RecipeV2Panel } from "./panels/recipe-v2";
import { RecipeV3Panel } from "./panels/recipe-v3";
import { ImportDriveLinksPanel } from "./panels/import-drive-links";
import { ExtractTextPanel } from "./panels/extract-text";
import { JobIndicator } from "./components/job-indicator";
import { jobStore } from "./job-store";
import type { Panel, PanelId } from "./types";

function init(): void {
  const app = document.getElementById("app");
  if (!app) return;

  const jobStrip = document.getElementById("job-strip");
  if (jobStrip) {
    new JobIndicator(jobStrip, jobStore);
  }

  const panels = new Map<PanelId, Panel>([
    ["tool-list", new ToolListPanel()],
    ["configure-ai-run", new ConfigureAIRunPanel()],
    ["recipes-list", new RecipesListPanel()],
    ["recipe", new RecipePanel()],
    ["recipe-v1", new RecipeV1Panel()],
    ["recipe-v2", new RecipeV2Panel()],
    ["recipe-v3", new RecipeV3Panel()],
    ["import-drive-links", new ImportDriveLinksPanel()],
    ["extract-text", new ExtractTextPanel()],
  ]);

  const router = new Router(app, panels);
  router.start("tool-list");
}

init();
```

- [ ] **Step 2: Typecheck and run full test suite**

```bash
npm run typecheck && npm test
```

Expected: no type errors, all tests pass.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: build completes with no errors. Verify `dist/index.js` and `dist/Sidebar.html` are updated.

- [ ] **Step 4: Commit**

```bash
git add src/client/sidebar-entry.ts
git commit -m "feat: register RecipeV1Panel, RecipeV2Panel, RecipeV3Panel in sidebar"
```

- [ ] **Step 5: Deploy and smoke-test**

```bash
npm run deploy
```

Open the add-on in Google Sheets. Navigate to SSI Tools → Run AI → Browse Recipes. Verify:
- The recipes list shows the original Document Summarization plus V1, V2, V3 variants
- Clicking V1 opens the 4-button panel with Prep enabled and Test/Cook/Configure disabled
- Clicking V2 opens the 2-button panel with both buttons enabled
- Clicking V3 opens the step-by-step panel with step 2 and 3 grayed out

Run a quick end-to-end on V1:
1. Paste a Drive folder URL
2. Click Prep — verify columns appear in the sheet
3. Click Test — verify the AI output appears in row 2
4. Click Cook — verify all rows get AI output
