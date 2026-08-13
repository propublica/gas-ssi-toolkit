import type { NavigationContext, Panel, TestRunDisplay } from "../types";
import type { RunConfig, ToolId, ModelId } from "../../shared/types";
import { TagList } from "../components/tag-list";
import { TokenInput } from "../components/token-input";
import { PromptColList } from "../components/prompt-col-list";
import { RowRange, sanitizeRowRange, type RowRangeValue } from "../components/row-range";
import { PanelLoader } from "../components/panel-loader";
import { getSheetHeaders, runBatchAI, getActiveRangeInfo, getDefaultRowRange } from "../services";
import { jobStore } from "../job-store";
import { TOOL_CATALOG } from "../tools";
import { MODEL_CATALOG } from "../models";
import { buildConfigSnapshot, configsMatch } from "../../shared/run-stats";
import { AsyncActionButton } from "../components/async-action-button";
import { formatDuration } from "../format";

export const CHUNK_SIZE = 40;

export function computeChunks(
  rowRange: { start: number; end: number },
  chunkSize: number,
): Array<{ start: number; end: number }> {
  const chunks: Array<{ start: number; end: number }> = [];
  for (let start = rowRange.start; start <= rowRange.end; start += chunkSize) {
    chunks.push({ start, end: Math.min(start + chunkSize - 1, rowRange.end) });
  }
  return chunks;
}

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
  private rowRangeComp: RowRange | null = null;
  private toolsList: TagList | null = null;
  private includeGroundingCb: HTMLInputElement | null = null;
  private applyMarkdownCb: HTMLInputElement | null = null;
  private wrapPromptsInTagsCb: HTMLInputElement | null = null;
  private outputColObserver: MutationObserver | null = null;
  private nav: NavigationContext | null = null;
  private headersLoaded = false;
  private toolsExpanded = false;
  private modelListEl: HTMLElement | null = null;
  private modelExpanded = false;
  private lastTest: TestRunDisplay | undefined = undefined;
  private testButton: AsyncActionButton | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    params?: Partial<RunConfig>,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.promptColList = null; // reset so unmount() guards correctly before load
    this.headersLoaded = false;
    this.lastTest = savedState?.lastTest;
    container.innerHTML = this.template();
    this.wireNavButtons(container);
    this.testButton = new AsyncActionButton(
      container.querySelector<HTMLButtonElement>("#test-btn")!,
      { idleLabel: "Test", loadingLabel: "Testing...", doneLabel: "Tested ✓" },
    );

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

    this.toolsList = new TagList(
      container.querySelector("#tools-list")!,
      TOOL_CATALOG.map((t) => ({ label: t.name, value: t.id })),
      preset.tools ?? [],
    );

    this.includeGroundingCb = container.querySelector<HTMLInputElement>("#include-grounding-cb");
    if (this.includeGroundingCb && preset.includeGrounding) {
      this.includeGroundingCb.checked = true;
    }

    this.applyMarkdownCb = container.querySelector<HTMLInputElement>("#apply-markdown-cb");
    if (this.applyMarkdownCb && preset.applyMarkdown) {
      this.applyMarkdownCb.checked = true;
    }

    this.wrapPromptsInTagsCb = container.querySelector<HTMLInputElement>(
      "#wrap-prompts-in-tags-cb",
    );
    if (this.wrapPromptsInTagsCb) {
      this.wrapPromptsInTagsCb.checked = preset.wrapPromptsInTags ?? true;
    }

    const updateGroundingVisibility = (): void => {
      const group = container.querySelector<HTMLElement>("#include-grounding-group");
      if (group) {
        group.style.display = (this.toolsList?.getValue().length ?? 0) > 0 ? "block" : "none";
      }
    };
    updateGroundingVisibility();
    container.querySelector("#tools-list")?.addEventListener("click", updateGroundingVisibility);

    // Restore and wire collapsible Tools section
    this.toolsExpanded = savedState?.toolsExpanded ?? false;
    this.applyToolsExpandState(container);
    container.querySelector("#tools-toggle")?.addEventListener("click", () => {
      this.toolsExpanded = !this.toolsExpanded;
      this.applyToolsExpandState(container);
    });

    const updateToolsSummary = (): void => {
      const summary = container.querySelector<HTMLElement>("#tools-summary");
      if (!summary) return;
      const selected = this.toolsList?.getValue() ?? [];
      if (selected.length === 0) {
        summary.textContent = "No tools selected";
      } else {
        const names = selected.map((id) => {
          const entry = TOOL_CATALOG.find((t) => t.id === id);
          return entry?.name ?? id;
        });
        summary.textContent = names.join(", ");
      }
    };
    updateToolsSummary();
    container.querySelector("#tools-list")?.addEventListener("click", updateToolsSummary);

    // Model selection
    const initialModel: ModelId = preset.model ?? "gemini-3.1-flash-lite";
    this.modelListEl = container.querySelector<HTMLElement>("#model-list");
    const modelButtons = this.modelListEl?.querySelectorAll<HTMLButtonElement>(".model-option");

    const updateModelSummary = (): void => {
      const entry = MODEL_CATALOG.find((m) => m.id === this.getSelectedModel());
      const summary = container.querySelector<HTMLElement>("#model-summary");
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
    this.applyModelExpandState(container);
    container.querySelector("#model-toggle")?.addEventListener("click", () => {
      this.modelExpanded = !this.modelExpanded;
      this.applyModelExpandState(container);
    });

    const loader = new PanelLoader(container);
    loader.setState({ status: "loading", message: "Loading columns..." });
    this.loadHeaders(container, preset).finally(() => loader.setState({ status: "idle" }));
  }

  private loadHeaders(container: HTMLElement, preset: Partial<RunConfig>): Promise<void> {
    this.outputColObserver?.disconnect();
    this.outputColObserver = null;
    this.promptColList?.destroy();
    this.promptColList = null;
    this.systemPromptList?.destroy();
    this.outputColList?.destroy();
    // #config-form now waits on both round trips, not just headers — getDefaultRowRange()
    // rejecting is caught above and never blocks the panel, but a slow (not failed) response
    // does add to render latency. Accepted: the server side is a single cheap getLastRow() call.
    return Promise.all([getSheetHeaders(), getDefaultRowRange().catch(() => undefined)]).then(
      ([headers, defaultRowRange]) => {
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
        this.systemPromptList = new TokenInput(
          container.querySelector("#system-prompt-col")!,
          headers,
          { multi: false, selected: preset.systemPromptCol ? [preset.systemPromptCol] : [] },
        );
        this.outputColList = new TokenInput(container.querySelector("#output-col")!, headers, {
          multi: false,
          includeNew: true,
          newDefault: "ai_",
          selected: preset.outputCol ? [preset.outputCol] : [],
        });
        this.rowRangeComp = new RowRange(container.querySelector("#row-range-container")!, {
          selected: preset.rowRange,
          fallback: defaultRowRange,
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
          container
            .querySelector<HTMLButtonElement>("#run-btn")!
            .addEventListener("click", () => this.handleRun(container));
          container
            .querySelector<HTMLButtonElement>("#test-btn")!
            .addEventListener("click", () => this.handleTest(container));
          this.headersLoaded = true;
        }

        this.checkTestStatsFreshness(container);
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
    return {
      promptCols,
      systemPromptCol: this.systemPromptList?.getValue()[0] ?? "",
      outputCol: this.outputColList?.getValue()[0] ?? "",
      rowRange: this.rowRangeComp?.getValue(),
      tools: (this.toolsList?.getValue() ?? []) as ToolId[],
      includeGrounding: this.includeGroundingCb?.checked ?? false,
      applyMarkdown: this.applyMarkdownCb?.checked ?? false,
      wrapPromptsInTags: this.wrapPromptsInTagsCb?.checked ?? true,
      toolsExpanded: this.toolsExpanded,
      model: this.getSelectedModel(),
      modelExpanded: this.modelExpanded,
      lastTest: this.lastTest,
    };
  }

  private applyToolsExpandState(container: HTMLElement): void {
    const content = container.querySelector<HTMLElement>("#tools-content");
    const toggle = container.querySelector<HTMLButtonElement>("#tools-toggle");
    if (content) content.hidden = !this.toolsExpanded;
    if (toggle) toggle.setAttribute("aria-expanded", String(this.toolsExpanded));
  }

  private applyModelExpandState(container: HTMLElement): void {
    const content = container.querySelector<HTMLElement>("#model-content");
    const toggle = container.querySelector<HTMLButtonElement>("#model-toggle");
    if (content) content.hidden = !this.modelExpanded;
    if (toggle) toggle.setAttribute("aria-expanded", String(this.modelExpanded));
  }

  private getSelectedModel(): ModelId {
    const selected = this.modelListEl?.querySelector<HTMLButtonElement>(".model-option.selected");
    return (selected?.getAttribute("data-value") as ModelId) ?? "gemini-3.1-flash-lite";
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
      this.loadHeaders(container, this.currentPreset()).finally(() => {
        btn.classList.remove("spinning");
        btn.disabled = false;
      });
    });
  }

  private currentPreset(): Partial<RunConfig> {
    return {
      promptCols: this.promptColList?.getValue() ?? [],
      systemPromptCol: this.systemPromptList?.getValue()[0] || undefined,
      outputCol: this.outputColList?.getValue()[0] || undefined,
      rowRange: this.rowRangeComp?.getValue(),
      tools: (this.toolsList?.getValue() ?? []) as ToolId[],
      includeGrounding: this.includeGroundingCb?.checked,
      applyMarkdown: this.applyMarkdownCb?.checked,
      wrapPromptsInTags: this.wrapPromptsInTagsCb?.checked,
      model: this.getSelectedModel(),
    };
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

  /**
   * Resolves the row range *before* deciding anything, so both input modes share one
   * dispatch path. The previous split — an explicit-rowRange branch plus a branch that
   * resolved the selection inside the dispatch callback — meant the pre-run warning could
   * only live in the first, and "Use highlighted rows" (the default) never warned at all.
   */
  private handleRun(_container: HTMLElement): void {
    const config = this.assembleRunConfig();
    if (!config) return;

    const resolveRange: Promise<RowRangeValue | undefined> = config.rowRange
      ? Promise.resolve(config.rowRange)
      : getActiveRangeInfo();

    resolveRange
      .then((range) => {
        if (!range) {
          // The old fallback dispatched runBatchAI with no rowRange here, but the server
          // resolves the active range the same way and returns null when there isn't one —
          // so that path was a silent no-op. Say so instead.
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
          .catch((err: Error) => {
            globalThis.alert("Error: " + err.message);
          });
      })
      .catch((err: Error) => {
        globalThis.alert("Error: " + err.message);
      });
    // NOTE: loadHeaders() is intentionally NOT called here.
    // Reloading after dispatch caused flicker and re-initialization mid-run.
  }

  /**
   * Warns before a run large enough to matter that has no test measurement behind it.
   * "Has a measurement" reuses the same snapshot comparison as checkTestStatsFreshness(),
   * so this dialog and the on-panel test results can never disagree about whether an
   * earlier test still applies — editing the config invalidates both.
   *
   * CHUNK_SIZE is the threshold rather than a dedicated constant: it already marks where
   * a run starts chunking and where the panel tells the user to keep the sidebar open.
   *
   * Returns false only when the user explicitly cancels.
   */
  private confirmUntestedRun(range: RowRangeValue): boolean {
    const rowCount = range.end - range.start + 1;
    if (rowCount <= CHUNK_SIZE) return true;
    if (
      this.lastTest &&
      configsMatch(buildConfigSnapshot(this.currentPreset()), this.lastTest.stats.config)
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
    chunks: Array<{ start: number; end: number }>,
  ): Promise<void> {
    const lastRow = chunks[chunks.length - 1].end;
    for (let i = 0; i < chunks.length; i++) {
      if (jobStore.isCancelled(jobId)) break;
      jobStore.setProgress(jobId, `Rows ${chunks[i].start}–${chunks[i].end} of ${lastRow}`);
      await runBatchAI({ ...config, rowRange: chunks[i] }, jobId);
    }
  }

  private handleTest(container: HTMLElement): void {
    const config = this.assembleRunConfig();
    if (!config) return;

    const jobId = `test-ai-${Date.now()}`;
    this.testButton?.setLoading();

    const resolveRange: Promise<{ start: number; end: number } | undefined> = config.rowRange
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
          this.renderTestStats(container, test);
          this.testButton?.setDone();
        } else {
          this.renderTestMessage(
            container,
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

  private renderTestStats(container: HTMLElement, test: TestRunDisplay): void {
    const el = container.querySelector<HTMLElement>("#test-results")!;
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

    if (stats.config.promptCols.some((pc) => pc.kind === "file")) {
      parts.push(`<p>⚠ Unusually large files may throw off cost and time estimates.</p>`);
    }

    el.innerHTML = parts.join("");
    el.hidden = false;
  }

  private renderTestMessage(container: HTMLElement, message: string): void {
    const el = container.querySelector<HTMLElement>("#test-results")!;
    el.innerHTML = `<p>${message}</p>`;
    el.hidden = false;
  }

  /**
   * Re-validates the displayed test results against the live config. Called after
   * every loadHeaders() resolution (initial mount AND refresh), not just the first
   * load — otherwise refreshing after an external sheet edit (e.g. a column
   * disappearing) could leave a stale "Tested ✓" display unvalidated indefinitely.
   * Skipped while a test is actively running: refresh isn't disabled during a
   * test, and re-checking against last completion's stats would incorrectly
   * clobber the in-flight loading state.
   */
  private checkTestStatsFreshness(container: HTMLElement): void {
    if (!this.lastTest || this.testButton?.getState() === "loading") return;
    const liveSnapshot = buildConfigSnapshot(this.currentPreset());
    if (configsMatch(liveSnapshot, this.lastTest.stats.config)) {
      this.renderTestStats(container, this.lastTest);
      this.testButton?.setDone();
    } else {
      this.renderTestMessage(
        container,
        "Configuration changed since last test — click Test to refresh.",
      );
      this.testButton?.setIdle();
    }
  }

  private assembleRunConfig(): RunConfig | null {
    const promptCols = this.promptColList?.getValue() ?? [];
    if (promptCols.length === 0) {
      globalThis.alert("Please select at least one User prompt column.");
      return null;
    }
    const systemPromptCol = this.systemPromptList?.getValue()[0] || undefined;
    const outputCol = this.outputColList?.getValue()[0] ?? "";
    if (!outputCol) {
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
    const applyMarkdown = this.applyMarkdownCb?.checked ?? false;
    const wrapPromptsInTags = this.wrapPromptsInTagsCb?.checked ?? true;
    const model = this.getSelectedModel();
    return {
      promptCols,
      systemPromptCol,
      outputCol,
      rowRange,
      tools: tools.length > 0 ? tools : undefined,
      includeGrounding: includeGrounding || undefined,
      applyMarkdown: applyMarkdown || undefined,
      wrapPromptsInTags: wrapPromptsInTags ? undefined : false,
      model,
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
    </div>
  `;
  }
}
