# Test Button & Cost Estimate Design

**Date:** 2026-07-16
**Branch:** AI-87-test-button-cost-estimate
**Related issue:** [AI-87](https://linear.app/propublica/issue/AI-87/implement-test-button-in-the-run-ai-inference-panel-with-cost)

## Overview

`ConfigureAIRunPanel` has no way to preview cost or quality before committing to a full batch run — the only safeguard today is a static row-count warning (`CHUNK_WARN_THRESHOLD`) using a hardcoded `~0.5s/row` time guess, with no cost signal at all. This is threat T14 in the security threat model (GCP cost explosion via large batch runs); this PR implements R43, the first of two planned mitigations.

This PR adds a "Test" button above "Run AI" that runs the user's exact configuration against the first 10 rows of their target range — a real run, not a dry run, so results land in the sheet exactly as a full run would — and measures actual token usage, time, and cost from the real Gemini response. R44 (a separate, future ticket — AI-88) will use this data to replace the static warning in `handleRun()` with a real, measured one. This spec only covers AI-87.

## Scope

**In scope:**
- A Test button + results display in `ConfigureAIRunPanel`
- Capturing token usage (`usageMetadata`) from the Gemini API response, previously discarded
- Computing cost from real token counts and current Gemini pricing
- Persisting the latest run's stats to `CacheService`, keyed per spreadsheet, so a *future* ticket can read it independent of the current session

**Explicitly out of scope (deferred to AI-88 or later):**
- Reading the cached stats back to power `handleRun()`'s warning (no `getRunStats()` read RPC is built here — AI-87 has no consumer for one)
- An "estimated cost for the full run" figure — may be added later as its own warning, not part of this display
- Invalidating the displayed test results if the user edits the form without navigating away (see "Accepted limitations" below)

## Design

### No separate "test mode"

`runBatchAI` behaves identically regardless of what triggered it — a full run, one chunk of a full run, or a Test click. Test is a **client-side** concept only: it computes a row range capped to 10 rows and calls the exact same `runBatchAI` RPC. The server has no branching on "is this a test."

Stats capture becomes part of `runBatchAI`'s normal contract: every invocation measures its own wall-clock time and, from the `GeminiResponse[]` it already has in hand, computes token/cost stats via a new pure module and writes them to cache. `runBatchAI` itself grows by only a few lines of wiring — all new logic lives in small, independently-tested files.

### Gemini API response — capturing `usageMetadata`

The REST response for `generateContent` includes a top-level `usageMetadata` object (sibling to `candidates`), which the toolkit currently discards entirely.

Field relationships, per the Gemini API reference and thinking-token docs — this matters for getting cost math right, not just for picking field names:
- `promptTokenCount` is the **complete** effective prompt size — it already includes `cachedContentTokenCount` and `toolUsePromptTokenCount` as subsets, not additional to it. Neither of those two needs to be captured separately: `cachedContentTokenCount` will always be 0 for this app (nothing here ever sets `cachedContent`), and `toolUsePromptTokenCount` would double-count input cost if added on top of `promptTokenCount`.
- `thoughtsTokenCount` is genuinely additional — billed at the model's **output** rate ("response pricing is the sum of output tokens and thinking tokens"). This is **not an edge case for this app**: thinking is on by default for both models in `PRICING_CATALOG` (Gemini 3.1 Pro Preview defaults to "high," Gemini 3.1 Flash Lite defaults to "minimal"), so omitting it would systematically undercount cost on every request, not just occasionally.
- `totalTokenCount` ≈ `promptTokenCount + thoughtsTokenCount + candidatesTokenCount`.

```typescript
// src/server/types.ts
export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount?: number; // billed at the output rate; present whenever thinking is active
  totalTokenCount: number;
}
```

`GeminiResponse` gains `usageMetadata?: GeminiUsageMetadata`. Unlike `groundingMetadata`/`codePairs` (genuinely conditional on tool use, and using a conditional-spread to keep the key fully absent when not applicable), `usageMetadata` is returned on essentially every successful response regardless of tools — so it's assigned directly rather than via the conditional-spread idiom:

```typescript
// api.ts — both callGeminiAPI and callGeminiAPIBatch
const usageMetadata = json.usageMetadata as GeminiUsageMetadata | undefined;
return { text, usageMetadata, ...(groundingMetadata !== undefined && { groundingMetadata }), ... };
```

The type stays optional purely as a defensive measure against parsing arbitrary external JSON, not because presence is conditional on anything this app controls.

### Pricing

New `src/server/pricing.ts`. Uses **Standard** tier pricing — not Gemini's discounted async Batch API tier, despite this codebase's own `runBatchAI` naming; we call `generateContent` synchronously via `UrlFetchApp.fetchAll`, which bills at Standard rates.

```typescript
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  inputPerMillionOver200k?: number;  // Pro Preview tiered rate, prompts > 200k tokens
  outputPerMillionOver200k?: number;
}

export const PRICING_CATALOG: Record<ModelId, ModelPricing> = {
  "gemini-3.1-flash-lite": { inputPerMillion: 0.25, outputPerMillion: 1.50 },
  "gemini-3.1-pro-preview": {
    inputPerMillion: 2.00, outputPerMillion: 12.00,
    inputPerMillionOver200k: 4.00, outputPerMillionOver200k: 18.00,
  },
};

export const GROUNDING_PRICE_PER_1000_QUERIES = 14.00;
```

Google Search grounding has its own per-query charge (separate from token pricing) — $14/1,000 queries after a shared monthly free quota (5,000/month, account-wide). `url_context` and `code_execution` have no separate fee; both bill as ordinary tokens. This app doesn't track the shared monthly free-tier consumption (that's account-wide state outside its visibility), so grounding cost is always computed "as if paid" — actual cost may be $0 if the account is within its monthly allowance. The UI should note this caveat wherever grounding cost is shown.

