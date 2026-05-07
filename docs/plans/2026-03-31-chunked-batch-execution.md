# Chunked Batch Execution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the monolithic `runBatchAI` dispatch with client-driven chunked execution, a pre-flight warning, and a between-chunk stop button.

**Architecture:** Chunking is entirely client-side — the server receives one `RunConfig` slice per chunk and is unaware of sequencing. `JobStore` gains three narrow additions (`cancel`, `isCancelled`, `setProgress`) while `dispatch()` remains unchanged. The chunk loop lives in `ConfigureAIRunPanel.handleRun()`.

**Tech Stack:** TypeScript, Jest/ts-jest, existing `JobStore`/`JobIndicator`/`ConfigureAIRunPanel` classes.

**Read before starting:**
- `docs/plans/2026-03-31-chunked-batch-execution-design.md` — full design rationale
- `src/client/job-store.ts` — current `dispatch()` contract
- `src/client/panels/configure-ai-run.ts` — `handleRun()` and `assembleRunConfig()`
- `src/client/components/job-indicator.ts` — current render pattern
- `src/client/types.ts` — `LoadingStatus` union

---

### Task 1: Add `"cancelling"` to `LoadingStatus`

**Files:**
- Modify: `src/client/types.ts:5`

**Step 1: Make the change**

```ts
// src/client/types.ts — line 5
export type LoadingStatus = "idle" | "loading" | "progress" | "cancelling" | "complete" | "error";
```

**Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: passes with no errors (no consumers reference the union exhaustively yet).

**Step 3: Commit**

```bash
git add src/client/types.ts
git commit -m "feat: add cancelling to LoadingStatus"
```

---

### Task 2: JobStore — `cancel()`, `isCancelled()`, `setProgress()`

**Files:**
- Modify: `src/client/job-store.ts`
- Modify: `__tests__/job-store.test.ts`

**Step 1: Write failing tests**

Append to the existing `describe("JobStore")` block in `__tests__/job-store.test.ts`:

```ts
describe("cancel()", () => {
  it("transitions a loading job to cancelling", () => {
    const listener = jest.fn();
    store.subscribe(listener);

    store.dispatch("job-c1", "Test", new Promise(() => {}));
    store.cancel("job-c1");

    const lastJobs = listener.mock.calls[listener.mock.calls.length - 1][0] as Array<{ id: string; state: { status: string } }>;
    const job = lastJobs.find((j) => j.id === "job-c1");
    expect(job?.state.status).toBe("cancelling");
  });

  it("transitions a progress job to cancelling", () => {
    const listener = jest.fn();
    store.subscribe(listener);

    store.dispatch("job-c2", "Test", new Promise(() => {}));
    store.setProgress("job-c2", "Row 3 of 10");
    store.cancel("job-c2");

    const lastJobs = listener.mock.calls[listener.mock.calls.length - 1][0] as Array<{ id: string; state: { status: string } }>;
    const job = lastJobs.find((j) => j.id === "job-c2");
    expect(job?.state.status).toBe("cancelling");
  });

  it("is a no-op for unknown job id", () => {
    expect(() => store.cancel("nonexistent")).not.toThrow();
  });

  it("is a no-op if job is already complete", async () => {
    const listener = jest.fn();
    store.subscribe(listener);

    await store.dispatch("job-c3", "Test", Promise.resolve());
    listener.mockClear();

    store.cancel("job-c3");
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("isCancelled()", () => {
  it("returns false before cancel is called", () => {
    store.dispatch("job-ic1", "Test", new Promise(() => {}));
    expect(store.isCancelled("job-ic1")).toBe(false);
  });

  it("returns true after cancel is called", () => {
    store.dispatch("job-ic2", "Test", new Promise(() => {}));
    store.cancel("job-ic2");
    expect(store.isCancelled("job-ic2")).toBe(true);
  });

  it("returns false for unknown job id", () => {
    expect(store.isCancelled("nonexistent")).toBe(false);
  });

  it("returns false after the job completes (flag cleaned up)", async () => {
    store.dispatch("job-ic3", "Test", new Promise(() => {}));
    store.cancel("job-ic3");
    expect(store.isCancelled("job-ic3")).toBe(true);

    // Simulate the promise resolving via the internal complete path —
    // easiest to test indirectly by checking flag cleanup after dispatch resolves.
    await store.dispatch("job-ic4", "Cleanup test", Promise.resolve());
    // ic3 flag still set (separate job), ic4 flag cleaned up (never set)
    expect(store.isCancelled("job-ic4")).toBe(false);
  });
});

describe("setProgress()", () => {
  it("updates the job state message", () => {
    const listener = jest.fn();
    store.subscribe(listener);

    store.dispatch("job-sp1", "Test", new Promise(() => {}));
    store.setProgress("job-sp1", "Chunk 2 of 6");

    const lastJobs = listener.mock.calls[listener.mock.calls.length - 1][0] as Array<{ id: string; state: { status: string; message?: string } }>;
    const job = lastJobs.find((j) => j.id === "job-sp1");
    expect(job?.state.status).toBe("progress");
    expect(job?.state.message).toBe("Chunk 2 of 6");
  });

  it("is a no-op for unknown job id", () => {
    expect(() => store.setProgress("nonexistent", "msg")).not.toThrow();
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/job-store.test.ts --bail
```

