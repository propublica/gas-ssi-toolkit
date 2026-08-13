# Row Range Default Fill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-08-12-row-range-default-fill-design.md` — wire the previously-unused `getDefaultRowRange` RPC into `ConfigureAIRunPanel` and `ExtractTextPanel` so their "Specify range" inputs are pre-filled with a sensible default (row 2 through the sheet's last populated row) instead of starting blank, without changing either panel's default "Use highlighted rows" mode.

**Architecture:** `RowRange`'s constructor changes from a single positional `RowRangeValue | undefined` to an options object (`{ selected?, fallback? }`), since it now needs two independent optional values of the same shape and a bare second positional argument would make call sites ambiguous. `fallback` only affects which values pre-fill the (initially hidden) Specify-range inputs — it never changes which mode is checked. Both panels fetch `getDefaultRowRange()` once per mount/refresh and pass the result through as `fallback`.

**Tech Stack:** TypeScript (ES2019 target), Jest + ts-jest, Google Apps Script (`clasp`), Rollup.

## Global Constraints

- Named exports only — no default exports. `const` by default, no `var`. `===` always. Avoid `any` — prefer `unknown`.
- Explicit return types on functions.
- Double quotes, semicolons, trailing commas (Prettier-enforced).
- This repo's pre-commit hook runs the full test suite (`npx jest --bail`) plus lint-staged before every commit — never use `git commit --no-verify` or any hook-bypass flag. Task 1 below updates `RowRange`'s constructor signature; both of its call sites (`ConfigureAIRunPanel`, `ExtractTextPanel`) must be updated in that same task/commit to keep compiling, even though neither gets the new `fallback` wiring until its own later task.
- **Promise timing in `ConfigureAIRunPanel` (read before starting Task 2):** `loadHeaders()` currently does a single `getSheetHeaders().then(...)` chain, and this codebase's tests rely on that resolving within exactly one `await Promise.resolve()` tick — confirmed empirically, not assumed. Combining it with `getDefaultRowRange()` via `Promise.all` needs **three** microtask ticks to settle instead of one (confirmed empirically: a plain `Promise.all([p1, p2])` needs 2 ticks, and wrapping one input in `.catch()`/`.then(ok, fail)` to isolate its errors from the other promise adds one more, regardless of which of those two forms you use — they're equivalent under the hood). Every test that awaits header-loading with a single `await Promise.resolve()` needs to await more ticks after Task 2 lands. Task 2's steps below list every affected test site precisely (found by grep, not guessed) and specify the fix. `ExtractTextPanel` does **not** have this problem — see Task 3's note on why its `getDefaultRowRange()` fetch stays a fully independent, single-tick promise chain instead of being combined with anything.
- Every commit must leave the full `npm test` suite green.

---

## File Map

| File | Change |
| --- | --- |
| `src/client/components/row-range.ts` | Constructor takes a `RowRangeOptions` object (`{ selected?, fallback? }`) instead of a bare `RowRangeValue`; `fallback` pre-fills the Specify-range inputs' values when `selected` is absent |
| `src/client/panels/configure-ai-run.ts` | `loadHeaders()` fetches `getDefaultRowRange()` alongside `getSheetHeaders()` via `Promise.all`, passes the result as `RowRange`'s `fallback` |
| `src/client/panels/extract-text.ts` | `mount()` fetches `getDefaultRowRange()` independently, passes the result as `RowRange`'s `fallback` once it resolves |
| `__tests__/components/row-range.test.ts` | Existing calls updated to the options-object form; new tests for fallback pre-fill and fallback-is-ignored-when-selected-present |
| `__tests__/panels/configure-ai-run.test.ts` | `getDefaultRowRange` added to the services mock; every test site that awaits header-loading with a single tick updated to await more; new tests for the fallback wiring |
| `__tests__/panels/extract-text.test.ts` | `getDefaultRowRange` added to the services mock with a `beforeEach` default; new tests for the fallback wiring |

---

### Task 1: `RowRange` options-object API, with both call sites kept compiling

**Files:**
- Modify: `src/client/components/row-range.ts`
- Modify: `src/client/panels/configure-ai-run.ts:217-220` (call-site wrap only — no `fallback` wiring yet)
- Modify: `src/client/panels/extract-text.ts:65` (call-site wrap only — no `fallback` wiring yet)
- Test: `__tests__/components/row-range.test.ts`

