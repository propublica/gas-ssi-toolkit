# Homepage UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current feature-named homepage buttons with an intent-led flat list under an "I want to..." sentence stem, routing recipes directly to the recipe panel instead of via the recipes-list submenu.

**Architecture:** Two file changes — a new `.home-prompt` CSS rule in `sidebar.css`, and a rewritten `ToolListPanel` in `tool-list.ts` that imports `RECIPES` to pass the `document-summarization` definition directly to `nav.navigate("recipe", ...)`. Tests are updated first (TDD).

**Tech Stack:** TypeScript, Jest + jsdom, plain CSS custom properties

---

## File Map

| File | Change |
|------|--------|
| `src/client/sidebar.css` | Add `.home-prompt` rule |
| `src/client/panels/tool-list.ts` | Rewrite `template()` and `wireEvents()`; import `RECIPES` |
| `__tests__/panels/tool-list.test.ts` | Add RECIPES mock; replace Recipes-submenu test; add three new tests |

---

### Task 1: Add `.home-prompt` CSS rule

**Files:**
- Modify: `src/client/sidebar.css`

- [ ] **Step 1: Add the style rule**

Open `src/client/sidebar.css` and append after the `.section` rule (line 41):

```css
.home-prompt {
    font-size: var(--font-size-300);
    font-style: italic;
    color: var(--text-secondary);
    margin: 0 0 16px 4px;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/sidebar.css
git commit -m "style: add .home-prompt sentence stem style"
```

---

### Task 2: Update ToolListPanel tests

**Files:**
- Modify: `__tests__/panels/tool-list.test.ts`

- [ ] **Step 1: Replace the entire test file contents**

```ts
/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  runTool: jest.fn(),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../../src/client/recipes", () => ({
  RECIPES: [
    {
      id: "document-summarization",
      name: "Document Summarization",
      icon: "📄",
      description: "Summarize files in a Google Drive folder",
      inputs: [],
      prepTemplate: [],
    },
  ],
}));

import { ToolListPanel } from "../../src/client/panels/tool-list";
import * as services from "../../src/client/services";
import * as jobStoreModule from "../../src/client/job-store";
import type { NavigationContext } from "../../src/client/types";

const mockNav: NavigationContext = {
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(false),
};

function mountPanel(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const container = document.getElementById("app")!;
  const panel = new ToolListPanel();
  panel.mount(container, mockNav);
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
  (jobStoreModule.jobStore.dispatch as jest.Mock).mockResolvedValue(undefined);
});

describe("ToolListPanel", () => {
  it("renders the 'I want to...' sentence stem", () => {
    const c = mountPanel();
    expect(c.querySelector(".home-prompt")?.textContent?.trim()).toBe("I want to...");
  });

  it("clicking Summarize a Drive folder navigates to recipe panel with document-summarization definition", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-document-summarization")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith(
      "recipe",
      expect.objectContaining({ id: "document-summarization" }),
    );
  });

  it("does not render a Recipes submenu button", () => {
    const c = mountPanel();
    expect(c.querySelector("#btn-recipes")).toBeNull();
  });

  it("clicking Run AI navigates to configure-ai-run", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-run-ai")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("configure-ai-run");
  });

  it("clicking Import Drive Links navigates to import-drive-links panel", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("import-drive-links");
  });

  it("clicking Extract Text navigates to extract-text panel", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-extract-text")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("extract-text");
  });

  it("clicking Sample Rows calls runTool with 'sampleRowsToEvaluation' and a jobId", () => {
    (services.runTool as jest.Mock).mockResolvedValue(undefined);
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-sample-rows")!.click();
    expect(services.runTool).toHaveBeenCalledWith(
      "sampleRowsToEvaluation",
      expect.stringMatching(/^sampleRowsToEvaluation-\d+$/),
    );
  });

  it("unmount() returns undefined", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const panel = new ToolListPanel();
    panel.mount(document.getElementById("app")!, mockNav);
    expect(panel.unmount()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test file to confirm failures**

```bash
npx jest __tests__/panels/tool-list.test.ts --no-coverage
```

Expected: 3 failures — `renders the 'I want to...' sentence stem`, `clicking Summarize a Drive folder navigates to recipe panel with document-summarization definition`, `does not render a Recipes submenu button`. The existing navigation and runTool tests may also fail since the button IDs are changing. All failures are expected at this stage.

- [ ] **Step 3: Commit the failing tests**

```bash
git add __tests__/panels/tool-list.test.ts
git commit -m "test: update ToolListPanel tests for intent-led homepage redesign"
```

---

### Task 3: Rewrite ToolListPanel

**Files:**
- Modify: `src/client/panels/tool-list.ts`

- [ ] **Step 1: Replace the entire file contents**

```ts
import type { NavigationContext, Panel } from "../types";
import { runTool } from "../services";
import { jobStore } from "../job-store";
import { RECIPES } from "../recipes";

