import type { NavigationContext, Panel } from "../types";
import type { RunConfig, ToolId, PromptColumnSpec } from "../../shared/types";
import { TagList } from "../components/tag-list";
import { SingleTagList } from "../components/single-tag-list";
import { RowRange } from "../components/row-range";
import { PanelLoader } from "../components/panel-loader";
import { getSheetHeaders, runBatchAI } from "../services";
import { jobStore } from "../job-store";
import { TOOL_CATALOG } from "../tools";

export const CHUNK_SIZE = 10;
// Warn before dispatch when the batch exceeds this many rows, regardless of chunk count.
// Kept separate from CHUNK_SIZE so small multi-chunk runs don't trigger the dialog.
export const CHUNK_WARN_THRESHOLD = 50;

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
  Omit<RunConfig, "rowRange" | "tools" | "includeGrounding" | "applyMarkdown">
> &
  Pick<RunConfig, "rowRange" | "tools" | "includeGrounding" | "applyMarkdown">;

export class ConfigureAIRunPanel implements Panel<Partial<RunConfig>, SavedState> {
  private userPromptList: TagList | null = null;
  private driveFileList: TagList | null = null;
  private systemPromptList: SingleTagList | null = null;
  private outputColList: SingleTagList | null = null;
  private rowRangeComp: RowRange | null = null;
  private toolsList: TagList | null = null;
  private includeGroundingCb: HTMLInputElement | null = null;
  private applyMarkdownCb: HTMLInputElement | null = null;
  private nav: NavigationContext | null = null;
  private headersLoaded = false;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    params?: Partial<RunConfig>,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.userPromptList = null; // reset so unmount() guards correctly before load
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

    const updateGroundingVisibility = (): void => {
      const group = container.querySelector<HTMLElement>("#include-grounding-group");
      if (group) {
        group.style.display = (this.toolsList?.getValue().length ?? 0) > 0 ? "block" : "none";
      }
    };
    updateGroundingVisibility();
    container.querySelector("#tools-list")?.addEventListener("click", updateGroundingVisibility);