**Interfaces:**
- Produces: `export interface RowRangeOptions { selected?: RowRangeValue; fallback?: RowRangeValue }`; `RowRange`'s constructor becomes `constructor(container: HTMLElement, options?: RowRangeOptions)`. `getValue()` is unchanged.

This task's two call-site edits are pure mechanical wrapping (`new RowRange(el, value)` → `new RowRange(el, { selected: value })`) — neither panel gets the new default-fill behavior yet. That's Tasks 2 and 3.

- [ ] **Step 1: Write the failing tests in `__tests__/components/row-range.test.ts`**

Update the three existing calls that pass a bare `RowRangeValue` as the second argument:

```ts
// Line 23
    new RowRange(c, { selected: { start: 3, end: 9 } });

// Line 48
    const r = new RowRange(c, { selected: { start: 2, end: 10 } });

// Line 54
    new RowRange(c, { selected: { start: 2, end: 5 } }); // starts with range checked
```

(The four calls that pass no second argument at all — `new RowRange(c);` — need no change; `options?: RowRangeOptions` being absent is still valid.)

Add these two new tests at the end of the `describe("RowRange", ...)` block:

```ts
  it("pre-fills range inputs from fallback when selected is absent, without checking 'range'", () => {
    const c = makeContainer();
    new RowRange(c, { fallback: { start: 2, end: 15 } });
    const selRadio = c.querySelector<HTMLInputElement>('input[value="selection"]');
    const numbers = c.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(selRadio?.checked).toBe(true);
    expect(numbers[0].value).toBe("2");
    expect(numbers[1].value).toBe("15");
  });

  it("ignores fallback when selected is present", () => {
    const c = makeContainer();
    new RowRange(c, { selected: { start: 3, end: 9 }, fallback: { start: 2, end: 100 } });
    const numbers = c.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(numbers[0].value).toBe("3");
    expect(numbers[1].value).toBe("9");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/components/row-range.test.ts`
Expected: FAIL — the three updated calls now pass an object shape `RowRange`'s current constructor doesn't understand (TS compile error: `Property 'start' is missing...` or similar), and the two new tests reference a `fallback` option that doesn't exist yet.

- [ ] **Step 3: Implement in `src/client/components/row-range.ts`**

Add the new exported interface, near the top of the file (after `RowRangeValue`):

```ts
export interface RowRangeOptions {
  /** The current value. Presence of this determines which radio is checked and pre-fills the inputs. */
  selected?: RowRangeValue;
  /** Used only when `selected` is absent — pre-fills the (hidden) Specify-range inputs' values without changing which mode is checked. */
  fallback?: RowRangeValue;
}
```

Update the constructor:

```ts
  constructor(container: HTMLElement, options?: RowRangeOptions) {
    this.container = container;
    const groupName = `row-range-${RowRange.instanceCount++}`;
    const refs = this.render(options, groupName);
    this.startInput = refs.startInput;
    this.endInput = refs.endInput;
    this.rangeRadio = refs.rangeRadio;
  }
```

