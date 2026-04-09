# ConfigureAIRunPanel UX Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the Run AI Inference panel to read as a top-to-bottom workflow narrative with helper text, a condensed prompt column row layout, and collapsible optional sections.

**Architecture:** Three purely client-side changes — collapse the two-line PromptColList row into one inline row, reorder panel sections and add helper text in the template, and add a collapsible toggle to the Tools section. No server changes.

**Tech Stack:** TypeScript, DOM APIs, CSS (inlined into Sidebar.html at build time via Rollup)

**Design spec:** `docs/plans/2026-04-07-configure-ai-run-ux-redesign.md`

---

### Task 1: One-line PromptColList row layout

**Context:** `PromptColList` (`src/client/components/prompt-col-list.ts`) currently renders each row as two stacked `<div>`s: `pcol-row-line1` (TokenInput) and `pcol-row-line2` (kind pills + controls). Collapse these into a single flex row. Existing tests check behavior (getValue, kind toggle, reorder, remove) — not DOM structure — so they should all pass unchanged after this refactor.

**Files:**
- Modify: `src/client/components/prompt-col-list.ts`
- Modify: `src/client/sidebar.css`

**Step 1: Run existing PromptColList tests to confirm baseline**

```bash
npx jest __tests__/components/prompt-col-list.test.ts --no-coverage
```

Expected: all pass.

**Step 2: Refactor `buildRow()` in `prompt-col-list.ts`**

Replace the two-line structure with a single flat row. Remove `line1`/`line2` wrapper divs; mount TokenInput directly into the row element with a wrapper that carries the width constraint:

```ts
private buildRow(kind: "text" | "file", initialCol: string): PromptRow {
  const el = document.createElement("div");
  el.className = "pcol-row";

  const pickerWrap = document.createElement("div");
  pickerWrap.className = "pcol-col-picker";
  const tokenInput = new TokenInput(pickerWrap, this.headers, {
    multi: false,
    selected: initialCol ? [initialCol] : [],
  });
  el.appendChild(pickerWrap);

  const pillsWrap = document.createElement("div");
  pillsWrap.className = "pcol-kind-pills";
  const textPill = this.makePill("Text", kind === "text");
  const filePill = this.makePill("File", kind === "file");
  pillsWrap.appendChild(textPill);
  pillsWrap.appendChild(filePill);
  el.appendChild(pillsWrap);

  const upBtn = this.makeBtn("↑", "pcol-btn-up");
  const downBtn = this.makeBtn("↓", "pcol-btn-down");
  const removeBtn = this.makeBtn("×", "pcol-btn-remove");
  el.appendChild(upBtn);
  el.appendChild(downBtn);
  el.appendChild(removeBtn);

  const row: PromptRow = { kind, tokenInput, el };

  textPill.addEventListener("click", () => {
    row.kind = "text";
    textPill.classList.add("selected");
    filePill.classList.remove("selected");
  });
  filePill.addEventListener("click", () => {
    row.kind = "file";
    filePill.classList.add("selected");
    textPill.classList.remove("selected");
  });
  upBtn.addEventListener("click", () => this.moveRow(row, -1));
  downBtn.addEventListener("click", () => this.moveRow(row, 1));
  removeBtn.addEventListener("click", () => this.removeRow(row));

  return row;
}
```

**Step 3: Update `.pcol-row` CSS in `sidebar.css`**

Find the existing `.pcol-row`, `.pcol-row-line1`, `.pcol-row-line2`, `.pcol-spacer` rules. Replace them with:

```css
.pcol-row {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 4px;
}

.pcol-col-picker {
    flex: 0 0 55%;
    min-width: 0;
}

.pcol-kind-pills {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
}

.pcol-btn-up,
.pcol-btn-down,
.pcol-btn-remove {
    flex-shrink: 0;
    /* keep existing button styles */
}
```

Remove any rules for `.pcol-row-line1`, `.pcol-row-line2`, `.pcol-spacer` if they exist.

**Step 4: Run tests again to confirm nothing broke**

```bash
npx jest __tests__/components/prompt-col-list.test.ts --no-coverage
```

Expected: all pass.

**Step 5: Commit**

```bash
git add src/client/components/prompt-col-list.ts src/client/sidebar.css
git commit -m "refactor: collapse PromptColList row to single inline line"
```

---

### Task 2: Reorder sections and add helper text

**Context:** `ConfigureAIRunPanel.template()` currently orders fields as: Prompt Columns → System Prompt → Output → Tools → Rows. Reorder to: System Prompt → Prompt Columns → Output → Rows → Tools. Add a `.field-helper` `<p>` element below each section's label. Existing tests use element IDs (`#prompt-col-list`, `#system-prompt-col`, etc.) not DOM order, so they pass unchanged.

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Modify: `src/client/sidebar.css`