### Types crossing the RPC boundary (`src/shared/types.ts`)

```typescript
export type RunStatsConfigSnapshot = Pick<
  RunConfig,
  "promptCols" | "systemPromptCol" | "tools" | "prefixWithColName" | "model"
>;
```

Follows the existing `RecipeSettings = Pick<RunConfig, ...>` precedent (`src/client/types.ts:46`) rather than a hand-written interface, so it can never drift out of sync with `RunConfig`. Only these five fields affect cost — `outputCol`, `includeGrounding`, and `applyMarkdown` affect where/how output is written, not what it costs to generate.

```typescript
export interface RunStats {
  rowCount: number;              // rows successfully measured (had usageMetadata)
  totalTimeMs: number;           // wall-clock time for the whole invocation
  totalInputTokens: number;      // sum of promptTokenCount (already includes tool-use/cached-content overhead)
  totalOutputTokens: number;     // sum of (candidatesTokenCount + thoughtsTokenCount) — both billed at the output rate
  totalTokenCost: number;        // USD, token pricing only
  totalGroundingQueries: number; // sum of groundingMetadata.webSearchQueries.length
  totalGroundingCost: number;    // USD, at Standard grounding rate
  testedAt: number;              // start-of-invocation timestamp
  config: RunStatsConfigSnapshot;
}
```

Deliberately stores **totals**, not averages — per-row figures are a trivial division wherever displayed, and there's no derived state to keep in sync. Total cost for display is `totalTokenCost + totalGroundingCost`.

### Cost computation (`src/server/cost-tracking.ts`, new)

Pure, no GAS globals, fully unit-testable with fixture data:

- `computeRunStats(results: GeminiResponse[], elapsedMs: number): Omit<RunStats, "testedAt" | "config">` — filters to results carrying `usageMetadata` (skips error/no-usage rows). For each measured result: the pricing tier is `promptTokenCount > 200_000 ? "over200k" : "standard"` (Pro Preview only); input cost is `promptTokenCount` at that tier's input rate; output cost is `(candidatesTokenCount + (thoughtsTokenCount ?? 0))` at that tier's output rate — thinking tokens are folded into the same output bucket since they're billed identically, not tracked as a separate field. Sums grounding queries from `groundingMetadata.webSearchQueries.length` **unconditionally** — this must not gate on `RunConfig.includeGrounding`, since that flag only controls whether a `_grounding` output column is written, not whether the tool actually ran and incurred cost.

### Config snapshot & comparison (`src/shared/run-stats.ts`, new)

A small shared module (not `shared/types.ts`, which is types-only per its header comment) holding the two functions both client and server need to agree on:

```typescript
export function buildConfigSnapshot(config: RunConfig): RunStatsConfigSnapshot {
  return {
    promptCols: config.promptCols,
    systemPromptCol: config.systemPromptCol,
    tools: config.tools ?? [],
    prefixWithColName: config.prefixWithColName ?? false,
    model: config.model,
  };
}

export function configsMatch(a: RunStatsConfigSnapshot, b: RunStatsConfigSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
```

Normalizing `tools`/`prefixWithColName` to stable defaults inside `buildConfigSnapshot` means two snapshots built the same way are always directly comparable — reusing the `JSON.stringify` idiom already used for cache serialization (`writeJobProgress`, `utils.ts:118`) rather than writing a field-by-field deep-equal.

