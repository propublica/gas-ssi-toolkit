# PromptColList Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the two separate "User prompt columns" / "Drive file columns" `TokenInput` pickers in `ConfigureAIRunPanel` with a single `PromptColList` component that renders an ordered, user-reorderable list of `PromptColumnSpec` rows.

**Architecture:** New `PromptColList` component wraps one `TokenInput` per row (single-select, column picker) alongside kind-toggle pills and up/down/remove buttons. `configure-ai-run.ts` replaces two `TokenInput` fields with one `PromptColList`. No server-side changes.

**Tech Stack:** TypeScript + DOM APIs + existing `TokenInput` component + existing `.tag`/`.tag.selected` CSS.

**Design doc:** `docs/plans/2026-04-02-prompt-col-list-design.md`

---

## Task 1: `PromptColList` component — failing tests

**Files:**
- Create: `__tests__/components/prompt-col-list.test.ts`

**Step 1: Write the test file**

```ts
/**
 * @jest-environment jsdom
 */
import { PromptColList } from "../../src/client/components/prompt-col-list";
import type { PromptColumnSpec } from "../../src/shared/types";

const HEADERS = ["col_a", "col_b", "col_c"];

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

/** Clicks the column TokenInput add btn in the Nth row, then selects value from dropdown. */
function selectColInRow(container: HTMLElement, rowIndex: number, value: string): void {
  const rows = container.querySelectorAll(".pcol-row");
  const row = rows[rowIndex] as HTMLElement;
  row.querySelector<HTMLElement>(".token-add-btn")!.click();
  row.querySelector<HTMLElement>(`.token-option[data-value="${value}"]`)!.click();
}

/** Returns the selected column value chip in the Nth row, or "" if none. */
function getColInRow(container: HTMLElement, rowIndex: number): string {
  const rows = container.querySelectorAll(".pcol-row");
  const row = rows[rowIndex] as HTMLElement;
  return row.querySelector<HTMLElement>(".token-chip[data-value]")?.getAttribute("data-value") ?? "";
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PromptColList — construction", () => {
  it("renders no rows and an add button when constructed with no initialValue", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    expect(container.querySelectorAll(".pcol-row").length).toBe(0);
    expect(container.querySelector(".pcol-add-btn")).not.toBeNull();
    list.destroy();
  });

  it("renders one row per entry in initialValue", () => {
    const container = makeContainer();
    const initial: PromptColumnSpec[] = [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ];
    const list = new PromptColList(container, HEADERS, initial);
    expect(container.querySelectorAll(".pcol-row").length).toBe(2);
    list.destroy();
  });

  it("pre-selects the column chip for each initialValue entry", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [{ col: "col_a", kind: "text" }]);
    expect(getColInRow(container, 0)).toBe("col_a");
    list.destroy();
  });

  it("pre-selects the correct kind pill for each initialValue entry", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    const rows = container.querySelectorAll(".pcol-row");
    const textPillRow0 = rows[0].querySelector<HTMLElement>(".pcol-kind-pills .tag:first-child");
    const filePillRow1 = rows[1].querySelector<HTMLElement>(".pcol-kind-pills .tag:last-child");
    expect(textPillRow0?.classList.contains("selected")).toBe(true);
    expect(filePillRow1?.classList.contains("selected")).toBe(true);
    list.destroy();
  });
});

describe("PromptColList — getValue()", () => {
  it("returns [] when there are no rows", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    expect(list.getValue()).toEqual([]);
    list.destroy();
  });

  it("returns [] when rows have no column selected", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    container.querySelector<HTMLElement>(".pcol-add-btn")!.click();
    expect(list.getValue()).toEqual([]);
    list.destroy();
  });

  it("returns spec for a row with a selected column", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    container.querySelector<HTMLElement>(".pcol-add-btn")!.click();
    selectColInRow(container, 0, "col_a");
    expect(list.getValue()).toEqual([{ col: "col_a", kind: "text" }]);
    list.destroy();
  });

  it("returns rows in display order", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    expect(list.getValue()).toEqual([
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    list.destroy();
  });

  it("skips rows with no column selected when mixed with filled rows", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [{ col: "col_a", kind: "text" }]);
    container.querySelector<HTMLElement>(".pcol-add-btn")!.click(); // empty row
    expect(list.getValue()).toEqual([{ col: "col_a", kind: "text" }]);
    list.destroy();
  });
});

describe("PromptColList — add row", () => {
  it("clicking add button appends a new empty row", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    container.querySelector<HTMLElement>(".pcol-add-btn")!.click();
    expect(container.querySelectorAll(".pcol-row").length).toBe(1);
    expect(getColInRow(container, 0)).toBe("");
    list.destroy();
  });

  it("new row defaults to text kind", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    container.querySelector<HTMLElement>(".pcol-add-btn")!.click();
    const rows = container.querySelectorAll(".pcol-row");
    const textPill = rows[0].querySelector<HTMLElement>(".pcol-kind-pills .tag:first-child");
    expect(textPill?.classList.contains("selected")).toBe(true);
    list.destroy();
  });
});

describe("PromptColList — remove row", () => {
  it("clicking remove on a row removes it from the DOM and getValue()", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    container.querySelector<HTMLElement>(".pcol-btn-remove")!.click();
    expect(container.querySelectorAll(".pcol-row").length).toBe(1);
    expect(list.getValue()).toEqual([{ col: "col_b", kind: "file" }]);
    list.destroy();
  });
});

describe("PromptColList — kind toggle", () => {
  it("clicking File pill changes kind to file in getValue()", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [{ col: "col_a", kind: "text" }]);
    const row = container.querySelector<HTMLElement>(".pcol-row")!;
    row.querySelector<HTMLElement>(".pcol-kind-pills .tag:last-child")!.click(); // File
    expect(list.getValue()).toEqual([{ col: "col_a", kind: "file" }]);
    list.destroy();
  });

  it("clicking Text pill after File restores text kind", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [{ col: "col_a", kind: "file" }]);
    const row = container.querySelector<HTMLElement>(".pcol-row")!;
    row.querySelector<HTMLElement>(".pcol-kind-pills .tag:first-child")!.click(); // Text
    expect(list.getValue()).toEqual([{ col: "col_a", kind: "text" }]);
    list.destroy();
  });
});

describe("PromptColList — reorder", () => {
  it("up button disabled on first row", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "text" },
    ]);
    const firstUpBtn = container.querySelector<HTMLButtonElement>(".pcol-btn-up");
    expect(firstUpBtn?.disabled).toBe(true);
    list.destroy();
  });

  it("down button disabled on last row", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "text" },
    ]);
    const downBtns = container.querySelectorAll<HTMLButtonElement>(".pcol-btn-down");
    expect(downBtns[downBtns.length - 1].disabled).toBe(true);
    list.destroy();
  });

  it("clicking up on second row moves it to first position in getValue()", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    const upBtns = container.querySelectorAll<HTMLButtonElement>(".pcol-btn-up");
    upBtns[1].click(); // up on second row
    expect(list.getValue()).toEqual([
      { col: "col_b", kind: "file" },
      { col: "col_a", kind: "text" },
    ]);
    list.destroy();
  });

  it("clicking down on first row moves it to second position in getValue()", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    container.querySelector<HTMLButtonElement>(".pcol-btn-down")!.click(); // down on first row
    expect(list.getValue()).toEqual([
      { col: "col_b", kind: "file" },
      { col: "col_a", kind: "text" },
    ]);
    list.destroy();
  });
});

describe("PromptColList — destroy()", () => {
  it("removes all DOM elements from the container", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [{ col: "col_a", kind: "text" }]);
    list.destroy();
    expect(container.querySelector(".pcol-list")).toBeNull();
    expect(container.querySelector(".pcol-add-btn")).toBeNull();
  });
});
```

