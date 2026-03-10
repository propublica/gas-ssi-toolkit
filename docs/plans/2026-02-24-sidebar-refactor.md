# Sidebar Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split `src/Sidebar.html` into `src/client/sidebar.ts` + `src/client/sidebar.css`, assembled into `dist/Sidebar.html` at build time, with typed `Partial<RunConfig>` preset support for autopopulating the Configure AI Run form.

**Architecture:** A second Rollup config entry compiles `src/client/sidebar.ts` (browser IIFE) and an inline plugin intercepts `generateBundle` to assemble `dist/Sidebar.html` by inlining the compiled JS and CSS into a template. The intermediate `.js` chunk is deleted from the bundle before Rollup writes to disk so `clasp push` never sees it. Pure helper functions (`buildTagList`, `buildSingleTagList`, `applyPreset`, `assembleRunConfig`, `handleRowRangeChange`) are named exports tested with Jest + jsdom.

**Tech Stack:** TypeScript 5, Rollup 4 with `@rollup/plugin-typescript`, Jest 29 + ts-jest + jsdom

**Design doc:** `docs/plans/2026-02-24-sidebar-refactor-design.md`

---

### Task 1: Type setup — `google.d.ts` + DOM lib

**Files:**
- Create: `src/client/google.d.ts`
- Modify: `tsconfig.json`

**Step 1: Create the type stub**

Create `src/client/google.d.ts`:

```typescript
import type { RunConfig } from "../../shared/types";

interface GoogleScriptRun {
  withSuccessHandler(fn: (result: unknown) => void): this;
  withFailureHandler(fn: (error: Error | string) => void): this;
  runTool(functionName: string): void;
  getSheetHeaders(): void;
  runBatchAI(config: RunConfig): void;
}

declare const google: {
  script: { run: GoogleScriptRun };
};
```

**Step 2: Add DOM to tsconfig lib**

In `tsconfig.json`, change:
```json
"lib": ["ES2019"],
```
to:
```json
"lib": ["ES2019", "DOM"],
```

This makes `document`, `HTMLElement`, `Event`, etc. available for the client code and for ts-jest when it compiles `sidebar.ts`. Server code is unaffected — it uses `@types/google-apps-script` globals, not DOM APIs.

**Step 3: Verify typecheck still passes**

```bash
npm run typecheck
```
Expected: no errors.

**Step 4: Commit**

```bash
git add src/client/google.d.ts tsconfig.json
git commit -m "feat: add google.d.ts type stub and DOM lib for client code"
```

---

### Task 2: Extract CSS

**Files:**
- Create: `src/client/sidebar.css`
- Modify: `src/Sidebar.html`

**Step 1: Create `sidebar.css`**

Create `src/client/sidebar.css` by copying the entire contents of the `<style>` block in `src/Sidebar.html` (lines 7–253, everything between `<style>` and `</style>`).

Then make one change — replace every occurrence of the Google Sans font reference:

```css
/* Find all occurrences of this pattern: */
font-family: 'Google Sans', Roboto, Arial, sans-serif;

/* Replace each with: */
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
```

There are three occurrences: on `body`, `.tool-btn`, and `.back-btn` / `.btn-run` / etc. Replace all.

**Step 2: Strip `<style>` block from `src/Sidebar.html`**

In `src/Sidebar.html`:

1. Remove the entire `<link href="https://fonts.googleapis.com/...">` tag (line 6).
2. Remove the entire `<style>...</style>` block (lines 7–253).
3. Add `{{STYLES}}` in `<head>` where the style block was:

```html
<head>
    <base target="_top">
    {{STYLES}}
</head>
```

The `<script>` block stays in place for now — it will be replaced in Task 10.

**Step 3: Verify the current build still works**

The `cp src/Sidebar.html dist/` step in `npm run build` will now copy the template (with `{{STYLES}}` placeholder) — this is fine for now; the full plugin wiring happens in Task 11.

```bash
npm run build
```
Expected: exits 0. `dist/Sidebar.html` will have the literal `{{STYLES}}` string — that's expected at this stage.

**Step 4: Commit**

```bash
git add src/client/sidebar.css src/Sidebar.html
git commit -m "feat: extract Sidebar CSS to sidebar.css, drop Google Fonts"
```

---

### Task 3: Create `sidebar.ts` skeleton

**Files:**
- Create: `src/client/sidebar.ts`

**Step 1: Create the skeleton with empty exported stubs**

Create `src/client/sidebar.ts`:

```typescript
import type { RunConfig } from "../../shared/types";

/**
 * Renders multi-select tag buttons into a container.
 * Exported for testing.
 */
export function buildTagList(
  container: HTMLElement,
  headers: string[],
  selected?: string[],
): void {
  void container;
  void headers;
  void selected;
}

/**
 * Renders single-select tag buttons into a container.
 * includeNew: append a "+ New column" tag with data-value="__new__".
 * Exported for testing.
 */
export function buildSingleTagList(
  container: HTMLElement,
  headers: string[],
  includeNew: boolean,
  selected?: string,
): void {
  void container;
  void headers;
  void includeNew;
  void selected;
}

/**
 * Applies a RunConfig preset by marking matching tags as selected.
 * Exported for testing.
 */
export function applyPreset(preset: Partial<RunConfig>): void {
  void preset;
}

/**
 * Reads current panel DOM state and returns a validated RunConfig.
 * Returns null and shows an alert if required fields are missing.
 * Exported for testing.
 */
export function assembleRunConfig(): RunConfig | null {
  return null;
}

/**
 * Shows/hides the row range inputs based on the selected radio.
 * Exported for testing.
 */
export function handleRowRangeChange(): void {}

/**
 * Wires all event listeners. Called once at the end of the script.
 * Not exported — not unit-tested (couples to google.script.run).
 */
function init(): void {}

init();
```