**Step 1: Run existing panel tests to confirm baseline**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts --no-coverage
```

Expected: all pass.

**Step 2: Update `template()` in `configure-ai-run.ts`**

Replace the `<div id="config-form">` contents with the new order and helper text elements. The IDs, checkbox IDs, and button IDs must stay identical — only order and added markup change:

```ts
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
        <span class="field-label">System prompt column <span class="optional">(optional)</span></span>
        <p class="field-helper">Sets the AI's role and behavior — what it should do and how it should respond — before it sees any data.</p>
        <div id="system-prompt-col" class="tag-list"></div>
      </div>
      <div class="field-group">
        <span class="field-label">User prompt columns <span class="required">*</span></span>
        <p class="field-helper">The content the AI acts on — what it reads, summarizes, classifies, or answers, one row at a time.</p>
        <div id="prompt-col-list"></div>
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
        <span class="field-label">Rows to process</span>
        <div id="row-range-container"></div>
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
      <div class="panel-buttons">
        <button id="run-btn" class="btn-run">Run AI</button>
      </div>
    </div>
  `;
}
```

**Step 3: Add `.field-helper` and collapsible CSS to `sidebar.css`**

Add these rules (do not remove any existing rules yet — the collapsible rules for `.collapsible-header`, `.collapsible-content`, etc. are new):

```css
.field-helper {
    font-size: 11px;
    color: var(--text-secondary);
    margin: 2px 0 8px 0;
    line-height: 1.4;
}

.collapsible-header {
    display: flex;
    align-items: center;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    gap: 6px;
    margin-bottom: 0;
}

.collapsible-header:hover .collapsible-label {
    color: var(--primary-blue);
}

.collapsible-label {
    font-size: 11px;
    font-style: italic;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.8px;
}

.collapsible-summary {
    flex: 1;
    font-size: 11px;
    color: var(--text-secondary);
    font-style: italic;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.collapsible-chevron {
    font-size: 10px;
    color: var(--text-secondary);
    transition: transform 0.15s ease;
    flex-shrink: 0;
}

.collapsible-header[aria-expanded="true"] .collapsible-chevron {
    transform: rotate(90deg);
}

.collapsible-content {
    padding-top: 8px;
}
```

**Step 4: Run tests to confirm nothing broke**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts --no-coverage
```

Expected: all pass. (The template reorder doesn't break any tests since they use IDs. The new `#tools-content` wrapper around `#tools-list` means tests that check `#tools-list` still find it — jsdom doesn't care about hidden.)

**Step 5: Commit**

```bash
git add src/client/panels/configure-ai-run.ts src/client/sidebar.css
git commit -m "feat: reorder ConfigureAIRunPanel sections and add helper text"
```

---

### Task 3: Wire collapsible Tools toggle

**Context:** The template from Task 2 already has `#tools-toggle` (button), `#tools-content` (hidden div), `#tools-summary` (summary text span), and `.collapsible-chevron`. Now wire the toggle behavior in `mount()`, update the summary text when tools are selected/deselected, and save/restore `toolsExpanded` in `SavedState`.

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Modify: `__tests__/panels/configure-ai-run.test.ts`

**Step 1: Write failing tests first**

Add a new `describe` block to `__tests__/panels/configure-ai-run.test.ts`:

```ts
describe("ConfigureAIRunPanel — collapsible Tools section", () => {
  it("tools content is hidden on mount by default", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector<HTMLElement>("#tools-content")!.hidden).toBe(true);
  });

  it("clicking tools toggle expands tools content", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#tools-toggle")!.click();
    expect(container.querySelector<HTMLElement>("#tools-content")!.hidden).toBe(false);
  });

  it("clicking tools toggle again collapses tools content", async () => {
    const { container } = await mountAndLoad();
    const toggle = container.querySelector<HTMLButtonElement>("#tools-toggle")!;
    toggle.click();
    toggle.click();
    expect(container.querySelector<HTMLElement>("#tools-content")!.hidden).toBe(true);
  });

  it("summary shows 'No tools selected' when no tools are active", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector<HTMLElement>("#tools-summary")!.textContent).toBe(
      "No tools selected",
    );
  });

  it("summary updates to tool names when a tool is selected", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>('[data-value="google_search"]')!.click();
    expect(container.querySelector<HTMLElement>("#tools-summary")!.textContent).toBe(
      "Google Search",
    );
  });

  it("summary reverts to 'No tools selected' when all tools deselected", async () => {
    const { container } = await mountAndLoad();
    const tag = container.querySelector<HTMLButtonElement>('[data-value="google_search"]')!;
    tag.click(); // select
    tag.click(); // deselect
    expect(container.querySelector<HTMLElement>("#tools-summary")!.textContent).toBe(
      "No tools selected",
    );
  });

  it("toolsExpanded: true in savedState expands section on mount", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [],
      systemPromptCol: "",
      outputCol: "",
      toolsExpanded: true,
    });
    expect(container.querySelector<HTMLElement>("#tools-content")!.hidden).toBe(false);
  });

  it("unmount() saves toolsExpanded: true when section is open", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#tools-toggle")!.click();
    const state = panel.unmount();
    expect((state as { toolsExpanded?: boolean })?.toolsExpanded).toBe(true);
  });

  it("unmount() saves toolsExpanded: false when section is closed", async () => {
    const { container, panel } = await mountAndLoad();
    // default is closed
    addPromptCol(container, "col_a");
    const state = panel.unmount();
    expect((state as { toolsExpanded?: boolean })?.toolsExpanded).toBe(false);
  });
});
```