**Step 2: Run to verify it fails**

```bash
cd .worktrees/prompt-col-list
npx jest __tests__/components/prompt-col-list.test.ts
```

Expected: `Cannot find module '../../src/client/components/prompt-col-list'`

---

## Task 2: `PromptColList` component — implementation

**Files:**
- Create: `src/client/components/prompt-col-list.ts`

**Step 1: Write the implementation**

```ts
import type { PromptColumnSpec } from "../../shared/types";
import { TokenInput } from "./token-input";

interface PromptRow {
  kind: "text" | "file";
  tokenInput: TokenInput;
  el: HTMLElement;
}

export class PromptColList {
  private readonly headers: string[];
  private rows: PromptRow[] = [];
  private readonly listEl: HTMLElement;
  private readonly addBtn: HTMLButtonElement;

  constructor(container: HTMLElement, headers: string[], initialValue?: PromptColumnSpec[]) {
    this.headers = headers;

    this.listEl = document.createElement("div");
    this.listEl.className = "pcol-list";

    this.addBtn = document.createElement("button");
    this.addBtn.type = "button";
    this.addBtn.className = "pcol-add-btn";
    this.addBtn.textContent = "+ Add column";
    this.addBtn.addEventListener("click", () => this.addRow("text", ""));

    container.appendChild(this.listEl);
    container.appendChild(this.addBtn);

    for (const spec of initialValue ?? []) {
      this.addRow(spec.kind, spec.col);
    }
  }

  getValue(): PromptColumnSpec[] {
    return this.rows
      .map((row) => ({ col: row.tokenInput.getValue()[0] ?? "", kind: row.kind }))
      .filter((spec) => spec.col !== "");
  }

  destroy(): void {
    for (const row of this.rows) {
      row.tokenInput.destroy();
    }
    this.rows = [];
    this.listEl.remove();
    this.addBtn.remove();
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private addRow(kind: "text" | "file", initialCol: string): void {
    const row = this.buildRow(kind, initialCol);
    this.rows.push(row);
    this.listEl.appendChild(row.el);
    this.updateArrows();
  }

  private buildRow(kind: "text" | "file", initialCol: string): PromptRow {
    const el = document.createElement("div");
    el.className = "pcol-row";

    // Line 1: TokenInput for column selection
    const line1 = document.createElement("div");
    line1.className = "pcol-row-line1";
    const tokenInput = new TokenInput(line1, this.headers, {
      multi: false,
      selected: initialCol ? [initialCol] : [],
    });
    el.appendChild(line1);

    // Line 2: kind pills + spacer + action buttons
    const line2 = document.createElement("div");
    line2.className = "pcol-row-line2";

    const pillsWrap = document.createElement("div");
    pillsWrap.className = "pcol-kind-pills";

    const textPill = this.makePill("Text", kind === "text");
    const filePill = this.makePill("File", kind === "file");
    pillsWrap.appendChild(textPill);
    pillsWrap.appendChild(filePill);

    const spacer = document.createElement("div");
    spacer.className = "pcol-spacer";

    const upBtn = this.makeBtn("↑", "pcol-btn-up");
    const downBtn = this.makeBtn("↓", "pcol-btn-down");
    const removeBtn = this.makeBtn("×", "pcol-btn-remove");

    line2.appendChild(pillsWrap);
    line2.appendChild(spacer);
    line2.appendChild(upBtn);
    line2.appendChild(downBtn);
    line2.appendChild(removeBtn);
    el.appendChild(line2);

    // Assemble the row object — listeners reference it by closure
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

  private makePill(label: string, selected: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag" + (selected ? " selected" : "");
    btn.textContent = label;
    return btn;
  }

  private makeBtn(label: string, className: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className;
    btn.textContent = label;
    return btn;
  }

  private moveRow(row: PromptRow, delta: -1 | 1): void {
    const idx = this.rows.indexOf(row);
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= this.rows.length) return;

    // Save elements before swapping array
    const elA = this.rows[idx].el;
    const elB = this.rows[newIdx].el;

    // Swap in state array
    [this.rows[idx], this.rows[newIdx]] = [this.rows[newIdx], this.rows[idx]];

    // Swap in DOM
    if (delta === -1) {
      this.listEl.insertBefore(elA, elB); // move A before B
    } else {
      this.listEl.insertBefore(elB, elA); // move B before A
    }

    this.updateArrows();
  }

  private removeRow(row: PromptRow): void {
    row.tokenInput.destroy();
    row.el.remove();
    this.rows = this.rows.filter((r) => r !== row);
    this.updateArrows();
  }

  private updateArrows(): void {
    this.rows.forEach((row, idx) => {
      const upBtn = row.el.querySelector<HTMLButtonElement>(".pcol-btn-up");
      const downBtn = row.el.querySelector<HTMLButtonElement>(".pcol-btn-down");
      if (upBtn) upBtn.disabled = idx === 0;
      if (downBtn) downBtn.disabled = idx === this.rows.length - 1;
    });
  }
}
```