Update `render()` — its first parameter changes from `selected: RowRangeValue | undefined` to `options: RowRangeOptions | undefined`, and a new `prefill` value (used only for the inputs' `.value`, never for which radio is checked) is derived at the top:

```ts
  private render(
    options: RowRangeOptions | undefined,
    groupName: string,
  ): {
    startInput: HTMLInputElement;
    endInput: HTMLInputElement;
    rangeRadio: HTMLInputElement;
  } {
    const selected = options?.selected;
    const prefill = selected ?? options?.fallback;

    this.container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "row-range-options";

    const selLabel = document.createElement("label");
    const selRadio = document.createElement("input");
    selRadio.type = "radio";
    selRadio.name = groupName;
    selRadio.value = "selection";
    selRadio.checked = !selected;
    selLabel.append(selRadio, " Use highlighted rows");

    const rangeLabel = document.createElement("label");
    const rangeRadio = document.createElement("input");
    rangeRadio.type = "radio";
    rangeRadio.name = groupName;
    rangeRadio.value = "range";
    rangeRadio.checked = !!selected;
    rangeLabel.append(rangeRadio, " Specify range");

    const rangeInputs = document.createElement("div");
    rangeInputs.className = "range-inputs";
    rangeInputs.style.display = selected ? "flex" : "none";

    const startInput = document.createElement("input");
    startInput.type = "number";
    startInput.placeholder = "Start row";
    startInput.min = "2";
    if (prefill) startInput.value = String(prefill.start);

    const endInput = document.createElement("input");
    endInput.type = "number";
    endInput.placeholder = "End row";
    endInput.min = "2";
    if (prefill) endInput.value = String(prefill.end);

    rangeInputs.append(startInput, endInput);
    wrapper.append(selLabel, rangeLabel, rangeInputs);
    this.container.appendChild(wrapper);

    const toggle = (): void => {
      rangeInputs.style.display = rangeRadio.checked ? "flex" : "none";
    };
    selRadio.addEventListener("change", toggle);
    rangeRadio.addEventListener("change", toggle);

    return { startInput, endInput, rangeRadio };
  }
```

`getValue()` is unchanged — do not touch it.

- [ ] **Step 4: Update the two call sites to keep the repo compiling**

In `src/client/panels/configure-ai-run.ts`, around lines 217-220, change:

```ts
        this.rowRangeComp = new RowRange(
          container.querySelector("#row-range-container")!,
          preset.rowRange,
        );
```

to:

```ts
        this.rowRangeComp = new RowRange(container.querySelector("#row-range-container")!, {
          selected: preset.rowRange,
        });
```

In `src/client/panels/extract-text.ts`, line 65, change:

```ts
    this.rowRange = new RowRange(container.querySelector("#row-range")!, savedRowRange);
```

to:

```ts
    this.rowRange = new RowRange(container.querySelector("#row-range")!, { selected: savedRowRange });
```

Neither of these two edits changes behavior — they're purely mechanical, wrapping the existing value in `{ selected: ... }`. No test in either panel's test file should need any change from this step alone.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: PASS — all 708 existing tests plus the 2 new `row-range.test.ts` tests, no regressions in either panel's test file.

- [ ] **Step 6: Commit**

```bash
git add src/client/components/row-range.ts src/client/panels/configure-ai-run.ts src/client/panels/extract-text.ts __tests__/components/row-range.test.ts
git commit -m "feat: give RowRange an options-object API with a fallback pre-fill"
```

---

### Task 2: Wire `getDefaultRowRange` into `ConfigureAIRunPanel`

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts:8` (import), `:184-220` (`loadHeaders()`)
- Test: `__tests__/panels/configure-ai-run.test.ts`

**Interfaces:**
- Consumes: `RowRangeOptions` (Task 1), `services.getDefaultRowRange(): Promise<{ start: number; end: number } | undefined>` (already exists from a prior session's work).

**Read the Global Constraints section's promise-timing note before starting this task** — it explains exactly why the steps below touch several test sites beyond the ones that test this feature directly.

- [ ] **Step 1: Add `getDefaultRowRange` to the services mock**

In `__tests__/panels/configure-ai-run.test.ts`, update the `jest.mock("../../src/client/services", ...)` factory (lines 5-10):

```ts
jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
  getActiveRangeInfo: jest.fn().mockResolvedValue(undefined),
  getJobProgress: jest.fn().mockResolvedValue(undefined),
  getDefaultRowRange: jest.fn().mockResolvedValue(undefined),
}));
```

- [ ] **Step 2: Fix every test site that awaits header-loading with a single tick**

These five sites currently assume `loadHeaders()`'s promise settles after exactly one `await Promise.resolve()`. After Step 4 below lands, it needs more (three, for the success path; the codebase already uses `for (let i = 0; i < 5; i++) await Promise.resolve();` as its idiom for "flush a deeper promise chain" in over a dozen other places in this same file — use that same idiom here rather than a fragile exact count).

**`mountAndLoad` helper (lines 64-75)** — this one covers the vast majority of tests in the file:

```ts
async function mountAndLoad(
  params?: Partial<RunConfig>,
  savedState?: Partial<SavedState>,
  headers = DEFAULT_HEADERS,
): Promise<{ container: HTMLElement; panel: ConfigureAIRunPanel }> {
  (services.getSheetHeaders as jest.Mock).mockResolvedValue(headers);
  const container = makeContainer();
  const panel = new ConfigureAIRunPanel();
  panel.mount(container, mockNav, params, savedState as SavedState);
  // loadHeaders() now awaits Promise.all([getSheetHeaders(), getDefaultRowRange()]),
  // which needs more microtask ticks to settle than a single promise chain did.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return { container, panel };
}
```

**"shows no-headers-msg when headers list is empty" (around line 127-135)** — replace the single `await Promise.resolve();` (line 132) with:

```ts
    for (let i = 0; i < 5; i++) await Promise.resolve();