    const loader = new PanelLoader(container);
    loader.setState({ status: "loading", message: "Loading columns..." });
    this.loadHeaders(container, preset).finally(() => loader.setState({ status: "idle" }));
  }

  private loadHeaders(container: HTMLElement, preset: Partial<RunConfig>): Promise<void> {
    return getSheetHeaders().then(
      (headers) => {
        if (headers.length === 0) {
          container.querySelector<HTMLElement>("#no-headers-msg")!.style.display = "block";
          return;
        }

        const presetTextCols =
          preset.promptCols?.filter((p) => p.kind === "text").map((p) => p.col) ?? [];
        const presetFileCols =
          preset.promptCols?.filter((p) => p.kind === "file").map((p) => p.col) ?? [];
        this.userPromptList = new TagList(
          container.querySelector("#user-prompt-cols")!,
          headers,
          presetTextCols,
        );
        this.driveFileList = new TagList(
          container.querySelector("#drive-file-cols")!,
          headers,
          presetFileCols,
        );
        this.systemPromptList = new SingleTagList(
          container.querySelector("#system-prompt-col")!,
          headers,
          { selected: preset.systemPromptCol },
        );
        this.outputColList = new SingleTagList(container.querySelector("#output-col")!, headers, {
          includeNew: true,
          selected: preset.outputCol,
          newPlaceholder: "ai_column_name",
          newDefault: "ai_",
        });
        this.rowRangeComp = new RowRange(
          container.querySelector("#row-range-container")!,
          preset.rowRange,
        );

        const updateGroundingLabel = (): void => {
          const val = this.outputColList?.getValue() ?? "";
          const label = container.querySelector<HTMLElement>("#grounding-col-name");
          if (label) label.textContent = val ? `${val}_grounding` : "_grounding";
        };
        updateGroundingLabel();
        container.querySelector("#output-col")?.addEventListener("click", updateGroundingLabel);
        container
          .querySelector("#output-col input")
          ?.addEventListener("input", updateGroundingLabel);

        if (!this.headersLoaded) {
          container.querySelector<HTMLElement>("#config-form")!.style.display = "block";
          container
            .querySelector<HTMLButtonElement>("#run-btn")!
            .addEventListener("click", () => this.handleRun(container));
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
    if (!this.userPromptList) return undefined;
    return {
      promptCols: [
        ...this.userPromptList.getValue().map((col) => ({ col, kind: "text" as const })),
        ...(this.driveFileList?.getValue() ?? []).map((col) => ({ col, kind: "file" as const })),
      ],
      systemPromptCol: this.systemPromptList?.getValue() ?? "",
      outputCol: this.outputColList?.getValue() ?? "",
      rowRange: this.rowRangeComp?.getValue(),
      tools: (this.toolsList?.getValue() ?? []) as ToolId[],
      includeGrounding: this.includeGroundingCb?.checked ?? false,
      applyMarkdown: this.applyMarkdownCb?.checked ?? false,
    };
  }

  private wireNavButtons(container: HTMLElement): void {
    container.querySelector("#back-btn")?.addEventListener("click", () => this.nav?.back());
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
    const textCols = this.userPromptList?.getValue() ?? [];
    const fileCols = this.driveFileList?.getValue() ?? [];
    return {
      promptCols: [
        ...textCols.map((col) => ({ col, kind: "text" as const })),
        ...fileCols.map((col) => ({ col, kind: "file" as const })),
      ],
      systemPromptCol: this.systemPromptList?.getValue() || undefined,
      outputCol: this.outputColList?.getValue() || undefined,
      rowRange: this.rowRangeComp?.getValue(),
      tools: (this.toolsList?.getValue() ?? []) as ToolId[],
      includeGrounding: this.includeGroundingCb?.checked,
      applyMarkdown: this.applyMarkdownCb?.checked,
    };
  }

  private handleRun(container: HTMLElement): void {
    const config = this.assembleRunConfig();
    if (!config) return;

    const jobId = `batch-ai-${Date.now()}`;

    if (config.rowRange) {
      const rowCount = config.rowRange.end - config.rowRange.start + 1;
      if (rowCount > CHUNK_WARN_THRESHOLD) {
        const chunkCount = Math.ceil(rowCount / CHUNK_SIZE);
        const estimatedMins = Math.ceil((rowCount * 5) / 60);
        const ok = globalThis.confirm(
          `You're about to process ${rowCount} rows across ${chunkCount} chunks.\n\n` +
            `This will take roughly ${estimatedMins} minutes. ` +
            `The sidebar must remain open throughout — closing it will stop the run after the current chunk finishes.\n\n` +
            `Continue?`,
        );
        if (!ok) return;
      }
    }

    if (config.rowRange) {
      const chunks = computeChunks(config.rowRange, CHUNK_SIZE);
      jobStore
        .dispatch(
          jobId,
          "Batch AI Run",
          (async () => {
            const lastRow = chunks[chunks.length - 1].end;
            for (let i = 0; i < chunks.length; i++) {
              if (jobStore.isCancelled(jobId)) break;
              jobStore.setProgress(jobId, `Rows ${chunks[i].start}–${chunks[i].end} of ${lastRow}`);
              await runBatchAI({ ...config, rowRange: chunks[i] }, jobId);
            }
          })(),
        )
        .catch((err: Error) => {
          globalThis.alert("Error: " + err.message);
        });
    } else {
      // No explicit row range — active sheet selection, resolved server-side.
      // Fall back to single dispatch (no chunking, no warning).
      jobStore.dispatch(jobId, "Batch AI Run", runBatchAI(config, jobId)).catch((err: Error) => {
        globalThis.alert("Error: " + err.message);
      });
    }

    this.loadHeaders(container, this.currentPreset());
  }

  private assembleRunConfig(): RunConfig | null {
    const textCols = this.userPromptList?.getValue() ?? [];
    if (textCols.length === 0) {
      globalThis.alert("Please select at least one User prompt column.");
      return null;
    }
    const fileCols = this.driveFileList?.getValue() ?? [];
    const promptCols: PromptColumnSpec[] = [
      ...textCols.map((col) => ({ col, kind: "text" as const })),
      ...fileCols.map((col) => ({ col, kind: "file" as const })),
    ];
    const systemPromptCol = this.systemPromptList?.getValue() || undefined;
    const outputCol = this.outputColList?.getValue() ?? "";
    if (!outputCol) {
      globalThis.alert("Please select an output column.");
      return null;
    }
    const rowRange = this.rowRangeComp?.getValue();
    const tools = (this.toolsList?.getValue() ?? []) as ToolId[];
    const includeGrounding = this.includeGroundingCb?.checked ?? false;
    const applyMarkdown = this.applyMarkdownCb?.checked ?? false;
    return {
      promptCols,
      systemPromptCol,
      outputCol,
      rowRange,
      tools: tools.length > 0 ? tools : undefined,
      includeGrounding: includeGrounding || undefined,
      applyMarkdown: applyMarkdown || undefined,
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
        No columns found — add headers to your sheet first.
      </div>
      <div id="config-form" style="display:none">
        <div class="field-group">
          <span class="field-label">User prompt columns <span class="required">*</span></span>
          <div id="user-prompt-cols" class="tag-list"></div>
        </div>
        <div class="field-group">
          <span class="field-label">Drive file columns <span class="optional">(optional)</span></span>
          <div id="drive-file-cols" class="tag-list"></div>
        </div>
        <div class="field-group">
          <span class="field-label">System prompt column <span class="optional">(optional)</span></span>
          <div id="system-prompt-col" class="tag-list"></div>
        </div>
        <div class="field-group">
          <span class="field-label">Output column <span class="required">*</span></span>
          <div id="output-col" class="tag-list"></div>
          <label class="checkbox-option">
            <input type="checkbox" id="apply-markdown-cb" />
            <span>Apply markdown formatting</span>
          </label>
        </div>
        <div class="field-group">
          <span class="field-label">Tools <span class="optional">(optional)</span></span>
          <div id="tools-list" class="tag-list"></div>
          <div id="include-grounding-group" style="display:none">
            <label class="checkbox-option">
              <input type="checkbox" id="include-grounding-cb" />
              <span>Include grounding column <span class="grounding-col-badge" id="grounding-col-name">_grounding</span></span>
            </label>
          </div>
        </div>
        <div class="field-group">
          <span class="field-label">Rows to process</span>
          <div id="row-range-container"></div>
        </div>
        <div class="panel-buttons">
          <button id="run-btn" class="btn-run">Run AI</button>
        </div>
      </div>
    `;
  }
}
