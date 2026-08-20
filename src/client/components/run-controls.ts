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
      .then((defaultRowRange) =>
        this.wireRowRangeAndActions(defaultRowRange, config.savedState?.rowRange),
      );
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

  /** Re-validates displayed test results against the live config.
   * Called after headers/config changes to detect stale test measurements. */
  checkTestStatsFreshness(): void {
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

  /** Disables/enables Test and Run while a DIFFERENT step is mid-edit
   * (Guided AI Inference's terminal step is the only caller today).
   * Respects each button's own busy state on re-enable: Test won't be
   * force-enabled mid-request (AsyncActionButton.setInteractive() already
   * guards this); Run has no comparable busy state of its own (the job
   * strip communicates progress, not a disabled Run button), so it's a
   * plain flip. */
  setInteractive(enabled: boolean): void {
    const runBtn = this.container.querySelector<HTMLButtonElement>("#run-btn");
    if (runBtn) runBtn.disabled = !enabled;
    this.testButton?.setInteractive(enabled);
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

    this.includeGroundingCb =
      this.container.querySelector<HTMLInputElement>("#include-grounding-cb");
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
    this.container
      .querySelector("#tools-list")
      ?.addEventListener("click", updateGroundingVisibility);

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
    this.container
      .querySelector<HTMLButtonElement>("#run-btn")!
      .addEventListener("click", () => this.handleRun());
    this.container
      .querySelector<HTMLButtonElement>("#test-btn")!
      .addEventListener("click", () => this.handleTest());
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
            'No rows to process. Select the rows you want to run on, or use "Specify range" to enter one.',
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

  private async runChunks(
    jobId: string,
    config: RunConfig,
    chunks: RowRangeValue[],
  ): Promise<void> {
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
          return runBatchAI(
            { ...config, rowRange: { start: sanitized.start, end: cappedEnd } },
            jobId,
          ).then((stats) => (stats ? { stats, fullRowCount } : undefined));
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
