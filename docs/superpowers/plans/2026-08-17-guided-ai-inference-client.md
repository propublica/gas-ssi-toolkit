# Guided AI Inference — Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the client-side "Guided AI Inference" panel — a three-step, blocking, RPC-aware flow (Gather Inputs → Tell the AI what to do → Run) — sharing its run-controls behavior with the existing freeform `ConfigureAIRunPanel`.

**Architecture:** A generic `StepFlow` shell drives an array of `Step` implementations through `locked → active → complete` status, using one callback (`onComplete`) for real state transitions and one (`onError`) for a purely cosmetic checklist decoration. The three concrete steps (`InputsStep`, `PromptStep`, `RunStep`) call existing, already-merged server RPCs (`prepRecipe`, `runBatchAI`, `getDefaultRowRange`) — no server changes in this plan. `RunStep` and `ConfigureAIRunPanel` share a new `RunControls` component (extracted from `ConfigureAIRunPanel`) for Model/Tools/Row-range/Test/Run behavior.

**Tech Stack:** TypeScript, Jest + jsdom, no new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-08-17-guided-ai-inference-client-architecture-design.md`

## Global Constraints

- No server-side changes — `prepRecipe`, `runBatchAI`, `getDefaultRowRange`, `"auto"` prompt-column kind, and `wrapPromptsInTags` are already merged and used as-is.
- This step framework is scoped to Guided AI Inference only — `RecipePanel`/`RecipePrepCook`/`RECIPES` are untouched.
- `Step`/`StepContext` is a single uniform interface — no `kind` field, no `CommitStep`/`OpenStep` split. Collapse-vs-stay-open behavior is purely positional (last step in the array vs. not).
- `onError()` is purely cosmetic (flips a checklist icon), never changes `locked`/`active`/`complete` status, and is not persisted in `StepFlowSavedState`.
- `PromptStep`'s prompt is required (non-empty) before it will commit.
- Switching between Guided and freeform is one-directional only: Guided → Freeform. No "Switch to Guided" affordance is added to the freeform panel.
- Named exports only, explicit return types, `===`, no `any` (prefer `unknown`), double quotes, trailing commas — per the project's ESLint/Prettier config.
- Every new file needs meaningful Jest coverage; `npm run test:coverage` enforces per-file thresholds.

---

## Task 1: Extract `RunControls` from `ConfigureAIRunPanel`

This is the foundational, highest-risk task: pulling Model/Tools/Row-range/Test/Run/chunking logic out of the 655-line `ConfigureAIRunPanel` into a new, independently-mountable component, without changing `ConfigureAIRunPanel`'s observable behavior. `RunStep` (Task 5) depends on this component.

**Files:**
- Create: `src/client/components/run-controls.ts`
- Create: `__tests__/components/run-controls.test.ts`
- Modify: `src/client/panels/configure-ai-run.ts`
- Delete: `__tests__/configure-ai-run.test.ts` (its one test, `computeChunks`, moves into the new file above)
- Do not modify: `__tests__/panels/configure-ai-run.test.ts` (this is the regression safety net — see Step 5)

**Interfaces:**
- Produces (consumed by Task 5's `RunStep`):
  - `export const CHUNK_SIZE = 40;`
  - `export function computeChunks(rowRange: RowRangeValue, chunkSize: number): RowRangeValue[]`
  - `export type PromptConfig = Pick<RunConfig, "promptCols" | "systemPromptCol" | "outputCol" | "wrapPromptsInTags" | "applyMarkdown">`
  - `export interface RunControlsSavedState { rowRange?: RowRangeValue; tools?: ToolId[]; includeGrounding?: boolean; model?: ModelId; toolsExpanded?: boolean; modelExpanded?: boolean; lastTest?: TestRunDisplay; }`
  - `export interface RunControlsConfig { getPromptConfig: () => PromptConfig; onRunSucceeded?: () => void; savedState?: RunControlsSavedState; }`
  - `export class RunControls { constructor(container: HTMLElement, config: RunControlsConfig); readonly ready: Promise<void>; getValue(): RunControlsSavedState; refreshRowRange(): Promise<void>; checkTestStatsFreshness(): void; destroy(): void; }`
  - `checkTestStatsFreshness()` is public (added during Task 1's implementation/review, not in the original design) so a host can explicitly re-validate the displayed test results against its own live prompt-config state once its own async loading has settled — see the mount-time ordering note below.

Rendered markup uses the exact same element ids `ConfigureAIRunPanel` uses today (`#model-list`, `#model-toggle`, `#model-summary`, `#model-content`, `#tools-list`, `#tools-toggle`, `#tools-summary`, `#tools-content`, `#include-grounding-cb`, `#include-grounding-group`, `#grounding-col-name`, `#row-range-container`, `#test-btn`, `#run-btn`, `#test-results`) — this is what lets the existing `__tests__/panels/configure-ai-run.test.ts` suite keep passing unmodified: it only cares that mounting the panel produces those ids and behaviors, not which class renders them.

- [ ] **Step 1: Write the new `RunControls` test file (failing)**

Create `__tests__/components/run-controls.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  runBatchAI: jest.fn(),
  getActiveRangeInfo: jest.fn().mockResolvedValue(undefined),
  getDefaultRowRange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: {
    dispatch: jest.fn().mockImplementation((_id, _label, fn: Promise<void>) => fn),
    isCancelled: jest.fn().mockReturnValue(false),
    setProgress: jest.fn(),
  },
}));

import {
  RunControls,
  computeChunks,
  CHUNK_SIZE,
  type RunControlsConfig,
} from "../../src/client/components/run-controls";
import * as services from "../../src/client/services";
import type { RunStats } from "../../src/shared/types";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

const TEST_STATS: RunStats = {
  rowCount: 10,
  totalTimeMs: 4200,
  totalInputTokens: 500,
  totalOutputTokens: 300,
  totalTokenCost: 0.002,
  totalGroundingQueries: 0,
  totalGroundingCost: 0,
  testedAt: 1234567890,
  config: {
    promptCols: [{ col: "col_a", kind: "text" }],
    systemPromptCol: undefined,
    tools: [],
    wrapPromptsInTags: true,
    model: "gemini-3.1-flash-lite",
  },
};

function basicPromptConfig() {
  return {
    promptCols: [{ col: "col_a", kind: "auto" as const }],
    systemPromptCol: undefined,
    outputCol: "ai_output",
    wrapPromptsInTags: undefined,
    applyMarkdown: undefined,
  };
}

async function mountAndSettle(configOverrides: Partial<RunControlsConfig> = {}) {
  const container = makeContainer();
  const rc = new RunControls(container, {
    getPromptConfig: basicPromptConfig,
    ...configOverrides,
  });
  await rc.ready;
  return { container, rc };
}

describe("computeChunks", () => {
  it("returns a single chunk when row count equals chunk size", () => {
    expect(computeChunks({ start: 2, end: 51 }, 50)).toEqual([{ start: 2, end: 51 }]);
  });

  it("returns multiple full chunks", () => {
    expect(computeChunks({ start: 2, end: 101 }, 50)).toEqual([
      { start: 2, end: 51 },
      { start: 52, end: 101 },
    ]);
  });

  it("trims the last chunk to the actual end row", () => {
    expect(computeChunks({ start: 2, end: 75 }, 50)).toEqual([
      { start: 2, end: 51 },
      { start: 52, end: 75 },
    ]);
  });

  it("returns a single chunk for exactly one row", () => {
    expect(computeChunks({ start: 5, end: 5 }, 50)).toEqual([{ start: 5, end: 5 }]);
  });
});

describe("RunControls — mount", () => {
  it("populates tools from TOOL_CATALOG synchronously, before ready resolves", () => {
    (services.getDefaultRowRange as jest.Mock).mockReturnValue(new Promise(() => {}));
    const container = makeContainer();
    new RunControls(container, { getPromptConfig: basicPromptConfig });
    expect(container.querySelectorAll("#tools-list .tag").length).toBeGreaterThan(0);
  });

  it("renders a model row for each MODEL_CATALOG entry", async () => {
    const { container } = await mountAndSettle();
    expect(container.querySelectorAll("#model-list .model-option")).toHaveLength(2);
  });

  it("selects gemini-3.1-flash-lite by default", async () => {
    const { container } = await mountAndSettle();
    const selected = container.querySelector<HTMLButtonElement>("#model-list .model-option.selected");
    expect(selected?.getAttribute("data-value")).toBe("gemini-3.1-flash-lite");
  });

  it("restores model/tools/rowRange from savedState", async () => {
    const { container } = await mountAndSettle({
      savedState: {
        model: "gemini-3.1-pro-preview",
        tools: ["google_search"],
        rowRange: { start: 2, end: 20 },
      },
    });
    expect(
      container.querySelector<HTMLButtonElement>("#model-list .model-option.selected"),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>('#model-list .model-option[data-value="gemini-3.1-pro-preview"]'),
    )?.toHaveClass?.("selected");
    expect(container.querySelector<HTMLElement>('[data-value="google_search"]')).toHaveClass("selected");
  });

  it("seeds the grounding column label from the initial output column", async () => {
    const { container } = await mountAndSettle({
      getPromptConfig: () => ({ ...basicPromptConfig(), outputCol: "summary" }),
    });
    expect(container.querySelector("#grounding-col-name")?.textContent).toBe("summary_grounding");
  });
});

describe("RunControls — Run AI", () => {
  it("calls runBatchAI and then onRunSucceeded once the chunked job resolves", async () => {
    (services.getActiveRangeInfo as jest.Mock).mockResolvedValue({ start: 2, end: 11 });
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const onRunSucceeded = jest.fn();
    const { container } = await mountAndSettle({ onRunSucceeded });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalled();
    expect(onRunSucceeded).toHaveBeenCalledTimes(1);
  });

  it("does not call onRunSucceeded when runBatchAI rejects", async () => {
    (services.getActiveRangeInfo as jest.Mock).mockResolvedValue({ start: 2, end: 11 });
    (services.runBatchAI as jest.Mock).mockRejectedValue(new Error("boom"));
    globalThis.alert = jest.fn();
    const onRunSucceeded = jest.fn();
    const { container } = await mountAndSettle({ onRunSucceeded });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(onRunSucceeded).not.toHaveBeenCalled();
  });

  it("does not require onRunSucceeded to be set", async () => {
    (services.getActiveRangeInfo as jest.Mock).mockResolvedValue({ start: 2, end: 11 });
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndSettle();
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalled();
  });
});

describe("RunControls — Test AI and getValue()", () => {
  it("shows test results and includes them in getValue().lastTest", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container, rc } = await mountAndSettle();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(container.querySelector<HTMLElement>("#test-results")!.hidden).toBe(false);
    expect(rc.getValue().lastTest?.stats).toEqual(TEST_STATS);
  });

  it("flags the file-size caveat for kind: 'auto' prompt columns, not just 'file'", async () => {
    const autoStats = {
      ...TEST_STATS,
      config: { ...TEST_STATS.config, promptCols: [{ col: "col_a", kind: "auto" as const }] },
    };
    (services.runBatchAI as jest.Mock).mockResolvedValue(autoStats);
    const { container } = await mountAndSettle();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(container.querySelector("#test-results")!.textContent).toContain(
      "Unusually large files may throw off cost and time estimates.",
    );
  });

  it("getValue() reflects live tools/model/rowRange selections", async () => {
    const { container, rc } = await mountAndSettle();
    container.querySelector<HTMLElement>('[data-value="google_search"]')!.click();
    container
      .querySelector<HTMLButtonElement>('#model-list .model-option[data-value="gemini-3.1-pro-preview"]')!
      .click();
    const value = rc.getValue();
    expect(value.tools).toEqual(["google_search"]);
    expect(value.model).toBe("gemini-3.1-pro-preview");
  });
});

describe("RunControls — refreshRowRange", () => {
  it("re-fetches the default row range without disturbing test button state mid-flight", async () => {
    let resolveStats!: (v: RunStats) => void;
    (services.runBatchAI as jest.Mock).mockReturnValue(
      new Promise<RunStats>((res) => {
        resolveStats = res;
      }),
    );
    const { container, rc } = await mountAndSettle();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await Promise.resolve();

    await rc.refreshRowRange();

    const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;
    expect(testBtn.disabled).toBe(true);
    expect(testBtn.querySelector(".btn-spinner")).not.toBeNull();
    resolveStats(TEST_STATS);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
});
```