### Server integration (`src/server/index.ts`)

`runBatchAI`'s signature changes from `void` to `RunStats | null`. All existing early-return paths (no headers, missing columns, no API key, "no rows to process") now explicitly `return null`. At the end, after the existing write loop/flush/toast (all unchanged):

```typescript
export function runBatchAI(config: RunConfig, jobId?: string): RunStats | null {
  const startTime = Date.now();
  // ...existing logic, completely unchanged...

  let stats: RunStats | null = null;
  try {
    const computed = {
      ...computeRunStats(results, Date.now() - startTime),
      testedAt: startTime,
      config: buildConfigSnapshot(config),
    };
    if (computed.rowCount > 0) {
      writeRunStats(cache, ss.getId(), computed);
      stats = computed;
    }
  } catch (_e) {
    // Stats/cost tracking is best-effort and must never fail the underlying AI run,
    // which has already fully completed by this point.
  }

  // ...existing toast, unchanged...
  return stats;
}
```

`writeRunStats(cache, spreadsheetId, stats)` goes in `utils.ts`, mirroring the existing `writeJobProgress` (takes `cache` as a param for testability). Cache key: `runStats:${spreadsheetId}` in `CacheService.getUserCache()` — already user-scoped; the spreadsheet ID prevents collisions if the same user has this add-on open across multiple sheets. TTL: 21600s (`CacheService`'s max).

No `getRunStats()` read RPC is added in this PR — nothing in AI-87 needs to read the cache back independently of a fresh `runBatchAI` call. AI-88 will add it when its warning logic needs a fresh read at decision time.

### Client integration

**`jobStore.dispatch`** (`job-store.ts`) becomes generic: `dispatch<T>(id: string, label: string, fn: Promise<T>): Promise<T>`, with its internal `.then(() => this.complete(id), ...)` changed to `.then((result) => { this.complete(id); return result; }, ...)`. Existing call sites (`handleRun`'s two dispatches, `importDriveLinks`, `extractText`) pass `Promise<void>`-returning functions and ignore the resolved value, so `T` infers as `void` for them — no changes needed there.

**`services.ts`**: `runBatchAI`'s wrapper return type becomes `Promise<RunStats | null>`.

**`rollup.config.js` footer**: the existing stub doesn't return its value —
```js
// current: function runBatchAI(config, jobId) { _GASEntry.runBatchAI(config, jobId); }
// needed:  function runBatchAI(config, jobId) { return _GASEntry.runBatchAI(config, jobId); }
```
Missing this would silently drop the `RunStats` value at the RPC boundary.

**`google.d.ts`**: `runBatchAI(config: RunConfig, jobId?: string): RunStats | null;` (was `void`).

**`ConfigureAIRunPanel`** (`configure-ai-run.ts`):
- New `#test-btn` in `.panel-buttons`, directly above `#run-btn`, with the Linear-specified flavor text as a `field-helper` above it ("Execute your configuration across the first 10 rows in your selection. Evaluate for quality. Estimate cost."). New `#test-results` container between them.
- New `handleTest()`:
  1. `assembleRunConfig()` — same validation `handleRun` already uses.
  2. Resolve the uncapped target range exactly as `handleRun` does (explicit `rowRange`, else `getActiveRangeInfo()`), then cap to `{ start, end: Math.min(start + 9, resolvedEnd) }`. 10 rows is always under `CHUNK_SIZE` (40), so this is always a single call — no chunk loop needed.
  3. `const stats = await jobStore.dispatch(jobId, "Test AI Run", runBatchAI(testConfig, jobId));` — reuses the existing job-strip progress UI for free.
  4. If `stats`: render rows tested, measured time, avg cost per row (`(totalTokenCost + totalGroundingCost) / rowCount`), and total cost of the test run; flash a brief success state on the button (CSS class swap, ~3s auto-revert — same ephemeral-feedback idiom as `#refresh-btn`'s existing `.spinning` toggle); set `this.lastTestStats = stats`.
  5. If `null` (nothing measurable — covers both "no rows in the selection" and "every attempted row errored"): show a neutral message, e.g. "Test didn't produce measurable results — check the sheet for errors in the tested rows." `lastTestStats` is left untouched.
  6. On RPC failure: `alert`, matching `handleRun`'s existing catch pattern.
- `SavedState` gains `lastTestStats: RunStats | null`.
- `mount()` restore path: if `savedState?.lastTestStats` exists, compute `buildConfigSnapshot()` of the config being restored and compare via `configsMatch()` against `savedState.lastTestStats.config`. Match → render the stats (no success flash — this isn't a fresh completion). Mismatch → render a "Configuration changed since last test" notice instead of numbers, so a stale cost figure is never shown next to a configuration it no longer describes.
- No new mutual-exclusion logic between Test and Run — `jobStore` already supports concurrent jobs shown in the strip, and there's no existing precedent to disable either button.

### Accepted limitations

- **Live-editing staleness**: editing the form after a completed test, without navigating away, leaves the displayed numbers stale until the user retests or navigates away and back (which triggers the `configsMatch` check above). Fully closing this would require wiring "invalidate on change" listeners onto every cost-relevant field, some of which (`PromptColList`, `systemPromptList`) have no change hooks in this panel today. Accepted for this PR — arguably lower-risk than the case that *is* handled, since the user just changed something themselves and is more likely to suspect the numbers are stale.
- **No full-run cost estimate** in this PR's display, even though cost scales linearly with row count (unlike time, which doesn't, given `fetchAll`'s parallelism). May be added later as its own warning.
- **Ambiguous zero-row case**: `stats === null` covers both "nothing was in the selection" and "everything was attempted and every row individually errored." Distinguishing them would need a discriminated return shape for what should be a rare case (an empty selection is far more likely than every row in a batch failing) — the neutral message above is accurate for both without overclaiming.

## Error handling

- All of `runBatchAI`'s existing early-return paths now explicitly `return null` — no behavior change, just a signature update.
- The stats computation + cache write is wrapped in its own `try/catch` inside `runBatchAI` — a failure there (e.g. a `CacheService` issue) must never break the already-completed work of writing AI results to the sheet.
- Grounding query counting is unconditional on `RunConfig.includeGrounding` (see Cost computation above).
- Uncaught exceptions elsewhere in `runBatchAI` (e.g. the file pipeline) already surface to the client via `google.script.run`'s default failure path, caught by `handleTest()` identically to `handleRun` — no new gap introduced.

## Testing

- `computeRunStats` (pure, fixture-driven): normal case; mixed success/error rows; Pro Preview tiering on both sides of the 200k threshold; a response with `thoughtsTokenCount` present, asserting it's billed at the output rate and folded into `totalOutputTokens`; a response with no `thoughtsTokenCount` (thinking disabled/absent); grounding query summing; all-rows-invalid → zero-value result.
- `buildConfigSnapshot` / `configsMatch` (pure): correct field selection; `tools: undefined` and `tools: []` normalize to equal.
- `api.ts`: extend existing tests to assert `usageMetadata` passthrough (present and absent cases).
- `writeRunStats`: mocked `CacheService`, matching the existing `writeJobProgress` test pattern.
- `configure-ai-run.test.ts`: row-range capping (explicit range vs. active-selection fallback, `min(10, available)`); stats rendering; success-flash toggle; both branches of the `SavedState`-restore `configsMatch` check; the null-result path.
- `job-store.test.ts`: generic `dispatch<T>` resolves with the wrapped value.

## Files changed

| File | Change |
|------|--------|
| `src/shared/types.ts` | Add `RunStatsConfigSnapshot` (`Pick<RunConfig, ...>`), `RunStats` |
| `src/shared/run-stats.ts` | New — `buildConfigSnapshot`, `configsMatch` |
| `src/server/types.ts` | Add `GeminiUsageMetadata`; add `usageMetadata?:` to `GeminiResponse` |
| `src/server/pricing.ts` | New — `PRICING_CATALOG`, `GROUNDING_PRICE_PER_1000_QUERIES` |
| `src/server/cost-tracking.ts` | New — `computeRunStats` |
| `src/server/api.ts` | Extract `usageMetadata` in `callGeminiAPI` and `callGeminiAPIBatch` |
| `src/server/utils.ts` | Add `writeRunStats` |
| `src/server/index.ts` | `runBatchAI` signature → `RunStats \| null`; timing wrap; stats write; early returns → `return null` |
| `rollup.config.js` | Fix `runBatchAI` footer stub to `return` its value |
| `src/client/google.d.ts` | `runBatchAI` return type → `RunStats \| null` |
| `src/client/services.ts` | `runBatchAI` wrapper return type → `Promise<RunStats \| null>` |
| `src/client/job-store.ts` | `dispatch` becomes generic `dispatch<T>` |
| `src/client/panels/configure-ai-run.ts` | `#test-btn` + `#test-results` UI; `handleTest()`; `SavedState.lastTestStats`; restore/staleness check |

## Out of scope (tracked separately)

- `getRunStats()` read RPC and wiring cached stats into `handleRun()`'s warning — AI-88 (R44)
- Estimated full-run cost display
- Live-editing invalidation of displayed test results without navigation