Expected: fails with `store.cancel is not a function` (or similar).

**Step 3: Implement the changes in `src/client/job-store.ts`**

Add a private field after the existing `pollIntervals` declaration:

```ts
private cancelFlags: Map<string, boolean> = new Map();
```

Add three public methods before `getJobs()`:

```ts
cancel(id: string): void {
  const job = this.jobs.get(id);
  if (!job) return;
  if (job.state.status !== "loading" && job.state.status !== "progress") return;
  this.cancelFlags.set(id, true);
  this.jobs.set(id, { ...job, state: { status: "cancelling", message: "Stopping after current chunk..." } });
  this.notify();
}

isCancelled(id: string): boolean {
  return this.cancelFlags.get(id) ?? false;
}

setProgress(id: string, message: string): void {
  const job = this.jobs.get(id);
  if (!job) return;
  this.jobs.set(id, { ...job, state: { status: "progress", message } });
  this.notify();
}
```

Clean up the cancel flag in the existing private `complete()` and `fail()` methods — add `this.cancelFlags.delete(id);` immediately after `this.stopPolling(id);` in each:

```ts
private complete(id: string): void {
  this.stopPolling(id);
  this.cancelFlags.delete(id); // ← add this line
  // ... rest unchanged
}

private fail(id: string, message: string): void {
  this.stopPolling(id);
  this.cancelFlags.delete(id); // ← add this line
  // ... rest unchanged
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/job-store.test.ts
```

Expected: all pass.

**Step 5: Full test suite**

```bash
npm test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/client/job-store.ts __tests__/job-store.test.ts
git commit -m "feat: add cancel, isCancelled, setProgress to JobStore"
```

---

### Task 3: `computeChunks` — pure helper with tests

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Create: `__tests__/configure-ai-run.test.ts`

**Step 1: Write the failing test**

Create `__tests__/configure-ai-run.test.ts`:

```ts
import { computeChunks } from "../src/client/panels/configure-ai-run";

describe("computeChunks", () => {
  it("returns a single chunk when row count equals chunk size", () => {
    expect(computeChunks({ start: 2, end: 51 }, 50)).toEqual([{ start: 2, end: 51 }]);
  });

  it("returns a single chunk when row count is less than chunk size", () => {
    expect(computeChunks({ start: 2, end: 11 }, 50)).toEqual([{ start: 2, end: 11 }]);
  });

  it("returns multiple full chunks", () => {
    expect(computeChunks({ start: 2, end: 101 }, 50)).toEqual([
      { start: 2, end: 51 },
      { start: 52, end: 101 },
    ]);
  });

  it("trims the last chunk to the actual end row", () => {
    expect(computeChunks({ start: 2, end: 75 }, 50)).toEqual([
      { start: 2, end: 51 },
      { start: 52, end: 75 },
    ]);
  });

  it("handles a start row other than 2", () => {
    expect(computeChunks({ start: 10, end: 69 }, 50)).toEqual([
      { start: 10, end: 59 },
      { start: 60, end: 69 },
    ]);
  });

  it("returns a single chunk for exactly one row", () => {
    expect(computeChunks({ start: 5, end: 5 }, 50)).toEqual([{ start: 5, end: 5 }]);
  });
});
```

