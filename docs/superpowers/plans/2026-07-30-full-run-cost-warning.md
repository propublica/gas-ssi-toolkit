# Full-Run Cost Warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `ConfigureAIRunPanel`'s static row-count warning with a cost-driven confirmation computed from real measured token usage, and close a gap where active-selection runs are never warned about at all.

**Architecture:** All new logic is client-side in `src/client/panels/configure-ai-run.ts`. A measured `RunStats` from the most recent Test click *or* full-run chunk is held in panel state (`lastRun`), validated against the live config with the existing `configsMatch`, and projected to the live row count at click time. `handleRun` becomes async so it resolves the row range *before* deciding whether to warn, which also collapses two near-duplicate dispatch paths into one. The unread `CacheService` run-stats write from AI-87 is deleted rather than consumed.

**Tech Stack:** TypeScript, Rollup (IIFE bundle for Google Apps Script), Jest + ts-jest, jsdom for panel tests.

**Spec:** `docs/superpowers/specs/2026-07-30-full-run-cost-warning-design.md`

## Global Constraints

- **Named exports only.** No default exports.
- **`const` by default**, `===` always, avoid `any` (prefer `unknown`), explicit return types on functions.
- **Prettier:** double quotes, semicolons, trailing commas. Run `npm run format` before committing if unsure.
- **Prefix unused parameters with `_`.**
- **No new RPC endpoints in this plan.** If a task seems to need one, stop — the spec explicitly rejected that approach.
- **Threshold value is exactly `10`** (US dollars), named `COST_WARN_THRESHOLD_USD`.
- **`CHUNK_SIZE` stays `40`.** `CHUNK_WARN_THRESHOLD` (currently `200`) is deleted by Task 5.
- **Dialog copy must match the spec verbatim** — the strings are asserted in tests. No time figure, no file-size caveat.
- **Per-file coverage thresholds are enforced** by `npm run test:coverage`. `src/client/panels/configure-ai-run.ts` requires statements 85, branches 70, functions 90 (`jest.config.cjs:114-118`).
- **Test tick convention:** this suite advances microtasks with `for (let i = 0; i < 5; i++) await Promise.resolve();`. Because `handleRun` becomes async, single-tick waits after a `#run-btn` click are no longer sufficient. Use the loop.
- **Pre-commit hook runs the full Jest suite** (`jest --bail`, no coverage). A commit will fail if any test fails.

---

### Task 1: `projectFullRunCost` and the cost threshold

Pure arithmetic, no DOM. Lands in the panel file alongside the existing `computeChunks` helper (same file already exports a pure helper for exactly this reason), and is tested in the root-level test file which holds pure helpers only.

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts` (add exports near `CHUNK_SIZE`, line 16-19; extend the `shared/types` import on line 2)
- Test: `__tests__/configure-ai-run.test.ts`

**Interfaces:**
- Consumes: `RunStats` from `src/shared/types`
- Produces: `COST_WARN_THRESHOLD_USD: number`, `projectFullRunCost(stats: RunStats, rowCount: number): number`

- [ ] **Step 1: Write the failing tests**

Replace the contents of `__tests__/configure-ai-run.test.ts` line 1 import and append the new describes. The full new import line:

```ts
import {
  computeChunks,
  projectFullRunCost,
  COST_WARN_THRESHOLD_USD,
} from "../src/client/panels/configure-ai-run";
import type { RunStats } from "../src/shared/types";
```

Append at the end of the file:

```ts
const SAMPLE: RunStats = {
  rowCount: 10,
  totalTimeMs: 4200,
  totalInputTokens: 500,
  totalOutputTokens: 300,
  totalTokenCost: 0.02,
  totalGroundingQueries: 0,
  totalGroundingCost: 0,
  testedAt: 1234567890,
  config: {
    promptCols: [{ col: "col_a", kind: "text" }],
    systemPromptCol: undefined,
    tools: [],
    prefixWithColName: false,
    model: "gemini-3.1-flash-lite",
  },
};

describe("projectFullRunCost", () => {
  it("scales a token-only sample linearly", () => {
    // $0.02 over 10 rows = $0.002/row → 1000 rows = $2.00
    expect(projectFullRunCost(SAMPLE, 1000)).toBeCloseTo(2.0, 10);
  });

  it("includes grounding cost in the per-row rate", () => {
    const grounded: RunStats = { ...SAMPLE, totalGroundingCost: 0.14 };
    // ($0.02 + $0.14) over 10 rows = $0.016/row → 100 rows = $1.60
    expect(projectFullRunCost(grounded, 100)).toBeCloseTo(1.6, 10);
  });

  it("returns the sample's own cost when projecting to the sample size", () => {
    expect(projectFullRunCost(SAMPLE, SAMPLE.rowCount)).toBeCloseTo(0.02, 10);
  });

  it("handles a single-row sample", () => {
    const oneRow: RunStats = { ...SAMPLE, rowCount: 1, totalTokenCost: 0.005 };
    expect(projectFullRunCost(oneRow, 40)).toBeCloseTo(0.2, 10);
  });
});

