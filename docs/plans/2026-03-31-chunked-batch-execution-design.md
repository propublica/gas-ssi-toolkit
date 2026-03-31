# Chunked Batch Execution — Design Document

## Problem

`runBatchAI` is a monolithic server-side function that processes all requested rows in a
single Apps Script execution. Apps Script enforces a **6-minute execution time limit** on
`google.script.run` calls. A batch that exceeds this wall is killed mid-run — the job
fails with a GAS timeout error, the user doesn't know which rows were written, and there
is no recovery path.

At realistic Gemini API latencies (3–6 seconds per row including sheet writes), the
practical row ceiling before timeout is **60–120 rows** depending on configuration.
Users who request more than this will encounter silent partial failures.

Additionally, once a batch is dispatched, there is no mechanism to stop it. A user who
accidentally submits 500 rows has no recourse.

## Non-Goals

This design does **not** address:

- **True background processing** (sidebar can be closed mid-batch). That requires GAS
  installable time-based triggers, which is a separate architectural effort. The current
  design requires the sidebar to remain open for the entire run. This limitation is
  documented explicitly in the UI.
- **Batches larger than ~5,000 rows**. At that scale, the appropriate tool is a Vertex AI
  batch pipeline, not a Sheets add-on. This design targets the realistic Sheets use case.
- **`extractText` or `importDriveLinks`**. Those tools are generally faster per-row and
  less commonly run at large scale. They can be chunked in a follow-up if needed.

## Solution

Split the client-side dispatch of `runBatchAI` into a **sequence of smaller calls**, each
covering a fixed-size row slice. The server is unaware of chunking — `runBatchAI` already
accepts a `rowRange` slice via `RunConfig`. Chunking is orchestrated entirely in the
client.

A new `JobStore.dispatchChunked()` method sequences the chunk calls, exposes a
between-chunk cancellation point, and reports overall progress. From the user's
perspective, the batch is one logical job in the strip — a single progress indicator,
a single stop button, a single completion event.

A pre-flight confirmation dialog warns the user before large batches start, communicating
the chunk count, estimated duration, and the sidebar-open requirement.

## Chunk Size

**50 rows per chunk** — fixed constant, not user-configurable.

Rationale: at 6 seconds/row (conservative, grounded run with Drive files), 50 rows = 5
minutes, leaving a 1-minute safety margin before the GAS wall. At 3 seconds/row (text
only), 50 rows = 2.5 minutes. The constant is defined once in `configure-ai-run.ts` and
can be adjusted later without architectural change.

## Pre-flight Warning

When the user clicks "Run AI" and the row range covers more than `CHUNK_WARN_THRESHOLD`
rows (initial value: **50**), show a `globalThis.confirm()` dialog before dispatching:

```
You're about to process 300 rows across 6 chunks.

This will take roughly 30 minutes. The sidebar must remain open
throughout — closing it will stop the run after the current chunk finishes.

Continue?
```

If the user dismisses, nothing is dispatched.

The warning fires **only when `rowRange` is explicitly set**. When `rowRange` is absent,
the server uses the active sheet selection (resolved server-side), so the client doesn't
know the count at dispatch time — skip the warning in that case.

## Cancellation

Cancellation is **between-chunk only**. There is no mechanism to interrupt an in-flight
GAS execution (the current chunk completes before the run stops). This is expected
behavior and is communicated in the UI ("Stopping after current chunk...").

`JobStore` tracks a per-job cancel flag. When the user clicks the stop button:
1. The flag is set immediately
2. The job state transitions to `"cancelling"` — the stop button becomes a
   "Stopping..." label
3. When the current chunk's promise resolves, the dispatch loop checks the flag and exits
   instead of starting the next chunk
4. The job completes normally (toast is shown with how many rows were processed)

The cancel flag is a plain `Map<string, boolean>` in `JobStore` — no RPC, no
`CacheService`, no server involvement. This is the key architectural simplification over
the originally discussed cancel approach.

## New `LoadingStatus` value: `"cancelling"`

`"cancelling"` is added to the `LoadingStatus` union in `client/types.ts`. It means:
the user has requested cancellation, the current chunk is still in-flight, we're waiting
for it to finish. The job is still in the strip's "active" filter but renders differently
(no stop button, "Stopping..." label).

This is distinct from `"error"` (unexpected failure) and `"complete"` (normal finish).

## `JobStore` Changes

### Design principle

`JobStore.dispatch()` has one contract: **the caller creates the work, the store tracks
it.** The store is an observer and reporter — it does not orchestrate sequences of
operations. This design is preserved. `dispatch()` is unchanged.

Three narrow additions support chunked execution from the outside:

### New private field

```ts
private cancelFlags: Map<string, boolean> = new Map();
```

### New public method: `cancel(id)`

Sets the cancel flag and transitions job state to `"cancelling"`. No-ops if the job is
not in an active state. Called by `JobIndicator` when the user clicks the stop button.

### New public method: `isCancelled(id)`

```ts
isCancelled(id: string): boolean
```

Returns whether the cancel flag has been set for a job. Called by the panel between
chunks to decide whether to continue.

### New public method: `setProgress(id, message)`

```ts
setProgress(id: string, message: string): void
```

Writes an intermediate status message directly to the job state without waiting for the
server poll. Used by the panel to show `"Chunk 2 of 6..."` between chunks. Does not
affect the polling interval.

### Sequencing lives in the panel, not the store

`ConfigureAIRunPanel.handleRun()` owns the chunk loop and calls `dispatch()` with a
single Promise — the settled result of an immediately-invoked async function:

