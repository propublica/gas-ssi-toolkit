import type { NavigationContext, Panel } from "../types";
import type { RunConfig } from "../../shared/types";
import { TagList } from "../components/tag-list";
import { SingleTagList } from "../components/single-tag-list";
import { RowRange } from "../components/row-range";
import { getSheetHeaders, runBatchAI } from "../services";

export type SavedState = Required<Omit<RunConfig, "rowRange">> & Pick<RunConfig, "rowRange">;

export class ConfigureAIRunPanel implements Panel<Partial<RunConfig>, SavedState> {
  private userPromptList: TagList | null = null;
  private driveFileList: TagList | null = null;
  private systemPromptList: SingleTagList | null = null;
  private outputColList: SingleTagList | null = null;
  private rowRangeComp: RowRange | null = null;
  private nav: NavigationContext | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    params?: Partial<RunConfig>,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.userPromptList = null; // reset so unmount() guards correctly before load
    container.innerHTML = this.template();
    this.wireNavButtons(container);

    const preset: Partial<RunConfig> = savedState
      ? {
          userPromptCols: savedState.userPromptCols,
          driveFileCols: savedState.driveFileCols.length ? savedState.driveFileCols : undefined,
          systemPromptCol: savedState.systemPromptCol || undefined,
          outputCol: savedState.outputCol || undefined,
          rowRange: savedState.rowRange,
        }
      : (params ?? {});

    getSheetHeaders().then(
      (headers) => {
        if (headers.length === 0) {
          container.querySelector<HTMLElement>("#no-headers-msg")!.style.display = "block";
          return;
        }

        this.userPromptList = new TagList(
          container.querySelector("#user-prompt-cols")!,
          headers,
          preset.userPromptCols ?? [],
        );
        this.driveFileList = new TagList(
          container.querySelector("#drive-file-cols")!,
          headers,
          preset.driveFileCols ?? [],
        );
        this.systemPromptList = new SingleTagList(
          container.querySelector("#system-prompt-col")!,
          headers,
          { selected: preset.systemPromptCol },
        );
        this.outputColList = new SingleTagList(container.querySelector("#output-col")!, headers, {
          includeNew: true,
          selected: preset.outputCol,
        });
        this.rowRangeComp = new RowRange(
          container.querySelector("#row-range-container")!,
          preset.rowRange,
        );

        container.querySelector<HTMLElement>("#config-form")!.style.display = "block";
        container
          .querySelector<HTMLButtonElement>("#run-btn")!
          .addEventListener("click", () => this.handleRun(container));
      },
      (err: Error) => {
        globalThis.alert("Error loading headers: " + err.message);
        nav.back();
      },
    );
  }

  unmount(): SavedState | undefined {
    if (!this.userPromptList) return undefined;
    return {
      userPromptCols: this.userPromptList.getValue(),
      driveFileCols: this.driveFileList?.getValue() ?? [],
      systemPromptCol: this.systemPromptList?.getValue() ?? "",
      outputCol: this.outputColList?.getValue() ?? "",
      rowRange: this.rowRangeComp?.getValue(),
    };
  }

  private wireNavButtons(container: HTMLElement): void {
    container.querySelector("#back-btn")?.addEventListener("click", () => this.nav?.back());
    container.querySelector("#cancel-btn")?.addEventListener("click", () => this.nav?.back());
  }

  private handleRun(container: HTMLElement): void {
    const config = this.assembleRunConfig();
    if (!config) return;

    const btn = container.querySelector<HTMLButtonElement>("#run-btn")!;
    btn.disabled = true;
    btn.textContent = "Running...";

    runBatchAI(config).then(
      () => {
        btn.disabled = false;
        btn.textContent = "Run AI";
        this.nav?.back();
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        btn.disabled = false;
        btn.textContent = "Run AI";
      },
    );
  }

  private assembleRunConfig(): RunConfig | null {
    const userPromptCols = this.userPromptList?.getValue() ?? [];
    if (userPromptCols.length === 0) {
      globalThis.alert("Please select at least one User prompt column.");
      return null;
    }

    const driveFileCols = this.driveFileList?.getValue() ?? [];
    const systemPromptCol = this.systemPromptList?.getValue() || undefined;
    const outputCol = this.outputColList?.getValue() ?? "";

    if (!outputCol) {
      globalThis.alert("Please select an output column.");
      return null;
    }

    const rowRange = this.rowRangeComp?.getValue();

    return {
      userPromptCols,
      driveFileCols: driveFileCols.length > 0 ? driveFileCols : undefined,
      systemPromptCol,
      outputCol,
      rowRange,
    };
  }

  private template(): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">Configure AI Run</span>
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
        </div>
        <div class="field-group">
          <span class="field-label">Rows to process</span>
          <div id="row-range-container"></div>
        </div>
        <div class="panel-buttons">
          <button id="cancel-btn" class="btn-cancel">Cancel</button>
          <button id="run-btn" class="btn-run">Run AI</button>
        </div>
      </div>
    `;
  }
}
