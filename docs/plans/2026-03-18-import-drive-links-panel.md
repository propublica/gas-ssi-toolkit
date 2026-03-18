# Import Drive Links Panel — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the legacy `ui.prompt()` dialog flow for Import Drive Links with a dedicated sidebar panel that collects folder URL, output column, and optional file type filters before running.

**Architecture:** New `ImportDriveLinksPanel` follows the `ConfigureAIRunPanel` pattern — `PanelLoader` covers `getSheetHeaders()`, `SingleTagList` with `includeNew` for output column, fixed `TagList` for file types. Server-side `importDriveLinks` is rewritten to accept a config object; old dialog-based implementation is deleted.

**Tech Stack:** TypeScript, Google Apps Script, Rollup IIFE, Jest/jsdom

**Worktree:** `.worktrees/import-drive-links-panel` (branch `feature/import-drive-links-panel`)

**Migration pattern note:** This is the first of three identical "Extra tool → dedicated panel" migrations. Sample Rows and Extract Text follow the same steps. Key things to preserve for those migrations:
- Each tool gets its own config interface in `src/shared/types.ts` (e.g. `SampleRowsConfig`, `ExtractTextConfig`)
- Each migration removes that tool's entry from the `runTool` TOOLS dispatcher in `index.ts`
- Once all three are migrated, `runTool` itself is dead code — delete the function, its GAS stub in `rollup.config.js`, and its declaration in `google.d.ts`
- `__tests__/panels/import-drive-links.test.ts` is the reference test pattern for the next two panel test files

---

### Task 1: Add `ImportDriveLinksConfig` to shared types

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add the interface**

At the bottom of `src/shared/types.ts`, add:

```ts
// ── Import Drive Links ───────────────────────────────────────────

export interface ImportDriveLinksConfig {
  folderUrl: string;
  outputCol: string;
  /** MIME type prefix strings. Absent = import all files. */
  mimeTypes?: string[];
}
```

**Step 2: Verify typecheck**

```bash
npm run typecheck
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add ImportDriveLinksConfig to shared types"
```

---

### Task 2: Update `getAllFilesRecursive` to support MIME filtering

**Files:**
- Modify: `src/server/utils.ts`

**Step 1: Write the failing test**

In `__tests__/utils.test.ts`, find the `getAllFilesRecursive` describe block and add:

```ts
it("filters by mimeType prefix when mimeTypePrefixes is provided", () => {
  const mockDoc = { getUrl: () => "doc-url", getMimeType: () => "application/vnd.google-apps.document" };
  const mockPdf = { getUrl: () => "pdf-url", getMimeType: () => "application/pdf" };
  const mockImg = { getUrl: () => "img-url", getMimeType: () => "image/png" };
  const files = makeIterator([mockDoc, mockPdf, mockImg]);
  const subfolders = makeIterator([]);
  const folder = { getFiles: () => files, getFolders: () => subfolders } as unknown as GoogleAppsScript.Drive.Folder;

  const result: DriveFileInfo[] = [];
  getAllFilesRecursive(folder, result, ["application/"]);
  expect(result.map((f) => f.url)).toEqual(["doc-url", "pdf-url"]);
});

it("imports all files when mimeTypePrefixes is absent", () => {
  const mockDoc = { getUrl: () => "doc-url", getMimeType: () => "application/vnd.google-apps.document" };
  const mockImg = { getUrl: () => "img-url", getMimeType: () => "image/png" };
  const files = makeIterator([mockDoc, mockImg]);
  const subfolders = makeIterator([]);
  const folder = { getFiles: () => files, getFolders: () => subfolders } as unknown as GoogleAppsScript.Drive.Folder;

  const result: DriveFileInfo[] = [];
  getAllFilesRecursive(folder, result);
  expect(result.map((f) => f.url)).toEqual(["doc-url", "img-url"]);
});
```

Note: the existing `makeIterator` helper and `DriveFileInfo` import are already in `utils.test.ts`. Also add `getMimeType` to the mock file objects used in existing tests if they don't have it (existing tests only call `getUrl`, so adding `getMimeType` to new test objects won't break them).

**Step 2: Run to confirm failure**