**Step 2: Verify typecheck passes**

```bash
npm run typecheck
```
Expected: no errors.

**Step 3: Commit**

```bash
git add src/client/sidebar.ts
git commit -m "feat: add sidebar.ts skeleton with exported stubs"
```

---

### Task 4: TDD `buildTagList`

**Files:**
- Create: `__tests__/sidebar.test.ts`
- Modify: `src/client/sidebar.ts`

**Step 1: Create test file with jsdom env and `buildTagList` tests**

Create `__tests__/sidebar.test.ts`:

```typescript
/**
 * @jest-environment jsdom
 */

// Mock google.script.run before importing the module.
const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  runTool: jest.fn(),
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
};
(globalThis as unknown as { google: unknown }).google = { script: { run: mockRun } };

import { buildTagList } from "../src/client/sidebar";

// ── buildTagList ──────────────────────────────────────────────────────────────

describe("buildTagList", () => {
  function makeContainer(): HTMLElement {
    document.body.innerHTML = '<div id="c"></div>';
    return document.getElementById("c")!;
  }

  it("renders one .tag button per header", () => {
    const c = makeContainer();
    buildTagList(c, ["col_a", "col_b"]);
    const tags = c.querySelectorAll(".tag");
    expect(tags).toHaveLength(2);
    expect(tags[0].textContent).toBe("col_a");
    expect(tags[1].getAttribute("data-value")).toBe("col_b");
  });

  it("pre-selects headers listed in selected", () => {
    const c = makeContainer();
    buildTagList(c, ["col_a", "col_b", "col_c"], ["col_b"]);
    const selected = c.querySelectorAll(".tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("col_b");
  });

  it("toggles .selected on click", () => {
    const c = makeContainer();
    buildTagList(c, ["col_a"]);
    const tag = c.querySelector(".tag") as HTMLButtonElement;
    tag.click();
    expect(tag.classList.contains("selected")).toBe(true);
    tag.click();
    expect(tag.classList.contains("selected")).toBe(false);
  });

  it("clears container before rendering", () => {
    const c = makeContainer();
    buildTagList(c, ["a"]);
    buildTagList(c, ["b", "c"]);
    expect(c.querySelectorAll(".tag")).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/sidebar.test.ts
```
Expected: FAIL — `buildTagList` is a no-op stub, so "renders one .tag button" fails with `expected 2, received 0`.

**Step 3: Implement `buildTagList`**

Replace the `buildTagList` stub in `src/client/sidebar.ts`:

```typescript
export function buildTagList(
  container: HTMLElement,
  headers: string[],
  selected?: string[],
): void {
  container.innerHTML = "";
  headers.forEach((h) => {
    const btn = document.createElement("button");
    btn.className = "tag";
    btn.type = "button";
    btn.textContent = h;
    btn.setAttribute("data-value", h);
    if (selected?.includes(h)) btn.classList.add("selected");
    btn.addEventListener("click", () => btn.classList.toggle("selected"));
    container.appendChild(btn);
  });
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/sidebar.test.ts
```
Expected: all `buildTagList` tests PASS.

**Step 5: Commit**

```bash
git add __tests__/sidebar.test.ts src/client/sidebar.ts
git commit -m "feat: implement buildTagList with tests"
```

---

### Task 5: TDD `buildSingleTagList`

**Files:**
- Modify: `__tests__/sidebar.test.ts`
- Modify: `src/client/sidebar.ts`

**Step 1: Add `buildSingleTagList` tests**

Add to the import line in `sidebar.test.ts`:
```typescript
import { buildTagList, buildSingleTagList } from "../src/client/sidebar";
```

Append the following describe block to `__tests__/sidebar.test.ts`:

```typescript
// ── buildSingleTagList ────────────────────────────────────────────────────────

describe("buildSingleTagList", () => {
  function makeContainer(): HTMLElement {
    // Provide new-col-input in the document for the __new__ tag handler.
    document.body.innerHTML = '<div id="c"></div><input id="new-col-input" type="text" style="display:none">';
    return document.getElementById("c")!;
  }

  it("renders one .tag button per header", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a", "b"], false);
    expect(c.querySelectorAll(".tag")).toHaveLength(2);
  });

  it("appends a '+ New column' tag when includeNew is true", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a"], true);
    const tags = c.querySelectorAll(".tag");
    expect(tags).toHaveLength(2);
    expect(tags[1].getAttribute("data-value")).toBe("__new__");
    expect(tags[1].textContent).toBe("+ New column");
  });

  it("pre-selects the specified column", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a", "b"], false, "b");
    const selected = c.querySelectorAll(".tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("b");
  });

  it("clicking a tag deselects all others (single-select)", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a", "b", "c"], false);
    const tags = c.querySelectorAll<HTMLButtonElement>(".tag");
    tags[0].click();
    expect(tags[0].classList.contains("selected")).toBe(true);
    tags[1].click();
    expect(tags[0].classList.contains("selected")).toBe(false);
    expect(tags[1].classList.contains("selected")).toBe(true);
  });

  it("clicking __new__ shows new-col-input", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a"], true);
    const newBtn = c.querySelector<HTMLButtonElement>('[data-value="__new__"]')!;
    newBtn.click();
    expect(document.getElementById("new-col-input")!.style.display).toBe("block");
  });

  it("clicking a regular tag hides new-col-input", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a"], true);
    // First show it via __new__
    (c.querySelector<HTMLButtonElement>('[data-value="__new__"]')!).click();
    // Then click a regular tag — should hide input
    (c.querySelector<HTMLButtonElement>('[data-value="a"]')!).click();
    expect(document.getElementById("new-col-input")!.style.display).toBe("none");
  });
});
```

**Step 2: Run tests to verify new ones fail**