describe("COST_WARN_THRESHOLD_USD", () => {
  it("is $10, the value documented in the AI-88 spec", () => {
    expect(COST_WARN_THRESHOLD_USD).toBe(10);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/configure-ai-run.test.ts
```

Expected: FAIL — TypeScript cannot resolve `projectFullRunCost` / `COST_WARN_THRESHOLD_USD` from the panel module.

- [ ] **Step 3: Implement**

In `src/client/panels/configure-ai-run.ts`, change the line 2 import to add `RunStats`:

```ts
import type { RunConfig, ToolId, ModelId, RunStats } from "../../shared/types";
```

Then insert directly below the existing `CHUNK_WARN_THRESHOLD` declaration (line 19):

```ts
/**
 * Warn before a full run when the projected cost exceeds this many US dollars.
 *
 * Replaces the row-count heuristic this constant sits next to: cost is what
 * T14 is actually about, and unlike time it is linear in row count, so a
 * measured sample projects reliably to any range size. See the AI-88 spec for
 * why no time threshold accompanies it.
 */
export const COST_WARN_THRESHOLD_USD = 10;

/**
 * Projects the total USD cost of running `rowCount` rows, from a measured
 * sample of a smaller (or larger) run of the same configuration.
 *
 * `stats.rowCount` is only ever stored when greater than zero — `runBatchAI`
 * guards the write (`index.ts`) — so no zero-division guard is needed here.
 */
export function projectFullRunCost(stats: RunStats, rowCount: number): number {
  const perRowCost = (stats.totalTokenCost + stats.totalGroundingCost) / stats.rowCount;
  return perRowCost * rowCount;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/configure-ai-run.test.ts
```

Expected: PASS, 11 tests (6 existing `computeChunks` + 4 projection + 1 threshold).

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/configure-ai-run.test.ts
git commit -m "feat(ai-88): add projectFullRunCost and cost threshold constant"
```

---

### Task 2: Replace `TestRunDisplay` with `MeasuredRun`

The panel's measured-run state takes its final shape: it can hold a measurement from a full run as well as a Test, and it no longer stores a row count. This is where AI-87's frozen-`fullRowCount` bug is removed at the root — the panel stops projecting, so it has nothing that can go stale.

**Deliberate AI-87 behavior changes in this task** (both flagged in the spec — the second is a consequence the spec notes only implicitly):
1. The panel's "Full run estimate:" line is removed. The projection moves to the Run dialog in Task 5.
2. The "Unusually large files may throw off cost and time estimates." caveat is removed. It existed to qualify the projection; with the panel showing only *measured* facts there is no estimate for it to qualify, and the spec forbids re-stating file caveats in the dialog.

**Files:**
- Modify: `src/client/types.ts:97-107` (replace the interface and its comment block)
- Modify: `src/client/panels/configure-ai-run.ts` (import, field, `SavedState`, `mount`, `unmount`, `handleTest`, `renderTestStats`, `checkTestStatsFreshness`)
- Test: `__tests__/panels/configure-ai-run.test.ts`

**Interfaces:**
- Consumes: `projectFullRunCost` is *not* used here — Task 5 is its only consumer.
- Produces: `MeasuredRun { stats: RunStats; source: "test" | "run" }` exported from `src/client/types.ts`; `SavedState.lastRun?: MeasuredRun`; private `this.lastRun`; renamed methods `renderMeasuredRun`, `checkLastRunFreshness`.

- [ ] **Step 1: Write the failing tests**

In `__tests__/panels/configure-ai-run.test.ts`:

Replace the `TEST_DISPLAY` fixture (lines 55-58) with:

```ts
const MEASURED_TEST: import("../../src/client/types").MeasuredRun = {
  stats: TEST_STATS,
  source: "test",
};

const MEASURED_RUN: import("../../src/client/types").MeasuredRun = {
  stats: TEST_STATS,
  source: "run",
};
```

Rename the describe on line 918 from `"ConfigureAIRunPanel — lastTest persistence"` to `"ConfigureAIRunPanel — lastRun persistence"`.

Within that describe, apply these edits:

- Line 929: `expect(state?.lastTest).toEqual(TEST_DISPLAY);` → `expect(state?.lastRun).toEqual(MEASURED_TEST);`
- Line 932 title: `"unmount saves lastTest: undefined when no test has run yet"` → `"unmount saves lastRun: undefined when nothing has been measured yet"`
- Line 936: `expect(state?.lastTest).toBeUndefined();` → `expect(state?.lastRun).toBeUndefined();`
- Line 944: `lastTest: TEST_DISPLAY,` → `lastRun: MEASURED_TEST,`
- Line 960: `lastTest: TEST_DISPLAY,` → `lastRun: MEASURED_TEST,`
- Line 964: `toContain("Configuration changed since last test")` → `toContain("Configuration changed since last run")`
- Line 969 title: `"renders nothing when there is no lastTest in savedState"` → `"renders nothing when there is no lastRun in savedState"`

**Delete these four tests entirely** (they assert the removed projection and caveat):
- Lines 979-993 — `"shows a labeled full-run cost and time estimate when the tested range is smaller than the full selection"`
- Lines 995-1006 — `"does not show a full-run estimate when the tested range covers the full selection"`
- Lines 1008-1025 — `"shows a file-size caveat when a prompt column is file-kind"`
- Lines 1027-1038 — `"does not show the file-size caveat when all prompt columns are text-kind"`

Append these two new tests to the `lastRun persistence` describe:

```ts
it("labels a restored run-sourced measurement 'Last run' and leaves the Test button idle", async () => {
  const { container } = await mountAndLoad(undefined, {
    promptCols: [{ col: "col_a", kind: "text" as const }],
    systemPromptCol: "",
    outputCol: "ai_inference",
    lastRun: MEASURED_RUN,
  });
  const results = container.querySelector<HTMLElement>("#test-results")!;
  expect(results.hidden).toBe(false);
  expect(results.textContent).toContain("Last run:");
  expect(results.textContent).not.toContain("Test run:");
  // A completed full run must not make the Test button claim "Tested ✓".
  expect(container.querySelector<HTMLButtonElement>("#test-btn")!.textContent).toBe("Test");
});

it("never renders a projected full-run figure in the panel", async () => {
  (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
  const { container } = await mountAndLoad({
    promptCols: [{ col: "col_a", kind: "text" }],
    outputCol: "ai_inference",
    rowRange: { start: 2, end: 5000 },
  });
  container.querySelector<HTMLButtonElement>("#test-btn")!.click();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  const results = container.querySelector<HTMLElement>("#test-results")!;
  expect(results.textContent).toContain("Test run:");
  expect(results.textContent).not.toContain("Full run estimate");
  expect(results.textContent).not.toContain("Unusually large files");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts
```

Expected: FAIL — `MeasuredRun` is not exported from `src/client/types.ts`, and `SavedState` has no `lastRun`.

- [ ] **Step 3: Replace the interface in `src/client/types.ts`**

Replace lines 97-107 entirely:

```ts
// ── Run AI measured-run state ────────────────────────────────────
// Client-only. Holds the most recent measured RunStats from either a Test
// click or a chunk of a full run, so the panel can display what the last run
// actually cost and handleRun can project a full-run cost before dispatching.
//
// Deliberately stores no row count. The projection always uses the row range
// resolved live at click time, because RunStatsConfigSnapshot excludes
// rowRange — configsMatch therefore cannot detect a widened range, so a count
// stored here would silently go stale (AI-88).

export interface MeasuredRun {
  stats: RunStats;
  /** Which action produced the measurement — controls the display label only. */
  source: "test" | "run";
}
```

- [ ] **Step 4: Update the panel**

In `src/client/panels/configure-ai-run.ts`:

Line 1 import — swap the type:

```ts
import type { NavigationContext, Panel, MeasuredRun } from "../types";
```

Line 44 in `SavedState`:

```ts
    lastRun?: MeasuredRun | undefined;
```

Line 62 field declaration:

```ts
  private lastRun: MeasuredRun | undefined = undefined;
```

Line 74 in `mount`:

```ts
    this.lastRun = savedState?.lastRun;
```

Line 275 in `unmount`'s returned object:

```ts
      lastRun: this.lastRun,
```

Line 247 in `loadHeaders`:

```ts
        this.checkLastRunFreshness(container);
```

Replace `handleTest` (lines 404-447) — the `fullRowCount` bookkeeping disappears, so the inner `.then` collapses:

```ts
  private handleTest(container: HTMLElement): void {
    const config = this.assembleRunConfig();
    if (!config) return;

    const jobId = `test-ai-${Date.now()}`;
    this.testButton?.setLoading();

    const resolveRange: Promise<{ start: number; end: number } | undefined> = config.rowRange
      ? Promise.resolve(config.rowRange)
      : getActiveRangeInfo();

    jobStore
      .dispatch(
        jobId,
        "Test AI Run",
        resolveRange.then((range) => {
          const sanitized = range ? this.resolveRowRange(range) : null;
          if (!sanitized) return undefined;
          const cappedEnd = Math.min(sanitized.start + 9, sanitized.end);
          return runBatchAI(
            { ...config, rowRange: { start: sanitized.start, end: cappedEnd } },
            jobId,
          );
        }),
      )
      .then((stats) => {
        if (stats) {
          this.lastRun = { stats, source: "test" };
          this.renderMeasuredRun(container, this.lastRun);
          this.testButton?.setDone();
        } else {
          this.renderTestMessage(
            container,
            "Test didn't produce measurable results — check the sheet for errors in the tested rows.",
          );
          this.testButton?.setIdle();
        }
      })
      .catch((err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.testButton?.setIdle();
      });
  }
```

Replace `renderTestStats` (lines 449-476) with `renderMeasuredRun` — measured facts only, no projection, no caveat:

```ts
  /**
   * Renders what the last measured run actually cost. Shows only measured
   * facts, never a projection: a projected figure would need the live row
   * range, which the panel does not track (see MeasuredRun's comment). The
   * full-run projection lives in the pre-run dialog instead.
   */
  private renderMeasuredRun(container: HTMLElement, run: MeasuredRun): void {
    const el = container.querySelector<HTMLElement>("#test-results")!;
    const { stats, source } = run;
    const totalCost = stats.totalTokenCost + stats.totalGroundingCost;
    const label = source === "test" ? "Test run" : "Last run";
    el.innerHTML =
      `<p><strong>${label}:</strong> ${stats.rowCount} row${stats.rowCount === 1 ? "" : "s"} · ` +
      `$${totalCost.toFixed(4)} · ${formatDuration(stats.totalTimeMs)}</p>`;
    el.hidden = false;
  }
```

Replace `checkTestStatsFreshness` (lines 484-506) with:

```ts
  /**
   * Re-validates the displayed measurement against the live config. Called after
   * every loadHeaders() resolution (initial mount AND refresh), not just the first
   * load — otherwise refreshing after an external sheet edit (e.g. a column
   * disappearing) could leave a stale display unvalidated indefinitely.
   * Skipped while a test is actively running: refresh isn't disabled during a
   * test, and re-checking against the last completion's stats would incorrectly
   * clobber the in-flight loading state.
   */
  private checkLastRunFreshness(container: HTMLElement): void {
    if (!this.lastRun || this.testButton?.getState() === "loading") return;
    const liveSnapshot = buildConfigSnapshot(this.currentPreset());
    if (configsMatch(liveSnapshot, this.lastRun.stats.config)) {
      this.renderMeasuredRun(container, this.lastRun);
      // Only a Test click earns the persistent "Tested ✓" state — a completed
      // full run is a measurement, but it isn't a test.
      if (this.lastRun.source === "test") {
        this.testButton?.setDone();
      } else {
        this.testButton?.setIdle();
      }
    } else {
      this.renderTestMessage(
        container,
        "Configuration changed since last run — click Test to refresh.",
      );
      this.testButton?.setIdle();
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts
```

Expected: PASS. Four tests removed, two added.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. If `TestRunDisplay` is still referenced anywhere, this is where it surfaces — verify with `grep -rn "TestRunDisplay" src/ __tests__/` and expect zero hits.

- [ ] **Step 7: Commit**

```bash
git add src/client/types.ts src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "refactor(ai-88): replace TestRunDisplay with MeasuredRun

Removes the frozen fullRowCount by making the panel show measured facts
only. The full-run projection moves to the pre-run dialog, where the live
row count is known. The file-size caveat goes with it — it existed to
qualify the projection."
```

---

### Task 3: Capture stats from full-run chunks

`runChunks` currently discards `runBatchAI`'s return value, so a user who runs 200 rows and then wants to run 5,000 more is nudged to "test first" despite having just measured 200 real rows.

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts:391-402` (`runChunks`)
- Test: `__tests__/panels/configure-ai-run.test.ts`

**Interfaces:**
- Consumes: `MeasuredRun` and `this.lastRun` from Task 2.
- Produces: no new exports. `runChunks` assigns `this.lastRun = { stats, source: "run" }` per chunk.

- [ ] **Step 1: Extend the `jobStore` mock**

`runChunks` calls `jobStore.isCancelled` and `jobStore.setProgress`, neither of which the current mock provides — no existing test reaches `runChunks`, so this has never mattered. Without this the new tests throw `TypeError: jobStore.isCancelled is not a function`.

Replace the mock at `__tests__/panels/configure-ai-run.test.ts:12-16`:

```ts
jest.mock("../../src/client/job-store", () => ({
  jobStore: {
    dispatch: jest.fn().mockImplementation((_id, _label, fn: Promise<void>) => fn),
    isCancelled: jest.fn().mockReturnValue(false),
    setProgress: jest.fn(),
  },
}));
```

`jest.clearAllMocks()` in `beforeEach` clears call records but preserves implementations set at mock-factory time, so `isCancelled` keeps returning `false` across tests.

- [ ] **Step 2: Write the failing tests**

Append a new describe to `__tests__/panels/configure-ai-run.test.ts`:

```ts
describe("ConfigureAIRunPanel — full-run stat capture", () => {
  it("captures a chunk's stats into lastRun during a full run", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container, panel } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 11 },
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(panel.unmount()?.lastRun).toEqual({ stats: TEST_STATS, source: "run" });
  });

  it("leaves a previously captured lastRun intact when a chunk measures nothing", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container, panel } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_a", kind: "text" as const }],
      systemPromptCol: "",
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 11 },
      lastRun: MEASURED_TEST,
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    expect(panel.unmount()?.lastRun).toEqual(MEASURED_TEST);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts -t "full-run stat capture"
```

Expected: FAIL on the first test — `lastRun` is `undefined` because `runChunks` discards the result.

- [ ] **Step 4: Implement**

Replace `runChunks` (lines 391-402):

```ts
  private async runChunks(
    jobId: string,
    config: RunConfig,
    chunks: Array<{ start: number; end: number }>,
  ): Promise<void> {
    const lastRow = chunks[chunks.length - 1].end;
    for (let i = 0; i < chunks.length; i++) {
      if (jobStore.isCancelled(jobId)) break;
      jobStore.setProgress(jobId, `Rows ${chunks[i].start}–${chunks[i].end} of ${lastRow}`);
      const stats = await runBatchAI({ ...config, rowRange: chunks[i] }, jobId);
      // Every invocation measures itself, so a full run keeps the cost estimate
      // fresh for a subsequent one — the pre-run nudge then only appears on a
      // genuinely first run of a configuration. A chunk that measured nothing
      // (every row errored) leaves the previous value alone rather than
      // clearing a still-useful measurement.
      if (stats) this.lastRun = { stats, source: "run" };
    }
  }
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 6: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "feat(ai-88): capture measured stats from full-run chunks"
```

---

### Task 4: Resolve the row range before dispatching

Pure restructure — no user-visible change yet. The existing `CHUNK_WARN_THRESHOLD` confirm is carried forward unchanged into the unified path so there is never a commit in this plan with no pre-run protection at all; Task 5 replaces it.

Today the confirm sits inside `if (config.rowRange)` (line 345). When no explicit range is set, the active selection is resolved asynchronously *inside* the dispatch (line 375) — so a user who highlights 5,000 rows and clicks Run is never warned. Since the active-selection path is the default whenever the RowRange fields are left blank, this is the likelier path for exactly the runs the warning exists to catch.

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts:339-389` (`handleRun`), and line 240 (the click wiring, because `handleRun` loses its parameter)
- Test: `__tests__/panels/configure-ai-run.test.ts`

**Interfaces:**
- Consumes: `computeChunks`, `CHUNK_SIZE`, `this.runChunks` from Task 3, `this.resolveRowRange`.
- Produces: `private handleRun(): void` (parameterless) delegating to `private async handleRunAsync(): Promise<void>`.

- [ ] **Step 1: Update the three existing Run AI tests for the extra async hop**

`handleRun` now awaits `getActiveRangeInfo()` before dispatching, so a single `await Promise.resolve()` no longer reaches `runBatchAI`. In `__tests__/panels/configure-ai-run.test.ts`, replace the lone `await Promise.resolve();` after each `#run-btn` click with the loop convention already used elsewhere in this file:

- Line 198 (in `"calls runBatchAI with correctly assembled RunConfig and a jobId"`)
- Line 215 (in `"stays on panel after run is dispatched without reloading headers"`)
- Line 243 (in `"assembleRunConfig includes drive file cols as file entries in promptCols"`)

Each becomes:

```ts
    for (let i = 0; i < 5; i++) await Promise.resolve();
```

- [ ] **Step 2: Write the failing test for the closed gap**

Append to the `"ConfigureAIRunPanel — Run AI"` describe:

```ts
  it("chunks an active-selection run rather than delegating the range to the server", async () => {
    (services.getActiveRangeInfo as jest.Mock).mockResolvedValue({ start: 2, end: 45 });
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 10; i++) await Promise.resolve();
    // 44 rows at CHUNK_SIZE 40 → first chunk 2-41. Previously this path called
    // runBatchAI with no rowRange at all and let the server resolve it.
    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 41 } }),
      expect.stringMatching(/^batch-ai-\d+$/),
    );
  });

  it("alerts and does not dispatch when resolving the active selection fails", async () => {
    (services.getActiveRangeInfo as jest.Mock).mockRejectedValue(new Error("range boom"));
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(globalThis.alert).toHaveBeenCalledWith("Error: range boom");
    expect(services.runBatchAI).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts -t "Run AI"
```

Expected: FAIL — the active-selection test sees `runBatchAI` called without a `rowRange`; the rejection test sees an unhandled rejection rather than an alert.

- [ ] **Step 4: Implement**

Change the click wiring at line 240 (drop the argument):

```ts
            .addEventListener("click", () => this.handleRun());
```

Replace `handleRun` in its entirety (lines 339-389):

```ts
  private handleRun(): void {
    // Fire-and-forget from a DOM click handler: every failure path inside
    // handleRunAsync alerts for itself, so there is no rejection to surface here.
    void this.handleRunAsync();
  }

  private async handleRunAsync(): Promise<void> {
    const config = this.assembleRunConfig();
    if (!config) return;

    // Resolve the range BEFORE dispatching. The pre-run warning needs the row
    // count, and resolving up front collapses what used to be two near-duplicate
    // dispatch paths into one. Previously the active-selection branch resolved
    // its range inside the dispatch, so those runs were never warned about at all.
    let rowRange = config.rowRange;
    if (!rowRange) {
      let active: { start: number; end: number } | undefined;
      try {
        active = await getActiveRangeInfo();
      } catch (err) {
        globalThis.alert("Error: " + (err as Error).message);
        return;
      }
      if (active) {
        const sanitized = this.resolveRowRange(active);
        if (!sanitized) return;
        rowRange = sanitized;
      }
    }

    const jobId = `batch-ai-${Date.now()}`;

    if (!rowRange) {
      // Neither an explicit range nor an active selection: let the server fall
      // back to sheet.getActiveRange(). The row count is unknowable here, so no
      // warning is possible — this preserves pre-AI-88 behavior for the edge case.
      jobStore
        .dispatch(jobId, "Batch AI Run", runBatchAI(config, jobId).then(() => undefined))
        .catch((err: Error) => {
          globalThis.alert("Error: " + err.message);
        });
      return;
    }

    const rowCount = rowRange.end - rowRange.start + 1;
    const chunks = computeChunks(rowRange, CHUNK_SIZE);

    if (rowCount > CHUNK_WARN_THRESHOLD) {
      // ~0.5 s/row estimate reflects ~10x speedup from parallel inference.
      const estimatedMins = Math.ceil((rowCount * 0.5) / 60) || 1;
      const ok = globalThis.confirm(
        `You're about to process ${rowCount} rows across ${chunks.length} chunks.\n\n` +
          `This will take roughly ${estimatedMins} minutes. ` +
          `The sidebar must remain open throughout — closing it will stop the run after the current chunk finishes.\n\n` +
          `Continue?`,
      );
      if (!ok) return;
    }

    jobStore.dispatch(jobId, "Batch AI Run", this.runChunks(jobId, config, chunks)).catch(
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
      },
    );
    // NOTE: loadHeaders() is intentionally NOT called here.
    // Reloading after dispatch caused flicker and re-initialization mid-run.
  }