- [ ] **Step 2: Run the new test file to verify it fails**

Run: `npx jest __tests__/components/run-controls.test.ts`
Expected: FAIL — `Cannot find module '../../src/client/components/run-controls'`

- [ ] **Step 3: Implement `RunControls`**

Create `src/client/components/run-controls.ts`:

```ts
import type { TestRunDisplay } from "../types";
import type { RunConfig, ToolId, ModelId } from "../../shared/types";
import { TagList } from "./tag-list";
import { RowRange, sanitizeRowRange, type RowRangeValue } from "./row-range";
import { AsyncActionButton } from "./async-action-button";
import { runBatchAI, getActiveRangeInfo, getDefaultRowRange } from "../services";
import { jobStore } from "../job-store";
import { TOOL_CATALOG } from "../tools";
import { MODEL_CATALOG } from "../models";
import { buildConfigSnapshot, configsMatch } from "../../shared/run-stats";
import { formatDuration } from "../format";

export const CHUNK_SIZE = 40;

export function computeChunks(rowRange: RowRangeValue, chunkSize: number): RowRangeValue[] {
  const chunks: RowRangeValue[] = [];
  for (let start = rowRange.start; start <= rowRange.end; start += chunkSize) {
    chunks.push({ start, end: Math.min(start + chunkSize - 1, rowRange.end) });
  }
  return chunks;
}

export type PromptConfig = Pick<
  RunConfig,
  "promptCols" | "systemPromptCol" | "outputCol" | "wrapPromptsInTags" | "applyMarkdown"
>;

export interface RunControlsSavedState {
  rowRange?: RowRangeValue;
  tools?: ToolId[];
  includeGrounding?: boolean;
  model?: ModelId;
  toolsExpanded?: boolean;
  modelExpanded?: boolean;
  lastTest?: TestRunDisplay;
}

export interface RunControlsConfig {
  getPromptConfig: () => PromptConfig;
  onRunSucceeded?: () => void;
  savedState?: RunControlsSavedState;
}

/**
 * Model/Tools/row-range/Test/Run AI controls, shared between ConfigureAIRunPanel
 * (the freeform panel) and RunStep (Guided AI Inference's terminal step). Depends
 * only on a host-supplied promptCols/systemPromptCol/outputCol/wrapPromptsInTags/
 * applyMarkdown snapshot — nothing about which columns exist or how they were
 * picked.
 */
export class RunControls {
  readonly ready: Promise<void>;
  private readonly container: HTMLElement;
  private readonly config: RunControlsConfig;
  private toolsList: TagList | null = null;
  private includeGroundingCb: HTMLInputElement | null = null;
  private toolsExpanded = false;
  private modelListEl: HTMLElement | null = null;
  private modelExpanded = false;
  private rowRangeComp: RowRange | null = null;
  private lastTest: TestRunDisplay | undefined;
  private testButton: AsyncActionButton | null = null;

  constructor(container: HTMLElement, config: RunControlsConfig) {
    this.container = container;
    this.config = config;
    this.lastTest = config.savedState?.lastTest;
    container.innerHTML = this.template();
    this.wireStatic(config.savedState);
    this.ready = getDefaultRowRange()
      .catch(() => undefined)
      .then((defaultRowRange) => this.wireRowRangeAndActions(defaultRowRange, config.savedState?.rowRange));
  }

  getValue(): RunControlsSavedState {
    return {
      rowRange: this.rowRangeComp?.getValue(),
      tools: (this.toolsList?.getValue() ?? []) as ToolId[],
      includeGrounding: this.includeGroundingCb?.checked ?? false,
      model: this.getSelectedModel(),
      toolsExpanded: this.toolsExpanded,
      modelExpanded: this.modelExpanded,
      lastTest: this.lastTest,
    };
  }

  /** Re-fetches the default row range, preserving any live "Specify range" values
   * (mirrors ConfigureAIRunPanel's refresh behavior). Only touches the row-range
   * sub-DOM — never recreates Model/Tools/#test-btn, so an in-flight Test/Run's
   * button state survives a refresh. */
  refreshRowRange(): Promise<void> {
    const selected = this.rowRangeComp?.getValue();
    return getDefaultRowRange()
      .catch(() => undefined)
      .then((defaultRowRange) => {
        this.rowRangeComp = new RowRange(this.container.querySelector("#row-range-container")!, {
          selected,
          fallback: defaultRowRange,
        });
      });
  }

  destroy(): void {
    this.container.innerHTML = "";
  }

  private wireStatic(savedState?: RunControlsSavedState): void {
    this.toolsList = new TagList(
      this.container.querySelector("#tools-list")!,
      TOOL_CATALOG.map((t) => ({ label: t.name, value: t.id })),
      savedState?.tools ?? [],
    );

    this.includeGroundingCb = this.container.querySelector<HTMLInputElement>("#include-grounding-cb");
    if (this.includeGroundingCb && savedState?.includeGrounding) {
      this.includeGroundingCb.checked = true;
    }

    const groundingLabel = this.container.querySelector<HTMLElement>("#grounding-col-name");
    if (groundingLabel) {
      const outputCol = this.config.getPromptConfig().outputCol;
      groundingLabel.textContent = outputCol ? `${outputCol}_grounding` : "_grounding";
    }

    const updateGroundingVisibility = (): void => {
      const group = this.container.querySelector<HTMLElement>("#include-grounding-group");
      if (group) {
        group.style.display = (this.toolsList?.getValue().length ?? 0) > 0 ? "block" : "none";
      }
    };
    updateGroundingVisibility();
    this.container.querySelector("#tools-list")?.addEventListener("click", updateGroundingVisibility);

    this.toolsExpanded = savedState?.toolsExpanded ?? false;
    this.applyToolsExpandState();
    this.container.querySelector("#tools-toggle")?.addEventListener("click", () => {
      this.toolsExpanded = !this.toolsExpanded;
      this.applyToolsExpandState();
    });

    const updateToolsSummary = (): void => {
      const summary = this.container.querySelector<HTMLElement>("#tools-summary");
      if (!summary) return;
      const selected = this.toolsList?.getValue() ?? [];
      summary.textContent =
        selected.length === 0
          ? "No tools selected"
          : selected.map((id) => TOOL_CATALOG.find((t) => t.id === id)?.name ?? id).join(", ");
    };
    updateToolsSummary();
    this.container.querySelector("#tools-list")?.addEventListener("click", updateToolsSummary);

    const initialModel: ModelId = savedState?.model ?? "gemini-3.1-flash-lite";
    this.modelListEl = this.container.querySelector<HTMLElement>("#model-list");
    const modelButtons = this.modelListEl?.querySelectorAll<HTMLButtonElement>(".model-option");
    const updateModelSummary = (): void => {
      const entry = MODEL_CATALOG.find((m) => m.id === this.getSelectedModel());
      const summary = this.container.querySelector<HTMLElement>("#model-summary");
      if (summary) summary.textContent = entry?.name ?? "";
    };
    modelButtons?.forEach((btn) => {
      if (btn.getAttribute("data-value") === initialModel) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        modelButtons.forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        updateModelSummary();
      });
    });
    updateModelSummary();

    this.modelExpanded = savedState?.modelExpanded ?? false;
    this.applyModelExpandState();
    this.container.querySelector("#model-toggle")?.addEventListener("click", () => {
      this.modelExpanded = !this.modelExpanded;
      this.applyModelExpandState();
    });
  }

  private wireRowRangeAndActions(
    defaultRowRange: RowRangeValue | undefined,
    selectedRowRange: RowRangeValue | undefined,
  ): void {
    this.rowRangeComp = new RowRange(this.container.querySelector("#row-range-container")!, {
      selected: selectedRowRange,
      fallback: defaultRowRange,
    });
    this.testButton = new AsyncActionButton(
      this.container.querySelector<HTMLButtonElement>("#test-btn")!,
      { idleLabel: "Test", loadingLabel: "Testing...", doneLabel: "Tested ✓" },
    );
    this.container.querySelector<HTMLButtonElement>("#run-btn")!.addEventListener("click", () => this.handleRun());
    this.container.querySelector<HTMLButtonElement>("#test-btn")!.addEventListener("click", () => this.handleTest());
    this.checkTestStatsFreshness();
  }

  private applyToolsExpandState(): void {
    const content = this.container.querySelector<HTMLElement>("#tools-content");
    const toggle = this.container.querySelector<HTMLButtonElement>("#tools-toggle");
    if (content) content.hidden = !this.toolsExpanded;
    if (toggle) toggle.setAttribute("aria-expanded", String(this.toolsExpanded));
  }

  private applyModelExpandState(): void {
    const content = this.container.querySelector<HTMLElement>("#model-content");
    const toggle = this.container.querySelector<HTMLButtonElement>("#model-toggle");
    if (content) content.hidden = !this.modelExpanded;
    if (toggle) toggle.setAttribute("aria-expanded", String(this.modelExpanded));
  }

  private getSelectedModel(): ModelId {
    const selected = this.modelListEl?.querySelector<HTMLButtonElement>(".model-option.selected");
    return (selected?.getAttribute("data-value") as ModelId) ?? "gemini-3.1-flash-lite";
  }

  private resolveRowRange(range: RowRangeValue): RowRangeValue | null {
    const sanitized = sanitizeRowRange(range);
    if (!sanitized) {
      globalThis.alert(
        "Row 1 is the header row and can't be processed. Please select a data row range.",
      );
    }
    return sanitized;
  }

  private currentSnapshot(): Partial<RunConfig> {
    return {
      ...this.config.getPromptConfig(),
      rowRange: this.rowRangeComp?.getValue(),
      tools: (this.toolsList?.getValue() ?? []) as ToolId[],
      model: this.getSelectedModel(),
    };
  }

  private assembleRunConfig(): RunConfig | null {
    const promptFields = this.config.getPromptConfig();
    if (promptFields.promptCols.length === 0) {
      globalThis.alert("Please select at least one User prompt column.");
      return null;
    }
    if (!promptFields.outputCol) {
      globalThis.alert("Please select an output column.");
      return null;
    }
    const rawRowRange = this.rowRangeComp?.getValue();
    let rowRange: RowRangeValue | undefined;
    if (rawRowRange) {
      rowRange = this.resolveRowRange(rawRowRange) ?? undefined;
      if (!rowRange) return null;
    }
    const tools = (this.toolsList?.getValue() ?? []) as ToolId[];
    const includeGrounding = this.includeGroundingCb?.checked ?? false;
    return {
      ...promptFields,
      rowRange,
      tools: tools.length > 0 ? tools : undefined,
      includeGrounding: includeGrounding || undefined,
      model: this.getSelectedModel(),
    };
  }

  private handleRun(): void {
    const config = this.assembleRunConfig();
    if (!config) return;

    const resolveRange: Promise<RowRangeValue | undefined> = config.rowRange
      ? Promise.resolve(config.rowRange)
      : getActiveRangeInfo();

    resolveRange
      .then((range) => {
        if (!range) {
          globalThis.alert(
            "No rows to process. Select the rows you want to run on, or use “Specify range” to enter one.",
          );
          return;
        }
        const sanitized = this.resolveRowRange(range);
        if (!sanitized) return;
        if (!this.confirmUntestedRun(sanitized)) return;

        const jobId = `batch-ai-${Date.now()}`;
        const chunks = computeChunks(sanitized, CHUNK_SIZE);
        jobStore
          .dispatch(jobId, "Batch AI Run", this.runChunks(jobId, config, chunks))
          .then(() => this.config.onRunSucceeded?.())
          .catch((err: Error) => {
            globalThis.alert("Error: " + err.message);
          });
      })
      .catch((err: Error) => {
        globalThis.alert("Error: " + err.message);
      });
  }

  private confirmUntestedRun(range: RowRangeValue): boolean {
    const rowCount = range.end - range.start + 1;
    if (rowCount <= CHUNK_SIZE) return true;
    if (
      this.lastTest &&
      configsMatch(buildConfigSnapshot(this.currentSnapshot()), this.lastTest.stats.config)
    ) {
      return true;
    }
    return globalThis.confirm(
      `You're about to process ${rowCount} rows without testing first.\n\n` +
        `A test run on 10 rows checks quality and cost before you commit to the full run.\n\n` +
        `Run anyway?`,
    );
  }

  private async runChunks(jobId: string, config: RunConfig, chunks: RowRangeValue[]): Promise<void> {
    const lastRow = chunks[chunks.length - 1].end;
    for (let i = 0; i < chunks.length; i++) {
      if (jobStore.isCancelled(jobId)) break;
      jobStore.setProgress(jobId, `Rows ${chunks[i].start}–${chunks[i].end} of ${lastRow}`);
      await runBatchAI({ ...config, rowRange: chunks[i] }, jobId);
    }
  }

  private handleTest(): void {
    const config = this.assembleRunConfig();
    if (!config) return;

    const jobId = `test-ai-${Date.now()}`;
    this.testButton?.setLoading();

    const resolveRange: Promise<RowRangeValue | undefined> = config.rowRange
      ? Promise.resolve(config.rowRange)
      : getActiveRangeInfo();

    jobStore
      .dispatch(
        jobId,
        "Test AI Run",
        resolveRange.then((range) => {
          const sanitized = range ? this.resolveRowRange(range) : null;
          if (!sanitized) return undefined;
          const fullRowCount = sanitized.end - sanitized.start + 1;
          const cappedEnd = Math.min(sanitized.start + 9, sanitized.end);
          return runBatchAI({ ...config, rowRange: { start: sanitized.start, end: cappedEnd } }, jobId).then(
            (stats) => (stats ? { stats, fullRowCount } : undefined),
          );
        }),
      )
      .then((test) => {
        if (test) {
          this.lastTest = test;
          this.renderTestStats(test);
          this.testButton?.setDone();
        } else {
          this.renderTestMessage(
            "Test didn't produce measurable results — check the sheet for errors in the tested rows.",
          );
          this.testButton?.setIdle();
        }
      })
      .catch((err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.testButton?.setIdle();
      });
  }

  private renderTestStats(test: TestRunDisplay): void {
    const el = this.container.querySelector<HTMLElement>("#test-results")!;
    const { stats, fullRowCount } = test;
    const totalCost = stats.totalTokenCost + stats.totalGroundingCost;
    const avgCost = totalCost / stats.rowCount;

    const parts = [
      `<p><strong>Test run:</strong> ${stats.rowCount} row${stats.rowCount === 1 ? "" : "s"} · ` +
        `$${totalCost.toFixed(4)} · ${formatDuration(stats.totalTimeMs)}</p>`,
    ];

    if (fullRowCount > stats.rowCount) {
      const fullCost = avgCost * fullRowCount;
      const chunkCount = Math.ceil(fullRowCount / CHUNK_SIZE);
      const fullTimeMs = chunkCount * stats.totalTimeMs;
      parts.push(
        `<p><strong>Full run estimate:</strong> ${fullRowCount} rows · ` +
          `~$${fullCost.toFixed(2)} · ~${formatDuration(fullTimeMs)}</p>`,
      );
    }

    // Widened from `pc.kind === "file"` to also cover "auto" — an auto-detected
    // Drive-link column (Guided AI Inference's InputsStep) is exactly as
    // expensive as an explicit file column but previously never tripped this
    // warning. Flagged as a known gap in the Session 2 server architecture spec.
    if (stats.config.promptCols.some((pc) => pc.kind === "file" || pc.kind === "auto")) {
      parts.push(`<p>⚠ Unusually large files may throw off cost and time estimates.</p>`);
    }

    el.innerHTML = parts.join("");
    el.hidden = false;
  }

  private renderTestMessage(message: string): void {
    const el = this.container.querySelector<HTMLElement>("#test-results")!;
    el.innerHTML = `<p>${message}</p>`;
    el.hidden = false;
  }

  private checkTestStatsFreshness(): void {
    if (!this.lastTest || this.testButton?.getState() === "loading") return;
    const liveSnapshot = buildConfigSnapshot(this.currentSnapshot());
    if (configsMatch(liveSnapshot, this.lastTest.stats.config)) {
      this.renderTestStats(this.lastTest);
      this.testButton?.setDone();
    } else {
      this.renderTestMessage("Configuration changed since last test — click Test to refresh.");
      this.testButton?.setIdle();
    }
  }

  private template(): string {
    return `
      <div class="field-group">
        <button type="button" id="model-toggle" class="collapsible-header">
          <span class="collapsible-label">MODEL</span>
          <span id="model-summary" class="collapsible-summary"></span>
          <span class="collapsible-chevron">▶</span>
        </button>
        <div id="model-content" class="collapsible-content" hidden>
          <div id="model-list" class="model-option-list">
            ${MODEL_CATALOG.map((m) => `<button type="button" class="model-option" data-value="${m.id}"><span class="model-option-name">${m.name}</span><span class="model-option-desc">${m.description}</span></button>`).join("")}
          </div>
        </div>
      </div>
      <div class="field-group">
        <button type="button" id="tools-toggle" class="collapsible-header">
          <span class="collapsible-label">TOOLS <span class="optional">(optional)</span></span>
          <span id="tools-summary" class="collapsible-summary">No tools selected</span>
          <span class="collapsible-chevron">▶</span>
        </button>
        <div id="tools-content" class="collapsible-content" hidden>
          <p class="field-helper">Give the AI extra capabilities. Google Search lets it look up current information; URL Context lets it read web pages you provide; Code Execution lets it run and verify calculations.</p>
          <div id="tools-list" class="tag-list"></div>
          <div id="include-grounding-group" style="display:none">
            <label class="checkbox-option">
              <input type="checkbox" id="include-grounding-cb" />
              <span>Include grounding column <span class="grounding-col-badge" id="grounding-col-name">_grounding</span></span>
            </label>
          </div>
        </div>
      </div>
      <div class="field-group">
        <span class="field-label">Rows to process</span>
        <div id="row-range-container"></div>
      </div>
      <div class="finish-panel">
        <div class="field-group">
          <p class="step-title">Test your setup</p>
          <p class="field-helper">Try it out on the first 10 rows — check quality and cost before committing to a full run.</p>
          <button id="test-btn" class="btn-outline">Test</button>
          <div id="test-results" class="test-results" hidden></div>
        </div>
        <div class="field-group field-group--joined">
          <p class="step-title">Run on all rows</p>
          <p class="field-helper">Run across your entire selection. For large runs above ${CHUNK_SIZE} rows, make sure you keep this sidebar open.</p>
          <button id="run-btn" class="btn-run">Run AI</button>
        </div>
      </div>
    `;
  }
}
```

- [ ] **Step 4: Run the new test file to verify it passes**

Run: `npx jest __tests__/components/run-controls.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 5: Refactor `ConfigureAIRunPanel` to delegate to `RunControls`**