```bash
npx jest __tests__/utils.test.ts
```
Expected: FAIL — `getMimeType` not called / filter not applied.

**Step 3: Update `getAllFilesRecursive` signature and body**

In `src/server/utils.ts`, change:

```ts
export function getAllFilesRecursive(
  folder: GoogleAppsScript.Drive.Folder,
  fileList: DriveFileInfo[],
): void {
  const files = folder.getFiles();
  while (files.hasNext()) {
    fileList.push({ url: files.next().getUrl() });
  }
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    getAllFilesRecursive(subfolders.next(), fileList);
  }
}
```

To:

```ts
export function getAllFilesRecursive(
  folder: GoogleAppsScript.Drive.Folder,
  fileList: DriveFileInfo[],
  mimeTypePrefixes?: string[],
): void {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    const mime = file.getMimeType();
    if (!mimeTypePrefixes || mimeTypePrefixes.some((p) => mime.startsWith(p))) {
      fileList.push({ url: file.getUrl() });
    }
  }
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    getAllFilesRecursive(subfolders.next(), fileList, mimeTypePrefixes);
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/utils.test.ts
```
Expected: all pass.

**Step 5: Commit**

```bash
git add src/server/utils.ts __tests__/utils.test.ts
git commit -m "feat: add mimeType prefix filtering to getAllFilesRecursive"
```

---

### Task 3: Replace old `importDriveLinks` server function and clean up dispatcher

**Files:**
- Modify: `src/server/index.ts`
- Modify: `__tests__/menu.test.ts`

**Step 1: Update the test first**

In `__tests__/menu.test.ts`, the `runTool` describe block has:

```ts
it("dispatches 'importDriveLinks' without throwing", () => {
  // importDriveLinks calls ui.prompt() which is mocked to return CANCEL (early exit)
  expect(() => runTool("importDriveLinks")).not.toThrow();
});
```

Remove that test — `importDriveLinks` is no longer in the `runTool` dispatcher.

Then add a test for the new `importDriveLinks` function. At the top of `menu.test.ts`, the mocks for `DriveApp`, `SpreadsheetApp` etc. are already set up. Add a new describe block:

```ts
describe("importDriveLinks", () => {
  it("calls getAllFilesRecursive and writes results to the output column", () => {
    const mockFile = { getUrl: (): string => "https://drive.google.com/file/1" };
    const mockFiles = makeFileIterator([mockFile]);
    const mockSubfolders = makeFileIterator([]);
    const mockFolder = {
      getFiles: () => mockFiles,
      getFolders: () => mockSubfolders,
    };
    (globalThis as unknown as { DriveApp: unknown }).DriveApp = {
      getFolderById: jest.fn().mockReturnValue(mockFolder),
    };

    importDriveLinks({ folderUrl: "https://drive.google.com/drive/folders/abc123", outputCol: "source_drive" });

    expect(mockGetRange).toHaveBeenCalled();
    expect(mockSetValues).toHaveBeenCalledWith([["https://drive.google.com/file/1"]]);
  });
});
```

Note: look at existing test helpers in `menu.test.ts` (like `makeFileIterator` or equivalent) and adapt accordingly. The test just needs to verify the function calls Drive and writes output — not a precise integration test.

**Step 2: Run to confirm failure**

```bash
npx jest __tests__/menu.test.ts
```
Expected: FAIL — `importDriveLinks` still has the old signature.

**Step 3: Replace the server function**

In `src/server/index.ts`, replace the entire `importDriveLinks` function (lines 72–126) with:

```ts
export function importDriveLinks(config: ImportDriveLinksConfig, jobId?: string): void {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const folderId = extractId(config.folderUrl);

  if (jobId) {
    writeJobProgress(CacheService.getUserCache(), jobId, { message: "Scanning folder..." });
  }

  const parentFolder = DriveApp.getFolderById(folderId);
  const allFiles: DriveFileInfo[] = [];
  getAllFilesRecursive(parentFolder, allFiles, config.mimeTypes);

  const col = findOrCreateColumn(sheet, config.outputCol, SpreadsheetApp.WrapStrategy.CLIP);
  writeColumn(sheet, col, allFiles.map((f) => f.url));
}
```