```

- [ ] **Step 5: Run the full suite**

```bash
npm test
```

Expected: PASS, all suites. If a Run AI test times out or sees `runBatchAI` uncalled, it needs the tick loop from Step 1 — check for any `#run-btn` click followed by a single `await Promise.resolve()`.

- [ ] **Step 6: Typecheck and lint**

```bash
npm run typecheck && npm run lint
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "refactor(ai-88): resolve row range before dispatching a full run

Collapses two near-duplicate dispatch paths into one and closes a gap
where active-selection runs were never warned about, because their range
was resolved inside the dispatch rather than before it."
```

---

### Task 5: The cost warning dialog

The feature itself. Two mutually exclusive bodies — you cannot lack an estimate and have an expensive one.

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts` (delete `CHUNK_WARN_THRESHOLD` at lines 17-19, add `buildRunWarning`, replace the confirm block in `handleRunAsync`)
- Test: `__tests__/panels/configure-ai-run.test.ts`

**Interfaces:**
- Consumes: `projectFullRunCost` and `COST_WARN_THRESHOLD_USD` (Task 1); `this.lastRun` (Task 2); `buildConfigSnapshot` and `configsMatch` (already imported at line 12); `CHUNK_SIZE`.
- Produces: `private buildRunWarning(rowRange: { start: number; end: number }, chunkCount: number): string | null`.

- [ ] **Step 1: Mock `confirm` globally**

`globalThis.confirm` is not currently mocked, and jsdom's implementation throws "not implemented". Add it to the existing `beforeEach` at line 102-105:

```ts
beforeEach(() => {
  jest.clearAllMocks();
  globalThis.alert = jest.fn();
  globalThis.confirm = jest.fn().mockReturnValue(true);
});
```

- [ ] **Step 2: Write the failing tests**

Append a new describe to `__tests__/panels/configure-ai-run.test.ts`:

```ts
// $5.00 over 10 rows = $0.50/row — crosses the $10 threshold at 21+ rows.
const EXPENSIVE_STATS: RunStats = { ...TEST_STATS, totalTokenCost: 5 };
const MEASURED_EXPENSIVE: import("../../src/client/types").MeasuredRun = {
  stats: EXPENSIVE_STATS,
  source: "test",
};

