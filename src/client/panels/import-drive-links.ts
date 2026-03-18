import type { NavigationContext, Panel } from "../types";
import type { ImportDriveLinksConfig } from "../../shared/types";
import { SingleTagList } from "../components/single-tag-list";
import { TagList } from "../components/tag-list";
import { PanelLoader } from "../components/panel-loader";
import { getSheetHeaders, importDriveLinks } from "../services";
import { jobStore } from "../job-store";

type SavedState = {
  folderUrl: string;
  outputCol: string;
  mimeTypes: string[];
};

const MIME_TYPE_OPTIONS = [
  { label: "Google Docs", value: "application/vnd.google-apps.document" },
  { label: "Google Sheets", value: "application/vnd.google-apps.spreadsheet" },
  { label: "PDFs", value: "application/pdf" },
  { label: "Images", value: "image/" },
  { label: "Audio", value: "audio/" },
  { label: "Video", value: "video/" },
];

export class ImportDriveLinksPanel implements Panel<undefined, SavedState> {
  private folderUrlInput: HTMLInputElement | null = null;
  private outputColList: SingleTagList | null = null;
  private mimeTypeList: TagList | null = null;
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

    this.folderUrlInput = container.querySelector<HTMLInputElement>("#folder-url-input");
    if (savedState?.folderUrl && this.folderUrlInput) {
      this.folderUrlInput.value = savedState.folderUrl;
    }

    this.mimeTypeList = new TagList(
      container.querySelector("#mime-type-list")!,
      MIME_TYPE_OPTIONS,
      savedState?.mimeTypes ?? [],
    );

    const loader = new PanelLoader(container);
    loader.setState({ status: "loading", message: "Loading columns..." });

    getSheetHeaders().then(
      (headers) => {
        this.outputColList = new SingleTagList(
          container.querySelector("#output-col")!,
          headers,
          { includeNew: true, selected: savedState?.outputCol },
        );
        container.querySelector<HTMLElement>("#config-form")!.style.display = "block";
        container
          .querySelector<HTMLButtonElement>("#import-btn")!
          .addEventListener("click", () => this.handleImport());
        loader.setState({ status: "idle" });
      },
      (err: Error) => {
        globalThis.alert("Error loading headers: " + err.message);
        nav.back();
      },
    );
  }

  unmount(): SavedState {
    return {
      folderUrl: this.folderUrlInput?.value ?? "",
      outputCol: this.outputColList?.getValue() ?? "",
      mimeTypes: this.mimeTypeList?.getValue() ?? [],
    };
  }

  private handleImport(): void {
    const config = this.assembleConfig();
    if (!config) return;

    const jobId = `import-drive-links-${Date.now()}`;
    jobStore
      .dispatch(jobId, "Import Drive Links", importDriveLinks(config, jobId))
      .catch((err: Error) => globalThis.alert("Error: " + err.message));
  }

  private assembleConfig(): ImportDriveLinksConfig | null {
    const folderUrl = this.folderUrlInput?.value.trim() ?? "";
    if (!folderUrl) {
      globalThis.alert("Please enter a Google Drive folder link.");
      return null;
    }

    const outputCol = this.outputColList?.getValue() ?? "";
    if (!outputCol) {
      globalThis.alert("Please select an output column.");
      return null;
    }

    const mimeTypes = this.mimeTypeList?.getValue() ?? [];

    return {
      folderUrl,
      outputCol,
      mimeTypes: mimeTypes.length > 0 ? mimeTypes : undefined,
    };
  }

  private template(): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">Import Drive Links</span>
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
          <span class="field-label">Drive Folder <span class="required">*</span></span>
          <input id="folder-url-input" type="text" class="text-input"
            placeholder="Paste Google Drive folder URL or ID" />
        </div>
        <div class="field-group">
          <span class="field-label">Output Column <span class="required">*</span></span>
          <div id="output-col" class="tag-list"></div>
        </div>
        <div class="field-group">
          <span class="field-label">File Types <span class="optional">(optional)</span></span>
          <div id="mime-type-list" class="tag-list"></div>
        </div>
        <div class="panel-buttons">
          <button id="import-btn" class="btn-run">Import Links</button>
        </div>
      </div>
    `;
  }
}