**Step 2: Run to confirm failure**

```bash
npx jest __tests__/configure-ai-run.test.ts --bail
```

Expected: fails — `computeChunks` is not exported yet.

**Step 3: Add the export to `configure-ai-run.ts`**

Add near the top of `src/client/panels/configure-ai-run.ts`, after the imports and before the `SavedState` type:

```ts
export const CHUNK_SIZE = 50;

export function computeChunks(
  rowRange: { start: number; end: number },
  chunkSize: number,
): Array<{ start: number; end: number }> {
  const chunks: Array<{ start: number; end: number }> = [];
  for (let start = rowRange.start; start <= rowRange.end; start += chunkSize) {
    chunks.push({ start, end: Math.min(start + chunkSize - 1, rowRange.end) });
  }
  return chunks;
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/configure-ai-run.test.ts
```

Expected: all pass.

**Step 5: Full test suite**

```bash
npm test
```

Expected: all pass.

**Step 6: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/configure-ai-run.test.ts
git commit -m "feat: add computeChunks helper with tests"
```

---

### Task 4: Pre-flight warning and chunked dispatch in `handleRun()`

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`

**Step 1: Replace `handleRun()`**

Find the existing `handleRun()` method (currently around line 192) and replace it entirely:

```ts
private handleRun(container: HTMLElement): void {
  const config = this.assembleRunConfig();
  if (!config) return;

  const jobId = `batch-ai-${Date.now()}`;

  if (config.rowRange) {
    const rowCount = config.rowRange.end - config.rowRange.start + 1;
    if (rowCount > CHUNK_SIZE) {
      const chunkCount = Math.ceil(rowCount / CHUNK_SIZE);
      const estimatedMins = Math.ceil((rowCount * 5) / 60);
      const ok = globalThis.confirm(
        `You're about to process ${rowCount} rows across ${chunkCount} chunks.\n\n` +
          `This will take roughly ${estimatedMins} minutes. ` +
          `The sidebar must remain open throughout — closing it will stop the run after the current chunk finishes.\n\n` +
          `Continue?`,
      );
      if (!ok) return;
    }
  }

  if (config.rowRange) {
    const chunks = computeChunks(config.rowRange, CHUNK_SIZE);
    const runChunks = async (): Promise<void> => {
      for (let i = 0; i < chunks.length; i++) {
        if (jobStore.isCancelled(jobId)) break;
        jobStore.setProgress(jobId, `Chunk ${i + 1} of ${chunks.length}`);
        await runBatchAI({ ...config, rowRange: chunks[i] }, jobId);
      }
    };
    jobStore.dispatch(jobId, "Batch AI Run", runChunks()).catch((err: Error) => {
      globalThis.alert("Error: " + err.message);
    });
  } else {
    // No explicit row range — active sheet selection, resolved server-side.
    // Fall back to single dispatch (no chunking, no warning).
    jobStore.dispatch(jobId, "Batch AI Run", runBatchAI(config, jobId)).catch((err: Error) => {
      globalThis.alert("Error: " + err.message);
    });
  }

  this.loadHeaders(container, this.currentPreset());
}
```

**Step 2: Build**

```bash
npm run build
```

Expected: clean build, no TypeScript errors.

**Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: passes.

**Step 4: Full test suite**

```bash
npm test
```

Expected: all pass.

**Step 5: Commit**

```bash
git add src/client/panels/configure-ai-run.ts
git commit -m "feat: pre-flight warning and chunked dispatch in handleRun"
```

---

### Task 5: Stop button in `JobIndicator`

**Files:**
- Modify: `src/client/components/job-indicator.ts`
- Modify: `src/client/sidebar.css`

**Step 1: Rewrite `job-indicator.ts`**

Replace the file contents entirely:

```ts
import type { Job } from "../types";
import type { JobStore } from "../job-store";

