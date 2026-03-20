# Extract Text Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate the Extract Text tool from a dispatch-based selection flow into a dedicated sidebar panel with source column, output column, and row range inputs.

**Architecture:** Add `ExtractTextConfig` to `shared/types.ts` as the RPC boundary type. Replace `extractTextFromSelection` in `index.ts` with `extractText(config, jobId)` that reads from a named column instead of the active range. Create `ExtractTextPanel` following the `ImportDriveLinksPanel` pattern exactly.

**Tech Stack:** TypeScript, Google Apps Script, Jest/jsdom for client tests, existing `SingleTagList`, `RowRange`, and `PanelLoader` components.

---

### Task 1: Add `ExtractTextConfig` to shared types

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Add the interface**

Append to the end of `src/shared/types.ts`:

```ts
// ── Extract Text ─────────────────────────────────────────────────

export interface ExtractTextConfig {
  sourceCol: string;
  outputCol: string;
  startRow: number;
  endRow: number;
}
```

**Step 2: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors.

**Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add ExtractTextConfig to shared types"
```

---

### Task 2: Replace server function `extractTextFromSelection` with `extractText`

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/server/drive.ts` (comment only)
- Modify: `rollup.config.js`

**Step 1: Update the server function in `index.ts`**

Replace the entire `extractTextFromSelection` function (lines 107–152) with:

```ts
export function extractText(config: ExtractTextConfig, jobId?: string): void {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (!checkDriveService(SpreadsheetApp.getUi())) return;

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0] as string[];
  const sourceColIdx = headers.indexOf(config.sourceCol);

  if (sourceColIdx === -1) {
    throw new Error(`Column "${config.sourceCol}" not found`);
  }

  const outputCol = findOrCreateColumn(
    sheet,
    config.outputCol,
    SpreadsheetApp.WrapStrategy.WRAP,
  );

  const total = config.endRow - config.startRow + 1;

  for (let i = 0; i < total; i++) {
    const rowIdx = config.startRow + i; // 1-based data row (row 1 = header)

    if (jobId) {
      writeJobProgress(CacheService.getUserCache(), jobId, {
        message: `Extracting row ${i + 1} of ${total}...`,
        current: i + 1,
        total,
      });
    }

    const cellValue = sheet
      .getRange(rowIdx + 1, sourceColIdx + 1)
      .getValue() as string;

    if (!isValidDriveLink(cellValue)) {
      continue;
    }

    const fileId = extractId(cellValue);
    const text = truncateText(extractTextUniversal(fileId), 49000);
    sheet.getRange(rowIdx + 1, outputCol).setValue(text);
    SpreadsheetApp.flush();
  }
}
```

Also add `ExtractTextConfig` to the imports at the top of `index.ts`. Find the line that imports from `"../shared/types"` and add `ExtractTextConfig` to it.

**Step 2: Remove `extractTextFromSelection` from the `runTool` dispatcher**

Find the `runTool` function (~line 388). Change:

```ts
const TOOLS: Record<string, (jobId?: string) => void> = {
  extractTextFromSelection,
  sampleRowsToEvaluation,
};
```

to:

```ts
const TOOLS: Record<string, (jobId?: string) => void> = {
  sampleRowsToEvaluation,
};
```

**Step 3: Add file size comment to `drive.ts`**

In `src/server/drive.ts`, find the line:

```ts
const tempFile = Drive.Files.create(resource, file.getBlob());
```

Add a comment directly above it:

```ts
// TODO: enforce a max file size here if needed before calling the Drive API
// e.g. if (file.getBlob().getBytes().length > MAX_BYTES) return "[Skipped: File too large]";
const tempFile = Drive.Files.create(resource, file.getBlob());
```

**Step 4: Update `rollup.config.js` footer stub**

Find:

```js
function extractTextFromSelection(jobId) { _GASEntry.extractTextFromSelection(jobId); }
```

Replace with:

```js
function extractText(config, jobId) { _GASEntry.extractText(config, jobId); }
```

**Step 5: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors.

**Step 6: Commit**

```bash
git add src/server/index.ts src/server/drive.ts rollup.config.js
git commit -m "feat: replace extractTextFromSelection with config-driven extractText"
```

---

### Task 3: Add `extract-text` to client PanelId and `google.d.ts`

**Files:**
- Modify: `src/client/types.ts`
- Modify: `src/client/google.d.ts`