Replace the full contents of `src/client/panels/configure-ai-run.ts`:

```ts
import type { NavigationContext, Panel, TestRunDisplay } from "../types";
import type { RunConfig, ToolId, ModelId } from "../../shared/types";
import { TokenInput } from "../components/token-input";
import { PromptColList } from "../components/prompt-col-list";
import { PanelLoader } from "../components/panel-loader";
import { getSheetHeaders } from "../services";
import { RunControls, type PromptConfig, type RunControlsSavedState } from "../components/run-controls";

export type SavedState = Required<
  Omit<
    RunConfig,
    "rowRange" | "tools" | "includeGrounding" | "applyMarkdown" | "wrapPromptsInTags" | "model"
  >
> &
  Pick<
    RunConfig,
    "rowRange" | "tools" | "includeGrounding" | "applyMarkdown" | "wrapPromptsInTags" | "model"
  > & {
    toolsExpanded?: boolean;
    modelExpanded?: boolean;
    lastTest?: TestRunDisplay | undefined;
  };

export class ConfigureAIRunPanel implements Panel<Partial<RunConfig>, SavedState> {
  private promptColList: PromptColList | null = null;
  private systemPromptList: TokenInput | null = null;
  private outputColList: TokenInput | null = null;
  private applyMarkdownCb: HTMLInputElement | null = null;
  private wrapPromptsInTagsCb: HTMLInputElement | null = null;
  private outputColObserver: MutationObserver | null = null;
  private nav: NavigationContext | null = null;
  private headersLoaded = false;
  private runControls: RunControls | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    params?: Partial<RunConfig>,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.promptColList = null; // reset so unmount() guards correctly before load
    this.headersLoaded = false;
    container.innerHTML = this.template();
    this.wireNavButtons(container);

    const preset: Partial<RunConfig> = savedState
      ? {
          promptCols: savedState.promptCols,
          systemPromptCol: savedState.systemPromptCol || undefined,
          outputCol: savedState.outputCol || undefined,
          rowRange: savedState.rowRange,
          tools: savedState.tools,
          includeGrounding: savedState.includeGrounding,
          applyMarkdown: savedState.applyMarkdown,
          wrapPromptsInTags: savedState.wrapPromptsInTags,
          model: savedState.model,
        }
      : (params ?? {});

    this.applyMarkdownCb = container.querySelector<HTMLInputElement>("#apply-markdown-cb");
    if (this.applyMarkdownCb && preset.applyMarkdown) {
      this.applyMarkdownCb.checked = true;
    }

    this.wrapPromptsInTagsCb = container.querySelector<HTMLInputElement>("#wrap-prompts-in-tags-cb");
    if (this.wrapPromptsInTagsCb) {
      this.wrapPromptsInTagsCb.checked = preset.wrapPromptsInTags ?? true;
    }

    this.runControls = new RunControls(container.querySelector("#run-controls-mount")!, {
      getPromptConfig: () => this.getPromptConfig(),
      savedState: this.buildRunControlsSavedState(savedState, preset),
    });

    const loader = new PanelLoader(container);
    loader.setState({ status: "loading", message: "Loading columns..." });
    Promise.all([this.loadHeaders(container, preset), this.runControls.ready]).finally(() =>
      loader.setState({ status: "idle" }),
    );
  }

  private buildRunControlsSavedState(
    savedState: SavedState | undefined,
    preset: Partial<RunConfig>,
  ): RunControlsSavedState {
    const source = savedState ?? preset;
    return {
      rowRange: source.rowRange,
      tools: source.tools,
      includeGrounding: source.includeGrounding,
      model: source.model,
      toolsExpanded: savedState?.toolsExpanded,
      modelExpanded: savedState?.modelExpanded,
      lastTest: savedState?.lastTest,
    };
  }

  private getPromptConfig(): PromptConfig {
    return {
      promptCols: this.promptColList?.getValue() ?? [],
      systemPromptCol: this.systemPromptList?.getValue()[0] || undefined,
      outputCol: this.outputColList?.getValue()[0] ?? "",
      wrapPromptsInTags: this.wrapPromptsInTagsCb?.checked ? undefined : false,
      applyMarkdown: this.applyMarkdownCb?.checked || undefined,
    };
  }

  private loadHeaders(container: HTMLElement, preset: Partial<RunConfig>): Promise<void> {
    this.outputColObserver?.disconnect();
    this.outputColObserver = null;
    this.promptColList?.destroy();
    this.promptColList = null;
    this.systemPromptList?.destroy();
    this.outputColList?.destroy();
    return getSheetHeaders().then(
      (headers) => {
        if (headers.length === 0) {
          container.querySelector<HTMLElement>("#no-headers-msg")!.style.display = "block";
          container.querySelector<HTMLElement>("#config-form")!.style.display = "none";
          return;
        }

        container.querySelector<HTMLElement>("#no-headers-msg")!.style.display = "none";

        this.promptColList = new PromptColList(
          container.querySelector("#prompt-col-list")!,
          headers,
          preset.promptCols,
        );
        this.systemPromptList = new TokenInput(container.querySelector("#system-prompt-col")!, headers, {
          multi: false,
          selected: preset.systemPromptCol ? [preset.systemPromptCol] : [],
        });
        this.outputColList = new TokenInput(container.querySelector("#output-col")!, headers, {
          multi: false,
          includeNew: true,
          newDefault: "ai_",
          selected: preset.outputCol ? [preset.outputCol] : [],
        });

        const updateGroundingLabel = (): void => {
          const val = this.outputColList?.getValue()[0] ?? "";
          const label = container.querySelector<HTMLElement>("#grounding-col-name");
          if (label) label.textContent = val ? `${val}_grounding` : "_grounding";
        };
        updateGroundingLabel();
        const outputColEl = container.querySelector("#output-col");
        if (outputColEl) {
          const observer = new MutationObserver(updateGroundingLabel);
          observer.observe(outputColEl, { childList: true, subtree: true });
          this.outputColObserver = observer;
        }

        if (!this.headersLoaded) {
          container.querySelector<HTMLElement>("#config-form")!.style.display = "block";
          this.headersLoaded = true;
        }
      },
      (err: Error) => {
        globalThis.alert("Error loading headers: " + err.message);
        this.nav?.back();
      },
    );
  }

  unmount(): SavedState | undefined {
    if (!this.promptColList) return undefined;
    this.outputColObserver?.disconnect();
    const promptCols = this.promptColList.getValue();
    this.promptColList.destroy();
    this.systemPromptList?.destroy();
    this.outputColList?.destroy();
    const runControlsState = this.runControls?.getValue();
    return {
      promptCols,
      systemPromptCol: this.systemPromptList?.getValue()[0] ?? "",
      outputCol: this.outputColList?.getValue()[0] ?? "",
      rowRange: runControlsState?.rowRange,
      tools: (runControlsState?.tools ?? []) as ToolId[],
      includeGrounding: runControlsState?.includeGrounding ?? false,
      applyMarkdown: this.applyMarkdownCb?.checked ?? false,
      wrapPromptsInTags: this.wrapPromptsInTagsCb?.checked ?? true,
      toolsExpanded: runControlsState?.toolsExpanded ?? false,
      model: (runControlsState?.model ?? "gemini-3.1-flash-lite") as ModelId,
      modelExpanded: runControlsState?.modelExpanded ?? false,
      lastTest: runControlsState?.lastTest,
    };
  }

  private wireNavButtons(container: HTMLElement): void {
    container.querySelector("#back-btn")?.addEventListener("click", () => this.nav?.back());
    container.querySelector("#browse-recipes-link")?.addEventListener("click", (e) => {
      e.preventDefault();
      this.nav?.navigate("recipes-list");
    });
    container.querySelector("#refresh-btn")?.addEventListener("click", () => {
      const btn = container.querySelector<HTMLButtonElement>("#refresh-btn")!;
      btn.classList.add("spinning");
      btn.disabled = true;
      Promise.all([
        this.loadHeaders(container, this.currentPreset()),
        this.runControls!.refreshRowRange(),
      ]).finally(() => {
        btn.classList.remove("spinning");
        btn.disabled = false;
      });
    });
  }

  private currentPreset(): Partial<RunConfig> {
    const runControlsState = this.runControls?.getValue();
    return {
      promptCols: this.promptColList?.getValue() ?? [],
      systemPromptCol: this.systemPromptList?.getValue()[0] || undefined,
      outputCol: this.outputColList?.getValue()[0] || undefined,
      rowRange: runControlsState?.rowRange,
      tools: runControlsState?.tools as ToolId[] | undefined,
      includeGrounding: runControlsState?.includeGrounding,
      applyMarkdown: this.applyMarkdownCb?.checked,
      wrapPromptsInTags: this.wrapPromptsInTagsCb?.checked,
      model: runControlsState?.model,
    };
  }

  private template(): string {
    return `
    <div class="panel-header">
      <button id="back-btn" class="back-btn">← Back</button>
      <span class="panel-title">▶️ Run AI Inference</span>
      <button id="refresh-btn" class="refresh-btn" title="Refresh columns">↻</button>
    </div>
    <div id="panel-loader" class="panel-loader" hidden>
      <div class="panel-loader__bar-wrap" hidden>
        <div class="panel-loader__bar-fill"></div>
      </div>
      <div class="panel-loader__spinner" hidden></div>
      <p class="panel-loader__message"></p>
    </div>
    <div id="no-headers-msg" class="no-headers-msg" style="display:none">
      No columns found.<br><br><br>Not sure where to begin? <a id="browse-recipes-link" href="#">Browse recipes</a> to get started.
    </div>
    <div id="config-form" style="display:none">
      <div class="field-group">
        <span class="field-label">System prompt column <span class="optional">(optional)</span></span>
        <p class="field-helper">Sets the AI's role and behavior — what it should do and how it should respond — before it sees any data.</p>
        <div id="system-prompt-col" class="tag-list"></div>
      </div>
      <div class="field-group">
        <span class="field-label">User prompt columns <span class="required">*</span></span>
        <p class="field-helper">The content the AI acts on — what it reads, summarizes, classifies, or answers, one row at a time.</p>
        <div id="prompt-col-list"></div>
        <label class="checkbox-option">
          <input type="checkbox" id="wrap-prompts-in-tags-cb" checked />
          <span>Tag each input with its column name</span>
        </label>
      </div>
      <div class="field-group">
        <span class="field-label">Output column <span class="required">*</span></span>
        <p class="field-helper">Where the AI's response will be written. Select an existing column or create a new one.</p>
        <div id="output-col" class="tag-list"></div>
        <label class="checkbox-option">
          <input type="checkbox" id="apply-markdown-cb" />
          <span>Apply markdown formatting</span>
        </label>
      </div>
      <div id="run-controls-mount"></div>
    </div>
  `;
  }
}
```

