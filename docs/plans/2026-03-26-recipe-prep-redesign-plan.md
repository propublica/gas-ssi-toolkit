# Recipe Prep Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the named-field `PrepRecipeParams`/`RecipeParams` shape with an agnostic `ColumnDef[]` system that separates population strategy (server), semantic role (client), and UI configuration (client).

**Architecture:** Three-phase refactor — (1) shared types + server, (2) client types + recipe migration, (3) RecipePanel rewrite. Each phase is independently committable. See `docs/plans/2026-03-26-recipe-prep-redesign.md` for full design rationale.

**Tech Stack:** TypeScript, Jest/ts-jest, jsdom (client tests), Google Apps Script globals mocked via `globalThis`

---

## Phase 1: Shared Types + Server

### Task 1: Replace PrepRecipeParams and PrepRecipeResult in shared/types.ts

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Replace the recipe RPC types**

In `src/shared/types.ts`, replace the entire `// ── Recipes ─────────────────────────────────────────────────────` section:

```typescript
// ── Recipes ─────────────────────────────────────────────────────

export type ColStrategy =
  | { kind: "list-drive-folder"; url: string }
  | { kind: "fill-value"; value: string }
  | { kind: "create-empty" };

export interface PrepColSpec {
  colTitle: string;
  strategy: ColStrategy;
}

export interface PrepRecipeParams {
  cols: PrepColSpec[];
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
}
```

Remove: the old `PrepRecipeParams` (with `driveFolder?`, `systemPrompt?`, `userPrompts?`, `outputCol?`, `tools?`) and the old `PrepRecipeResult` (with `rowRange`, `colNames`, `tools?`).

**Step 2: Run typecheck to see what breaks**

```bash
npm run typecheck
```