**Step 2: Run tests**

```bash
npx jest __tests__/components/prompt-col-list.test.ts
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add src/client/components/prompt-col-list.ts __tests__/components/prompt-col-list.test.ts
git commit -m "feat: add PromptColList component for ordered prompt column selection"
```

---

## Task 3: CSS for `PromptColList`

**Files:**
- Modify: `src/client/sidebar.css` (append at end)

**Step 1: Append the new styles**

Add to the bottom of `src/client/sidebar.css`:

```css
/* ── Prompt Column List ──────────────────────────────────────────────────── */

.pcol-list { display: flex; flex-direction: column; gap: 8px; }

.pcol-row { display: flex; flex-direction: column; gap: 4px; }

.pcol-row-line1 { width: 100%; }

.pcol-row-line2 {
  display: flex;
  align-items: center;
  gap: 4px;
}

.pcol-kind-pills { display: flex; gap: 4px; }

.pcol-spacer { flex: 1; }

.pcol-btn-up,
.pcol-btn-down,
.pcol-btn-remove {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 2px 4px;
  line-height: 1;
}

.pcol-btn-up:hover,
.pcol-btn-down:hover { color: var(--primary-blue); }
.pcol-btn-remove:hover { color: #d93025; }
.pcol-btn-up:disabled,
.pcol-btn-down:disabled { opacity: 0.25; cursor: default; }

.pcol-add-btn {
  width: 100%;
  margin-top: 4px;
  background: none;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 5px 8px;
  cursor: pointer;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
  box-sizing: border-box;
}

.pcol-add-btn:hover { border-color: var(--primary-blue); color: var(--primary-blue); }
```