Delete `__tests__/configure-ai-run.test.ts` (its only test, `computeChunks`, is already covered by Step 1's new file).

- [ ] **Step 6: Run the full existing regression suite to verify the extraction is behavior-preserving**

Run: `npx jest __tests__/panels/configure-ai-run.test.ts`
Expected: PASS — every test in this file (Model selector, Tools TagList, includeGrounding, collapsible Tools section, wrapPromptsInTags, Test AI, Run AI, untested-run warning, lastTest persistence, row range default fill, refresh, back, unmount) passes **unmodified**, proving the refactor didn't change `ConfigureAIRunPanel`'s observable behavior. If any test fails, the extraction introduced a real behavior change — fix `run-controls.ts` or `configure-ai-run.ts`, do not edit the test to match.

- [ ] **Step 7: Run typecheck and the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS

- [ ] **Step 8: Commit**

```bash
git add src/client/components/run-controls.ts __tests__/components/run-controls.test.ts \
  src/client/panels/configure-ai-run.ts
git rm __tests__/configure-ai-run.test.ts
git commit -m "Extract RunControls from ConfigureAIRunPanel for reuse by Guided AI Inference"
```

---

## Task 2: `Step`/`StepContext` types and the `StepFlow` shell

**Files:**
- Modify: `src/client/types.ts`
- Create: `src/client/components/step-flow.ts`
- Create: `__tests__/components/step-flow.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces (consumed by Tasks 3, 4, 5, 6):
  - `export interface StepContext { onComplete(): void; onError(): void; }`
  - `export interface Step<S = unknown> { title: string; flavorText: string; mount(container: HTMLElement, ctx: StepContext, savedState?: S): void; unmount(): { savedState: S; summary: string } | undefined; }`
  - `export interface StepFlowSavedState { activeStepIndex: number; steps: Array<{ status: "locked" | "active" | "complete"; saved?: { savedState: unknown; summary: string } }>; }`
  - `export class StepFlow { constructor(container: HTMLElement, steps: Step[], savedState?: StepFlowSavedState); getValue(): StepFlowSavedState; }`

- [ ] **Step 1: Add the `Step`/`StepContext`/`StepFlowSavedState` types**

In `src/client/types.ts`, add after the existing `Job`/`LoadingState` section (after line 36, before the "Recipe UI types" comment):

```ts
// ── Step framework (Guided AI Inference) ──────────────────────────
// Positional, not kind-based: whether completing a step collapses it and
// unlocks a next step, or leaves it expanded forever, is decided by the
// StepFlow shell based on array position — the last step behaves
// differently, but nothing on the step itself declares that.

export interface StepContext {
  /** Called by the step, at its own discretion, when it considers its own
   * designated action to have succeeded. May be called more than once —
   * the shell's handling of this is idempotent. */
  onComplete(): void;
  /** Purely cosmetic — flips this step's checklist icon to a red ✕. Does
   * NOT change locked/active/complete status. The step's own mount()
   * remains responsible for displaying the actual error message inline. */
  onError(): void;
}

export interface Step<S = unknown> {
  title: string;
  flavorText: string;
  mount(container: HTMLElement, ctx: StepContext, savedState?: S): void;
  unmount(): { savedState: S; summary: string } | undefined;
}

export interface StepFlowSavedState {
  activeStepIndex: number;
  steps: Array<{
    status: "locked" | "active" | "complete";
    saved?: { savedState: unknown; summary: string };
  }>;
}
```

- [ ] **Step 2: Write the failing `StepFlow` test**

Create `__tests__/components/step-flow.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */

import { StepFlow } from "../../src/client/components/step-flow";
import type { Step, StepContext } from "../../src/client/types";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

class FakeStep implements Step<{ value: string }> {
  title: string;
  flavorText: string;
  mounted = false;
  lastCtx: StepContext | null = null;
  private value = "";

  constructor(title: string, flavorText = "flavor") {
    this.title = title;
    this.flavorText = flavorText;
  }

  mount(container: HTMLElement, ctx: StepContext, savedState?: { value: string }): void {
    this.mounted = true;
    this.lastCtx = ctx;
    this.value = savedState?.value ?? "";
    container.innerHTML = `<input class="fake-step-input" value="${this.value}" />`;
  }

  unmount(): { savedState: { value: string }; summary: string } | undefined {
    if (!this.mounted) return undefined;
    this.mounted = false;
    return { savedState: { value: this.value }, summary: this.value || "empty" };
  }

  setValue(v: string): void {
    this.value = v;
  }
}

describe("StepFlow — initial render", () => {
  it("mounts only step 0, others locked", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    expect(a.mounted).toBe(true);
    expect(b.mounted).toBe(false);
    expect(container.querySelectorAll(".step-row")).toHaveLength(2);
  });

  it("shows ○ for locked steps and ● for the active one", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    const icons = container.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("●");
    expect(icons[1].textContent).toBe("○");
  });
});

describe("StepFlow — onComplete for a non-terminal step", () => {
  it("collapses the step, shows its cached summary and [Edit], and mounts the next step", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.setValue("col_x");
    a.lastCtx!.onComplete();

    expect(a.mounted).toBe(false);
    expect(b.mounted).toBe(true);
    const icons = container.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("✓");
    expect(icons[1].textContent).toBe("●");
    expect(container.querySelector(".step-summary")!.textContent).toBe("col_x");
    expect(container.querySelector(".step-edit-btn")).not.toHaveAttribute("hidden");
  });
});

describe("StepFlow — onComplete for the terminal (last) step", () => {
  it("flips the icon to ✓ but keeps the step mounted and expanded, with no [Edit]", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete();

    expect(b.mounted).toBe(true);
    const rows = container.querySelectorAll(".step-row");
    const lastIcon = rows[1].querySelector(".step-icon")!;
    expect(lastIcon.textContent).toBe("✓");
    expect(rows[1].querySelector(".step-body")).not.toHaveAttribute("hidden");
    expect(rows[1].querySelector(".step-edit-btn")).toHaveAttribute("hidden");
  });

  it("calling onComplete again on an already-complete terminal step is a no-op", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete();
    expect(() => b.lastCtx!.onComplete()).not.toThrow();
    expect(b.mounted).toBe(true);
  });
});