```bash
npx jest __tests__/sidebar.test.ts
```
Expected: `buildSingleTagList` tests FAIL.

**Step 3: Implement `buildSingleTagList`**

Replace the `buildSingleTagList` stub in `src/client/sidebar.ts`:

```typescript
export function buildSingleTagList(
  container: HTMLElement,
  headers: string[],
  includeNew: boolean,
  selected?: string,
): void {
  container.innerHTML = "";

  function selectOnly(clicked: HTMLButtonElement): void {
    container.querySelectorAll<HTMLButtonElement>(".tag").forEach((t) => {
      t.classList.remove("selected");
    });
    clicked.classList.add("selected");
  }

  headers.forEach((h) => {
    const btn = document.createElement("button");
    btn.className = "tag";
    btn.type = "button";
    btn.textContent = h;
    btn.setAttribute("data-value", h);
    if (selected === h) btn.classList.add("selected");
    btn.addEventListener("click", function () {
      selectOnly(this);
      const input = document.getElementById("new-col-input") as HTMLInputElement | null;
      if (input) input.style.display = "none";
    });
    container.appendChild(btn);
  });

  if (includeNew) {
    const newBtn = document.createElement("button");
    newBtn.className = "tag";
    newBtn.type = "button";
    newBtn.textContent = "+ New column";
    newBtn.setAttribute("data-value", "__new__");
    newBtn.addEventListener("click", function () {
      selectOnly(this);
      const input = document.getElementById("new-col-input") as HTMLInputElement | null;
      if (input) {
        input.style.display = "block";
        input.focus();
      }
    });
    container.appendChild(newBtn);
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/sidebar.test.ts
```
Expected: all `buildSingleTagList` tests PASS.

**Step 5: Commit**

```bash
git add __tests__/sidebar.test.ts src/client/sidebar.ts
git commit -m "feat: implement buildSingleTagList with tests"
```

---

### Task 6: TDD `handleRowRangeChange`

**Files:**
- Modify: `__tests__/sidebar.test.ts`
- Modify: `src/client/sidebar.ts`

**Step 1: Add `handleRowRangeChange` tests**

Update the import line in `sidebar.test.ts`:
```typescript
import { buildTagList, buildSingleTagList, handleRowRangeChange } from "../src/client/sidebar";
```

Append to `sidebar.test.ts`:

```typescript
// ── handleRowRangeChange ──────────────────────────────────────────────────────

describe("handleRowRangeChange", () => {
  function makeRowRangeDom(checkedValue: "selection" | "range"): void {
    document.body.innerHTML = `
      <input type="radio" name="row-range" value="selection" ${checkedValue === "selection" ? "checked" : ""}>
      <input type="radio" name="row-range" value="range" ${checkedValue === "range" ? "checked" : ""}>
      <div id="range-inputs" style="display:none"></div>
    `;
  }

  it("shows range-inputs when 'range' radio is checked", () => {
    makeRowRangeDom("range");
    handleRowRangeChange();
    expect(document.getElementById("range-inputs")!.style.display).toBe("flex");
  });

  it("hides range-inputs when 'selection' radio is checked", () => {
    makeRowRangeDom("selection");
    handleRowRangeChange();
    expect(document.getElementById("range-inputs")!.style.display).toBe("none");
  });
});
```

**Step 2: Run tests to verify new ones fail**

```bash
npx jest __tests__/sidebar.test.ts
```
Expected: `handleRowRangeChange` tests FAIL.

**Step 3: Implement `handleRowRangeChange`**

Replace the `handleRowRangeChange` stub in `src/client/sidebar.ts`:

```typescript
export function handleRowRangeChange(): void {
  const checked = document.querySelector<HTMLInputElement>(
    'input[name="row-range"]:checked',
  );
  const rangeInputs = document.getElementById("range-inputs");
  if (rangeInputs) {
    rangeInputs.style.display = checked?.value === "range" ? "flex" : "none";
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/sidebar.test.ts
```
Expected: all `handleRowRangeChange` tests PASS.

**Step 5: Commit**

```bash
git add __tests__/sidebar.test.ts src/client/sidebar.ts
git commit -m "feat: implement handleRowRangeChange with tests"
```

---

### Task 7: TDD `applyPreset`

**Files:**
- Modify: `__tests__/sidebar.test.ts`
- Modify: `src/client/sidebar.ts`

**Step 1: Add `applyPreset` tests**

Update the import line in `sidebar.test.ts`:
```typescript
import {
  buildTagList,
  buildSingleTagList,
  applyPreset,
  handleRowRangeChange,
} from "../src/client/sidebar";
```

Append to `sidebar.test.ts`:

