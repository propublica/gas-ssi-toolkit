# Full-Run Cost Warning Design

**Date:** 2026-07-30
**Branch:** AI-88-full-run-cost-warning
**Related issue:** [AI-88](https://linear.app/propublica/issue/AI-88/beef-up-run-ai-inference-panels-full-run-warning)
**Threat model:** T14 / R44 (supersedes R18)

## Overview

`ConfigureAIRunPanel`'s pre-run warning is static: it fires above 200 rows and estimates time from a hardcoded `~0.5s/row` guess, with no cost signal. AI-87 added a Test button that measures real token usage and cost from Gemini responses. AI-88 uses that measured data to gate the full run.

This is R44, the second of two planned T14 mitigations.

## Scope

**In scope:**
- Replace the static row-count warning with a cost-driven one, computed from real measured token usage
- Nudge the user to run a Test when no measurement exists for the current configuration
- Close a gap where active-selection runs never warn at all
- Capture measured stats from full runs, not just Test clicks
- Remove the unread `CacheService` run-stats write

**Explicitly out of scope:**
- A time threshold (see "Why cost only")
- Grounding free-tier disclosure in the cost display (real gap, tracked separately)
- Lifting the file pipeline out of `runBatchAI` (separate refactor)
- `generationConfig.maxOutputTokens` (R29, already tracked)
- Cross-session persistence of measured stats (see "Why no cache")

## How estimation works today

Measurement is per `runBatchAI` invocation. The server has no "test mode" — one invocation is either one Test click (≤10 rows) or one chunk of a full run (≤40 rows).

| Step | Location | What happens |
|---|---|---|
| 1 | `index.ts:313` | `startTime = Date.now()` — before all work: sheet reads, column resolution, file pipeline, Gemini calls, writes |
| 2 | `index.ts:526` | `callGeminiAPIBatch` → one `UrlFetchApp.fetchAll` for every row in the invocation |
| 3 | `api.ts` | `usageMetadata` extracted per response |
| 4 | `index.ts:584` | `computeRunStats(results, Date.now() - startTime, model)` |
| 5 | `utils.ts:135` | Written to `CacheService`, **and** returned to the client |

Cost per response (`cost-tracking.ts`): input = `promptTokenCount` × input rate; output = `(candidatesTokenCount + thoughtsTokenCount)` × output rate; Pro Preview switches to its >200k tier per request; grounding = `webSearchQueries.length` × $14/1,000. Responses without `usageMetadata` (errored rows) are excluded from both `rowCount` and cost.

The client projects to a full run in `renderTestStats` (`configure-ai-run.ts:449-476`):

```
avgCost    = (totalTokenCost + totalGroundingCost) / rowCount
fullCost   = avgCost × fullRowCount
chunkCount = ceil(fullRowCount / CHUNK_SIZE)
fullTimeMs = chunkCount × totalTimeMs
```

## Why cost only

Cost is linear in rows — per-row cost × row count is methodologically sound for any sample size. Time is not, and the code shows why:

- **Text mode:** all ≤40 requests go out in one `fetchAll` (`api.ts:137`). Wall clock ≈ slowest request, roughly flat in row count. A 10-row test and a 40-row chunk are both "one `fetchAll` deep," so `chunkCount × totalTimeMs` is approximately right.
- **File mode:** `index.ts:443` is a **sequential** `for` loop over sub-batches of `FILE_PIPELINE_BATCH_SIZE = 10` unique files. A 10-row/10-file test pays one sub-batch; a 40-row/40-file chunk pays four. `chunkCount × totalTimeMs` therefore undercounts by up to ~4×.

The sequential loop is deliberate, not an oversight — `index.ts:437-442` documents it as a memory guard preventing JS runtime crashes from the `Uint8Array`→`Byte[]` expansion `UrlFetchApp` payloads require (~8× overhead), with `batchBytes.clear()` at line 472 releasing each sub-batch. Flattening it would trade a known arithmetic error for a crash the team already fixed.

Under AI-87 the time figure was cosmetic. Gating a warning on it would make a known-wrong number consequential, so **R44's 10-minute threshold is dropped.** Correcting it is possible — scale file-mode time by sub-batch ratio, which needs a unique-file count in `RunStats` — but it is not worth carrying here. The sidebar-open concern that motivated the time threshold is served by a plain reminder instead.

## Why no cache

`writeRunStats` writes `RunStats` to `CacheService` (`runStats:{spreadsheetId}`, 6h TTL) on every invocation with `rowCount > 0`. AI-87 built it speculatively for AI-88. AI-88 does not want it.

A redundant Test is nearly free: `handleTest` runs the first 10 rows *of the same selection the full run will cover*, so those output cells are overwritten by the full run anyway. The cost of a false nudge is ~10 extra inferences.

Reading the cache would buy "don't re-test after a sidebar reopen," at the price of:
- A new RPC endpoint (`getRunStats`) plus footer stub, `google.d.ts` entry, and services wrapper — 5 files to read one cache key
- Two sources of truth (in-memory vs cached) and a merge rule between them
- A **6-hour window in which a stale estimate is presented as current** — `configsMatch` compares column *names*, so the sheet's contents can change entirely while the estimate still validates

In-memory state cannot have that last problem: it dies with the session. Paying complexity and a wider staleness window to save pennies is a bad trade, so `writeRunStats` and its call site are **deleted**.

### What survives what

`Router.lastState` (`router.ts:22`) records each panel's `savedState` on every navigation away, independent of path.

| Event | Measured stats survive? | Why |
|---|---|---|
| Back button | Yes | `back()` restores the stack entry's `savedState` (`router.ts:59`) |
| Navigate away, visit others, return | Yes | `Router.lastState` map (`router.ts:43-48`) |
| Refresh columns (↻) | Yes | calls `loadHeaders()` only — no unmount |
| Arrive with explicit params (recipe Cook) | No | `router.ts:43` bypasses the cache when params are passed — intentional; `configsMatch` would reject it anyway |
| Close and reopen the sidebar | No | the iframe is destroyed with Router, `lastState`, and all panel instances |
| Reload the spreadsheet | No | same |

Note that `mount()` assigns `this.lastRun = savedState?.lastRun`, so the singleton panel instance surviving is *not* an independent safety net despite looking like one.

Accepted: the residual loss is "tested, closed the sidebar, reopened, want to run without re-testing" — one redundant 10-row test.

## Design

### Capture stats from full runs, not just Tests

`runChunks` currently discards `runBatchAI`'s return value (`configure-ai-run.ts:400`). So a user who runs 200 rows and then wants to run 5,000 more is nudged to "test first" despite having just measured 200 real rows.

`runChunks` assigns each chunk's stats into `this.lastRun` as it goes, keeping the most recent non-null result. Every run then refreshes the estimate, making the nudge rare in practice — it appears only on a genuinely first run of a configuration in a fresh sidebar, which is exactly when it is warranted.

### One state field, no frozen row count

`TestRunDisplay` (`client/types.ts:103`) is replaced:

```ts
export interface MeasuredRun {
  stats: RunStats;
  /** Which action produced the measurement — controls the display label only. */
  source: "test" | "run";
}
```

`fullRowCount` is **removed**. It existed so `renderTestStats` could project a full-run cost, and it was frozen at measurement time — `RunStatsConfigSnapshot` deliberately excludes `rowRange`, so `configsMatch` cannot detect a user testing 10 rows and then widening 50 → 5,000. The displayed projection would silently stay wrong.

Removing it fixes that at the root: **the panel no longer projects.** It shows only what was measured, which is accurate forever. The projection moves into the dialog, the one place where the live row count is known.

This is a deliberate change to AI-87's shipped display — the "Full run estimate" line in the panel goes away, replaced by the same information at the moment of decision with correct inputs.

### Projection

Module-level in `configure-ai-run.ts`, exported for testing, matching the existing `computeChunks` precedent in that file:

```ts
export const COST_WARN_THRESHOLD_USD = 10;

export function projectFullRunCost(stats: RunStats, rowCount: number): number {
  return ((stats.totalTokenCost + stats.totalGroundingCost) / stats.rowCount) * rowCount;
}
```

Its only caller is `handleRun`; it is extracted purely so the arithmetic is unit-testable without a DOM, exactly as `computeChunks` already is. No shared module in `src/shared/` is warranted for a single-consumer client-side helper. `CHUNK_WARN_THRESHOLD = 200` is deleted.

### Trigger logic

Two mutually exclusive conditions, evaluated after the row range is resolved. They cannot both hold: you cannot lack an estimate and have an expensive one.

| Condition | Result |
|---|---|
| No usable stats **and** `rowCount > CHUNK_SIZE` | Untested nudge |
| Usable stats **and** `projectFullRunCost(...) > COST_WARN_THRESHOLD_USD` | Cost warning |
| Otherwise | No dialog — run launches |

"Usable" means `lastRun` exists **and** `configsMatch(buildConfigSnapshot(this.currentPreset()), lastRun.stats.config)`. This is re-checked at click time, not only on `loadHeaders` resolution, so a config edit made after the last measurement is caught.

### Dialog copy

Untested:

```
You're about to process 5,000 rows across 125 chunks.

You haven't tested this configuration, so there's no cost estimate.
Cancel and click Test to see what a full run will cost.

Keep this sidebar open until the run finishes.
```

Cost warning:

```
You're about to process 5,000 rows across 125 chunks.

Estimated cost: ~$18.40, based on your last run of 10 rows.
Consider narrowing your row range first.

Keep this sidebar open until the run finishes.
```

The sidebar line appends only when `chunkCount > 1`, evaluated independently of which body fired — a 40-row Pro Preview run over large files can cross $10 in a single chunk. No time figure and no file-size caveat: both are already communicated in the panel's own helper text.

### `handleRun` restructure

Today the confirm sits inside `if (config.rowRange)` (`configure-ai-run.ts:345`). When no explicit range is set, the active selection is resolved asynchronously *inside* the dispatch (line 375) — so **a user who highlights 5,000 rows and clicks Run gets no dialog at all.** Since the active-selection path is the default when the RowRange fields are left blank, this is the likelier path for exactly the runs the warning exists to catch.

Fixing it means resolving the range before deciding, which makes `handleRun` async. This is a net simplification: the two near-duplicate dispatch paths (lines 361-386) collapse into one.

```
handleRun():
  1. assembleRunConfig()                          — unchanged
  2. range = config.rowRange ?? await getActiveRangeInfo()
       → if neither resolves, fall through to today's behavior:
         dispatch runBatchAI with no rowRange and let the server use
         sheet.getActiveRange(). Row count is unknown, so no dialog.
       → resolveRowRange() sanitizes (rejects the header row)
  3. rowCount, chunkCount = computeChunks(range, CHUNK_SIZE).length
  4. pick dialog body per the trigger table; append sidebar line if chunkCount > 1
  5. confirm() → bail on cancel
  6. one dispatch path: jobStore.dispatch(jobId, "Batch AI Run", runChunks(...))
```

`handleRun` is invoked from a click listener, so the awaited `getActiveRangeInfo()` needs its own `try/catch` alerting on failure — an unhandled rejection would otherwise be silent. The existing `.catch` on the dispatch is retained.

### Server change

`runBatchAI` keeps its `RunStats | null` return — the client uses it. Only the cache write goes: the `writeRunStats(cache, ss.getId(), computed)` call at `index.ts:589` is removed, and `writeRunStats` itself is deleted from `utils.ts`. The surrounding `try/catch` is retained; `computeRunStats` and `buildConfigSnapshot` are pure, but the invariant that stats computation must never break an already-completed run is worth keeping. `cache` remains in use for `writeJobProgress`.

## Error handling

- No new RPC endpoints, so no new failure surface at the RPC boundary.
- `getActiveRangeInfo()` rejection in `handleRun` is caught and alerted, matching the existing dispatch `.catch` pattern.
- `resolveRowRange()` returning null (header-row-only selection) aborts before any dialog, unchanged.
- Unresolvable range → no dialog, run proceeds with server-side active-range resolution. Preserves today's behavior rather than blocking on an edge case.
- `projectFullRunCost` divides by `stats.rowCount`, which is only ever stored when `> 0` (`index.ts:588`). No guard needed, but the test suite pins this.

## Testing

The suite already splits this panel by kind: `__tests__/configure-ai-run.test.ts` holds pure helpers (`computeChunks` only, 36 lines), `__tests__/panels/configure-ai-run.test.ts` holds DOM-driven panel behavior (1,039 lines). New tests follow that split.

`__tests__/configure-ai-run.test.ts` — `projectFullRunCost`, pure: token-only cost, grounding-inclusive cost, scaling to a larger row count, single-row sample.

`__tests__/panels/configure-ai-run.test.ts`:
- All three trigger branches: untested + above chunk size → nudge; usable stats + over threshold → cost warning; usable stats + under threshold → no dialog
- Untested **below** chunk size → no dialog
- `configsMatch` mismatch at click time → treated as untested even though `lastRun` exists
- Sidebar line present when `chunkCount > 1`, absent when 1
- Projection uses the **live** row count, not the count at measurement time
- Active-selection path warns (the closed gap)
- `runChunks` captures stats into `lastRun`; a null result leaves the previous value intact
- `lastRun` round-trips through `unmount()`/`mount()` savedState
- Panel display renders measured facts only, labelled by `source`, with no projection

`utils.test.ts` — remove the `writeRunStats` describe block (lines 330-353).

## Files changed

| File | Change |
|---|---|
| `src/client/panels/configure-ai-run.ts` | `COST_WARN_THRESHOLD_USD` + `projectFullRunCost`; delete `CHUNK_WARN_THRESHOLD`; async `handleRun` with range resolved first and one dispatch path; `runChunks` captures stats; panel display drops the projection. Renames: `lastTest` → `lastRun`, `renderTestStats` → `renderMeasuredRun`, `checkTestStatsFreshness` → `checkLastRunFreshness`, `SavedState.lastTest` → `lastRun` |
| `src/client/types.ts` | Replace `TestRunDisplay` with `MeasuredRun` |
| `src/server/index.ts` | Remove the `writeRunStats` call and its import |
| `src/server/utils.ts` | Delete `writeRunStats` |
| `__tests__/configure-ai-run.test.ts` | Add `projectFullRunCost` pure tests |
| `__tests__/panels/configure-ai-run.test.ts` | Trigger-branch and capture tests; rename the `lastTest persistence` block (line 918) to `lastRun` |
| `__tests__/utils.test.ts` | Remove the `writeRunStats` describe block (lines 330-353) |
| `docs/threat_models/ssi-toolkit-threat-model.md` | R44 resolved (cost gate only); amend R43's note about caching for R44 |

Net effect is a code reduction: one new constant and one 3-line function, against a deleted constant, a deleted server function, a deleted interface field, and two collapsed dispatch paths. No new RPC endpoint, so no new T8 surface.

## Threat model updates

- **R44** → resolved, with the scope recorded: cost threshold implemented; time threshold dropped because the projection undercounts in file mode (sequential sub-batch loop), and gating on a known-wrong number is worse than not gating. The chunk-size concern is served by the sidebar reminder.
- **R43** → amend the note stating token usage is "persisted to `CacheService` for R44." R44 chose not to consume it and the write is removed.
- **R18** → already marked superseded by R44; no change.
- New open item: grounding cost is computed as if paid, ignoring the 5,000/month account-wide free quota, and the UI does not disclose this. AI-87's spec called for the caveat; it was never added.

## Accepted limitations

- **Sample bias.** Cost scales with tokens, not rows. Rows 2-11 may be nothing like row 4,000. Inherent to sampling; the dialog discloses the sample size ("based on your last run of 10 rows") so the user can judge.
- **Live-edit staleness.** Editing the form after a measurement leaves `lastRun` stale until the click-time `configsMatch` catches it. Config-shaped edits are caught; sheet *content* edits are not, since the snapshot compares column names. Inherited from AI-87.
- **No cross-session persistence.** See "Why no cache."
- **Unbounded output tokens.** With `maxOutputTokens` unset (`config.ts:14`), one runaway generation can cost far more than the sample implied. R29, tracked separately.
- **Pricing is hardcoded** as of 2026-07-16 with no expiry marker, so projections drift as Google's prices change.