**Step 1: Add `"extract-text"` to `PanelId`**

In `src/client/types.ts`, find:

```ts
export type PanelId =
  | "tool-list"
  | "configure-ai-run"
  | "recipes-list"
  | "recipe"
  | "import-drive-links";
```

Replace with:

```ts
export type PanelId =
  | "tool-list"
  | "configure-ai-run"
  | "recipes-list"
  | "recipe"
  | "import-drive-links"
  | "extract-text";
```

**Step 2: Add `extractText` to `google.d.ts`**

In `src/client/google.d.ts`, find:

```ts
import type { RunConfig, PrepRecipeParams, ImportDriveLinksConfig } from "../shared/types";
```

Replace with:

```ts
import type { RunConfig, PrepRecipeParams, ImportDriveLinksConfig, ExtractTextConfig } from "../shared/types";
```

Then inside the `GoogleScriptRun` interface, add after the `importDriveLinks` line:

```ts
extractText(config: ExtractTextConfig, jobId?: string): void;
```

**Step 3: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/client/types.ts src/client/google.d.ts
git commit -m "feat: register extract-text PanelId and google.d.ts declaration"
```

---

### Task 4: Add `extractText` service wrapper

**Files:**
- Modify: `src/client/services.ts`

**Step 1: Add the import**

In `src/client/services.ts`, find:

```ts
import type {
  ImportDriveLinksConfig,
  PrepRecipeParams,
  PrepRecipeResult,
  RunConfig,
} from "../shared/types";
```

Add `ExtractTextConfig` to the import list.

**Step 2: Add the service function**

Append after the `importDriveLinks` function:

```ts
export function extractText(config: ExtractTextConfig, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .extractText(config, jobId);
  });
}
```

**Step 3: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors.

**Step 4: Commit**

```bash
git add src/client/services.ts
git commit -m "feat: add extractText service wrapper"
```

---

### Task 5: Write failing tests for `ExtractTextPanel`

**Files:**
- Create: `__tests__/panels/extract-text.test.ts`

**Step 1: Write the test file**

```ts
/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  extractText: jest.fn(),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));

import { ExtractTextPanel } from "../../src/client/panels/extract-text";
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
  const panel = new ExtractTextPanel();
  panel.mount(container, mockNav, undefined, savedState as never);
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
  (jobStoreModule.jobStore.dispatch as jest.Mock).mockResolvedValue(undefined);
});