```typescript
// ── applyPreset ───────────────────────────────────────────────────────────────

describe("applyPreset", () => {
  /**
   * Sets up the AI panel DOM with rendered tags for each container,
   * then calls applyPreset and asserts the result.
   */
  function setupPanel(headers: string[]): void {
    document.body.innerHTML = `
      <div id="user-prompt-cols"></div>
      <div id="drive-file-cols"></div>
      <div id="system-prompt-col"></div>
      <div id="output-col"></div>
      <input id="new-col-input" type="text" style="display:none">
      <input type="radio" name="row-range" value="selection" checked>
      <input type="radio" name="row-range" value="range">
      <div id="range-inputs" style="display:none">
        <input type="number" id="row-start">
        <input type="number" id="row-end">
      </div>
    `;
    buildTagList(document.getElementById("user-prompt-cols")!, headers);
    buildTagList(document.getElementById("drive-file-cols")!, headers);
    buildSingleTagList(document.getElementById("system-prompt-col")!, headers, false);
    buildSingleTagList(document.getElementById("output-col")!, headers, true);
  }

  it("pre-selects userPromptCols", () => {
    setupPanel(["col_a", "col_b", "col_c"]);
    applyPreset({ userPromptCols: ["col_a", "col_c"] });
    const selected = document.querySelectorAll("#user-prompt-cols .tag.selected");
    expect(selected).toHaveLength(2);
    expect(selected[0].getAttribute("data-value")).toBe("col_a");
    expect(selected[1].getAttribute("data-value")).toBe("col_c");
  });

  it("pre-selects driveFileCols", () => {
    setupPanel(["source_drive", "source_text"]);
    applyPreset({ driveFileCols: ["source_drive"] });
    const selected = document.querySelectorAll("#drive-file-cols .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("source_drive");
  });

  it("pre-selects systemPromptCol (single-select)", () => {
    setupPanel(["system_prompt", "user_prompt"]);
    applyPreset({ systemPromptCol: "system_prompt" });
    const selected = document.querySelectorAll("#system-prompt-col .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("system_prompt");
  });

  it("pre-selects outputCol (single-select)", () => {
    setupPanel(["ai_inference", "col_b"]);
    applyPreset({ outputCol: "ai_inference" });
    const selected = document.querySelectorAll("#output-col .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("ai_inference");
  });

  it("sets rowRange radio and populates inputs", () => {
    setupPanel(["col_a"]);
    applyPreset({ rowRange: { start: 2, end: 10 } });
    const rangeRadio = document.querySelector<HTMLInputElement>(
      'input[name="row-range"][value="range"]',
    )!;
    expect(rangeRadio.checked).toBe(true);
    expect((document.getElementById("row-start") as HTMLInputElement).value).toBe("2");
    expect((document.getElementById("row-end") as HTMLInputElement).value).toBe("10");
    expect(document.getElementById("range-inputs")!.style.display).toBe("flex");
  });

  it("ignores fields absent from the preset", () => {
    setupPanel(["col_a", "col_b"]);
    applyPreset({ userPromptCols: ["col_a"] });
    // drive-file-cols should have no selection
    expect(document.querySelectorAll("#drive-file-cols .tag.selected")).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify new ones fail**

```bash
npx jest __tests__/sidebar.test.ts
```
Expected: `applyPreset` tests FAIL.

**Step 3: Implement `applyPreset` and its private helpers**

Replace the `applyPreset` stub in `src/client/sidebar.ts`. Also add private helpers `setMultiSelected` and `setSingleSelected` (unexported):

```typescript
function setMultiSelected(containerId: string, values: string[]): void {
  document
    .getElementById(containerId)
    ?.querySelectorAll<HTMLButtonElement>(".tag")
    .forEach((tag) => {
      tag.classList.toggle("selected", values.includes(tag.getAttribute("data-value") ?? ""));
    });
}

function setSingleSelected(containerId: string, value: string): void {
  document
    .getElementById(containerId)
    ?.querySelectorAll<HTMLButtonElement>(".tag")
    .forEach((tag) => {
      tag.classList.toggle("selected", tag.getAttribute("data-value") === value);
    });
}