export class ToolListPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = this.template();
    this.wireEvents(container, nav);
  }

  unmount(): undefined {
    return undefined;
  }

  private wireEvents(container: HTMLElement, nav: NavigationContext): void {
    const documentSummarization = RECIPES.find((r) => r.id === "document-summarization");
    container.querySelector("#btn-document-summarization")?.addEventListener("click", () => {
      nav.navigate("recipe", documentSummarization);
    });
    container.querySelector("#btn-run-ai")?.addEventListener("click", () => {
      nav.navigate("configure-ai-run");
    });
    container.querySelector("#btn-import-drive-links")?.addEventListener("click", () => {
      nav.navigate("import-drive-links");
    });
    container.querySelector("#btn-extract-text")?.addEventListener("click", () => {
      nav.navigate("extract-text");
    });
    container.querySelector("#btn-sample-rows")?.addEventListener("click", (e) => {
      this.dispatchTool(e as MouseEvent, "sampleRowsToEvaluation");
    });
  }

  private dispatchTool(e: MouseEvent, fn: string): void {
    const btn = e.currentTarget as HTMLButtonElement;
    const jobId = `${fn}-${Date.now()}`;
    const label = btn.textContent?.trim() ?? fn;
    jobStore
      .dispatch(jobId, label, runTool(fn, jobId))
      .catch((err: Error) => globalThis.alert("Error: " + err.message));
  }

  private template(): string {
    return `
      <p class="home-prompt">I want to...</p>
      <button id="btn-document-summarization" class="tool-btn">
        <span class="icon">📄</span>
        <span class="tool-btn-text">
          <span>Summarize a Drive folder</span>
          <span class="tool-btn-sub">For FOIA drops, court filings, doc sets</span>
        </span>
      </button>
      <button id="btn-run-ai" class="tool-btn">
        <span class="icon">▶️</span>
        <span class="tool-btn-text">
          <span>Run AI across my spreadsheet</span>
          <span class="tool-btn-sub">Your prompts, your data, your tools — totally freeform</span>
        </span>
      </button>
      <button id="btn-import-drive-links" class="tool-btn">
        <span class="icon">📂</span>
        <span class="tool-btn-text">
          <span>Import files from a Drive folder</span>
          <span class="tool-btn-sub">Track progress through doc dumps</span>
        </span>
      </button>
      <button id="btn-extract-text" class="tool-btn">
        <span class="icon">📜</span>
        <span class="tool-btn-text">
          <span>Extract text from files</span>
          <span class="tool-btn-sub">Import text from PDFs, images, and Docs</span>
        </span>
      </button>
      <button id="btn-sample-rows" class="tool-btn">
        <span class="icon">🎲</span>
        <span class="tool-btn-text">
          <span>Pull a random sample</span>
          <span class="tool-btn-sub">Get a sense of what you have</span>
        </span>
      </button>
      <div class="status-footer">
        <strong>SSI Tools v2.1</strong><br>
        Powered by Gemini 3.1 Flash Lite Preview<br>
        Evaluation Unrestricted Mode
      </div>
    `;
  }
}
```

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all 489+ tests pass. The tool-list suite should now show 8 passing tests.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/client/panels/tool-list.ts
git commit -m "feat: intent-led homepage — flat list with I want to... stem, direct recipe navigation"
```