describe("StepFlow — onError", () => {
  it("shows ✕ in place of the active step's icon without changing its status", () => {
    const [a] = [new FakeStep("A")];
    const container = makeContainer();
    new StepFlow(container, [a]);
    a.lastCtx!.onError();
    expect(container.querySelector(".step-icon")!.textContent).toBe("✕");
    expect(a.mounted).toBe(true); // still active/mounted, not collapsed
  });

  it("clears on the next onComplete for that step", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onError();
    a.lastCtx!.onComplete();
    const icons = container.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("✓");
  });
});

describe("StepFlow — [Edit]", () => {
  it("re-expands a collapsed step with its cached savedState, leaving other steps untouched", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.setValue("col_x");
    a.lastCtx!.onComplete(); // a: complete/collapsed, b: active

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click();

    expect(a.mounted).toBe(true);
    expect(container.querySelector(".fake-step-input")).toHaveValue("col_x");
    expect(b.mounted).toBe(true); // b was already mounted (active) and stays so
  });

  it("editing an earlier step does not collapse an already-complete terminal step", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete(); // b: terminal, complete, expanded

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    expect(b.mounted).toBe(true);
    const rows = container.querySelectorAll(".step-row");
    expect(rows[1].querySelector(".step-body")).not.toHaveAttribute("hidden");
  });
});

describe("StepFlow — getValue()/restore round trip", () => {
  it("captures live state of every currently-mounted step", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.setValue("col_x");
    a.lastCtx!.onComplete();
    b.setValue("live-b-value");

    const flow = new StepFlow(container, [a, b]); // not used further; re-derive value via a fresh instance below
    void flow;
  });

  it("a fresh StepFlow constructed from a prior getValue() restores status, activeIndex, and mounts correctly", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const flow1 = new StepFlow(container, [a, b]);
    a.setValue("col_x");
    a.lastCtx!.onComplete();
    b.setValue("draft");
    const saved = flow1.getValue();

    expect(saved.activeStepIndex).toBe(1);
    expect(saved.steps[0]).toEqual({ status: "complete", saved: { savedState: { value: "col_x" }, summary: "col_x" } });

    const [a2, b2] = [new FakeStep("A"), new FakeStep("B")];
    new StepFlow(container, [a2, b2], saved);
    expect(a2.mounted).toBe(false); // collapsed, not re-mounted
    expect(b2.mounted).toBe(true);
    expect(container.querySelector(".fake-step-input")).toHaveValue("draft");
  });
});
```

- [ ] **Step 3: Run the test file to verify it fails**

Run: `npx jest __tests__/components/step-flow.test.ts`
Expected: FAIL — `Cannot find module '../../src/client/components/step-flow'`

- [ ] **Step 4: Implement `StepFlow`**

Create `src/client/components/step-flow.ts`:

```ts
import type { Step, StepContext, StepFlowSavedState } from "../types";

export class StepFlow {
  private readonly container: HTMLElement;
  private readonly steps: Step[];
  private statuses: Array<"locked" | "active" | "complete">;
  private savedByIndex: Array<{ savedState: unknown; summary: string } | undefined>;
  private hasErrorByIndex: boolean[];
  private activeIndex: number;
  private rowEls: HTMLElement[] = [];

  constructor(container: HTMLElement, steps: Step[], savedState?: StepFlowSavedState) {
    if (steps.length === 0) throw new Error("StepFlow requires at least one step");
    this.container = container;
    this.steps = steps;

    if (savedState) {
      this.statuses = savedState.steps.map((s) => s.status);
      this.savedByIndex = savedState.steps.map((s) => s.saved);
      this.activeIndex = savedState.activeStepIndex;
    } else {
      this.statuses = steps.map((_, i) => (i === 0 ? "active" : "locked"));
      this.savedByIndex = steps.map(() => undefined);
      this.activeIndex = 0;
    }
    this.hasErrorByIndex = steps.map(() => false);

    this.container.innerHTML = "";
    this.rowEls = steps.map((step, i) => this.buildRow(step, i));
    this.rowEls.forEach((row) => this.container.appendChild(row));
    steps.forEach((_, i) => {
      if (this.isMountedState(i)) this.mountStep(i);
    });
  }

  getValue(): StepFlowSavedState {
    this.steps.forEach((_, i) => {
      if (this.isMountedState(i)) {
        const result = this.steps[i].unmount();
        if (result) this.savedByIndex[i] = result;
      }
    });
    return {
      activeStepIndex: this.activeIndex,
      steps: this.statuses.map((status, i) => ({ status, saved: this.savedByIndex[i] })),
    };
  }

  private isLastStep(index: number): boolean {
    return index === this.steps.length - 1;
  }

  private isMountedState(index: number): boolean {
    return index === this.activeIndex || (this.isLastStep(index) && this.statuses[index] === "complete");
  }

  private iconFor(index: number): string {
    if (this.hasErrorByIndex[index]) return "✕";
    if (this.statuses[index] === "complete") return "✓";
    if (this.statuses[index] === "locked") return "○";
    return "●";
  }

  private buildRow(step: Step, index: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "step-row";
    row.setAttribute("data-step-index", String(index));
    row.innerHTML = `
      <div class="step-header">
        <span class="step-icon">${this.iconFor(index)}</span>
        <span class="step-title-text">${step.title}</span>
        <button type="button" class="step-edit-btn" hidden>Edit</button>
      </div>
      <p class="step-summary" hidden></p>
      <p class="step-flavor-text" hidden></p>
      <div class="step-body" hidden></div>
    `;
    row
      .querySelector<HTMLButtonElement>(".step-edit-btn")!
      .addEventListener("click", () => this.editStep(index));
    this.applyRowDisplay(row, index, step);
    return row;
  }

  private applyRowDisplay(row: HTMLElement, index: number, step: Step): void {
    const status = this.statuses[index];
    const collapsedNonTerminalComplete = status === "complete" && !this.isLastStep(index);

    row.querySelector<HTMLElement>(".step-edit-btn")!.hidden = !collapsedNonTerminalComplete;

    const summaryEl = row.querySelector<HTMLElement>(".step-summary")!;
    summaryEl.hidden = !collapsedNonTerminalComplete;
    summaryEl.textContent = this.savedByIndex[index]?.summary ?? "";

    const expanded = status !== "locked" && !collapsedNonTerminalComplete;
    const flavorEl = row.querySelector<HTMLElement>(".step-flavor-text")!;
    flavorEl.hidden = !expanded || step.flavorText === "";
    flavorEl.textContent = step.flavorText;
    row.querySelector<HTMLElement>(".step-body")!.hidden = !expanded;
  }

  private mountStep(index: number): void {
    const body = this.rowEls[index].querySelector<HTMLElement>(".step-body")!;
    const ctx: StepContext = {
      onComplete: () => this.handleComplete(index),
      onError: () => this.handleError(index),
    };
    this.steps[index].mount(body, ctx, this.savedByIndex[index]?.savedState);
  }

  private handleComplete(index: number): void {
    // Idempotent for ANY already-complete step, not just the terminal one —
    // a second call must not re-unmount an already-collapsed step or
    // re-mount an already-live next step (found during Task 2 review: the
    // StepContext.onComplete contract promises this unconditionally).
    if (this.statuses[index] === "complete") return;

    this.hasErrorByIndex[index] = false;

    if (this.isLastStep(index)) {
      // Stays mounted and expanded forever — only the icon changes. Its
      // savedState/summary are refreshed lazily by getValue() when the panel
      // is actually torn down, not eagerly here.
      this.statuses[index] = "complete";
      this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
      this.updateIcon(index);
      return;
    }

    const result = this.steps[index].unmount();
    if (result) this.savedByIndex[index] = result;
    this.statuses[index] = "complete";

    const nextIndex = index + 1;
    if (this.statuses[nextIndex] === "locked") this.statuses[nextIndex] = "active";
    this.activeIndex = nextIndex;
    this.mountStep(nextIndex);

    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.applyRowDisplay(this.rowEls[nextIndex], nextIndex, this.steps[nextIndex]);
    this.updateIcon(index);
    this.updateIcon(nextIndex); // newly-unlocked step's icon must flip ○ -> ● (found during Task 2 review)
  }

  private handleError(index: number): void {
    this.hasErrorByIndex[index] = true;
    this.updateIcon(index);
  }

  private updateIcon(index: number): void {
    const icon = this.rowEls[index].querySelector<HTMLElement>(".step-icon");
    if (icon) icon.textContent = this.iconFor(index);
  }

  private editStep(index: number): void {
    const previousActive = this.activeIndex;
    this.statuses[index] = "active";
    this.activeIndex = index;
    this.mountStep(index);
    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.updateIcon(index);
    if (previousActive !== index) {
      this.applyRowDisplay(this.rowEls[previousActive], previousActive, this.steps[previousActive]);
    }
  }
}
```

- [ ] **Step 5: Run the test file to verify it passes**

Run: `npx jest __tests__/components/step-flow.test.ts`
Expected: PASS (all tests green)

- [ ] **Step 6: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/client/types.ts src/client/components/step-flow.ts __tests__/components/step-flow.test.ts
git commit -m "Add Step/StepContext types and the StepFlow shell component"
```

---

## Task 3: `InputsStep`

**Files:**
- Create: `src/client/panels/guided/inputs-step.ts`
- Create: `__tests__/panels/guided/inputs-step.test.ts`

**Interfaces:**
- Consumes: `Step`, `StepContext` (Task 2); `TokenInput` (`src/client/components/token-input.ts`, existing); `prepRecipe` (`src/client/services.ts`, existing); `PrepColSpec`, `PromptColumnSpec` (`src/shared/types.ts`, existing).
- Produces (consumed by Task 6):
  - `export type InputRow = { kind: "column"; colTitle: string } | { kind: "drive-folder"; url: string; colTitle: string };`
  - `export interface InputsStepSavedState { rows: InputRow[]; }`
  - `export interface InputsStepResult { promptCols: PromptColumnSpec[]; }`
  - `export class InputsStep implements Step<InputsStepSavedState> { constructor(headers: string[]); getResult(): InputsStepResult | null; }`

- [ ] **Step 1: Write the failing test**