Add the `ImportDriveLinksConfig` import at the top of the file:

```ts
import type { RunConfig, PrepRecipeParams, PrepRecipeResult, ImportDriveLinksConfig } from "../shared/types";
```

Also add the `DriveFileInfo` import if not already present (check existing imports from `./types`).

**Step 4: Remove `importDriveLinks` from `runTool` dispatcher**

In `src/server/index.ts`, the `runTool` function currently is:

```ts
export function runTool(functionName: string, jobId?: string): void {
  const TOOLS: Record<string, (jobId?: string) => void> = {
    importDriveLinks,
    extractTextFromSelection,
    sampleRowsToEvaluation,
  };
  TOOLS[functionName]?.(jobId);
}
```

Remove `importDriveLinks` from the TOOLS map:

```ts
export function runTool(functionName: string, jobId?: string): void {
  const TOOLS: Record<string, (jobId?: string) => void> = {
    extractTextFromSelection,
    sampleRowsToEvaluation,
  };
  TOOLS[functionName]?.(jobId);
}
```

**Step 5: Run tests**

```bash
npx jest __tests__/menu.test.ts
```
Expected: all pass.

**Step 6: Full test suite**

```bash
npm test
```
Expected: all pass.

**Step 7: Commit**

```bash
git add src/server/index.ts __tests__/menu.test.ts
git commit -m "feat: replace importDriveLinks with panel-driven config-based version"
```

---

### Task 4: Update rollup footer and `google.d.ts`

**Files:**
- Modify: `rollup.config.js`
- Modify: `src/client/google.d.ts`

**Step 1: Update rollup footer**

In `rollup.config.js`, the footer currently has:

```js
function importDriveLinks(jobId) { _GASEntry.importDriveLinks(jobId); }
```

Replace with:

```js
function importDriveLinks(config, jobId) { _GASEntry.importDriveLinks(config, jobId); }
```

**Step 2: Update `google.d.ts`**

In `src/client/google.d.ts`, add the import and declaration:

```ts
import type { RunConfig, PrepRecipeParams, ImportDriveLinksConfig } from "../shared/types";
```

And in the `GoogleScriptRun` interface, add:

```ts
importDriveLinks(config: ImportDriveLinksConfig, jobId?: string): void;
```

**Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

**Step 4: Commit**

```bash
git add rollup.config.js src/client/google.d.ts
git commit -m "feat: update rollup stub and google.d.ts for new importDriveLinks signature"
```

---

### Task 5: Add `importDriveLinks` service wrapper

**Files:**
- Modify: `src/client/services.ts`
- Modify: `__tests__/services.test.ts`

**Step 1: Write the failing test**

In `__tests__/services.test.ts`, add a new describe block:

```ts
describe("importDriveLinks", () => {
  it("calls google.script.run.importDriveLinks with config and jobId and resolves", async () => {
    const handlers = captureHandlers();
    const config = { folderUrl: "https://drive.google.com/drive/folders/abc", outputCol: "source_drive" };
    const promise = services.importDriveLinks(config, "job-1");
    handlers.resolve(undefined);
    await expect(promise).resolves.toBeUndefined();
    expect(mockRun.importDriveLinks).toHaveBeenCalledWith(config, "job-1");
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const config = { folderUrl: "https://drive.google.com/drive/folders/abc", outputCol: "source_drive" };
    const promise = services.importDriveLinks(config, "job-1");
    handlers.reject(new Error("drive error"));
    await expect(promise).rejects.toThrow("drive error");
  });
});
```

Also add `importDriveLinks: jest.fn()` to the `mockRun` object at the top of the file.

**Step 2: Run to confirm failure**

```bash
npx jest __tests__/services.test.ts
```
Expected: FAIL — `importDriveLinks` not in services.

**Step 3: Add the service function**

In `src/client/services.ts`, add:

```ts
import type { PrepRecipeParams, PrepRecipeResult, RunConfig, ImportDriveLinksConfig } from "../shared/types";

export function importDriveLinks(config: ImportDriveLinksConfig, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .importDriveLinks(config, jobId);
  });
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/services.test.ts
```
Expected: all pass.

**Step 5: Commit**

