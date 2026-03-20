import type { NavigationContext, Panel } from "../types";
import type { ExtractTextConfig } from "../../shared/types";
import { SingleTagList } from "../components/single-tag-list";
import { RowRange } from "../components/row-range";
import { PanelLoader } from "../components/panel-loader";
import { getSheetHeaders, extractText } from "../services";
import { jobStore } from "../job-store";

type SavedState = {
  sourceCol: string;
  outputCol: string;
  startRow: number;
  endRow: number;
};

export class ExtractTextPanel implements Panel<undefined, SavedState> {
  private sourceColList: SingleTagList | null = null;
  private outputColList: SingleTagList | null = null;
  private rowRange: RowRange | null = null;
  private nav: NavigationContext | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    _params?: undefined,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    container.innerHTML = this.template();
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());

    const loader = new PanelLoader(container);

    const loadHeaders = (
      selectedSource?: string,
      selectedOutput?: string,
    ): Promise<void> => {
      loader.setState({ status: "loading", message: "Loading columns..." });
      return getSheetHeaders().then(
        (headers) => {
          this.sourceColList = new SingleTagList(
            container.querySelector("#source-col")!,
            headers,
            { selected: selectedSource },
          );
          this.outputColList = new SingleTagList(
            container.querySelector("#output-col")!,
            headers,
            {
              includeNew: true,
              selected: selectedOutput,
              newPlaceholder: "extracted_text",
              newDefault: "",
            },
          );
          container.querySelector<HTMLElement>("#config-form")!.style.display = "block";
          loader.setState({ status: "idle" });
        },
        (err: Error) => {
          globalThis.alert("Error loading headers: " + err.message);
          nav.back();
        },
      );
    };

    const savedRowRange =
      savedState?.startRow !== undefined && savedState?.endRow !== undefined
        ? { start: savedState.startRow, end: savedState.endRow }
        : undefined;

    this.rowRange = new RowRange(container.querySelector("#row-range")!, savedRowRange);

    container
      .querySelector<HTMLButtonElement>("#extract-btn")!
      .addEventListener("click", () => this.handleExtract());

    container.querySelector("#refresh-btn")?.addEventListener("click", () => {
      const btn = container.querySelector<HTMLButtonElement>("#refresh-btn")!;
      btn.classList.add("spinning");
      btn.disabled = true;
      loadHeaders(
        this.sourceColList?.getValue(),
        this.outputColList?.getValue(),
      ).finally(() => {
        btn.classList.remove("spinning");
        btn.disabled = false;
      });
    });

    loadHeaders(savedState?.sourceCol, savedState?.outputCol);
  }

  unmount(): SavedState {
    const range = this.rowRange?.getValue();
    return {
      sourceCol: this.sourceColList?.getValue() ?? "",
      outputCol: this.outputColList?.getValue() ?? "",
      startRow: range?.start ?? 2,
      endRow: range?.end ?? 2,
    };
  }

  private handleExtract(): void {
    const config = this.assembleConfig();
    if (!config) return;

    const jobId = `extract-text-${Date.now()}`;
    jobStore
      .dispatch(jobId, "Extract Text", extractText(config, jobId))
      .catch((err: Error) => globalThis.alert("Error: " + err.message));
  }

  private assembleConfig(): ExtractTextConfig | null {
    const sourceCol = this.sourceColList?.getValue() ?? "";
    if (!sourceCol) {
      globalThis.alert("Please select a source column.");
      return null;
    }

    const outputCol = this.outputColList?.getValue() ?? "";
    if (!outputCol) {
      globalThis.alert("Please select an output column.");
      return null;
    }

    const range = this.rowRange?.getValue();

    return {
      sourceCol,
      outputCol,
      rowRange: range ? { start: range.start, end: range.end } : { start: 2, end: 2 },
    };
  }

  private template(): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">📜 Extract Text</span>
        <button id="refresh-btn" class="refresh-btn" title="Refresh columns">↻</button>
      </div>
      <div id="panel-loader" class="panel-loader" hidden>
        <div class="panel-loader__bar-wrap" hidden>
          <div class="panel-loader__bar-fill"></div>
        </div>
        <div class="panel-loader__spinner" hidden></div>
        <p class="panel-loader__message"></p>
      </div>
      <div id="config-form" style="display:none">
        <div class="field-group">
          <span class="field-label">Source Column <span class="required">*</span></span>
          <div id="source-col" class="tag-list"></div>
        </div>
        <div class="field-group">
          <span class="field-label">Output Column <span class="required">*</span></span>
          <div id="output-col" class="tag-list"></div>
        </div>
        <div class="field-group">
          <span class="field-label">Row Range <span class="required">*</span></span>
          <div id="row-range"></div>
        </div>
        <div class="field-group helper-text">
          <p>Supported file types: Google Docs, PDFs, and images (JPEG, PNG, GIF, WebP, etc.)</p>
          <p>Google Docs are read directly. PDFs and images are processed using Google Drive's native OCR service.</p>
          <p>Output is truncated at 49,000 characters.</p>
        </div>
        <div class="panel-buttons">
          <button id="extract-btn" class="btn-run">Extract Text</button>
        </div>
      </div>
    `;
  }
}