**Step 2: Run new tests to confirm they fail**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts --no-coverage -t "collapsible Tools"
```

Expected: all 9 new tests FAIL.

**Step 3: Extend `SavedState` type**

In `src/client/panels/configure-ai-run.ts`, update the `SavedState` type:

```ts
export type SavedState = Required<
  Omit<RunConfig, "rowRange" | "tools" | "includeGrounding" | "applyMarkdown">
> &
  Pick<RunConfig, "rowRange" | "tools" | "includeGrounding" | "applyMarkdown"> & {
    toolsExpanded?: boolean;
  };
```

**Step 4: Add `toolsExpanded` private field and wire toggle in `mount()`**

Add a private field to the class:

```ts
private toolsExpanded = false;
```

At the end of the `mount()` method, after `this.toolsList` is initialized and before `loadHeaders` is called, add:

```ts
// Restore collapse state
this.toolsExpanded = preset.toolsExpanded ?? false; // preset won't have this key from RunConfig but SavedState does
// We need to read toolsExpanded from savedState directly since preset is Partial<RunConfig>
```

Actually, `preset` is typed as `Partial<RunConfig>` which doesn't have `toolsExpanded`. Read it directly from `savedState`:

```ts
this.toolsExpanded = savedState?.toolsExpanded ?? false;
this.applyToolsExpandState(container);
this.wireToolsToggle(container);
```

Add two new private methods:

```ts
private applyToolsExpandState(container: HTMLElement): void {
  const content = container.querySelector<HTMLElement>("#tools-content");
  const toggle = container.querySelector<HTMLButtonElement>("#tools-toggle");
  if (content) content.hidden = !this.toolsExpanded;
  if (toggle) toggle.setAttribute("aria-expanded", String(this.toolsExpanded));
}

private wireToolsToggle(container: HTMLElement): void {
  container.querySelector("#tools-toggle")?.addEventListener("click", () => {
    this.toolsExpanded = !this.toolsExpanded;
    this.applyToolsExpandState(container);
  });
}
```

**Step 5: Wire summary text updates**

The summary should update whenever the tools TagList changes. The TagList fires click events on its container. Extend `updateGroundingVisibility` (already wired to `click` on `#tools-list`) or add a separate listener:

```ts
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
```

(Add this directly after the existing `updateGroundingVisibility` block in `mount()`.)

**Step 6: Save `toolsExpanded` in `unmount()`**

In `unmount()`, add `toolsExpanded` to the returned object:

```ts
return {
  promptCols,
  systemPromptCol: this.systemPromptList?.getValue()[0] ?? "",
  outputCol: this.outputColList?.getValue()[0] ?? "",
  rowRange: this.rowRangeComp?.getValue(),
  tools: (this.toolsList?.getValue() ?? []) as ToolId[],
  includeGrounding: this.includeGroundingCb?.checked ?? false,
  applyMarkdown: this.applyMarkdownCb?.checked ?? false,
  toolsExpanded: this.toolsExpanded,
};
```

**Step 7: Run all new tests**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts --no-coverage -t "collapsible Tools"
```

Expected: all 9 pass.

**Step 8: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all pass.

**Step 9: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "feat: add collapsible Tools section to ConfigureAIRunPanel"
```

---

## Verification

After all three tasks are committed, build and visually verify:

```bash
npm run build
npm run typecheck
```

Open the add-on sidebar (or run `npm run deploy` and open via `npm run clasp:open`) and confirm:
1. Section order: System Prompt → User Prompt → Output → Rows → Tools
2. Helper text appears below each section label in light gray
3. Each prompt column row is a single horizontal line
4. Tools section starts collapsed with "No tools selected" summary
5. Clicking Tools header toggles expansion; summary updates with selected tool names
6. Navigating away and back preserves the expanded/collapsed state
