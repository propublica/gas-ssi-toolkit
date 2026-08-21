import type { NavigationContext, Panel, TestRunDisplay } from "../types";
import type { RunConfig, ToolId, ModelId } from "../../shared/types";
import { TokenInput } from "../components/token-input";
import { PromptColList } from "../components/prompt-col-list";
import { PanelLoader } from "../components/panel-loader";
import { getSheetHeaders } from "../services";
import {
  RunControls,
  type PromptConfig,
  type RunControlsSavedState,
} from "../components/run-controls";

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

    this.wrapPromptsInTagsCb = container.querySelector<HTMLInputElement>(
      "#wrap-prompts-in-tags-cb",
    );
    if (this.wrapPromptsInTagsCb) {
      this.wrapPromptsInTagsCb.checked = preset.wrapPromptsInTags ?? true;
    }

    this.runControls = new RunControls(container.querySelector("#run-controls-mount")!, {
      getPromptConfig: (): PromptConfig => this.getPromptConfig(),
      savedState: this.buildRunControlsSavedState(savedState, preset),
    });

    const loader = new PanelLoader(container);
    loader.setState({ status: "loading", message: "Loading columns..." });
    Promise.all([this.loadHeaders(container, preset), this.runControls.ready])
      .then(() => this.runControls?.checkTestStatsFreshness())
      .finally(() => loader.setState({ status: "idle" }));
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
    const promptCols = this.promptColList?.getValue() ?? [];
    const systemPromptCol = this.systemPromptList?.getValue()[0] || undefined;
    const outputCol = this.outputColList?.getValue()[0] ?? "";
    const wrapPromptsInTags = this.wrapPromptsInTagsCb?.checked ? undefined : false;
    const applyMarkdown = this.applyMarkdownCb?.checked || undefined;
    return {
      promptCols,
      systemPromptCol,
      outputCol,
      wrapPromptsInTags,
      applyMarkdown,
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
        this.systemPromptList = new TokenInput(
          container.querySelector("#system-prompt-col")!,
          headers,
          {
            multi: false,
            selected: preset.systemPromptCol ? [preset.systemPromptCol] : [],
          },
        );
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
        globalThis.alert("Couldn't load headers: " + err.message);
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
      ])
        .then(() => this.runControls?.checkTestStatsFreshness())
        .finally(() => {
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
      <span class="panel-title">▶️ Freeform AI Inference</span>
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