```bash
git add src/client/services.ts __tests__/services.test.ts
git commit -m "feat: add importDriveLinks service wrapper"
```

---

### Task 6: Register `import-drive-links` PanelId and create the panel

**Files:**
- Modify: `src/client/types.ts`
- Create: `src/client/panels/import-drive-links.ts`
- Create: `__tests__/panels/import-drive-links.test.ts`

**Step 1: Add PanelId**

In `src/client/types.ts`, update:

```ts
export type PanelId = "tool-list" | "configure-ai-run" | "recipes-list" | "recipe";
```

To:

```ts
export type PanelId = "tool-list" | "configure-ai-run" | "recipes-list" | "recipe" | "import-drive-links";
```

**Step 2: Write tests for the new panel**

Create `__tests__/panels/import-drive-links.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  importDriveLinks: jest.fn(),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));

import { ImportDriveLinksPanel } from "../../src/client/panels/import-drive-links";
import * as services from "../../src/client/services";
import * as jobStoreModule from "../../src/client/job-store";
import type { NavigationContext } from "../../src/client/types";

const mockNav: NavigationContext = {
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(true),
};

function mountPanel(savedState?: unknown): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const container = document.getElementById("app")!;
  const panel = new ImportDriveLinksPanel();
  panel.mount(container, mockNav, undefined, savedState as never);
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
  (jobStoreModule.jobStore.dispatch as jest.Mock).mockResolvedValue(undefined);
});

describe("ImportDriveLinksPanel", () => {
  it("shows a loader while headers are loading", () => {
    (services.getSheetHeaders as jest.Mock).mockReturnValue(new Promise(() => {}));
    const c = mountPanel();
    expect(c.querySelector("#panel-loader")).toBeTruthy();
    expect(c.querySelector<HTMLElement>("#config-form")!.style.display).toBe("none");
  });

  it("reveals form after headers load", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive", "ai_inference"]);
    const c = mountPanel();
    await Promise.resolve();
    expect(c.querySelector<HTMLElement>("#config-form")!.style.display).not.toBe("none");
  });

  it("back button calls nav.back()", () => {
    (services.getSheetHeaders as jest.Mock).mockReturnValue(new Promise(() => {}));
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#back-btn")!.click();
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("alerts when folder URL is empty and Import is clicked", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel();
    await Promise.resolve();
    c.querySelector<HTMLButtonElement>("#import-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("folder"));
  });

  it("dispatches importDriveLinks job when form is valid", async () => {
    const promise = Promise.resolve();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    (services.importDriveLinks as jest.Mock).mockReturnValue(promise);
    const c = mountPanel();
    await Promise.resolve();

    c.querySelector<HTMLInputElement>("#folder-url-input")!.value =
      "https://drive.google.com/drive/folders/abc123";
    // select the output column tag
    c.querySelector<HTMLElement>("#output-col .tag")?.click();

    c.querySelector<HTMLButtonElement>("#import-btn")!.click();
    expect(jobStoreModule.jobStore.dispatch).toHaveBeenCalledWith(
      expect.stringMatching(/^import-drive-links-\d+$/),
      "Import Drive Links",
      promise,
    );
  });

  it("unmount returns saved state with folder URL and mimeTypes", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel();
    await Promise.resolve();
    c.querySelector<HTMLInputElement>("#folder-url-input")!.value = "https://drive.google.com/drive/folders/xyz";
    const panel = new ImportDriveLinksPanel();
    panel.mount(c, mockNav);
    await Promise.resolve();
    c.querySelector<HTMLInputElement>("#folder-url-input")!.value = "https://drive.google.com/drive/folders/xyz";
    const state = panel.unmount();
    expect(state?.folderUrl).toBe("https://drive.google.com/drive/folders/xyz");
    expect(Array.isArray(state?.mimeTypes)).toBe(true);
  });

  it("restores saved folder URL on mount", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel({
      folderUrl: "https://drive.google.com/drive/folders/saved",
      outputCol: "",
      mimeTypes: [],
    });
    await Promise.resolve();
    expect(c.querySelector<HTMLInputElement>("#folder-url-input")!.value).toBe(
      "https://drive.google.com/drive/folders/saved",
    );
  });
});
```

**Step 3: Run to confirm failure**