**Step 2: Verify build still compiles**

```bash
npm run build
```

Expected: no errors, `dist/` updated.

**Step 3: Commit**

```bash
git add src/client/sidebar.css
git commit -m "feat: add pcol-* styles for PromptColList component"
```

---

## Task 4: Update `configure-ai-run.ts`

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`

Make the following changes. Read the current file before editing.

**Step 1: Add import**

At the top of the file, add:
```ts
import { PromptColList } from "../components/prompt-col-list";
```

**Step 2: Replace `userPromptList` and `driveFileList` fields**

Remove:
```ts
private userPromptList: TokenInput | null = null;
private driveFileList: TokenInput | null = null;
```

Add:
```ts
private promptColList: PromptColList | null = null;
```

**Step 3: Update `loadHeaders()` — remove destroy calls and construction**

Remove:
```ts
this.userPromptList?.destroy();
this.driveFileList?.destroy();
```

Add:
```ts
this.promptColList?.destroy();
this.promptColList = null;
```

Remove:
```ts
const presetTextCols =
  preset.promptCols?.filter((p) => p.kind === "text").map((p) => p.col) ?? [];
const presetFileCols =
  preset.promptCols?.filter((p) => p.kind === "file").map((p) => p.col) ?? [];
this.userPromptList = new TokenInput(
  container.querySelector("#user-prompt-cols")!,
  headers,
  { selected: presetTextCols },
);
this.driveFileList = new TokenInput(container.querySelector("#drive-file-cols")!, headers, {
  selected: presetFileCols,
});
```

Add:
```ts
this.promptColList = new PromptColList(
  container.querySelector("#prompt-col-list")!,
  headers,
  preset.promptCols,
);
```

**Step 4: Update `unmount()`**

Change the guard from:
```ts
if (!this.userPromptList) return undefined;
```
To:
```ts
if (!this.promptColList) return undefined;
```

Remove:
```ts
this.userPromptList.destroy();
this.driveFileList?.destroy();
```
Add:
```ts
this.promptColList.destroy();
```

Replace the two-array merge in the return value:
```ts
promptCols: [
  ...this.userPromptList.getValue().map((col) => ({ col, kind: "text" as const })),
  ...(this.driveFileList?.getValue() ?? []).map((col) => ({ col, kind: "file" as const })),
],
```
With:
```ts
promptCols: this.promptColList.getValue(),
```

**Step 5: Update `currentPreset()`**

Remove:
```ts
const textCols = this.userPromptList?.getValue() ?? [];
const fileCols = this.driveFileList?.getValue() ?? [];
return {
  promptCols: [
    ...textCols.map((col) => ({ col, kind: "text" as const })),
    ...fileCols.map((col) => ({ col, kind: "file" as const })),
  ],
```

Add:
```ts
return {
  promptCols: this.promptColList?.getValue() ?? [],
```

**Step 6: Update `assembleRunConfig()`**

Remove:
```ts
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
```

Add:
```ts
const promptCols = this.promptColList?.getValue() ?? [];
if (promptCols.length === 0) {
  globalThis.alert("Please select at least one User prompt column.");
  return null;
}
```

**Step 7: Update the template**

Replace:
```html
<div class="field-group">
  <span class="field-label">User prompt columns <span class="required">*</span></span>
  <div id="user-prompt-cols" class="tag-list"></div>
</div>
<div class="field-group">
  <span class="field-label">Drive file columns <span class="optional">(optional)</span></span>
  <div id="drive-file-cols" class="tag-list"></div>
</div>
```

With:
```html
<div class="field-group">
  <span class="field-label">Prompt columns <span class="required">*</span></span>
  <div id="prompt-col-list"></div>
</div>
```

**Step 8: Remove unused `TokenInput` import if no longer referenced**

Check whether `TokenInput` is still imported. If the only import was for `userPromptList` / `driveFileList`, remove the import line. (The systemPromptList and outputColList still use `TokenInput`, so the import stays.)

**Step 9: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 10: Commit**

```bash
git add src/client/panels/configure-ai-run.ts
git commit -m "feat: replace split TokenInput pickers with PromptColList in ConfigureAIRunPanel"
```

---

## Task 5: Update `configure-ai-run` tests

**Files:**
- Modify: `__tests__/panels/configure-ai-run.test.ts`

The existing tests use `selectColumn(container, "user-prompt-cols", value)` and
`getChipValues(container, "user-prompt-cols")`. These helpers target the old `#user-prompt-cols`
TokenInput container. After the refactor that element is gone; instead `#prompt-col-list`
contains `PromptColList` rows.

**Step 1: Replace `selectColumn` and `getChipValues` helpers**

Remove the old helpers:
```ts
function selectColumn(container: HTMLElement, fieldId: string, value: string): void { ... }
function getChipValues(container: HTMLElement, fieldId: string): string[] { ... }
```

Keep `selectColumn` for `system-prompt-col`, `output-col` fields (these are unchanged TokenInputs). Add new helpers for the PromptColList:

```ts
/** Clicks the "+ Add column" button and selects value in the newly appended row. */
function addPromptCol(
  container: HTMLElement,
  value: string,
  kind: "text" | "file" = "text",
): void {
  container.querySelector<HTMLElement>(".pcol-add-btn")!.click();
  const rows = container.querySelectorAll(".pcol-row");
  const row = rows[rows.length - 1] as HTMLElement;
  row.querySelector<HTMLElement>(".token-add-btn")!.click();
  row.querySelector<HTMLElement>(`.token-option[data-value="${value}"]`)!.click();
  if (kind === "file") {
    const pills = row.querySelectorAll<HTMLElement>(".pcol-kind-pills .tag");
    pills[1].click();
  }
}

/** Returns column values of all filled rows in the PromptColList. */
function getPromptColValues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".pcol-row"))
    .map((row) => row.querySelector<HTMLElement>(".token-chip[data-value]")?.getAttribute("data-value") ?? "")
    .filter(Boolean);
}

/** Selects a column in a non-PromptColList TokenInput field (system-prompt-col, output-col). */
function selectColumn(container: HTMLElement, fieldId: string, value: string): void {
  container.querySelector<HTMLElement>(`#${fieldId} .token-add-btn`)!.click();
  container.querySelector<HTMLElement>(`#${fieldId} .token-option[data-value="${value}"]`)!.click();
}
```

**Step 2: Update assertions that reference old field IDs**

Find and update each failing assertion:

- `"pre-selects params on mount"`:
  ```ts
  // Before:
  expect(getChipValues(container, "user-prompt-cols")).toContain("col_a");
  // After:
  expect(getPromptColValues(container)).toContain("col_a");
  ```

- `"restores savedState over params"`:
  ```ts
  // Before:
  expect(getChipValues(container, "user-prompt-cols")).toContain("col_b");
  // After:
  expect(getPromptColValues(container)).toContain("col_b");
  ```

- `"alerts when no output column selected"`:
  ```ts
  // Before:
  selectColumn(container, "user-prompt-cols", "col_a");
  // After:
  addPromptCol(container, "col_a");
  ```

- `"unmount() returns current form state"`:
  ```ts
  // Before:
  selectColumn(container, "user-prompt-cols", "col_a");
  // After:
  addPromptCol(container, "col_a");
  ```

- `"unmount saves includeGrounding state"`:
  ```ts
  // Before:
  selectColumn(container, "user-prompt-cols", "col_a");
  // After:
  addPromptCol(container, "col_a");
  ```

- `"refresh-btn refetches headers preserving current selections"`:
  ```ts
  // Before:
  expect(getChipValues(container, "user-prompt-cols")).toContain("col_a");
  // After:
  expect(getPromptColValues(container)).toContain("col_a");
  ```

**Step 3: Run the full test suite**

```bash
npm test
```

Expected: 391+ tests passing (new component tests add to the total), 0 failures.

**Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 5: Commit**

```bash
git add __tests__/panels/configure-ai-run.test.ts
git commit -m "test: update configure-ai-run tests for PromptColList"
```

---

## Task 6: Final verification

**Step 1: Full test suite with coverage**

```bash
npm run test:coverage
```

Expected: all tests pass, coverage thresholds met.

**Step 2: Lint**

```bash
npm run lint
```

Expected: no errors or warnings.

**Step 3: Build**

```bash
npm run build
```

Expected: `dist/` builds cleanly with no errors.