describe("ExtractTextPanel", () => {
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

  it("alerts when source column is not selected and Extract is clicked", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel();
    await Promise.resolve();
    c.querySelector<HTMLButtonElement>("#extract-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("source column"));
  });

  it("alerts when output column is not selected and Extract is clicked", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel();
    await Promise.resolve();
    // select source column but not output
    c.querySelector<HTMLElement>("#source-col .tag")?.click();
    c.querySelector<HTMLButtonElement>("#extract-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("output column"));
  });

  it("dispatches extractText job when form is valid", async () => {
    const promise = Promise.resolve();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive", "extracted_text"]);
    (services.extractText as jest.Mock).mockReturnValue(promise);
    const c = mountPanel();
    await Promise.resolve();

    // select source column (first tag) and output column (second tag)
    const tags = c.querySelectorAll<HTMLElement>(".tag");
    tags[0]?.click(); // source-col first tag
    tags[1]?.click(); // output-col first tag (or new col)

    c.querySelector<HTMLButtonElement>("#extract-btn")!.click();
    expect(jobStoreModule.jobStore.dispatch).toHaveBeenCalledWith(
      expect.stringMatching(/^extract-text-\d+$/),
      "Extract Text",
      promise,
    );
  });

  it("unmount returns saved state", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    document.body.innerHTML = '<div id="app"></div>';
    const container = document.getElementById("app")!;
    const panel = new ExtractTextPanel();
    panel.mount(container, mockNav);
    await Promise.resolve();
    const state = panel.unmount();
    expect(state).toBeDefined();
    expect(typeof state?.startRow).toBe("number");
    expect(typeof state?.endRow).toBe("number");
  });

  it("restores saved state on remount", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel({
      sourceCol: "source_drive",
      outputCol: "extracted_text",
      startRow: 2,
      endRow: 10,
    });
    await Promise.resolve();
    // Panel should not throw and form should be visible after load
    expect(c.querySelector("#config-form")).toBeTruthy();
  });

  it("navigates back when getSheetHeaders fails", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockRejectedValue(new Error("network error"));
    mountPanel();
    await Promise.resolve();
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("alerts on jobStore dispatch failure", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive", "extracted_text"]);
    (services.extractText as jest.Mock).mockReturnValue(Promise.resolve());
    (jobStoreModule.jobStore.dispatch as jest.Mock).mockReturnValue(
      Promise.reject(new Error("job failed")),
    );
    const c = mountPanel();
    await Promise.resolve();

    const tags = c.querySelectorAll<HTMLElement>(".tag");
    tags[0]?.click();
    tags[1]?.click();
    c.querySelector<HTMLButtonElement>("#extract-btn")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.alert).toHaveBeenCalledWith("Error: job failed");
  });

  it("refresh button re-fetches headers", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel();
    await Promise.resolve();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(1);
    c.querySelector<HTMLButtonElement>("#refresh-btn")!.click();
    await Promise.resolve();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run the tests — expect failure**

```bash
npx jest __tests__/panels/extract-text.test.ts
```

Expected: FAIL — `Cannot find module '../../src/client/panels/extract-text'`

**Step 3: Commit the failing tests**

```bash
git add __tests__/panels/extract-text.test.ts
git commit -m "test: add failing tests for ExtractTextPanel"
```

---

### Task 6: Implement `ExtractTextPanel`

**Files:**
- Create: `src/client/panels/extract-text.ts`

**Step 1: Create the panel**

```ts
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

    this.rowRange = new RowRange(container.querySelector("#row-range")!, {
      startRow: savedState?.startRow,
      endRow: savedState?.endRow,
    });

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
    const range = this.rowRange?.getValue() ?? { startRow: 2, endRow: 2 };
    return {
      sourceCol: this.sourceColList?.getValue() ?? "",
      outputCol: this.outputColList?.getValue() ?? "",
      startRow: range.startRow,
      endRow: range.endRow,
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

    const range = this.rowRange?.getValue() ?? { startRow: 2, endRow: 2 };

    return {
      sourceCol,
      outputCol,
      startRow: range.startRow,
      endRow: range.endRow,
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
```

**Step 2: Run the tests — expect them to pass**

```bash
npx jest __tests__/panels/extract-text.test.ts
```

Expected: all tests pass.

**Step 3: Run the full test suite**

```bash
npm test
```

Expected: all 311+ tests pass.

**Step 4: Commit**

```bash
git add src/client/panels/extract-text.ts
git commit -m "feat: implement ExtractTextPanel"
```

---

### Task 7: Wire panel into the app

**Files:**
- Modify: `src/client/sidebar-entry.ts`
- Modify: `src/client/panels/tool-list.ts`

**Step 1: Register `ExtractTextPanel` in `sidebar-entry.ts`**

Add the import after the `ImportDriveLinksPanel` import:

```ts
import { ExtractTextPanel } from "./panels/extract-text";
```

Add to the panels Map:

```ts
["extract-text", new ExtractTextPanel()],
```

**Step 2: Update `tool-list.ts` to navigate instead of dispatch**

In `wireEvents`, find:

```ts
container.querySelector("#btn-extract-text")?.addEventListener("click", (e) => {
  this.dispatchTool(e as MouseEvent, "extractTextFromSelection");
});
```

Replace with:

```ts
container.querySelector("#btn-extract-text")?.addEventListener("click", () => {
  nav.navigate("extract-text");
});
```

**Step 3: Verify typecheck passes**

```bash
npm run typecheck
```

Expected: no errors.

**Step 4: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add src/client/sidebar-entry.ts src/client/panels/tool-list.ts
git commit -m "feat: wire ExtractTextPanel into router and tool-list"
```

---

### Task 8: Final verification

**Step 1: Run lint**

```bash
npm run lint
```

Expected: no errors.

**Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 3: Run full test suite with coverage**

```bash
npm run test:coverage
```

Expected: all tests pass, all per-file coverage thresholds met.

**Step 4: Build**

```bash
npm run build
```

Expected: clean build, `dist/index.js` and `dist/Sidebar.html` produced, no errors.

**Step 5: Commit if any lint/format fixes were needed**

```bash
git add -A
git commit -m "chore: lint and format fixes"
```