Create `__tests__/panels/guided/inputs-step.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */

jest.mock("../../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import { InputsStep } from "../../../src/client/panels/guided/inputs-step";
import * as services from "../../../src/client/services";
import type { StepContext } from "../../../src/client/types";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

function makeCtx(): StepContext & { onComplete: jest.Mock; onError: jest.Mock } {
  return { onComplete: jest.fn(), onError: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("InputsStep — column rows", () => {
  it("adding a column row and continuing calls onComplete with no RPC", async () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a", "col_b"]);
    const ctx = makeCtx();
    step.mount(container, ctx);

    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="col_a"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    expect(services.prepRecipe).not.toHaveBeenCalled();
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
    expect(step.getResult()?.promptCols).toEqual([{ col: "col_a", kind: "auto" }]);
  });

  it("removing a row before continuing excludes it", async () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a"]);
    const ctx = makeCtx();
    step.mount(container, ctx);

    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLButtonElement>(".guided-input-remove")!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    expect(step.getResult()?.promptCols).toEqual([]);
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("InputsStep — drive-folder rows", () => {
  it("assigns distinct auto-generated titles to multiple folder rows", () => {
    const container = makeContainer();
    const step = new InputsStep([]);
    step.mount(container, makeCtx());

    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();

    const urlInputs = container.querySelectorAll<HTMLInputElement>(".guided-input-folder-url");
    expect(urlInputs).toHaveLength(2);
  });

  it("calls prepRecipe with one PrepColSpec per folder row, then onComplete", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const container = makeContainer();
    const step = new InputsStep([]);
    const ctx = makeCtx();
    step.mount(container, ctx);

    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value =
      "https://drive.google.com/drive/folders/abc123";
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.prepRecipe).toHaveBeenCalledWith({
      cols: [
        {
          colTitle: "Drive Link",
          fillStrategy: { kind: "list-drive-folder", inputId: "driveFolder_0" },
        },
      ],
      inputValues: { driveFolder_0: "https://drive.google.com/drive/folders/abc123" },
    });
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
    expect(step.getResult()?.promptCols).toEqual([{ col: "Drive Link", kind: "auto" }]);
  });

  it("calls ctx.onError and alerts (does not call onComplete) when prepRecipe rejects", async () => {
    (services.prepRecipe as jest.Mock).mockRejectedValue(new Error("Drive down"));
    globalThis.alert = jest.fn();
    const container = makeContainer();
    const step = new InputsStep([]);
    const ctx = makeCtx();
    step.mount(container, ctx);

    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value = "https://drive.google.com/x";
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(ctx.onError).toHaveBeenCalledTimes(1);
    expect(ctx.onComplete).not.toHaveBeenCalled();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("Drive down"));
  });
});

describe("InputsStep — unmount/mount round trip", () => {
  it("unmount() returns rows and a summary; mount(savedState) restores them", () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a"]);
    step.mount(container, makeCtx());
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="col_a"]')!.click();

    const result = step.unmount();
    expect(result?.summary).toBe("col_a");
    expect(result?.savedState.rows).toEqual([{ kind: "column", colTitle: "col_a" }]);

    const step2 = new InputsStep(["col_a"]);
    step2.mount(container, makeCtx(), result?.savedState);
    expect(container.querySelectorAll(".guided-input-row")).toHaveLength(1);
  });

  it("unmount() before mount returns undefined", () => {
    const step = new InputsStep([]);
    expect(step.unmount()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/panels/guided/inputs-step.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `InputsStep`**

Create `src/client/panels/guided/inputs-step.ts`:

```ts
import type { Step, StepContext } from "../../types";
import type { PrepColSpec, PromptColumnSpec } from "../../../shared/types";
import { TokenInput } from "../../components/token-input";
import { prepRecipe } from "../../services";

export type InputRow =
  | { kind: "column"; colTitle: string }
  | { kind: "drive-folder"; url: string; colTitle: string };

export interface InputsStepSavedState {
  rows: InputRow[];
}

export interface InputsStepResult {
  promptCols: PromptColumnSpec[];
}

export class InputsStep implements Step<InputsStepSavedState> {
  readonly title = "Gather your inputs";
  readonly flavorText = "The content the AI works on, one row at a time.";

  private readonly headers: string[];
  private container: HTMLElement | null = null;
  private rows: Array<{ row: InputRow; el: HTMLElement; tokenInput?: TokenInput }> = [];
  private result: InputsStepResult | null = null;
  // Monotonic, never decremented on row removal — found during Task 3 review:
  // a count-based scheme (existingFolderCount + 1) reissues an already-used
  // title after a remove-then-add sequence (add A "Drive Link", add B "Drive
  // Link 2", remove A, add C -> count is 1 -> C also gets "Drive Link 2"),
  // silently colliding two PrepColSpecs onto one sheet column.
  private nextFolderNumber = 1;

  constructor(headers: string[]) {
    this.headers = headers;
  }

  getResult(): InputsStepResult | null {
    return this.result;
  }

  mount(container: HTMLElement, ctx: StepContext, savedState?: InputsStepSavedState): void {
    this.container = container;
    this.rows = [];
    container.innerHTML = `
      <div class="guided-input-rows"></div>
      <div class="guided-input-add-btns">
        <button type="button" class="btn-outline" id="gi-add-column">+ Column</button>
        <button type="button" class="btn-outline" id="gi-add-folder">+ Drive folder</button>
      </div>
      <button type="button" class="btn-run" id="gi-continue">Import &amp; Continue</button>
    `;
    for (const row of savedState?.rows ?? []) this.addRow(row);
    this.nextFolderNumber = this.computeNextFolderNumber();

    container.querySelector<HTMLButtonElement>("#gi-add-column")!.addEventListener("click", () => {
      this.addRow({ kind: "column", colTitle: "" });
    });
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.addEventListener("click", () => {
      this.addRow({ kind: "drive-folder", url: "", colTitle: this.nextFolderTitle() });
    });
    container.querySelector<HTMLButtonElement>("#gi-continue")!.addEventListener("click", () => {
      this.handleContinue(ctx);
    });
  }

  unmount(): { savedState: InputsStepSavedState; summary: string } | undefined {
    if (!this.container) return undefined;
    const rows = this.currentRows();
    const summary = rows.map((r) => r.colTitle).filter(Boolean).join(", ") || "No inputs selected";
    return { savedState: { rows }, summary };
  }

  /** Scans restored rows for the highest "Drive Link"(=1)/"Drive Link N" number
   * already in use, so freshly-added rows never collide with a restored title. */
  private computeNextFolderNumber(): number {
    let max = 0;
    for (const { row } of this.rows) {
      if (row.kind !== "drive-folder") continue;
      const match = /^Drive Link(?: (\d+))?$/.exec(row.colTitle);
      if (!match) continue;
      const num = match[1] ? parseInt(match[1], 10) : 1;
      max = Math.max(max, num);
    }
    return max + 1;
  }

  private nextFolderTitle(): string {
    const n = this.nextFolderNumber++;
    return n === 1 ? "Drive Link" : `Drive Link ${n}`;
  }

  private addRow(row: InputRow): void {
    const el = document.createElement("div");
    el.className = "guided-input-row";
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "guided-input-remove";
    removeBtn.textContent = "✕";

    let tokenInput: TokenInput | undefined;
    if (row.kind === "column") {
      const pickerWrap = document.createElement("div");
      pickerWrap.className = "guided-input-col-picker";
      tokenInput = new TokenInput(pickerWrap, this.headers, {
        multi: false,
        selected: row.colTitle ? [row.colTitle] : [],
      });
      el.appendChild(pickerWrap);
    } else {
      const input = document.createElement("input");
      input.type = "text";
      input.className = "guided-input-folder-url";
      input.placeholder = "Drive folder URL";
      input.value = row.url;
      el.appendChild(input);
    }
    el.appendChild(removeBtn);

    const entry = { row, el, tokenInput };
    removeBtn.addEventListener("click", () => {
      tokenInput?.destroy();
      el.remove();
      this.rows = this.rows.filter((r) => r !== entry);
    });

    this.rows.push(entry);
    this.container!.querySelector(".guided-input-rows")!.appendChild(el);
  }

  private currentRows(): InputRow[] {
    return this.rows.map(({ row, el, tokenInput }) => {
      if (row.kind === "column") {
        return { kind: "column" as const, colTitle: tokenInput?.getValue()[0] ?? "" };
      }
      const url = el.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value.trim();
      return { kind: "drive-folder" as const, url, colTitle: row.colTitle };
    });
  }

  private handleContinue(ctx: StepContext): void {
    const rows = this.currentRows().filter((r) => (r.kind === "column" ? r.colTitle !== "" : r.url !== ""));
    const folderRows = rows.filter(
      (r): r is { kind: "drive-folder"; url: string; colTitle: string } => r.kind === "drive-folder",
    );

    const finish = (): void => {
      this.result = { promptCols: rows.map((r) => ({ col: r.colTitle, kind: "auto" as const })) };
      ctx.onComplete();
    };

    if (folderRows.length === 0) {
      finish();
      return;
    }

    const cols: PrepColSpec[] = folderRows.map((r, i) => ({
      colTitle: r.colTitle,
      fillStrategy: { kind: "list-drive-folder", inputId: `driveFolder_${i}` },
    }));
    const inputValues: Record<string, string> = {};
    folderRows.forEach((r, i) => (inputValues[`driveFolder_${i}`] = r.url));

    prepRecipe({ cols, inputValues }).then(finish, (err: Error) => {
      globalThis.alert("Error importing Drive folder: " + err.message);
      ctx.onError();
    });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/panels/guided/inputs-step.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/client/panels/guided/inputs-step.ts __tests__/panels/guided/inputs-step.test.ts
git commit -m "Add InputsStep for Guided AI Inference"
```

---

## Task 4: `PromptStep`

**Files:**
- Create: `src/client/panels/guided/prompt-step.ts`
- Create: `__tests__/panels/guided/prompt-step.test.ts`

**Interfaces:**
- Consumes: `Step`, `StepContext` (Task 2); `prepRecipe` (existing).
- Produces (consumed by Task 6):
  - `export const SYSTEM_PROMPT_COLUMN_TITLE = "System Prompt";`
  - `export interface PromptStepSavedState { promptText: string; }`
  - `export interface PromptStepResult { systemPromptCol: string; }`
  - `export class PromptStep implements Step<PromptStepSavedState> { getResult(): PromptStepResult | null; }`

- [ ] **Step 1: Write the failing test**

Create `__tests__/panels/guided/prompt-step.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */

jest.mock("../../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import { PromptStep, SYSTEM_PROMPT_COLUMN_TITLE } from "../../../src/client/panels/guided/prompt-step";
import * as services from "../../../src/client/services";
import type { StepContext } from "../../../src/client/types";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

function makeCtx(): StepContext & { onComplete: jest.Mock; onError: jest.Mock } {
  return { onComplete: jest.fn(), onError: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.alert = jest.fn();
});

describe("PromptStep — required prompt", () => {
  it("alerts and does not call prepRecipe when the prompt is empty", () => {
    const container = makeContainer();
    const step = new PromptStep();
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("describe what the AI should do"));
    expect(services.prepRecipe).not.toHaveBeenCalled();
    expect(ctx.onComplete).not.toHaveBeenCalled();
  });

  it("alerts on whitespace-only input", () => {
    const container = makeContainer();
    const step = new PromptStep();
    step.mount(container, makeCtx());
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "   ";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    expect(globalThis.alert).toHaveBeenCalled();
    expect(services.prepRecipe).not.toHaveBeenCalled();
  });
});

describe("PromptStep — commit", () => {
  it("writes a single fill-value PrepColSpec and calls onComplete", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const container = makeContainer();
    const step = new PromptStep();
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "You are a helpful assistant.";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.prepRecipe).toHaveBeenCalledWith({
      cols: [
        {
          colTitle: SYSTEM_PROMPT_COLUMN_TITLE,
          fillStrategy: { kind: "fill-value", value: "You are a helpful assistant." },
        },
      ],
      inputValues: {},
    });
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
    expect(step.getResult()).toEqual({ systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE });
  });

  it("calls ctx.onError and alerts, not onComplete, when prepRecipe rejects", async () => {
    (services.prepRecipe as jest.Mock).mockRejectedValue(new Error("write failed"));
    const container = makeContainer();
    const step = new PromptStep();
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "Do something.";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(ctx.onError).toHaveBeenCalledTimes(1);
    expect(ctx.onComplete).not.toHaveBeenCalled();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("write failed"));
  });
});