```

**"calls nav.back() on getSheetHeaders failure and alerts" (around line 137-145)** — replace the single `await Promise.resolve();` (line 142) with:

```ts
    for (let i = 0; i < 5; i++) await Promise.resolve();
```

**"shows PanelLoader while headers are loading" (around line 181-198)** — replace both individual awaits after `resolveHeaders(DEFAULT_HEADERS);`:

```ts
    // was:
    // await Promise.resolve();
    // await Promise.resolve(); // flush finally()
    resolveHeaders(DEFAULT_HEADERS);
    for (let i = 0; i < 5; i++) await Promise.resolve();
```

**"browse-recipes-link navigates to recipes-list when no headers present" (around line 397-405)** — replace the single `await Promise.resolve();` (line 402) with:

```ts
    for (let i = 0; i < 5; i++) await Promise.resolve();
```

Do **not** touch "populates tools from TOOL_CATALOG synchronously (before headers load)" (~line 501) or "unmount() before headers load returns undefined" (~line 640) — both mock `getSheetHeaders` to never resolve at all and assert synchronous behavior with no `await`, so they're unaffected by this change.

- [ ] **Step 3: Add the new feature tests**

Add this new describe block (placement doesn't matter — end of file is fine):

```ts
describe("row range default fill", () => {
  it("pre-fills the Specify-range inputs from getDefaultRowRange when no rowRange preset is given", async () => {
    (services.getDefaultRowRange as jest.Mock).mockResolvedValue({ start: 2, end: 50 });
    const { container } = await mountAndLoad();
    const rangeRadio = container.querySelector<HTMLInputElement>("input[value='range']")!;
    rangeRadio.click();
    const numbers = container.querySelectorAll<HTMLInputElement>(".range-inputs input");
    expect(numbers[0].value).toBe("2");
    expect(numbers[1].value).toBe("50");
  });

  it("does not use the fallback when a rowRange preset is already given", async () => {
    (services.getDefaultRowRange as jest.Mock).mockResolvedValue({ start: 2, end: 999 });
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 5, end: 8 },
    });
    const numbers = container.querySelectorAll<HTMLInputElement>(".range-inputs input");
    expect(numbers[0].value).toBe("5");
    expect(numbers[1].value).toBe("8");
  });

  it("still loads the panel normally when getDefaultRowRange rejects", async () => {
    (services.getDefaultRowRange as jest.Mock).mockRejectedValue(new Error("range error"));
    const { container } = await mountAndLoad();
    expect(container.querySelector<HTMLElement>("#config-form")!.style.display).toBe("block");
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npx jest __tests__/panels/configure-ai-run.test.ts`
Expected: FAIL — the three new tests fail because `loadHeaders()` doesn't call `getDefaultRowRange()` yet; the five updated timing sites should still pass at this point (they're just more generous than needed until Step 5 lands, which is harmless).

- [ ] **Step 5: Implement in `src/client/panels/configure-ai-run.ts`**

Update the import (line 8):

```ts
import { getSheetHeaders, runBatchAI, getActiveRangeInfo, getDefaultRowRange } from "../services";
```

Update `loadHeaders()` (lines 184-220) — replace the `getSheetHeaders().then(...)` call and the `RowRange` construction:

```ts
  private loadHeaders(container: HTMLElement, preset: Partial<RunConfig>): Promise<void> {
    this.outputColObserver?.disconnect();
    this.outputColObserver = null;
    this.promptColList?.destroy();
    this.promptColList = null;
    this.systemPromptList?.destroy();
    this.outputColList?.destroy();
    return Promise.all([getSheetHeaders(), getDefaultRowRange().catch(() => undefined)]).then(
      ([headers, defaultRowRange]) => {
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
          { multi: false, selected: preset.systemPromptCol ? [preset.systemPromptCol] : [] },
        );
        this.outputColList = new TokenInput(container.querySelector("#output-col")!, headers, {
          multi: false,
          includeNew: true,
          newDefault: "ai_",
          selected: preset.outputCol ? [preset.outputCol] : [],
        });
        this.rowRangeComp = new RowRange(container.querySelector("#row-range-container")!, {
          selected: preset.rowRange,
          fallback: defaultRowRange,
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
          container
            .querySelector<HTMLButtonElement>("#run-btn")!
            .addEventListener("click", () => this.handleRun(container));
          container
            .querySelector<HTMLButtonElement>("#test-btn")!
            .addEventListener("click", () => this.handleTest(container));
          this.headersLoaded = true;
        }

        this.checkTestStatsFreshness(container);
      },
      (err: Error) => {
        globalThis.alert("Error loading headers: " + err.message);
        this.nav?.back();
      },
    );
  }
```

Only three things changed from the original: the `return getSheetHeaders().then(` line became `return Promise.all([getSheetHeaders(), getDefaultRowRange().catch(() => undefined)]).then(`, the callback parameter `(headers) =>` became `([headers, defaultRowRange]) =>`, and the `RowRange` construction now passes `{ selected: preset.rowRange, fallback: defaultRowRange }` instead of `{ selected: preset.rowRange }`. Everything else in the function — including the `(err: Error) => {...}` rejection handler, which still only fires when `getSheetHeaders()` itself rejects, since `getDefaultRowRange()`'s own rejection is already caught inline — is untouched.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest __tests__/panels/configure-ai-run.test.ts`
Expected: PASS (all tests in this file, including the three new ones and the five timing-adjusted ones)

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS — confirms nothing outside this file's own test suite was affected.

- [ ] **Step 8: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "feat: pre-fill ConfigureAIRunPanel's row range from getDefaultRowRange"
```

---

### Task 3: Wire `getDefaultRowRange` into `ExtractTextPanel`

**Files:**
- Modify: `src/client/panels/extract-text.ts:6` (import), `:60-65` (row range construction)
- Test: `__tests__/panels/extract-text.test.ts`

**Interfaces:**
- Consumes: `RowRangeOptions` (Task 1), `services.getDefaultRowRange()` (same as Task 2).

**Why this task doesn't need `Promise.all` or any test-timing changes:** unlike `ConfigureAIRunPanel`, `ExtractTextPanel` constructs its `RowRange` once at mount, independently of the header-loading chain (`this.rowRange = new RowRange(...)` currently sits outside `loadHeaders()` entirely — see line 65). This task keeps that independence: `getDefaultRowRange()` becomes its own self-contained promise chain that doesn't touch or depend on `getSheetHeaders()`'s chain at all, so the existing header-loading tests are completely unaffected. The one subtlety: use a single `.then(onFulfilled, onRejected)` call (both branches funnelling into the same construction logic) rather than a chained `.catch().then()`, since a `.catch()` step adds an extra microtask tick that a plain `.then` with two handlers doesn't need — confirmed empirically. This keeps `RowRange` fully constructed within the same single `await Promise.resolve()` tick every existing test in this file already uses.

- [ ] **Step 1: Add `getDefaultRowRange` to the services mock and its default**

In `__tests__/panels/extract-text.test.ts`, update the mock factory (lines 5-8):

```ts
jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  extractText: jest.fn(),
  getDefaultRowRange: jest.fn(),
}));
```

Update the existing `beforeEach` (lines 38-41) to give it a default so every existing test keeps working without individually mocking it:

```ts
beforeEach(() => {
  jest.clearAllMocks();
  (jobStoreModule.jobStore.dispatch as jest.Mock).mockResolvedValue(undefined);
  (services.getDefaultRowRange as jest.Mock).mockResolvedValue(undefined);
});
```

- [ ] **Step 2: Add the new feature tests**

Add these three tests inside the `describe("ExtractTextPanel", ...)` block (placement doesn't matter — end of the block is fine):

```ts
  it("pre-fills the Specify-range inputs from getDefaultRowRange when no saved range is given", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive", "extracted_text"]);
    (services.getDefaultRowRange as jest.Mock).mockResolvedValue({ start: 2, end: 40 });
    const c = mountPanel();
    await Promise.resolve();

    const rangeRadio = c.querySelector<HTMLInputElement>("input[value='range']")!;
    rangeRadio.click();
    const rangeInputs = c.querySelectorAll<HTMLInputElement>(".range-inputs input");
    expect(rangeInputs[0].value).toBe("2");
    expect(rangeInputs[1].value).toBe("40");
  });

  it("does not use the fallback when a saved row range is already present", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive", "extracted_text"]);
    (services.getDefaultRowRange as jest.Mock).mockResolvedValue({ start: 2, end: 999 });
    const c = mountPanel({
      sourceCol: "source_drive",
      outputCol: "extracted_text",
      startRow: 3,
      endRow: 9,
    });
    await Promise.resolve();

    const rangeInputs = c.querySelectorAll<HTMLInputElement>(".range-inputs input");
    expect(rangeInputs[0].value).toBe("3");
    expect(rangeInputs[1].value).toBe("9");
  });

  it("still renders the row range control when getDefaultRowRange rejects", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    (services.getDefaultRowRange as jest.Mock).mockRejectedValue(new Error("range error"));
    const c = mountPanel();
    await Promise.resolve();
    expect(c.querySelector(".row-range-options")).toBeTruthy();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest __tests__/panels/extract-text.test.ts`
Expected: FAIL — the three new tests fail because `mount()` doesn't call `getDefaultRowRange()` yet.

- [ ] **Step 4: Implement in `src/client/panels/extract-text.ts`**

Update the import (line 6):

```ts
import { getSheetHeaders, extractText, getDefaultRowRange } from "../services";
```

Add `RowRangeValue` to the existing import from `../components/row-range` (line 4):

```ts
import { RowRange, type RowRangeValue } from "../components/row-range";
```

Replace the `RowRange` construction (currently line 65, which after Task 1 reads `this.rowRange = new RowRange(container.querySelector("#row-range")!, { selected: savedRowRange });`) with:

```ts
    const buildRowRange = (defaultRowRange?: RowRangeValue): void => {
      this.rowRange = new RowRange(container.querySelector("#row-range")!, {
        selected: savedRowRange,
        fallback: defaultRowRange,
      });
    };
    getDefaultRowRange().then(buildRowRange, () => buildRowRange(undefined));
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest __tests__/panels/extract-text.test.ts`
Expected: PASS (all tests in this file, including the three new ones — no existing test in this file should need any change)

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/panels/extract-text.ts __tests__/panels/extract-text.test.ts
git commit -m "feat: pre-fill ExtractTextPanel's row range from getDefaultRowRange"
```

---

### Task 4: Full verification pass

**Files:** none (verification only)

**Interfaces:** none — this task confirms Tasks 1-3 integrate correctly.

- [ ] **Step 1: Run the full test suite with coverage**

Run: `npm run test:coverage`
Expected: PASS, all suites green, per-file coverage thresholds met.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS with no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS with no errors. If auto-fixable issues appear, run `npm run lint:fix` and re-verify tests still pass.

- [ ] **Step 4: Format check**

Run: `npm run format:check`
Expected: PASS. If it fails, run `npm run format` and re-run the full test suite.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: Succeeds, producing `dist/index.js` and `dist/Sidebar.html` with no Rollup errors.

- [ ] **Step 6: Manual QA note for later deployment**

If deploying to the dev sheet to sanity-check: open **Run AI Inference**, confirm switching to "Specify range" shows pre-filled Start/End values (row 2 through the sheet's actual last row) instead of blank boxes; repeat for **Extract Text**. In both panels, confirm a sheet with an existing "Specify range" preset (e.g. restored from saved navigation state) still shows its own saved values, not the fallback.

- [ ] **Step 7: Commit (only if Steps 3-4 required fixes)**

```bash
git add -A
git commit -m "chore: lint/format fixes from full verification pass"
```

If no fixes were needed, skip this step.

---

## Self-Review Notes

- **Spec coverage:** Every element of `docs/superpowers/specs/2026-08-12-row-range-default-fill-design.md` has a task: the `RowRangeOptions` API (Task 1), `ConfigureAIRunPanel` wiring (Task 2), `ExtractTextPanel` wiring (Task 3). The design's explicit non-goals (default *mode* unchanged, `sanitizeRowRange`/`getValue()` untouched, no new UI copy) are honored — no task touches any of them.
- **Placeholder scan:** No TBD/TODO markers; every step includes literal code.
- **Type consistency:** `RowRangeOptions` is defined once (Task 1) and used identically at both call sites (Tasks 2 and 3) — `{ selected, fallback }`, never a different field order or a bare positional value after Task 1 lands.
- **Scope check:** Task 1 exists specifically to keep the whole repo compiling the moment `RowRange`'s signature changes — both its call sites are fixed in the same commit, verified against a grep-confirmed, exhaustive list of every `new RowRange(...)` site in the codebase (production and test). Task 2's test-timing fixes are similarly exhaustive: found via `grep -n "panel.mount(\|await Promise.resolve()"` against the full file, not assumed from a sample, and each site's fix was chosen based on empirically measured microtask-tick counts (verified with `node -e`) rather than theoretical reasoning about Promise scheduling, which this investigation showed is easy to get wrong on paper.