export function applyPreset(preset: Partial<RunConfig>): void {
  if (preset.userPromptCols) setMultiSelected("user-prompt-cols", preset.userPromptCols);
  if (preset.driveFileCols) setMultiSelected("drive-file-cols", preset.driveFileCols);
  if (preset.systemPromptCol) setSingleSelected("system-prompt-col", preset.systemPromptCol);
  if (preset.outputCol) setSingleSelected("output-col", preset.outputCol);
  if (preset.rowRange) {
    const rangeRadio = document.querySelector<HTMLInputElement>(
      'input[name="row-range"][value="range"]',
    );
    if (rangeRadio) {
      rangeRadio.checked = true;
      handleRowRangeChange();
      const startInput = document.getElementById("row-start") as HTMLInputElement | null;
      const endInput = document.getElementById("row-end") as HTMLInputElement | null;
      if (startInput) startInput.value = String(preset.rowRange.start);
      if (endInput) endInput.value = String(preset.rowRange.end);
    }
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/sidebar.test.ts
```
Expected: all `applyPreset` tests PASS.

**Step 5: Commit**

```bash
git add __tests__/sidebar.test.ts src/client/sidebar.ts
git commit -m "feat: implement applyPreset with tests"
```

---

### Task 8: TDD `assembleRunConfig`

**Files:**
- Modify: `__tests__/sidebar.test.ts`
- Modify: `src/client/sidebar.ts`

**Step 1: Add `assembleRunConfig` tests**

Update the import line in `sidebar.test.ts`:
```typescript
import {
  buildTagList,
  buildSingleTagList,
  applyPreset,
  assembleRunConfig,
  handleRowRangeChange,
} from "../src/client/sidebar";
```

Append to `sidebar.test.ts`:

```typescript
// ── assembleRunConfig ─────────────────────────────────────────────────────────

describe("assembleRunConfig", () => {
  // alert is not implemented in jsdom — mock it.
  beforeAll(() => {
    globalThis.alert = jest.fn();
  });

  afterEach(() => {
    (globalThis.alert as jest.Mock).mockClear();
  });

  const PANEL_HTML = `
    <div id="user-prompt-cols"></div>
    <div id="drive-file-cols"></div>
    <div id="system-prompt-col"></div>
    <div id="output-col"></div>
    <input id="new-col-input" type="text" style="display:none">
    <input type="radio" name="row-range" value="selection" checked>
    <input type="radio" name="row-range" value="range">
    <div id="range-inputs" style="display:none">
      <input type="number" id="row-start">
      <input type="number" id="row-end">
    </div>
  `;

  function setupWithSelections({
    userPrompt = [] as string[],
    drive = [] as string[],
    system = undefined as string | undefined,
    output = undefined as string | undefined,
    newOutputName = undefined as string | undefined,
    rowRange = undefined as { start: number; end: number } | undefined,
  } = {}): void {
    document.body.innerHTML = PANEL_HTML;
    buildTagList(document.getElementById("user-prompt-cols")!, ["col_a", "col_b", "col_c"]);
    buildTagList(document.getElementById("drive-file-cols")!, ["source_drive"]);
    buildSingleTagList(document.getElementById("system-prompt-col")!, ["system_prompt"], false);
    buildSingleTagList(document.getElementById("output-col")!, ["ai_inference"], true);

    if (userPrompt.length) applyPreset({ userPromptCols: userPrompt });
    if (drive.length) applyPreset({ driveFileCols: drive });
    if (system) applyPreset({ systemPromptCol: system });
    if (output) applyPreset({ outputCol: output });
    if (rowRange) applyPreset({ rowRange });

    if (newOutputName !== undefined) {
      // Simulate selecting __new__ and typing a name.
      const newBtn = document.querySelector<HTMLButtonElement>(
        '#output-col [data-value="__new__"]',
      )!;
      newBtn.click();
      (document.getElementById("new-col-input") as HTMLInputElement).value = newOutputName;
    }
  }

  it("returns a valid RunConfig when all required fields are selected", () => {
    setupWithSelections({ userPrompt: ["col_a"], output: "ai_inference" });
    const config = assembleRunConfig();
    expect(config).not.toBeNull();
    expect(config!.userPromptCols).toEqual(["col_a"]);
    expect(config!.outputCol).toBe("ai_inference");
    expect(config!.driveFileCols).toBeUndefined();
    expect(config!.systemPromptCol).toBeUndefined();
    expect(config!.rowRange).toBeUndefined();
  });

  it("includes driveFileCols when selected", () => {
    setupWithSelections({
      userPrompt: ["col_a"],
      drive: ["source_drive"],
      output: "ai_inference",
    });
    const config = assembleRunConfig();
    expect(config!.driveFileCols).toEqual(["source_drive"]);
  });

  it("includes systemPromptCol when selected", () => {
    setupWithSelections({
      userPrompt: ["col_a"],
      system: "system_prompt",
      output: "ai_inference",
    });
    const config = assembleRunConfig();
    expect(config!.systemPromptCol).toBe("system_prompt");
  });

  it("uses new-col-input value as outputCol when __new__ is selected", () => {
    setupWithSelections({ userPrompt: ["col_a"], newOutputName: "my_output" });
    const config = assembleRunConfig();
    expect(config).not.toBeNull();
    expect(config!.outputCol).toBe("my_output");
  });

  it("includes rowRange when 'range' radio is selected", () => {
    setupWithSelections({
      userPrompt: ["col_a"],
      output: "ai_inference",
      rowRange: { start: 3, end: 7 },
    });
    const config = assembleRunConfig();
    expect(config!.rowRange).toEqual({ start: 3, end: 7 });
  });

  it("returns null and alerts when no userPromptCols selected", () => {
    setupWithSelections({ output: "ai_inference" });
    const config = assembleRunConfig();
    expect(config).toBeNull();
    expect(globalThis.alert).toHaveBeenCalledWith(
      "Please select at least one User prompt column.",
    );
  });

  it("returns null and alerts when no output column selected", () => {
    setupWithSelections({ userPrompt: ["col_a"] });
    const config = assembleRunConfig();
    expect(config).toBeNull();
    expect(globalThis.alert).toHaveBeenCalledWith("Please select an output column.");
  });

  it("returns null and alerts when __new__ selected but input is blank", () => {
    setupWithSelections({ userPrompt: ["col_a"], newOutputName: "  " });
    const config = assembleRunConfig();
    expect(config).toBeNull();
    expect(globalThis.alert).toHaveBeenCalledWith(
      "Please enter a name for the new output column.",
    );
  });

  it("returns null and alerts when row range values are invalid", () => {
    setupWithSelections({ userPrompt: ["col_a"], output: "ai_inference" });
    // Manually set range radio and bad inputs.
    (
      document.querySelector<HTMLInputElement>('input[name="row-range"][value="range"]')!
    ).checked = true;
    (document.getElementById("row-start") as HTMLInputElement).value = "5";
    (document.getElementById("row-end") as HTMLInputElement).value = "3"; // end < start
    const config = assembleRunConfig();
    expect(config).toBeNull();
    expect(globalThis.alert).toHaveBeenCalledWith(
      "Please enter a valid row range (start ≥ 2, end ≥ start).",
    );
  });
});
```

**Step 2: Run tests to verify new ones fail**

```bash
npx jest __tests__/sidebar.test.ts
```
Expected: `assembleRunConfig` tests FAIL (stub returns `null` always, so "valid config" tests fail).

**Step 3: Implement `assembleRunConfig`**

Add private helper `getSelectedValues` (unexported) and replace the `assembleRunConfig` stub in `src/client/sidebar.ts`:

```typescript
function getSelectedValues(containerId: string): string[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>(`#${containerId} .tag.selected`),
  )
    .map((t) => t.getAttribute("data-value") ?? "")
    .filter(Boolean);
}

export function assembleRunConfig(): RunConfig | null {
  const userPromptCols = getSelectedValues("user-prompt-cols");
  if (userPromptCols.length === 0) {
    alert("Please select at least one User prompt column.");
    return null;
  }

  const driveFileCols = getSelectedValues("drive-file-cols");

  const sysTag = document.querySelector<HTMLButtonElement>(
    "#system-prompt-col .tag.selected",
  );
  const systemPromptCol = sysTag?.getAttribute("data-value") ?? undefined;

  const outputTag = document.querySelector<HTMLButtonElement>("#output-col .tag.selected");
  if (!outputTag) {
    alert("Please select an output column.");
    return null;
  }

  let outputCol: string;
  if (outputTag.getAttribute("data-value") === "__new__") {
    const input = document.getElementById("new-col-input") as HTMLInputElement | null;
    outputCol = input?.value.trim() ?? "";
    if (!outputCol) {
      alert("Please enter a name for the new output column.");
      return null;
    }
  } else {
    outputCol = outputTag.getAttribute("data-value") ?? "";
  }

  const rowRangeMode = document.querySelector<HTMLInputElement>(
    'input[name="row-range"]:checked',
  )?.value;

  let rowRange: { start: number; end: number } | undefined;
  if (rowRangeMode === "range") {
    const start = parseInt(
      (document.getElementById("row-start") as HTMLInputElement | null)?.value ?? "",
      10,
    );
    const end = parseInt(
      (document.getElementById("row-end") as HTMLInputElement | null)?.value ?? "",
      10,
    );
    if (isNaN(start) || isNaN(end) || start < 2 || end < start) {
      alert("Please enter a valid row range (start ≥ 2, end ≥ start).");
      return null;
    }
    rowRange = { start, end };
  }

  return {
    userPromptCols,
    driveFileCols: driveFileCols.length > 0 ? driveFileCols : undefined,
    systemPromptCol,
    outputCol,
    rowRange,
  };
}
```

**Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/sidebar.test.ts
```
Expected: all `assembleRunConfig` tests PASS.

**Step 5: Run full test suite to confirm no regressions**

```bash
npm test
```
Expected: all tests PASS.

**Step 6: Commit**

```bash
git add __tests__/sidebar.test.ts src/client/sidebar.ts
git commit -m "feat: implement assembleRunConfig with tests"
```

---

### Task 9: Add untested wrappers and `init()`

**Files:**
- Modify: `src/client/sidebar.ts`

These functions are not unit-tested (they call `google.script.run` or toggle panel visibility — same rationale as the server tool orchestrators in `index.ts`).

**Step 1: Replace the `init()` stub and add panel/dispatch functions**

Replace the entire `init()` stub at the bottom of `src/client/sidebar.ts` with the full set of wiring functions. Add these **before** `init()`:

```typescript
// ── Panel navigation ──────────────────────────────────────────────────────────

function showAIPanel(preset?: Partial<RunConfig>): void {
  document.getElementById("tool-list")!.style.display = "none";
  document.getElementById("ai-panel")!.style.display = "block";
  document.getElementById("config-form")!.style.display = "none";
  document.getElementById("no-headers-msg")!.style.display = "none";

  google.script.run
    .withSuccessHandler((headers: unknown) => {
      const hs = headers as string[];
      if (!hs || hs.length === 0) {
        document.getElementById("no-headers-msg")!.style.display = "block";
        return;
      }
      buildTagList(document.getElementById("user-prompt-cols")!, hs);
      buildTagList(document.getElementById("drive-file-cols")!, hs);
      buildSingleTagList(document.getElementById("system-prompt-col")!, hs, false);
      buildSingleTagList(document.getElementById("output-col")!, hs, true);
      if (preset) applyPreset(preset);
      document.getElementById("config-form")!.style.display = "block";
    })
    .withFailureHandler((msg: Error | string) => {
      alert("Error loading headers: " + msg);
      hideAIPanel();
    })
    .getSheetHeaders();
}

function hideAIPanel(): void {
  document.getElementById("ai-panel")!.style.display = "none";
  document.getElementById("tool-list")!.style.display = "block";
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

function dispatchTool(e: MouseEvent, fn: string): void {
  const btn = e.currentTarget as HTMLButtonElement;
  const orig = btn.innerHTML;
  btn.classList.add("loading");
  btn.innerHTML = '<span class="icon">⏳</span> Working...';
  google.script.run
    .withSuccessHandler(() => {
      btn.classList.remove("loading");
      btn.innerHTML = orig;
    })
    .withFailureHandler((msg: Error | string) => {
      alert("Error: " + msg);
      btn.classList.remove("loading");
      btn.innerHTML = orig;
    })
    .runTool(fn);
}

// ── Run AI ────────────────────────────────────────────────────────────────────

function runAI(): void {
  const config = assembleRunConfig();
  if (!config) return;

  const btn = document.getElementById("run-btn") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Running...";

  google.script.run
    .withSuccessHandler(() => {
      btn.disabled = false;
      btn.textContent = "Run AI";
      hideAIPanel();
    })
    .withFailureHandler((msg: Error | string) => {
      alert("Error: " + msg);
      btn.disabled = false;
      btn.textContent = "Run AI";
    })
    .runBatchAI(config);
}
```

Replace the `init()` stub with:

```typescript
function init(): void {
  document
    .getElementById("btn-import-drive-links")
    ?.addEventListener("click", (e) => dispatchTool(e as MouseEvent, "importDriveLinks"));

  document
    .getElementById("btn-run-ai")
    ?.addEventListener("click", () => showAIPanel());

  document
    .getElementById("btn-sample-rows")
    ?.addEventListener("click", (e) =>
      dispatchTool(e as MouseEvent, "sampleRowsToEvaluation"),
    );

  document
    .getElementById("btn-extract-text")
    ?.addEventListener("click", (e) =>
      dispatchTool(e as MouseEvent, "extractTextFromSelection"),
    );

  document.getElementById("back-btn")?.addEventListener("click", () => hideAIPanel());
  document.getElementById("cancel-btn")?.addEventListener("click", () => hideAIPanel());
  document.getElementById("run-btn")?.addEventListener("click", () => runAI());

  document
    .querySelectorAll<HTMLInputElement>('input[name="row-range"]')
    .forEach((radio) => radio.addEventListener("change", handleRowRangeChange));
}

init();
```

**Step 2: Verify typecheck passes**

```bash
npm run typecheck
```
Expected: no errors.

**Step 3: Run tests — confirm nothing regressed**

```bash
npm test
```
Expected: all tests PASS.

**Step 4: Commit**

```bash
git add src/client/sidebar.ts
git commit -m "feat: add showAIPanel, hideAIPanel, dispatchTool, runAI, init"
```

---

### Task 10: Update `src/Sidebar.html` template

**Files:**
- Modify: `src/Sidebar.html`

**Step 1: Strip the `<script>` block and add `{{SCRIPTS}}`**

In `src/Sidebar.html`, remove the entire `<script>...</script>` block (currently at the bottom of `<body>`). Replace it with `{{SCRIPTS}}`:

```html
    {{SCRIPTS}}
</body>
```

**Step 2: Update button markup for event listener wiring**

The inline `onclick` attributes must be removed and replaced with `id` attributes so `init()` can wire them. Make these changes to the HTML:

```html
<!-- Import Drive Links button -->
<button id="btn-import-drive-links" class="tool-btn">
    <span class="icon">📂</span> Import Drive Links
</button>

<!-- Run AI Inference button -->
<button id="btn-run-ai" class="tool-btn">
    <span class="icon">▶️</span> Run AI Inference
</button>

<!-- Sample Rows button -->
<button id="btn-sample-rows" class="tool-btn">
    <span class="icon">🎲</span> Sample Rows
</button>

<!-- Extract Text button -->
<button id="btn-extract-text" class="tool-btn">
    <span class="icon">📜</span> Extract Text
</button>

<!-- Back button — add id, keep class -->
<button id="back-btn" class="back-btn">← Back</button>

<!-- Cancel button — add id -->
<button id="cancel-btn" class="btn-cancel">Cancel</button>
```

Also remove `onchange="handleRowRangeChange()"` from the two radio inputs (the listener is wired in `init()`).

**Step 3: Verify the template looks correct**

After edits, `src/Sidebar.html` should have:
- `<base target="_top">` and `{{STYLES}}` in `<head>`
- No `<style>` block, no `<link>` to Google Fonts
- All buttons with `id` attributes and no `onclick`/`onchange` attributes
- `{{SCRIPTS}}` just before `</body>`

**Step 4: Commit**

```bash
git add src/Sidebar.html
git commit -m "feat: convert Sidebar.html to build template with id-wired buttons"
```

---

### Task 11: Add `inlineSidebarHtml` Rollup plugin and second config

**Files:**
- Modify: `rollup.config.js`

**Step 1: Add the plugin and second config entry**

Replace the contents of `rollup.config.js` with:

```javascript
import typescript from "@rollup/plugin-typescript";
import { nodeResolve } from "@rollup/plugin-node-resolve";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Rollup plugin: reads src/Sidebar.html (template) and src/client/sidebar.css,
 * inlines the compiled client JS and the CSS, and writes dist/Sidebar.html.
 * The intermediate JS chunk is deleted from the bundle so clasp never sees it.
 */
function inlineSidebarHtml({ template, css }) {
  return {
    name: "inline-sidebar-html",
    buildStart() {
      // Tell Rollup's watcher to re-run this config when CSS or template changes.
      this.addWatchFile(resolve(css));
      this.addWatchFile(resolve(template));
    },
    generateBundle(_options, bundle) {
      const chunkKey = Object.keys(bundle).find((k) => bundle[k].type === "chunk");
      const code = chunkKey ? bundle[chunkKey].code : "";

      const templateContent = readFileSync(resolve(template), "utf-8");
      const cssContent = readFileSync(resolve(css), "utf-8");

      const assembled = templateContent
        .replace("{{STYLES}}", `<style>\n${cssContent}\n</style>`)
        .replace("{{SCRIPTS}}", `<script>\n${code}\n</script>`);

      this.emitFile({ type: "asset", fileName: "Sidebar.html", source: assembled });

      // Suppress the JS chunk — clasp must not push it as a .gs file.
      if (chunkKey) delete bundle[chunkKey];
    },
  };
}

export default [
  // ── Config 1: Server bundle (unchanged) ─────────────────────────────────────
  {
    input: "src/server/index.ts",
    output: {
      dir: "dist",
      format: "iife",
      name: "_GASEntry",
      inlineDynamicImports: true,
      sourcemap: true,
      banner: "/* Apps Script Bundle — generated by Rollup. Do not edit. */",
      footer: `
/**
 * Global Handshake — Explicit function stubs for Google Apps Script discovery.
 *
 * Every export from index.ts that Apps Script needs to call must have a
 * matching one-line stub here. Rollup's IIFE wrapper scopes everything inside
 * _GASEntry; these stubs re-expose the relevant functions in the global scope.
 *
 * CUSTOM FUNCTIONS: If the stub is for a Sheets custom function (callable from
 * a cell formula), you MUST add a JSDoc comment with @customfunction directly
 * on the stub below. The TypeScript-level JSDoc is compiled away by Rollup and
 * does NOT appear on the global stub. Google Sheets only recognises a function
 * as a custom function when @customfunction is present on the global declaration
 * — without it the function will not appear in autocomplete or parameter hints.
 */
function onOpen(e) { _GASEntry.onOpen(e); }
function showSidebar() { _GASEntry.showSidebar(); }
function runTool(fn) { _GASEntry.runTool(fn); }
function getSheetHeaders() { return _GASEntry.getSheetHeaders(); }
function runBatchAI(config) { _GASEntry.runBatchAI(config); }
function importDriveLinks() { _GASEntry.importDriveLinks(); }
function extractTextFromSelection() { _GASEntry.extractTextFromSelection(); }
function sampleRowsToEvaluation() { _GASEntry.sampleRowsToEvaluation(); }
/**
 * Call the Gemini API from a spreadsheet cell.
 * @param {string|Array} userTexts One or more text parts for the user message.
 *   Pass a single string, a cell reference, or a range / array literal.
 * @param {string} [systemPrompt] (Optional) System-level instruction for the model.
 * @param {string|Array} [toolNames] (Optional) Names of pre-registered tools to enable.
 * @return {string} The model's text response, or "[SSI Error: ...]" on failure.
 * @customfunction
 */
function SSI(userTexts, systemPrompt, toolNames) { return _GASEntry.SSI(userTexts, systemPrompt, toolNames); }
`,
    },
    plugins: [nodeResolve({ preferBuiltins: false }), typescript({ tsconfig: "./tsconfig.json" })],
  },

  // ── Config 2: Client bundle → dist/Sidebar.html ──────────────────────────────
  {
    input: "src/client/sidebar.ts",
    output: {
      dir: "dist",
      format: "iife",
      name: "_Sidebar",
      entryFileNames: "_sidebar.js", // temp filename, deleted by plugin before write
    },
    plugins: [
      nodeResolve({ preferBuiltins: false }),
      typescript({ tsconfig: "./tsconfig.json" }),
      inlineSidebarHtml({
        template: "src/Sidebar.html",
        css: "src/client/sidebar.css",
      }),
    ],
  },
];
```

**Step 2: Verify the build runs without errors**

```bash
npm run build
```
Expected: exits 0. Check `dist/` — you should see `index.js`, `Sidebar.html`, `appsscript.json`, but NOT `_sidebar.js`.

**Step 3: Spot-check `dist/Sidebar.html`**

Open `dist/Sidebar.html` and confirm:
- It contains a `<style>` block with the sidebar CSS (no Google Fonts link)
- It contains a `<script>` block with compiled JS
- It does NOT contain the literal strings `{{STYLES}}` or `{{SCRIPTS}}`
- Buttons have `id` attributes matching what `init()` wires

**Step 4: Commit**

```bash
git add rollup.config.js
git commit -m "feat: add inlineSidebarHtml Rollup plugin and client build config"
```

---

### Task 12: Update `package.json` scripts and coverage config

**Files:**
- Modify: `package.json`
- Modify: `jest.config.cjs`

**Step 1: Remove `cp src/Sidebar.html dist/` from build scripts**

In `package.json`, update two scripts:

```json
"build": "rimraf dist && rollup -c && cp appsscript.json dist/",
"build:watch": "mkdir -p dist && cp appsscript.json dist/ && rollup -c --watch",
```

The `cp src/Sidebar.html dist/` suffix is removed from `build`. The `cp src/Sidebar.html dist/` call is removed from `build:watch` as well. The Rollup plugin handles writing `dist/Sidebar.html` in both modes.

**Step 2: Add `sidebar.ts` coverage threshold and exclude `google.d.ts`**

In `jest.config.cjs`:

1. Add `!src/client/google.d.ts` to `collectCoverageFrom` (it's a declaration file with no executable code):

```javascript
collectCoverageFrom: [
  "src/**/*.ts",
  "!src/server/index.ts",
  "!src/client/google.d.ts",
],
```

2. Add a per-file threshold for `src/client/sidebar.ts`. The untested wrappers (`showAIPanel`, `hideAIPanel`, `dispatchTool`, `runAI`, `init`) are excluded from the threshold rationale. Set thresholds based on the tested helpers covering ~60% of the file:

```javascript
"./src/client/sidebar.ts": {
  statements: 60,
  branches: 70,
  functions: 55,
},
```

> **Note:** After running `npm run test:coverage` for the first time, adjust these values to ~5 points below the observed output (same convention as the other thresholds in this file).

**Step 3: Verify the full test suite with coverage passes**

```bash
npm run test:coverage
```
Expected: all tests pass, all per-file thresholds met.

**Step 4: Run a full build to confirm nothing is broken**

```bash
npm run build
```
Expected: exits 0. `dist/` contains `index.js`, `Sidebar.html`, `appsscript.json`. No `_sidebar.js`.

**Step 5: Commit**

```bash
git add package.json jest.config.cjs
git commit -m "chore: update build scripts and coverage config for client module"
```

---

### Task 13: End-to-end verification

**Files:** none

**Step 1: Full clean build**

```bash
npm run build
```
Expected: exits 0.

**Step 2: Full test suite**

```bash
npm test
```
Expected: all suites pass. New suite: `__tests__/sidebar.test.ts`.

**Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

**Step 4: Lint**

```bash
npm run lint
```
Expected: no errors. (ESLint runs on `src/**/*.ts` which now includes `src/client/sidebar.ts`.)

**Step 5: Verify `dist/Sidebar.html` structure**

Open `dist/Sidebar.html` in a browser (or just inspect the file). Confirm:
- No `{{STYLES}}` or `{{SCRIPTS}}` literals remain
- CSS is inlined in a `<style>` block
- JS is inlined in a `<script>` block
- No `onclick` or `onchange` attributes on buttons/radios
- Buttons have `id="btn-import-drive-links"`, `id="btn-run-ai"`, etc.
- No `<link>` to `fonts.googleapis.com`

**Step 6: Final commit if any loose ends**

If everything is clean:

```bash
git status
# Should be clean. If not, commit any final tweaks.
```

---

## Summary of changed files

| File | Action |
|---|---|
| `src/client/google.d.ts` | Created |
| `src/client/sidebar.ts` | Created |
| `src/client/sidebar.css` | Created |
| `src/Sidebar.html` | Modified (template with placeholders, id-wired buttons) |
| `__tests__/sidebar.test.ts` | Created |
| `rollup.config.js` | Modified (array export + `inlineSidebarHtml` plugin) |
| `package.json` | Modified (remove `cp src/Sidebar.html dist/` from build scripts) |
| `jest.config.cjs` | Modified (exclude `google.d.ts`, add `sidebar.ts` threshold) |
| `tsconfig.json` | Modified (add `"DOM"` to lib) |