describe("PromptStep — unmount/mount round trip", () => {
  it("unmount() truncates a long prompt to a 60-char summary with an ellipsis", () => {
    const container = makeContainer();
    const step = new PromptStep();
    step.mount(container, makeCtx());
    const long = "x".repeat(80);
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = long;
    const result = step.unmount();
    expect(result?.summary).toBe("x".repeat(60) + "…");
    expect(result?.savedState.promptText).toBe(long);
  });

  it("mount(savedState) restores the prompt text", () => {
    const container = makeContainer();
    const step = new PromptStep();
    step.mount(container, makeCtx(), { promptText: "restored text" });
    expect(container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value).toBe("restored text");
  });

  it("unmount() before mount returns undefined", () => {
    expect(new PromptStep().unmount()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/panels/guided/prompt-step.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `PromptStep`**

Create `src/client/panels/guided/prompt-step.ts`:

```ts
import type { Step, StepContext } from "../../types";
import { prepRecipe } from "../../services";

export const SYSTEM_PROMPT_COLUMN_TITLE = "System Prompt";

export interface PromptStepSavedState {
  promptText: string;
}

export interface PromptStepResult {
  systemPromptCol: string;
}

export class PromptStep implements Step<PromptStepSavedState> {
  readonly title = "Tell the AI what to do";
  readonly flavorText = "Set the AI's role and behavior — what it should do and how it should respond.";

  private textarea: HTMLTextAreaElement | null = null;
  private result: PromptStepResult | null = null;

  getResult(): PromptStepResult | null {
    return this.result;
  }

  mount(container: HTMLElement, ctx: StepContext, savedState?: PromptStepSavedState): void {
    container.innerHTML = `
      <textarea id="gp-prompt-text" class="guided-prompt-textarea"></textarea>
      <button type="button" class="btn-run" id="gp-continue">Import &amp; Continue</button>
    `;
    this.textarea = container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!;
    this.textarea.value = savedState?.promptText ?? "";

    container.querySelector<HTMLButtonElement>("#gp-continue")!.addEventListener("click", () => {
      this.handleContinue(ctx);
    });
  }

  unmount(): { savedState: PromptStepSavedState; summary: string } | undefined {
    if (!this.textarea) return undefined;
    const promptText = this.textarea.value;
    const summary = promptText.length > 60 ? promptText.slice(0, 60) + "…" : promptText;
    return { savedState: { promptText }, summary };
  }

  private handleContinue(ctx: StepContext): void {
    const promptText = this.textarea!.value.trim();
    if (!promptText) {
      globalThis.alert("Please describe what the AI should do.");
      return;
    }
    prepRecipe({
      cols: [{ colTitle: SYSTEM_PROMPT_COLUMN_TITLE, fillStrategy: { kind: "fill-value", value: promptText } }],
      inputValues: {},
    }).then(
      () => {
        this.result = { systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE };
        ctx.onComplete();
      },
      (err: Error) => {
        globalThis.alert("Error saving prompt: " + err.message);
        ctx.onError();
      },
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/panels/guided/prompt-step.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/client/panels/guided/prompt-step.ts __tests__/panels/guided/prompt-step.test.ts
git commit -m "Add PromptStep for Guided AI Inference"
```

---

## Task 5: `RunStep`

**Files:**
- Create: `src/client/panels/guided/run-step.ts`
- Create: `__tests__/panels/guided/run-step.test.ts`

**Interfaces:**
- Consumes: `Step`, `StepContext` (Task 2); `RunControls`, `PromptConfig`, `RunControlsSavedState` (Task 1).
- Produces (consumed by Task 6):
  - `export const GUIDED_OUTPUT_COLUMN_TITLE = "ai_output";`
  - `export interface RunStepSavedState { runControls?: RunControlsSavedState; }`
  - `export class RunStep implements Step<RunStepSavedState> { constructor(getPromptFields: () => Pick<RunConfig, "promptCols" | "systemPromptCol">, onSwitchToFreeform: (config: Partial<RunConfig>) => void); }`

- [ ] **Step 1: Write the failing test**

Create `__tests__/panels/guided/run-step.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */

jest.mock("../../../src/client/services", () => ({
  runBatchAI: jest.fn().mockResolvedValue(undefined),
  getActiveRangeInfo: jest.fn().mockResolvedValue({ start: 2, end: 11 }),
  getDefaultRowRange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../src/client/job-store", () => ({
  jobStore: {
    dispatch: jest.fn().mockImplementation((_id, _label, fn: Promise<void>) => fn),
    isCancelled: jest.fn().mockReturnValue(false),
    setProgress: jest.fn(),
  },
}));

import { RunStep, GUIDED_OUTPUT_COLUMN_TITLE } from "../../../src/client/panels/guided/run-step";
import * as services from "../../../src/client/services";
import type { StepContext } from "../../../src/client/types";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

function makeCtx(): StepContext & { onComplete: jest.Mock; onError: jest.Mock } {
  return { onComplete: jest.fn(), onError: jest.fn() };
}

describe("RunStep — mount and Run AI", () => {
  it("assembles promptCols/systemPromptCol from the host callback plus a fixed output column", async () => {
    const getPromptFields = jest.fn().mockReturnValue({
      promptCols: [{ col: "NoteCol", kind: "auto" as const }],
      systemPromptCol: "System Prompt",
    });
    const container = makeContainer();
    const step = new RunStep(getPromptFields, jest.fn());
    step.mount(container, makeCtx());
    await Promise.resolve();

    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCols: [{ col: "NoteCol", kind: "auto" }],
        systemPromptCol: "System Prompt",
        outputCol: GUIDED_OUTPUT_COLUMN_TITLE,
      }),
      expect.any(String),
    );
  });

  it("calls ctx.onComplete after a successful Run AI, not after Test", async () => {
    const ctx = makeCtx();
    const container = makeContainer();
    const step = new RunStep(() => ({ promptCols: [{ col: "a", kind: "auto" }] }), jest.fn());
    step.mount(container, ctx);
    await Promise.resolve();

    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ctx.onComplete).not.toHaveBeenCalled();

    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("RunStep — Switch to Freeform", () => {
  it("navigates with the current promptCols/systemPromptCol/outputCol plus live run-controls settings", async () => {
    const onSwitchToFreeform = jest.fn();
    const container = makeContainer();
    const step = new RunStep(
      () => ({ promptCols: [{ col: "a", kind: "auto" as const }], systemPromptCol: "System Prompt" }),
      onSwitchToFreeform,
    );
    step.mount(container, makeCtx());
    await Promise.resolve();

    container.querySelector<HTMLButtonElement>("#gr-switch-to-freeform")!.click();

    expect(onSwitchToFreeform).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCols: [{ col: "a", kind: "auto" }],
        systemPromptCol: "System Prompt",
        outputCol: GUIDED_OUTPUT_COLUMN_TITLE,
      }),
    );
  });
});

describe("RunStep — unmount/mount round trip", () => {
  it("unmount() returns RunControls' live state; mount(savedState) restores it", async () => {
    const container = makeContainer();
    const step = new RunStep(() => ({ promptCols: [] }), jest.fn());
    step.mount(container, makeCtx());
    await Promise.resolve();
    container.querySelector<HTMLElement>('[data-value="google_search"]')!.click();

    const result = step.unmount();
    expect(result?.savedState.runControls?.tools).toEqual(["google_search"]);

    const step2 = new RunStep(() => ({ promptCols: [] }), jest.fn());
    step2.mount(container, makeCtx(), result?.savedState);
    await Promise.resolve();
    expect(container.querySelector('[data-value="google_search"]')).toHaveClass("selected");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/panels/guided/run-step.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `RunStep`**

Create `src/client/panels/guided/run-step.ts`:

```ts
import type { Step, StepContext } from "../../types";
import type { RunConfig } from "../../../shared/types";
import { RunControls, type PromptConfig, type RunControlsSavedState } from "../../components/run-controls";

export const GUIDED_OUTPUT_COLUMN_TITLE = "ai_output";

export interface RunStepSavedState {
  runControls?: RunControlsSavedState;
}

/**
 * Terminal step. Never collapses — its flavorText is intentionally empty, since
 * the wireframe places no flavor line here (Model/Tools/row-range/Test/Run speak
 * for themselves). Test never calls ctx.onComplete(); only a successful full
 * Run AI does, and since this is always the last step in GuidedAIInferencePanel's
 * array, StepFlow only flips its checklist icon rather than collapsing it.
 */
export class RunStep implements Step<RunStepSavedState> {
  readonly title = "Run";
  readonly flavorText = "";

  private runControls: RunControls | null = null;

  constructor(
    private readonly getPromptFields: () => Pick<RunConfig, "promptCols" | "systemPromptCol">,
    private readonly onSwitchToFreeform: (config: Partial<RunConfig>) => void,
  ) {}

  mount(container: HTMLElement, ctx: StepContext, savedState?: RunStepSavedState): void {
    container.innerHTML = `
      <div id="gr-run-controls-mount"></div>
      <button type="button" id="gr-switch-to-freeform" class="link-btn">Switch to Freeform</button>
    `;
    this.runControls = new RunControls(container.querySelector("#gr-run-controls-mount")!, {
      getPromptConfig: (): PromptConfig => ({
        ...this.getPromptFields(),
        outputCol: GUIDED_OUTPUT_COLUMN_TITLE,
        wrapPromptsInTags: undefined,
        applyMarkdown: undefined,
      }),
      onRunSucceeded: () => ctx.onComplete(),
      savedState: savedState?.runControls,
    });
    container.querySelector<HTMLButtonElement>("#gr-switch-to-freeform")!.addEventListener("click", () => {
      this.onSwitchToFreeform({
        ...this.getPromptFields(),
        outputCol: GUIDED_OUTPUT_COLUMN_TITLE,
        ...this.runControls!.getValue(),
      });
    });
  }

  unmount(): { savedState: RunStepSavedState; summary: string } | undefined {
    if (!this.runControls) return undefined;
    return { savedState: { runControls: this.runControls.getValue() }, summary: "" };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/panels/guided/run-step.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/client/panels/guided/run-step.ts __tests__/panels/guided/run-step.test.ts
git commit -m "Add RunStep for Guided AI Inference"
```

---

## Task 6: `GuidedAIInferencePanel`

**Files:**
- Create: `src/client/panels/guided-ai-inference.ts`
- Create: `__tests__/panels/guided-ai-inference.test.ts`

**Interfaces:**
- Consumes: `StepFlow`, `StepFlowSavedState` (Task 2); `InputsStep` (Task 3); `PromptStep` (Task 4); `RunStep`, `GUIDED_OUTPUT_COLUMN_TITLE` (Task 5); `getSheetHeaders` (existing); `PanelLoader` (existing).
- Produces (consumed by Task 7):
  - `export class GuidedAIInferencePanel implements Panel<undefined, StepFlowSavedState>`

- [ ] **Step 1: Write the failing test**

Create `__tests__/panels/guided-ai-inference.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  prepRecipe: jest.fn(),
  runBatchAI: jest.fn().mockResolvedValue(undefined),
  getActiveRangeInfo: jest.fn().mockResolvedValue({ start: 2, end: 11 }),
  getDefaultRowRange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: {
    dispatch: jest.fn().mockImplementation((_id, _label, fn: Promise<void>) => fn),
    isCancelled: jest.fn().mockReturnValue(false),
    setProgress: jest.fn(),
  },
}));

import { GuidedAIInferencePanel } from "../../src/client/panels/guided-ai-inference";
import * as services from "../../src/client/services";
import type { NavigationContext } from "../../src/client/types";

const mockNav: NavigationContext = {
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(true),
};

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

async function mountAndLoad(headers = ["NoteCol", "OtherCol"]) {
  (services.getSheetHeaders as jest.Mock).mockResolvedValue(headers);
  const container = makeContainer();
  const panel = new GuidedAIInferencePanel();
  panel.mount(container, mockNav, undefined, undefined);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return { container, panel };
}

beforeEach(() => jest.clearAllMocks());

describe("GuidedAIInferencePanel — mount", () => {
  it("fetches headers and renders three steps, only the first active", async () => {
    const { container } = await mountAndLoad();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(1);
    const rows = container.querySelectorAll(".step-row");
    expect(rows).toHaveLength(3);
    const icons = container.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("●");
    expect(icons[1].textContent).toBe("○");
    expect(icons[2].textContent).toBe("○");
  });

  it("back-btn calls nav.back()", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#back-btn")!.click();
    expect(mockNav.back).toHaveBeenCalled();
  });
});

describe("GuidedAIInferencePanel — end-to-end step progression", () => {
  it("completing Step 1 and Step 2 unlocks Step 3, which assembles a RunConfig from both", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const { container } = await mountAndLoad();

    // Step 1: pick an existing column, continue.
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="NoteCol"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    // Step 2: write a prompt, continue.
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "Summarize this.";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    // Step 3 should now be mounted and interactive.
    expect(container.querySelector("#run-btn")).not.toBeNull();
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCols: [{ col: "NoteCol", kind: "auto" }],
        systemPromptCol: "System Prompt",
        outputCol: "ai_output",
      }),
      expect.any(String),
    );
    const icons = container.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("✓");
    expect(icons[1].textContent).toBe("✓");
    expect(icons[2].textContent).toBe("✓");
  });
});