```ts
const runChunks = async (): Promise<void> => {
  for (let i = 0; i < chunks.length; i++) {
    if (jobStore.isCancelled(jobId)) break;
    jobStore.setProgress(jobId, `Chunk ${i + 1} of ${chunks.length}`);
    await runBatchAI({ ...config, rowRange: chunks[i] }, jobId);
  }
};

jobStore.dispatch(jobId, "Batch AI Run", runChunks());
```

`JobStore` receives one Promise and tracks it as before. It has no knowledge of chunks,
steps, or cancellation logic. The store's existing `complete()` path fires when `runChunks`
resolves — whether all chunks ran or the loop exited early due to cancellation.

## `JobIndicator` Changes

### Stop button

Active and progress jobs render a `✕` stop button:

```html
<button class="job-strip__cancel" data-cancel-job="${jobId}" title="Stop after current chunk">✕</button>
```

Cancelling jobs render a static label instead:

```html
<span class="job-strip__cancelling">Stopping...</span>
```

### Event delegation

`JobIndicator` currently wires no click listeners (it replaces `innerHTML` on each
render, which destroys child listeners). A single delegated listener on `this.el` handles
stop button clicks without being destroyed by re-renders:

```ts
this.el.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-cancel-job]");
  if (btn) store.cancel(btn.getAttribute("data-cancel-job")!);
});
```

`store` must be retained as an instance field (currently it is only a constructor
parameter).

## `ConfigureAIRunPanel` Changes

`handleRun()` is extended in two ways:

**1. Pre-flight check** (before dispatch):
```ts
if (config.rowRange && rowCount > CHUNK_WARN_THRESHOLD) {
  const chunkCount = Math.ceil(rowCount / CHUNK_SIZE);
  const ok = globalThis.confirm(`...`);
  if (!ok) return;
}
```

**2. Chunk dispatch** (replaces single `runBatchAI` call):
```ts
const chunks = computeChunks(config.rowRange!, CHUNK_SIZE);
const steps = chunks.map((slice) => () => runBatchAI({ ...config, rowRange: slice }, jobId));
jobStore.dispatchChunked(jobId, "Batch AI Run", steps);
```

`computeChunks` is a pure exported helper in `configure-ai-run.ts`:

```ts
export function computeChunks(
  rowRange: { start: number; end: number },
  chunkSize: number,
): Array<{ start: number; end: number }> {
  const chunks = [];
  for (let start = rowRange.start; start <= rowRange.end; start += chunkSize) {
    chunks.push({ start, end: Math.min(start + chunkSize - 1, rowRange.end) });
  }
  return chunks;
}
```

Exporting it allows direct unit testing without mounting the panel.

When `rowRange` is absent (active selection mode), dispatch falls back to a single
`runBatchAI` call via `dispatch()` as before — chunking only applies when the client
knows the row count.

## Progress Display

Within each chunk, the server writes per-row progress to `CacheService` as before — the
`JobStore` poll picks it up and the strip shows `"Processing row N of 50"`.

Between chunks, `dispatchChunked` updates the job state to `"Chunk N of M — starting..."`
before awaiting the next step. This is written directly to `this.jobs` inside `JobStore`,
so it is visible immediately without a poll round-trip.

The user therefore sees:
- Within chunk: `"Processing row 23 of 50"` (server-driven)
- Between chunks: `"Chunk 3 of 10 — starting..."` (client-driven)

No changes to `getJobProgress` or the server-side `writeJobProgress` call are needed.

## What Does Not Change

- `src/server/index.ts` (`runBatchAI`, `getJobProgress`) — no server changes
- `src/shared/types.ts` — no RPC boundary changes
- `src/client/services.ts` — no new RPC calls
- `src/client/google.d.ts` — no new server declarations
- `rollup.config.js` — no new global stubs
- `JobStore.dispatch()` — unchanged; existing jobs use it as before
- The `CacheService` job progress channel — unchanged

## Files Touched

| File | Change |
|---|---|
| `src/client/types.ts` | Add `"cancelling"` to `LoadingStatus` |
| `src/client/job-store.ts` | Add `cancelFlags` field; add `cancel()`, `isCancelled()`, and `setProgress()` methods. `dispatch()` is unchanged. |
| `src/client/components/job-indicator.ts` | Add stop button; event delegation; handle `"cancelling"` render |
| `src/client/sidebar.css` | Style `.job-strip__cancel` and `.job-strip__cancelling` |
| `src/client/panels/configure-ai-run.ts` | Add `computeChunks` helper; pre-flight warning; chunked dispatch in `handleRun()` |

## User-Facing Limitation to Document

The sidebar must remain open for the entire batch run. If it is closed:

- The currently in-flight chunk completes server-side (rows are written)
- No further chunks are dispatched
- The batch stops without error or notification

This should be surfaced in two places:
1. The pre-flight confirmation dialog (already included in the warning copy above)
2. A note in the sidebar UI near the Run button when a large row range is detected

## Future Work

**Time-based trigger chaining** would remove the sidebar-open requirement. Each chunk
completion creates a GAS installable trigger for the next chunk, allowing the user to
close everything. Progress would be persisted in `PropertiesService` rather than
`CacheService`. This is a meaningful architectural addition and is deferred.

**External pipeline dispatch** — for batches beyond ~5,000 rows, the right tool is a
Vertex AI batch inference job. The `dispatchChunked` interface is designed to be
replaceable: a future `dispatchExternal()` path would accept the same `RunConfig` and
return the same `Promise<void>`, with the strip UI unchanged.