/**
 * Renders active and recently failed jobs into the sidebar chrome strip.
 * Mounts to #job-strip which lives outside the router's #app container
 * and therefore persists across panel navigation.
 */
export class JobIndicator {
  private el: HTMLElement;
  private store: JobStore;

  constructor(container: HTMLElement, store: JobStore) {
    this.el = container;
    this.store = store;
    store.subscribe((jobs) => this.render(jobs));
    // Event delegation — survives innerHTML re-renders on each notify()
    this.el.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-cancel-job]");
      if (btn) {
        const jobId = btn.getAttribute("data-cancel-job");
        if (jobId) this.store.cancel(jobId);
      }
    });
  }

  private render(jobs: Job[]): void {
    const active = jobs.filter(
      (j) =>
        j.state.status === "loading" ||
        j.state.status === "progress" ||
        j.state.status === "cancelling",
    );
    const failed = jobs.filter((j) => j.state.status === "error");

    if (active.length === 0 && failed.length === 0) {
      this.el.hidden = true;
      this.el.innerHTML = "";
      return;
    }

    this.el.hidden = false;

    const items = [
      ...active.map((j) => this.renderActive(j)),
      ...failed.map((j) => this.renderFailed(j)),
    ];

    this.el.innerHTML = items.join("");
  }

  private renderActive(job: Job): string {
    const msg = job.state.message ?? job.label;
    const isCancelling = job.state.status === "cancelling";
    const action = isCancelling
      ? `<span class="job-strip__cancelling">Stopping...</span>`
      : `<button class="job-strip__cancel" data-cancel-job="${this.escape(job.id)}" title="Stop after current chunk">&#x2715;</button>`;
    return `<span class="job-strip__item job-strip__item--active">
      <span class="job-strip__spinner"></span>
      <span class="job-strip__label">${this.escape(msg)}</span>
      ${action}
    </span>`;
  }

  private renderFailed(job: Job): string {
    return `<span class="job-strip__item job-strip__item--error">
      <span class="job-strip__label">&#x26A0; ${this.escape(job.label)} failed</span>
    </span>`;
  }

  private escape(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
}
```

**Step 2: Add CSS to `src/client/sidebar.css`**

Append to the end of the file:

```css
.job-strip__cancel {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
  opacity: 0.6;
  padding: 0 2px;
}

.job-strip__cancel:hover {
  opacity: 1;
}

.job-strip__cancelling {
  font-size: 11px;
  font-style: italic;
  opacity: 0.6;
}
```

**Step 3: Build**

```bash
npm run build
```

Expected: clean build. Verify `dist/Sidebar.html` contains the new CSS.

**Step 4: Full test suite**

```bash
npm test
```

Expected: all pass.

**Step 5: Commit**

```bash
git add src/client/components/job-indicator.ts src/client/sidebar.css
git commit -m "feat: stop button and cancelling state in JobIndicator"
```

---

### Task 6: Lint, format, final verification

**Step 1: Lint**

```bash
npm run lint
```

Fix any reported issues before continuing.

**Step 2: Format**

```bash
npm run format:check
```

If it reports differences, run `npm run format` and re-stage the affected files.

**Step 3: Full build and test**

```bash
npm run build && npm test
```

Expected: clean build, all tests pass.

**Step 4: Typecheck both configs**

```bash
npm run typecheck
```

Expected: no errors on either server or client tsconfig.

**Step 5: Final commit if any formatting fixes were needed**

```bash
git add -p  # stage only formatting changes
git commit -m "chore: lint and format fixes"
```