describe("GuidedAIInferencePanel — persistence", () => {
  it("unmount() then mount(savedState) restores step progress", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="NoteCol"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    const saved = panel.unmount();
    expect(saved?.activeStepIndex).toBe(1);

    const container2 = makeContainer();
    const panel2 = new GuidedAIInferencePanel();
    panel2.mount(container2, mockNav, undefined, saved);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    const icons = container2.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("✓");
    expect(icons[1].textContent).toBe("●");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/panels/guided-ai-inference.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `GuidedAIInferencePanel`**

Create `src/client/panels/guided-ai-inference.ts`:

```ts
import type { NavigationContext, Panel, StepFlowSavedState } from "../types";
import type { RunConfig } from "../../shared/types";
import { StepFlow } from "../components/step-flow";
import { InputsStep } from "./guided/inputs-step";
import { PromptStep } from "./guided/prompt-step";
import { RunStep } from "./guided/run-step";
import { getSheetHeaders } from "../services";
import { PanelLoader } from "../components/panel-loader";

export class GuidedAIInferencePanel implements Panel<undefined, StepFlowSavedState> {
  private stepFlow: StepFlow | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    _params?: undefined,
    savedState?: StepFlowSavedState,
  ): void {
    container.innerHTML = this.template();
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());

    const loader = new PanelLoader(container);
    loader.setState({ status: "loading", message: "Loading columns..." });

    getSheetHeaders()
      .then((headers) => {
        const promptStep = new PromptStep();
        const inputsStep = new InputsStep(headers);
        const runStep = new RunStep(
          () => ({
            promptCols: inputsStep.getResult()?.promptCols ?? [],
            systemPromptCol: promptStep.getResult()?.systemPromptCol,
          }),
          (config: Partial<RunConfig>) => nav.navigate("configure-ai-run", config),
        );
        this.stepFlow = new StepFlow(
          container.querySelector("#steps-container")!,
          [inputsStep, promptStep, runStep],
          savedState,
        );
      })
      .finally(() => loader.setState({ status: "idle" }));
  }

  unmount(): StepFlowSavedState | undefined {
    return this.stepFlow?.getValue();
  }

  private template(): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">🧭 Guided AI Inference</span>
      </div>
      <p class="recipe-intro">Walk through each stage of Spreadsheet Inference.</p>
      <div id="panel-loader" class="panel-loader" hidden>
        <div class="panel-loader__bar-wrap" hidden>
          <div class="panel-loader__bar-fill"></div>
        </div>
        <div class="panel-loader__spinner" hidden></div>
        <p class="panel-loader__message"></p>
      </div>
      <div id="steps-container"></div>
    `;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest __tests__/panels/guided-ai-inference.test.ts`
Expected: PASS

- [ ] **Step 5: Run typecheck and the full suite**

Run: `npm run typecheck && npm test`
Expected: both PASS

- [ ] **Step 6: Commit**

```bash
git add src/client/panels/guided-ai-inference.ts __tests__/panels/guided-ai-inference.test.ts
git commit -m "Add GuidedAIInferencePanel composing the three Guided AI Inference steps"
```

---

## Task 7: Wiring — `PanelId`, `sidebar-entry.ts`, `tool-list.ts`

**Files:**
- Modify: `src/client/types.ts`
- Modify: `src/client/sidebar-entry.ts`
- Modify: `src/client/panels/tool-list.ts`
- Modify: `__tests__/panels/tool-list.test.ts`

**Interfaces:**
- Consumes: `GuidedAIInferencePanel` (Task 6).
- Produces: nothing consumed by later tasks — this is the final integration point.

- [ ] **Step 1: Add `"guided-ai-inference"` to `PanelId`**

In `src/client/types.ts`, update the `PanelId` union (currently at line 69-75):

```ts
export type PanelId =
  | "tool-list"
  | "guided-ai-inference"
  | "configure-ai-run"
  | "recipes-list"
  | "recipe"
  | "import-drive-links"
  | "extract-text";
```

- [ ] **Step 2: Write the failing `tool-list` test additions**

Read the current `__tests__/panels/tool-list.test.ts` first, then add these cases inside its existing top-level `describe` block (matching its existing style — check how the file mocks `services`/`jobStore` before adding):

```ts
it("btn-guided-ai navigates to guided-ai-inference", () => {
  const container = makeContainer();
  const panel = new ToolListPanel();
  panel.mount(container, mockNav);
  container.querySelector<HTMLButtonElement>("#btn-guided-ai")!.click();
  expect(mockNav.navigate).toHaveBeenCalledWith("guided-ai-inference");
});

it("renders Guided AI Inference, Freeform AI Inference, and Recipes first, in that order", () => {
  const container = makeContainer();
  const panel = new ToolListPanel();
  panel.mount(container, mockNav);
  const ids = Array.from(container.querySelectorAll(".tool-btn")).map((btn) => btn.id);
  expect(ids.slice(0, 3)).toEqual(["btn-guided-ai", "btn-run-ai", "btn-recipes"]);
});
```

(Adapt `makeContainer`/`mockNav` to whatever helpers the existing file already defines — do not duplicate them if they exist.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx jest __tests__/panels/tool-list.test.ts`
Expected: FAIL — `#btn-guided-ai` not found / order mismatch

- [ ] **Step 4: Update `tool-list.ts`**

In `src/client/panels/tool-list.ts`, update `wireEvents` to add the new handler, and `template` to add the button and reorder the "Main Tools" section:

```ts
private wireEvents(container: HTMLElement, nav: NavigationContext): void {
  container.querySelector("#btn-guided-ai")?.addEventListener("click", () => {
    nav.navigate("guided-ai-inference");
  });
  container.querySelector("#btn-run-ai")?.addEventListener("click", () => {
    nav.navigate("configure-ai-run");
  });
  container.querySelector("#btn-recipes")?.addEventListener("click", () => {
    nav.navigate("recipes-list");
  });
  container.querySelector("#btn-import-drive-links")?.addEventListener("click", () => {
    nav.navigate("import-drive-links");
  });
  container.querySelector("#btn-sample-rows")?.addEventListener("click", (e) => {
    this.dispatchTool(e as MouseEvent, "sampleRowsToEvaluation");
  });
  container.querySelector("#btn-extract-text")?.addEventListener("click", () => {
    nav.navigate("extract-text");
  });
  container.querySelector("#btn-format-markdown")?.addEventListener("click", () => {
    const btn = container.querySelector<HTMLButtonElement>("#btn-format-markdown")!;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="icon">📝</span> Formatting...';
    formatMarkdownSelection()
      .catch((err: Error) => globalThis.alert("Error: " + err.message))
      .finally(() => {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
      });
  });
}
```

And `template()`'s "Main Tools" section:

```ts
private template(): string {
  return `
    <div class="section">
      <h3>Main Tools</h3>
      <button id="btn-guided-ai" class="tool-btn">
        <span class="icon">🧭</span> Guided AI Inference
      </button>
      <button id="btn-run-ai" class="tool-btn">
        <span class="icon">▶️</span> Freeform AI Inference
      </button>
      <button id="btn-recipes" class="tool-btn">
        <span class="icon">🥞</span> Recipes
      </button>
    </div>
    <div class="section">
      <h3>Extras</h3>
      <button id="btn-import-drive-links" class="tool-btn">
        <span class="icon">📂</span> Import Drive Links
      </button>
      <button id="btn-sample-rows" class="tool-btn">
        <span class="icon">🎲</span> Sample Rows
      </button>
      <button id="btn-extract-text" class="tool-btn">
        <span class="icon">📜</span> Extract Text
      </button>
      <button id="btn-format-markdown" class="tool-btn">
        <span class="icon">📝</span> Format Markdown
      </button>
    </div>
    <div class="status-footer">
      <strong>SSI Tools v2.1</strong><br>
      Powered by Gemini 3.1 Flash Lite<br>
      Evaluation Unrestricted Mode
    </div>
  `;
}
```

Note: `#btn-run-ai`'s label changes from "Run AI Inference" to "Freeform AI Inference" — check the existing `tool-list.test.ts` for any assertion on that literal text and update it to match, since this is an intentional rename called for by the approved wireframe (Session 1), not an accidental behavior change.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx jest __tests__/panels/tool-list.test.ts`
Expected: PASS

- [ ] **Step 6: Register the panel in `sidebar-entry.ts`**

In `src/client/sidebar-entry.ts`, add the import and map entry:

```ts
import { Router } from "./router";
import { ToolListPanel } from "./panels/tool-list";
import { GuidedAIInferencePanel } from "./panels/guided-ai-inference";
import { ConfigureAIRunPanel } from "./panels/configure-ai-run";
import { RecipesListPanel } from "./panels/recipes-list";
import { RecipePanel } from "./panels/recipe";
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
    ["guided-ai-inference", new GuidedAIInferencePanel()],
    ["configure-ai-run", new ConfigureAIRunPanel()],
    ["recipes-list", new RecipesListPanel()],
    ["recipe", new RecipePanel()],
    ["import-drive-links", new ImportDriveLinksPanel()],
    ["extract-text", new ExtractTextPanel()],
  ]);

  const router = new Router(app, panels);
  router.start("tool-list");
}

init();
```

(`sidebar-entry.ts` is excluded from coverage per `CLAUDE.md` and has no dedicated test file — no test step here, matching the existing file's status quo.)

- [ ] **Step 7: Run the full suite, typecheck, lint, and format check**

Run: `npm run typecheck && npm run lint && npm run format:check && npm test`
Expected: all PASS

- [ ] **Step 8: Build to confirm the Rollup bundle succeeds**

Run: `npm run build`
Expected: succeeds, `dist/index.js` and `dist/Sidebar.html` produced with no errors

- [ ] **Step 9: Commit**

```bash
git add src/client/types.ts src/client/sidebar-entry.ts src/client/panels/tool-list.ts \
  __tests__/panels/tool-list.test.ts
git commit -m "Wire Guided AI Inference into the sidebar menu and router"
```

---

## Self-Review Notes

**Spec coverage:** `Step`/`StepContext` contract (Task 2), the `[Edit]` lifecycle and idempotent `onComplete` (Task 2), `onError`'s cosmetic-only behavior and its one clearing site (Task 2's `handleComplete`), all three concrete steps and their exact `prepRecipe` shapes (Tasks 3-4), the shared `RunControls` extraction (Task 1), panel persistence via `StepFlowSavedState` (Tasks 2 and 6), one-directional Guided→Freeform switching (Task 5), and menu/router wiring with the approved ordering (Task 7) are each covered by a task. The Session 2 server-architecture spec's flagged gap (file-size warning under-firing for `"auto"` kind) is fixed in Task 1 since that's the natural place it's touched.

**Type consistency checked:** `PromptConfig` (Task 1) is consumed identically by `ConfigureAIRunPanel.getPromptConfig()` (Task 1) and `RunStep`'s `getPromptConfig` (Task 5). `RunControlsSavedState` (Task 1) is the exact shape both `ConfigureAIRunPanel.unmount()`/`buildRunControlsSavedState()` and `RunStepSavedState.runControls` (Task 5) produce/consume. `Step<S>`/`StepContext` (Task 2) are implemented identically by `InputsStep`, `PromptStep`, and `RunStep` (Tasks 3-5) and consumed identically by `StepFlow` (Task 2) and `GuidedAIInferencePanel` (Task 6). `StepFlowSavedState` (Task 2) is both `StepFlow`'s own state and `GuidedAIInferencePanel`'s `Panel` `S` type (Task 6) — no separate wrapper type, since the panel has no state of its own beyond what `StepFlow` tracks.

**Known follow-up not in this plan:** per the spec, "Switch to Guided" from the freeform panel is explicitly out of scope, not deferred-and-forgotten.
