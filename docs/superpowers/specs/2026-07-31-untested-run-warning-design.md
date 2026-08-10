# Untested-run warning for Run AI Inference (AI-88)

## Problem

Two defects in the pre-run warning in `ConfigureAIRunPanel`:

1. **The threshold is arbitrary.** `CHUNK_WARN_THRESHOLD = 200` warns based on row count alone, and
   pairs it with a hardcoded `~0.5 s/row` time estimate. The estimate is fabricated, and it
   undercounts badly for file-mode runs because the file sub-batch loop in `runBatchAI` is sequential
   by design. Row count on its own says nothing about whether the run will produce useful output.

2. **The warning is unreachable in the default input mode.** The `confirm()` sits inside
   `if (config.rowRange)`. "Use highlighted rows" — the default — leaves `rowRange` undefined, so no
   dialog fires no matter how many rows are selected.

## Approach

Replace the row-count warning with a **test-coverage** warning: if the run is large enough to matter
and the user has not tested this exact configuration, tell them so and let them continue anyway.

The gate is intentionally minimal — one condition, one dialog, no cost or time projection.

## Design

### The gate

```
rowCount > CHUNK_SIZE  AND  no test measurement matching the live config  →  confirm()
```

- **`CHUNK_SIZE` (40) is the threshold.** No new constant. It already marks the point where a run
  chunks and where the panel's static helper text tells the user to keep the sidebar open.
- **"Tested" means `this.lastTest` exists and `configsMatch(buildConfigSnapshot(currentPreset()),
  this.lastTest.stats.config)`.** This reuses the comparison `checkTestStatsFreshness()` already
  applies to the results display, so the dialog and the on-panel text cannot disagree — editing the
  config after testing invalidates both.
- **Only the Test button records a measurement.** `runChunks` continues to discard the `RunStats`
  that `runBatchAI` returns. `lastTest` therefore keeps its name and its meaning: "you clicked
  Test." Accumulating full-run stats into it was considered and rejected as scope not worth the
  complexity.

### Restructuring `handleRun`

`handleRun` currently has two dispatch branches: an explicit-`rowRange` path that chunks
immediately, and a no-`rowRange` path that resolves the selection *inside* the `jobStore.dispatch`
callback. The warning can only live in the first, which is the cause of defect 2.

Resolve the range *before* deciding anything, collapsing both branches into one — the same shape
`handleTest` already uses:

```
assembleRunConfig()
  → resolve range (config.rowRange ?? getActiveRangeInfo())
  → sanitize (alert + bail if the range is header-only or absent)
  → confirmUntestedRun(range)   // bail if the user cancels
  → computeChunks + jobStore.dispatch
```

### Dropped: the empty-active-range fallback

The old no-`rowRange` branch fell back to `runBatchAI(config, jobId)` when `getActiveRangeInfo()`
returned nothing. That path was already a silent no-op: the server's `runBatchAI` performs the same
`sheet.getActiveRange()` lookup and returns `null` when there is no range
(`src/server/index.ts:375`). It dispatched a job that did nothing and reported nothing.

Replaced with an explicit alert asking the user to select rows or specify a range.

### Deletions

- `CHUNK_WARN_THRESHOLD` and its explanatory comment.
- The `~0.5 s/row` time estimate. No time figure ships.
- The "sidebar must remain open" sentence moves out of the dialog. The panel template already states
  it statically in the Run-on-all-rows helper text.

### Accepted consequence

A **tested** run of any size now shows no dialog at all. For a tested 5,000-row run, the static
helper text is the only place the sidebar warning appears. This is the deliberate trade for a gate
with one condition.

## Testing

`__tests__/panels/configure-ai-run.test.ts`:

- No dialog at or below `CHUNK_SIZE` rows.
- Dialog fires for an untested run above `CHUNK_SIZE` rows in **highlighted-rows mode** — the
  regression from defect 2.
- Dialog fires in explicit-range mode too.
- No dialog when `lastTest` matches the live config.
- Dialog fires when `lastTest` exists but the config has since changed.
- Cancelling the dialog dispatches nothing.
- Empty active range alerts and dispatches nothing.

Four existing "Run AI" tests rely on `getActiveRangeInfo()` resolving to `undefined` and reaching
the dropped fallback. They are updated to resolve a real range, since the path they exercised
no-ops in production.

No test currently asserts on `CHUNK_WARN_THRESHOLD` or the existing `confirm()`, so there is nothing
to remove.