```bash
npx jest __tests__/panels/import-drive-links.test.ts
```
Expected: FAIL — panel not yet created.

**Step 4: Create the panel**

Create `src/client/panels/import-drive-links.ts`:

```ts
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
        <span class="panel-title">📂 Import Drive Links</span>
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
```

**Step 5: Run tests**

```bash
npx jest __tests__/panels/import-drive-links.test.ts
```
Expected: all pass.

**Step 6: Commit**

```bash
git add src/client/types.ts src/client/panels/import-drive-links.ts __tests__/panels/import-drive-links.test.ts
git commit -m "feat: add ImportDriveLinksPanel"
```

---

### Task 7: Register panel in sidebar-entry and update ToolListPanel

**Files:**
- Modify: `src/client/sidebar-entry.ts`
- Modify: `src/client/panels/tool-list.ts`
- Modify: `__tests__/panels/tool-list.test.ts`

**Step 1: Update the ToolListPanel test first**

In `__tests__/panels/tool-list.test.ts`, replace the test:

```ts
it("clicking a tool button calls runTool with the function name and a jobId", () => {
  (services.runTool as jest.Mock).mockResolvedValue(undefined);
  const c = mountPanel();
  c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!.click();
  expect(services.runTool).toHaveBeenCalledWith(
    "importDriveLinks",
    expect.stringMatching(/^importDriveLinks-\d+$/),
  );
});
```

And the dispatch test for `importDriveLinks-\d+`:

```ts
it("clicking a tool button dispatches to jobStore with matching jobId, label, and promise", () => {
  const promise = Promise.resolve();
  (services.runTool as jest.Mock).mockReturnValue(promise);
  const c = mountPanel();
  const btn = c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!;
  btn.click();
  expect(jobStoreModule.jobStore.dispatch).toHaveBeenCalledWith(
    expect.stringMatching(/^importDriveLinks-\d+$/),
    expect.any(String),
    promise,
  );
});
```

Replace both with a single navigation test:

```ts
it("clicking Import Drive Links navigates to import-drive-links panel", () => {
  const c = mountPanel();
  c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!.click();
  expect(mockNav.navigate).toHaveBeenCalledWith("import-drive-links");
});
```

Also remove the `on runTool failure` test for `#btn-import-drive-links` (it tests the old dispatch path). Update the mock imports at the top — `runTool` can be removed from the mock if no other button tests use it; check first.

**Step 2: Run to confirm failure**

```bash
npx jest __tests__/panels/tool-list.test.ts
```
Expected: FAIL — button still dispatches instead of navigating.

**Step 3: Update `ToolListPanel`**

In `src/client/panels/tool-list.ts`, change the `btn-import-drive-links` handler from:

```ts
container.querySelector("#btn-import-drive-links")?.addEventListener("click", (e) => {
  this.dispatchTool(e as MouseEvent, "importDriveLinks");
});
```

To:

```ts
container.querySelector("#btn-import-drive-links")?.addEventListener("click", () => {
  nav.navigate("import-drive-links");
});
```

**Step 4: Run tests**

```bash
npx jest __tests__/panels/tool-list.test.ts
```
Expected: all pass.

**Step 5: Register panel in `sidebar-entry.ts`**

In `src/client/sidebar-entry.ts`, add:

```ts
import { ImportDriveLinksPanel } from "./panels/import-drive-links";
```

And in the panels Map:

```ts
["import-drive-links", new ImportDriveLinksPanel()],
```

**Step 6: Full test suite + typecheck + build**

```bash
npm test && npm run typecheck && npm run build
```
Expected: all pass, build succeeds.

**Step 7: Commit**

```bash
git add src/client/sidebar-entry.ts src/client/panels/tool-list.ts __tests__/panels/tool-list.test.ts
git commit -m "feat: wire ImportDriveLinksPanel into router and update ToolListPanel navigation"
```

---

### Task 8: Final verification

**Step 1: Full test suite with coverage**

```bash
npm run test:coverage
```
Expected: all thresholds pass.

**Step 2: Lint**

```bash
npm run lint
```
Expected: no errors.

**Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

**Step 4: Build**

```bash
npm run build
```
Expected: `dist/` generated without errors.