/** savedState whose config matches TEST_STATS.config, so configsMatch passes. */
function matchingState(overrides: Partial<SavedState>): Partial<SavedState> {
  return {
    promptCols: [{ col: "col_a", kind: "text" as const }],
    systemPromptCol: "",
    outputCol: "ai_inference",
    ...overrides,
  };
}

describe("ConfigureAIRunPanel — pre-run cost warning", () => {
  it("nudges an untested run above the chunk size", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 42 }, // 41 rows > CHUNK_SIZE 40
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const text = (globalThis.confirm as jest.Mock).mock.calls[0][0] as string;
    expect(text).toContain("41 rows across 2 chunks");
    expect(text).toContain("You haven't tested this configuration");
    expect(text).toContain("Keep this sidebar open until the run finishes.");
  });

  it("does not warn an untested run at or below the chunk size", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 41 }, // exactly 40 rows
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(globalThis.confirm).not.toHaveBeenCalled();
    expect(services.runBatchAI).toHaveBeenCalled();
  });

  it("warns with a projected cost when the measurement crosses the threshold", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(EXPENSIVE_STATS);
    const { container } = await mountAndLoad(
      undefined,
      matchingState({ rowRange: { start: 2, end: 42 }, lastRun: MEASURED_EXPENSIVE }),
    );
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const text = (globalThis.confirm as jest.Mock).mock.calls[0][0] as string;
    // 41 rows × $0.50/row = $20.50
    expect(text).toContain("Estimated cost: ~$20.50");
    expect(text).toContain("based on your last run of 10 rows");
    expect(text).toContain("Consider narrowing your row range first.");
    expect(text).not.toContain("You haven't tested");
  });

  it("does not warn when the projected cost is under the threshold", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container } = await mountAndLoad(
      undefined,
      // TEST_STATS is $0.0002/row, so even 5,000 rows is only ~$1.
      matchingState({ rowRange: { start: 2, end: 5001 }, lastRun: MEASURED_TEST }),
    );
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(globalThis.confirm).not.toHaveBeenCalled();
    expect(services.runBatchAI).toHaveBeenCalled();
  });

  it("treats a config-mismatched measurement as untested", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_b", kind: "text" as const }], // differs from TEST_STATS.config
      systemPromptCol: "",
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 42 },
      lastRun: MEASURED_EXPENSIVE,
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const text = (globalThis.confirm as jest.Mock).mock.calls[0][0] as string;
    expect(text).toContain("You haven't tested this configuration");
    expect(text).not.toContain("Estimated cost");
  });

  it("projects from the live row range, not the range measured earlier", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(EXPENSIVE_STATS);
    const { container } = await mountAndLoad(
      undefined,
      // Measurement covered 10 rows; the live range is 1,000.
      matchingState({ rowRange: { start: 2, end: 1001 }, lastRun: MEASURED_EXPENSIVE }),
    );
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const text = (globalThis.confirm as jest.Mock).mock.calls[0][0] as string;
    // 1,000 rows × $0.50/row = $500.00 — not the $5.00 the sample itself cost.
    expect(text).toContain("Estimated cost: ~$500.00");
  });

  it("omits the sidebar reminder for a single-chunk run", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(EXPENSIVE_STATS);
    const { container } = await mountAndLoad(
      undefined,
      // 40 rows = exactly one chunk, but $20 of cost.
      matchingState({ rowRange: { start: 2, end: 41 }, lastRun: MEASURED_EXPENSIVE }),
    );
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const text = (globalThis.confirm as jest.Mock).mock.calls[0][0] as string;
    expect(text).toContain("Estimated cost:");
    expect(text).not.toContain("Keep this sidebar open");
  });

  it("does not dispatch when the user cancels", async () => {
    (globalThis.confirm as jest.Mock).mockReturnValue(false);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 42 },
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(services.runBatchAI).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts -t "pre-run cost warning"
```

Expected: FAIL — the old warning fires only above 200 rows and has entirely different copy.

- [ ] **Step 4: Delete `CHUNK_WARN_THRESHOLD`**

Remove lines 17-19 of `src/client/panels/configure-ai-run.ts`:

```ts
// Warn before dispatch when the batch exceeds this many rows, regardless of chunk count.
// Kept separate from CHUNK_SIZE so small multi-chunk runs don't trigger the dialog.
export const CHUNK_WARN_THRESHOLD = 200;
```

Verify nothing else references it: `grep -rn "CHUNK_WARN_THRESHOLD" src/ __tests__/` must return zero hits.

- [ ] **Step 5: Add `buildRunWarning`**

Insert as a private method directly above `handleRun`:

```ts
  /**
   * Assembles the pre-run confirmation text, or null when no dialog is warranted.
   *
   * The two bodies are mutually exclusive by construction: a run either has a
   * usable measurement or it doesn't. An untested run is only worth interrupting
   * once it is large enough to chunk; a measured one is judged purely on cost,
   * at any size.
   *
   * Cost is the only threshold. Time is deliberately absent: the projection
   * undercounts by up to ~4x for file-mode runs, because the file sub-batch loop
   * in runBatchAI is sequential (a deliberate memory guard), and gating on a
   * known-wrong number is worse than not gating. See the AI-88 spec.
   */
  private buildRunWarning(
    rowRange: { start: number; end: number },
    chunkCount: number,
  ): string | null {
    const rowCount = rowRange.end - rowRange.start + 1;
    const liveSnapshot = buildConfigSnapshot(this.currentPreset());
    const measured =
      this.lastRun && configsMatch(liveSnapshot, this.lastRun.stats.config)
        ? this.lastRun
        : undefined;

    let body: string | null = null;
    if (!measured) {
      if (rowCount > CHUNK_SIZE) {
        body =
          `You're about to process ${rowCount} rows across ${chunkCount} chunks.\n\n` +
          `You haven't tested this configuration, so there's no cost estimate. ` +
          `Cancel and click Test to see what a full run will cost.`;
      }
    } else {
      const cost = projectFullRunCost(measured.stats, rowCount);
      if (cost > COST_WARN_THRESHOLD_USD) {
        const sampleRows = measured.stats.rowCount;
        body =
          `You're about to process ${rowCount} rows across ${chunkCount} chunks.\n\n` +
          `Estimated cost: ~$${cost.toFixed(2)}, based on your last run of ` +
          `${sampleRows} row${sampleRows === 1 ? "" : "s"}.\n` +
          `Consider narrowing your row range first.`;
      }
    }

    if (body === null) return null;
    // Appended independently of which body fired: a single 40-row chunk on a
    // costly model can cross the threshold without being a multi-chunk run.
    return chunkCount > 1 ? `${body}\n\nKeep this sidebar open until the run finishes.` : body;
  }
```

- [ ] **Step 6: Swap the confirm block in `handleRunAsync`**

Replace the whole `if (rowCount > CHUNK_WARN_THRESHOLD) { ... }` block added in Task 4 with:

```ts
    const warning = this.buildRunWarning(rowRange, chunks.length);
    if (warning !== null && !globalThis.confirm(warning)) return;
```

The `const rowCount = ...` line above it becomes unused — delete it (`buildRunWarning` derives its own).

- [ ] **Step 7: Run tests to verify they pass**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts
```

Expected: PASS, whole file.

- [ ] **Step 8: Run the full suite, typecheck, lint, format**

```bash
npm test && npm run typecheck && npm run lint && npm run format:check
```

Expected: all pass. If `format:check` fails, run `npm run format`.

- [ ] **Step 9: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "feat(ai-88): warn on projected full-run cost before dispatching

Replaces the static 200-row CHUNK_WARN_THRESHOLD confirm with two
mutually exclusive bodies: a nudge to Test when no measurement matches
the live config, and a projected-cost warning above \$10. The sidebar
reminder is appended only for multi-chunk runs."
```

---

### Task 6: Delete the unread `CacheService` run-stats write

AI-87 persisted `RunStats` to `CacheService` speculatively for AI-88. AI-88 chose not to read it (see the spec's "Why no cache"), so the write is dead code. `runBatchAI` keeps its `RunStats | null` return — the client uses that.

**Files:**
- Modify: `src/server/utils.ts:122-136` (delete `writeRunStats`), and its `RunStats` type import on line 10
- Modify: `src/server/index.ts:34` (import list) and `:581-595` (the call)
- Test: `__tests__/utils.test.ts:19` (import) and `:330-353` (describe block)

**Interfaces:**
- Consumes: nothing from earlier tasks — fully independent.
- Produces: no exports. Removes `writeRunStats` from `src/server/utils.ts`.

- [ ] **Step 1: Delete the test first**

In `__tests__/utils.test.ts`, remove `writeRunStats,` from the import block at line 19, and delete the entire `describe("writeRunStats", ...)` block at lines 330-353.

- [ ] **Step 2: Run to confirm the suite is green without those tests**

```bash
npx jest __tests__/utils.test.ts
```

Expected: PASS — removing tests cannot fail; this confirms nothing else depended on that import.

- [ ] **Step 3: Delete the function**

In `src/server/utils.ts`, delete the doc comment and function at lines 122-136 (`writeRunStats`). Then check whether the `RunStats` type import on line 10 still has a consumer:

```bash
grep -n "RunStats" src/server/utils.ts
```

If the only remaining hit is the import itself, delete the import line too.

- [ ] **Step 4: Remove the call site**

In `src/server/index.ts`, remove `writeRunStats,` from the import block at line 34. Then replace the stats block at lines 581-595 with:

```ts
  let stats: RunStats | null = null;
  try {
    const computed: RunStats = {
      ...computeRunStats(results, Date.now() - startTime, config.model ?? CONFIG.DEFAULT_MODEL),
      testedAt: startTime,
      config: buildConfigSnapshot(config),
    };
    if (computed.rowCount > 0) {
      stats = computed;
    }
  } catch (_e) {
    // Stats/cost tracking is best-effort and must never fail the underlying
    // AI run, which has already fully completed by this point.
  }
```

`computeRunStats` and `buildConfigSnapshot` are both pure, so this can no longer realistically throw — the try/catch is retained to preserve the invariant that stats computation never breaks an already-completed run.

- [ ] **Step 5: Verify `cache` is still used in `runBatchAI`**

```bash
grep -n "cache" src/server/index.ts | grep -n "writeJobProgress"
```

Expected: hits — `cache` is still passed to `writeJobProgress`, so the `const cache = CacheService.getUserCache();` line at 388 must stay. Do not remove it.

- [ ] **Step 6: Run the full suite and typecheck**

```bash
npm test && npm run typecheck
```

Expected: PASS. Typecheck catches any missed reference.

- [ ] **Step 7: Commit**

```bash
git add src/server/utils.ts src/server/index.ts __tests__/utils.test.ts
git commit -m "refactor(ai-88): remove the unread CacheService run-stats write

AI-87 persisted RunStats for AI-88 to consume. AI-88 uses in-session
panel state instead, so the write had no reader: keeping it would mean a
second source of truth and a 6-hour window in which a stale estimate
validates against a changed sheet."
```

---

### Task 7: Threat model, coverage, and build verification

**Files:**
- Modify: `docs/threat_models/ssi-toolkit-threat-model.md` (R43 note at line 255, R44 at line 256, the audit rows at lines 303-304, and the open-items table)

**Interfaces:**
- Consumes: the completed implementation from Tasks 1-6.
- Produces: documentation only.

- [ ] **Step 1: Update R44 (line 256)**

Replace the R44 row's mitigation text with:

```
Replaced the static row-count warning in `ConfigureAIRunPanel` with one driven by measured run data: an untested configuration above the client chunk size prompts the user to run a Test first; once a measurement exists for the live configuration, the projected cost of the full range is compared against a $10 threshold. Implemented cost-only — the time threshold originally scoped here was dropped because the projection undercounts by up to ~4x for file-mode runs (the file sub-batch loop in `runBatchAI` is sequential by design, as a memory guard), and gating on a known-wrong figure is worse than not gating. The chunk-size concern it was meant to serve is covered by a sidebar-open reminder appended to whichever warning fires (AI-88; supersedes R18's static threshold)
```

- [ ] **Step 2: Amend R43's caching note (line 255)**

R43 currently states that token usage is "captured and persisted to `CacheService` (`runStats:{spreadsheetId}`) for R44." Replace that clause with:

```
Token usage and Gemini pricing are captured and returned to the client for R44's projection. The `CacheService` persistence originally added here was removed by AI-88, which uses in-session panel state instead — cross-session persistence bought a redundant 10-row test's worth of cost at the price of a second source of truth and a 6-hour window in which a stale estimate validates against a changed sheet
```

- [ ] **Step 3: Update the audit row for AI-88 (line 304)**

Change its status from `Open` to `Resolved`, and set the description to:

```
Fix T14 — data-driven full-run warning | Replaced the static row-count warning with a projected-cost warning computed from measured token usage; also closed a gap where active-selection runs were never warned about, because their row range was resolved inside the dispatch rather than before it (R44)
```

- [ ] **Step 4: Add the new open item**

Append a row to the open-items table (near the other T14 `Low`/`Medium` entries around lines 288-298):

```
| Low | Open | — | — | Fix T14 — grounding cost disclosure | Google Search grounding cost is computed as if fully paid, ignoring the 5,000-query/month account-wide free quota (`pricing.ts`). AI-87's spec called for the UI to note this caveat wherever grounding cost is shown; it was never added, and AI-88's dialog does not state it either |
```

- [ ] **Step 5: Confirm no new RPC surface was introduced**

```bash
grep -c "google.script.run" src/client/services.ts
```

Compare against `git show develop:src/client/services.ts | grep -c "google.script.run"` — the counts must be equal. AI-88 adds no RPC endpoint, so T8's RPC inventory needs no change. If the counts differ, an endpoint was added against the spec — stop and flag it.

- [ ] **Step 6: Run coverage and enforce thresholds**

```bash
npm run test:coverage
```

Expected: PASS. `src/client/panels/configure-ai-run.ts` must hold statements ≥85, branches ≥70, functions ≥90. If branches fall short, the likeliest uncovered paths are `buildRunWarning`'s `sampleRows === 1` plural branch and the `!rowRange` fallback in `handleRunAsync` — add a targeted test rather than lowering the threshold.

- [ ] **Step 7: Verify the bundle builds**

```bash
npm run build
```

Expected: `dist/index.js` and `dist/Sidebar.html` produced with no errors. No footer stub changes were needed — this plan adds no Apps Script entry point.

- [ ] **Step 8: Commit**

```bash
git add docs/threat_models/ssi-toolkit-threat-model.md
git commit -m "docs(security): mark R44 resolved, amend R43's caching note (AI-88)

Records that R44 shipped cost-only, why the time threshold was dropped,
and that AI-87's CacheService persistence was removed rather than read.
Adds an open item for the undisclosed grounding free-tier quota."
```

---

## Self-Review

**1. Spec coverage.** Every spec section maps to a task: trigger logic and dialog copy → Task 5; `MeasuredRun` and the removed frozen row count → Task 2; capture from full runs → Task 3; the `handleRun` restructure and closed active-selection gap → Task 4; `projectFullRunCost` and `COST_WARN_THRESHOLD_USD` → Task 1; the server change → Task 6; threat model updates → Task 7. The spec's testing section is distributed across the tasks that introduce each behavior. Out-of-scope items (time threshold, grounding disclosure, file-pipeline refactor, `maxOutputTokens`) are correctly absent from all tasks, with the grounding gap recorded as a new open item in Task 7.

**2. Placeholder scan.** No TBD/TODO. Every code step carries the actual code. Every test step carries the actual assertions.

**3. Type consistency.** `MeasuredRun` is defined once (Task 2) with fields `stats` and `source`, used identically in Tasks 3 and 5. `projectFullRunCost(stats, rowCount)` is defined in Task 1 and called with that exact signature in Task 5. `buildRunWarning(rowRange, chunkCount)` returns `string | null` and is consumed as such. `handleRun()` is parameterless from Task 4 onward, with the click wiring at line 240 updated in the same task. Renames (`lastTest`→`lastRun`, `renderTestStats`→`renderMeasuredRun`, `checkTestStatsFreshness`→`checkLastRunFreshness`) all land in Task 2, and later tasks use only the new names.

**One ordering note for the implementer:** Task 4 deliberately carries the old `CHUNK_WARN_THRESHOLD` confirm forward unchanged so that no commit in this sequence leaves the panel with no pre-run protection at all. Task 5 deletes it. Do not merge Tasks 4 and 5 — the restructure and the new behavior are worth separate review gates.