Expected: type errors in `src/server/index.ts`, `src/client/panels/recipe.ts`, `__tests__/panels/recipe.test.ts`. These are addressed in subsequent tasks.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "refactor: replace named-field PrepRecipeParams/Result with agnostic ColStrategy shapes"
```

---

### Task 2: Rewrite server prepRecipe()

**Files:**
- Modify: `src/server/index.ts`

**Step 1: Replace the prepRecipe function body**

Find `export function prepRecipe(params: PrepRecipeParams): PrepRecipeResult {` in `src/server/index.ts` and replace the entire function:

```typescript
export function prepRecipe(params: PrepRecipeParams): PrepRecipeResult {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  let numRows = 1;

  // Pass 1: scan Drive folders, cache results, determine numRows
  const folderCache = new Map<string, string[]>();
  for (const col of params.cols) {
    if (col.strategy.kind === "list-drive-folder") {
      const url = col.strategy.url;
      if (!folderCache.has(url)) {
        const folder = DriveApp.getFolderById(extractId(url));
        const files: { url: string }[] = [];
        getAllFilesRecursive(folder, files);
        folderCache.set(url, files.map((f) => f.url));
      }
      numRows = Math.max(numRows, folderCache.get(url)!.length || 1);
    }
  }

  // Pass 2: write all columns
  for (const col of params.cols) {
    const colIdx = findOrCreateColumn(sheet, col.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
    switch (col.strategy.kind) {
      case "list-drive-folder": {
        const urls = folderCache.get(col.strategy.url) ?? [];
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
      case "create-empty":
        break;
    }
  }

  SpreadsheetApp.flush();
  return { rowRange: { start: 2, end: 2 + numRows - 1 } };
}
```

**Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: `src/server/index.ts` passes. Remaining errors are in client files (addressed next).

**Step 3: Run tests**

```bash
npm test
```

Expected: `__tests__/panels/recipe.test.ts` fails (shape mismatch). All other suites pass.

**Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "refactor: rewrite prepRecipe() to iterate PrepColSpec[] with two-pass folder scan"
```

---

## Phase 2: Client Types + Recipe Migration

### Task 3: Add new client types to client/types.ts

**Files:**
- Modify: `src/client/types.ts`

**Step 1: Add new types and replace RecipeParams**

Add to imports at the top of `src/client/types.ts`:
```typescript
import type { ToolId } from "../shared/types";
```

Replace the existing `RecipeParams` interface and add the new types. The full additions/replacements:

```typescript
export type ColStrategyKind = "list-drive-folder" | "fill-value" | "create-empty";
export type ColRole = "userPrompt" | "systemPrompt" | "driveLink" | "output";

export interface AppendField {
  id: string;
  label: string;
  placeholder?: string;
  /** Text injected before the reporter's value, e.g. "\n\nYou are looking for:\n\n" */
  prefix?: string;
}

export interface RecipeSettings {
  tools?: ToolId[];
  applyMarkdown?: boolean;
  includeGrounding?: boolean;
}

export interface ColumnDef {
  /** UI section heading shown in the recipe panel */
  label: string;
  /** How this column maps into RunConfig after prep */
  role: ColRole;
  /** What PrepColSpec.strategy type to generate during prep */
  strategyKind: ColStrategyKind;
  /** Lockable column header field */
  colTitle: RecipeFieldConfig;
  /** Lockable prompt text — present for fill-value columns */
  prompt?: RecipeFieldConfig;
  /** Lockable URL input — present for drive columns */
  url?: RecipeFieldConfig;
  /** Extra reporter inputs composed into the prompt before prep */
  appendFields?: AppendField[];
  helperText?: string;
  /** Show * in section heading */
  required?: boolean;
}

export interface RecipeParams {
  columns: ColumnDef[];
  settings?: RecipeSettings;
}
```

Remove the old `RecipeParams` interface (with `driveFolder?`, `systemPrompt?`, `userPrompts?`, `outputCol?`).

`RecipeDefinition` is unchanged — `params?: RecipeParams` already references the updated type.

**Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: errors in `src/client/recipes.ts` and `src/client/panels/recipe.ts` (they use old RecipeParams shape). Addressed in subsequent tasks.

**Step 3: Commit**

```bash
git add src/client/types.ts
git commit -m "refactor: replace named-field RecipeParams with ColumnDef[] + RecipeSettings"
```

---

### Task 4: Migrate document-summarization recipe

**Files:**
- Modify: `src/client/recipes.ts`

**Step 1: Rewrite the document-summarization recipe entry**

Replace the entire `document-summarization` entry in `RECIPES` with:

```typescript
{
  id: "document-summarization",
  name: "Document Summarization",
  icon: "📄",
  description: "Summarize each file in a Google Drive folder",
  panelId: "recipe",
  params: {
    columns: [
      {
        label: "Drive Folder",
        role: "driveLink",
        strategyKind: "list-drive-folder",
        colTitle: { value: "Drive Link", locked: true },
        url: { value: "", locked: false, placeholder: "Paste Google Drive folder URL" },
        helperText: "Make sure you have access to this folder",
        required: true,
      },
      {
        label: "System Prompt",
        role: "systemPrompt",
        strategyKind: "fill-value",
        colTitle: { value: "System Prompt", locked: true },
        prompt: {
          value:
            "You are an expert document analyst. Produce clear, structured summaries " +
            "focusing on key themes, main arguments, important data points, and actionable conclusions.",
          locked: true,
        },
      },
      {
        label: "User Prompt",
        role: "userPrompt",
        strategyKind: "fill-value",
        colTitle: { value: "User Prompt", locked: true },
        prompt: {
          value:
            "Please summarize the attached document. Include the main topics, key findings, " +
            "and important conclusions. The document file will be attached as inline data.",
          locked: true,
        },
      },
      {
        label: "Output Column",
        role: "output",
        strategyKind: "create-empty",
        colTitle: { value: "AI_Summarization", locked: true },
      },
    ],
  } satisfies RecipeParams,
},
```

Update the import at the top if needed — `RecipeParams` is still exported from `"./types"`.

**Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: `src/client/recipes.ts` passes. Remaining errors in `src/client/panels/recipe.ts`.

**Step 3: Commit**

```bash
git add src/client/recipes.ts
git commit -m "refactor: migrate document-summarization recipe to ColumnDef[] shape"
```

---

## Phase 3: RecipePanel Rewrite

This is the largest task. The panel's template, field mounting, prep params, run config assembly, and saved state all change together. Write the tests first, then implement.

### Task 5: Rewrite RecipePanel tests

**Files:**
- Modify: `__tests__/panels/recipe.test.ts`

**Step 1: Replace the test file**

The new tests use `ColumnDef[]` shape and new DOM IDs (`#col-{i}-title-container`, `#col-{i}-prompt-container`, `#col-{i}-url-input`). Replace the full file:

```typescript
/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import { RecipePanel } from "../../src/client/panels/recipe";
import * as services from "../../src/client/services";
import type { PrepRecipeResult } from "../../src/shared/types";
import type { ColumnDef, RecipeDefinition, RecipeParams, NavigationContext } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return {
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  };
}

function mount(params: RecipeParams, savedState?: unknown) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipePanel();
  const definition: RecipeDefinition = {
    id: "test",
    name: "Test Recipe",
    icon: "🧪",
    description: "Test",
    panelId: "recipe",
    params,
  };
  panel.mount(container, nav, definition, savedState as never);
  return { container, nav, panel, definition };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

// helper: a minimal column set covering all roles
const fullColumns: ColumnDef[] = [
  {
    label: "Drive Folder",
    role: "driveLink",
    strategyKind: "list-drive-folder",
    colTitle: { value: "Drive Link", locked: true },
    url: { value: "", locked: false, placeholder: "Paste folder URL" },
    required: true,
  },
  {
    label: "System Prompt",
    role: "systemPrompt",
    strategyKind: "fill-value",
    colTitle: { value: "System Prompt", locked: true },
    prompt: { value: "You are helpful.", locked: true },
  },
  {
    label: "User Prompt",
    role: "userPrompt",
    strategyKind: "fill-value",
    colTitle: { value: "User Prompt", locked: true },
    prompt: { value: "Summarize.", locked: true },
  },
  {
    label: "Output Column",
    role: "output",
    strategyKind: "create-empty",
    colTitle: { value: "AI_Out", locked: true },
  },
];

const mockResult: PrepRecipeResult = {
  rowRange: { start: 2, end: 11 },
};

// ── rendering ───────────────────────────────────────────────────

describe("rendering", () => {
  it("renders a url input for list-drive-folder columns", () => {
    const { container } = mount({ columns: [fullColumns[0]] });
    expect(container.querySelector("#col-0-url-input")).not.toBeNull();
  });

  it("does not render url input for fill-value columns", () => {
    const { container } = mount({ columns: [fullColumns[2]] });
    expect(container.querySelector("#col-0-url-input")).toBeNull();
  });

  it("renders a prompt container for fill-value columns", () => {
    const { container } = mount({ columns: [fullColumns[1]] });
    expect(container.querySelector("#col-0-prompt-container")).not.toBeNull();
  });

  it("does not render prompt container for create-empty columns", () => {
    const { container } = mount({ columns: [fullColumns[3]] });
    expect(container.querySelector("#col-0-prompt-container")).toBeNull();
  });

  it("renders one section per ColumnDef", () => {
    const { container } = mount({ columns: fullColumns });
    expect(container.querySelectorAll(".recipe-section-card")).toHaveLength(fullColumns.length);
  });

  it("renders append field inputs when appendFields present", () => {
    const colWithAppend: ColumnDef = {
      ...fullColumns[2],
      appendFields: [{ id: "search", label: "What are you looking for?" }],
    };
    const { container } = mount({ columns: [colWithAppend] });
    expect(container.querySelector("#col-0-append-search")).not.toBeNull();
  });
});

// ── LockableField defaults ────────────────────────────────────────

describe("LockableField defaults", () => {
  it("initialises locked colTitle field as disabled", () => {
    const { container } = mount({ columns: [fullColumns[3]] });
    const input = container.querySelector<HTMLInputElement>("#col-0-title-container input")!;
    expect(input.value).toBe("AI_Out");
    expect(input.disabled).toBe(true);
  });

  it("initialises unlocked url field as enabled", () => {
    const { container } = mount({ columns: [fullColumns[0]] });
    const input = container.querySelector<HTMLInputElement>("#col-0-url-input")!;
    expect(input.disabled).toBe(false);
  });
});

// ── prep flow ──────────────────────────────────────────────────

describe("Prep flow", () => {
  beforeEach(() => mockPrepRecipe.mockClear());

  it("calls services.prepRecipe with PrepColSpec[] built from resolved field values", async () => {
    mockPrepRecipe.mockResolvedValue(mockResult);
    const { container } = mount({ columns: fullColumns });
    container.querySelector<HTMLInputElement>("#col-0-url-input")!.value =
      "https://drive.google.com/drive/folders/abc123";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith({
      cols: [
        { colTitle: "Drive Link", strategy: { kind: "list-drive-folder", url: "https://drive.google.com/drive/folders/abc123" } },
        { colTitle: "System Prompt", strategy: { kind: "fill-value", value: "You are helpful." } },
        { colTitle: "User Prompt", strategy: { kind: "fill-value", value: "Summarize." } },
        { colTitle: "AI_Out", strategy: { kind: "create-empty" } },
      ],
    });
  });

  it("composes appendFields into the fill-value prompt string", async () => {
    mockPrepRecipe.mockResolvedValue(mockResult);
    const colWithAppend: ColumnDef = {
      ...fullColumns[2],
      appendFields: [{ id: "search", label: "What?", prefix: "\n\nLooking for:\n\n" }],
    };
    const { container } = mount({ columns: [colWithAppend] });
    container.querySelector<HTMLInputElement>("#col-0-append-search")!.value = "a signature";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith({
      cols: [
        {
          colTitle: "User Prompt",
          strategy: { kind: "fill-value", value: "Summarize.\n\nLooking for:\n\na signature" },
        },
      ],
    });
  });

  it("shows alert and does not call prepRecipe when url input is empty for list-drive-folder", async () => {
    const alertMock = jest.fn();
    globalThis.alert = alertMock;
    const { container } = mount({ columns: [fullColumns[0]] });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(mockPrepRecipe).not.toHaveBeenCalled();
  });
});

// ── Cook flow ──────────────────────────────────────────────────

describe("Cook flow", () => {
  it("navigates to configure-ai-run with RunConfig assembled from ColumnDef roles + rowRange", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const { container, nav } = mount({ columns: fullColumns });
    container.querySelector<HTMLInputElement>("#col-0-url-input")!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith("configure-ai-run", {
      promptCols: [
        { col: "Drive Link", kind: "file" },
        { col: "User Prompt", kind: "text" },
      ],
      systemPromptCol: "System Prompt",
      outputCol: "AI_Out",
      rowRange: { start: 2, end: 5 },
    });
  });

  it("spreads RecipeSettings into RunConfig", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 3 } });
    const outputOnly: ColumnDef = fullColumns[3];
    const { container, nav } = mount({
      columns: [outputOnly],
      settings: { tools: ["google_search"], applyMarkdown: true },
    });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith("configure-ai-run",
      expect.objectContaining({ tools: ["google_search"], applyMarkdown: true }),
    );
  });
});

// ── saved state ────────────────────────────────────────────────

describe("unmount / saved state", () => {
  it("unmount returns colValues array and prepComplete: false when not prepped", () => {
    const { container, panel } = mount({ columns: [fullColumns[0]] });
    container.querySelector<HTMLInputElement>("#col-0-url-input")!.value = "my-folder-url";
    const state = panel.unmount();
    expect(state).toMatchObject({
      colValues: [expect.objectContaining({ url: "my-folder-url" })],
      prepComplete: false,
    });
  });

  it("restores url value from savedState", () => {
    const savedState = {
      colValues: [{ url: "restored-url" }],
      prepComplete: false,
    };
    const { container } = mount({ columns: [fullColumns[0]] }, savedState);
    expect(container.querySelector<HTMLInputElement>("#col-0-url-input")!.value).toBe("restored-url");
  });

  it("mounts with savedState prepComplete: true — Cook is enabled", () => {
    const savedState = {
      colValues: [{}],
      prepComplete: true,
      preppedRunConfig: { outputCol: "Out", promptCols: [] },
    };
    const { container } = mount({ columns: [fullColumns[3]] }, savedState);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});
```

**Step 2: Run the new tests to verify they all fail**

```bash
npx jest __tests__/panels/recipe.test.ts
```

Expected: multiple failures — DOM IDs not found, shape mismatches. This confirms the tests are exercising the right new behavior.

---

### Task 6: Rewrite RecipePanel

**Files:**
- Modify: `src/client/panels/recipe.ts`

**Step 1: Replace the full file**

The panel's private fields, SavedState, template, mountFields, buildPrepParams, buildRunConfig, and unmount all change. Replace the full file content:

```typescript
import type { NavigationContext, Panel, RecipeDefinition, ColumnDef } from "../types";
import type { ColStrategy, PrepColSpec, PrepRecipeParams, PrepRecipeResult, RunConfig, PromptColumnSpec } from "../../shared/types";
import { LockableField } from "../components/lockable-field";
import { RecipePrepCook } from "../components/recipe-prep-cook";
import { prepRecipe } from "../services";

type ColFieldRefs = {
  colTitle?: LockableField;
  prompt?: LockableField;
  urlInput?: HTMLInputElement;
  appendInputs?: Record<string, HTMLInputElement>;
};

type ColSavedValues = {
  colTitle?: string;
  prompt?: string;
  url?: string;
  appendValues?: Record<string, string>;
};

type SavedState = {
  colValues: ColSavedValues[];
  prepComplete: boolean;
  preppedRunConfig?: Partial<RunConfig>;
};

export class RecipePanel implements Panel<RecipeDefinition, SavedState> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private prepCook: RecipePrepCook | null = null;
  private preppedRunConfig: Partial<RunConfig> | null = null;
  private fields: ColFieldRefs[] = [];

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    definition?: RecipeDefinition,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.fields = [];
    this.preppedRunConfig = savedState?.preppedRunConfig ?? null;

    container.innerHTML = this.template(definition);
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());

    this.mountFields(container, definition?.params?.columns ?? [], savedState);
    this.mountPrepCook(container, savedState?.prepComplete ?? false);
  }

  unmount(): SavedState {
    const colValues: ColSavedValues[] = this.fields.map((f) => ({
      colTitle: f.colTitle?.getValue(),
      prompt: f.prompt?.getValue(),
      url: f.urlInput?.value,
      appendValues: f.appendInputs
        ? Object.fromEntries(
            Object.entries(f.appendInputs).map(([id, el]) => [id, el.value]),
          )
        : undefined,
    }));
    return {
      colValues,
      prepComplete: this.prepCook?.isPrepComplete() ?? false,
      preppedRunConfig: this.preppedRunConfig ?? undefined,
    };
  }

  private mountFields(
    container: HTMLElement,
    columns: ColumnDef[],
    savedState?: SavedState,
  ): void {
    const reset = (): void => this.prepCook?.reset();

    columns.forEach((col, i) => {
      const saved = savedState?.colValues?.[i];
      const refs: ColFieldRefs = {};

      refs.colTitle = new LockableField(
        container.querySelector(`#col-${i}-title-container`)!,
        {
          label: "Column",
          defaultValue: saved?.colTitle ?? col.colTitle.value,
          locked: col.colTitle.locked,
          onUnlock: reset,
        },
      );

      if (col.prompt !== undefined) {
        refs.prompt = new LockableField(
          container.querySelector(`#col-${i}-prompt-container`)!,
          {
            label: "Prompt",
            defaultValue: saved?.prompt ?? col.prompt.value,
            locked: col.prompt.locked,
            multiline: true,
            onUnlock: reset,
          },
        );
      }

      if (col.url !== undefined) {
        const urlEl = container.querySelector<HTMLInputElement>(`#col-${i}-url-input`);
        if (urlEl) {
          if (saved?.url) urlEl.value = saved.url;
          urlEl.addEventListener("input", reset);
          refs.urlInput = urlEl;
        }
      }

      if (col.appendFields?.length) {
        refs.appendInputs = {};
        for (const af of col.appendFields) {
          const el = container.querySelector<HTMLInputElement>(`#col-${i}-append-${af.id}`);
          if (el) {
            if (saved?.appendValues?.[af.id]) el.value = saved.appendValues[af.id];
            refs.appendInputs[af.id] = el;
          }
        }
      }

      this.fields[i] = refs;
    });
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
    const columns = this.definition?.params?.columns ?? [];
    const cols: PrepColSpec[] = [];

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const colTitle = this.fields[i]?.colTitle?.getValue() ?? col.colTitle.value;

      let strategy: ColStrategy;
      switch (col.strategyKind) {
        case "list-drive-folder": {
          const url = this.fields[i]?.urlInput?.value.trim() ?? "";
          if (!url) {
            globalThis.alert(`Please enter a URL for "${col.label}".`);
            return null;
          }
          strategy = { kind: "list-drive-folder", url };
          break;
        }
        case "fill-value": {
          const base = this.fields[i]?.prompt?.getValue() ?? col.prompt?.value ?? "";
          const appended = (col.appendFields ?? [])
            .map((af) => {
              const v = this.fields[i]?.appendInputs?.[af.id]?.value.trim() ?? "";
              return v ? (af.prefix ?? "") + v : "";
            })
            .join("");
          strategy = { kind: "fill-value", value: base + appended };
          break;
        }
        case "create-empty":
          strategy = { kind: "create-empty" };
          break;
      }

      cols.push({ colTitle, strategy });
    }

    return { cols };
  }

  private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
    const columns = this.definition?.params?.columns ?? [];
    const settings = this.definition?.params?.settings ?? {};
    const promptCols: PromptColumnSpec[] = [];
    let systemPromptCol: string | undefined;
    let outputCol = "";

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const resolvedTitle = this.fields[i]?.colTitle?.getValue() ?? col.colTitle.value;

      switch (col.role) {
        case "userPrompt":
          promptCols.push({ col: resolvedTitle, kind: "text" });
          break;
        case "driveLink":
          promptCols.push({ col: resolvedTitle, kind: "file" });
          break;
        case "systemPrompt":
          systemPromptCol = resolvedTitle;
          break;
        case "output":
          outputCol = resolvedTitle;
          break;
      }
    }

    return { promptCols, systemPromptCol, outputCol, rowRange: result.rowRange, ...settings };
  }

  private template(definition: RecipeDefinition | undefined | null): string {
    const columns = definition?.params?.columns ?? [];
    const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";

    const columnSections = columns
      .map((col, i) => {
        const requiredMark = col.required ? ` <span class="required">*</span>` : "";
        const helperHtml = col.helperText ? `<p class="field-helper">${col.helperText}</p>` : "";

        const urlInputHtml =
          col.url !== undefined
            ? `<input id="col-${i}-url-input" type="text" class="text-input"
                placeholder="${col.url.placeholder ?? "Paste Google Drive URL"}" />`
            : "";

        const promptContainerHtml =
          col.prompt !== undefined ? `<div id="col-${i}-prompt-container"></div>` : "";

        const appendFieldsHtml = (col.appendFields ?? [])
          .map(
            (af) =>
              `<div class="append-field">
                <label class="field-label">${af.label}</label>
                <input id="col-${i}-append-${af.id}" type="text" class="text-input"
                  placeholder="${af.placeholder ?? ""}" />
              </div>`,
          )
          .join("");

        return `
          <div class="recipe-section-card">
            <div class="recipe-section-card-title">${col.label}${requiredMark}</div>
            ${helperHtml}
            <div id="col-${i}-title-container"></div>
            ${urlInputHtml}
            ${promptContainerHtml}
            ${appendFieldsHtml}
          </div>`;
      })
      .join("");

    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">${title}</span>
      </div>
      ${columnSections}
      <div id="prep-cook-container"></div>
    `;
  }
}
```

**Step 2: Run the recipe panel tests**

```bash
npx jest __tests__/panels/recipe.test.ts
```

Expected: all tests pass.

**Step 3: Run the full test suite**

```bash
npm test
```

Expected: all 332+ tests pass. Fix any unexpected failures before proceeding.

**Step 4: Run typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/client/panels/recipe.ts __tests__/panels/recipe.test.ts
git commit -m "refactor: rewrite RecipePanel for ColumnDef[] — agnostic column specs, role-based RunConfig assembly"
```

---

## Final Verification

**Step 1: Full test suite with coverage**

```bash
npm run test:coverage
```

Expected: all tests pass, all per-file thresholds met.

**Step 2: Typecheck both configs**

```bash
npm run typecheck
```

Expected: clean.

**Step 3: Lint**

```bash
npm run lint
```

Expected: clean.

**Step 4: Final commit if anything was cleaned up**

If clean, no commit needed. The branch is ready for PR to `develop`.
