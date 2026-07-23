# Test Button & Cost Estimate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Test" button to the Run AI Inference panel that runs the user's exact configuration against the first 10 rows of their target range, measures real cost/time/tokens from the Gemini response, and displays them.

**Architecture:** No server-side "test mode" — `runBatchAI` measures and caches stats on every invocation (full run, one chunk, or a Test click); Test is a client-side concept that caps the row range to 10 and calls the same RPC. New pure modules (`cost-tracking.ts`, `pricing.ts`, `run-stats.ts`) carry all the new logic; `runBatchAI` itself only grows by a few lines of wiring.

**Tech Stack:** TypeScript, Jest (ts-jest), Google Apps Script (CacheService, UrlFetchApp), Rollup.

## Global Constraints

- Full spec: `docs/superpowers/specs/2026-07-16-test-button-cost-estimate-design.md` — read it if any task here seems to contradict it; the spec is the source of truth for *why*, this plan is the source of truth for *exact code*.
- `RunStatsConfigSnapshot` covers exactly these `RunConfig` fields: `promptCols`, `systemPromptCol`, `tools`, `prefixWithColName`, `model`. Never add `outputCol`, `includeGrounding`, or `applyMarkdown` to it — they don't affect cost.
- Pricing uses **Standard** tier (not Batch API tier) — this app calls `generateContent` synchronously via `UrlFetchApp.fetchAll`.
- `toolUsePromptTokenCount` and `cachedContentTokenCount` are subsets of `promptTokenCount`, never additive — do not add them to input token totals.
- `thoughtsTokenCount` is additive and bills at the **output** rate — always fold it into output tokens, never drop it.
- Every new pure module (`cost-tracking.ts`, `pricing.ts`, `run-stats.ts`) must have zero GAS/DOM globals so it's testable without mocking.
- `src/server/index.ts` is excluded from coverage thresholds (`jest.config.cjs`) — do not add a dedicated test file for `runBatchAI` itself; its new lines are thin wiring covered indirectly by other tasks' tests.
- Run `npx jest --silent` after every task and confirm all suites pass before committing.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/shared/types.ts` | Modify | Add `RunStatsConfigSnapshot`, `RunStats` |
| `src/shared/run-stats.ts` | Create | `buildConfigSnapshot`, `configsMatch` — pure, used by both client and server |
| `src/server/types.ts` | Modify | Add `GeminiUsageMetadata`; add `usageMetadata?` to `GeminiResponse`; fix `AppConfig.DEFAULT_MODEL` type |
| `src/server/api.ts` | Modify | Extract `usageMetadata` from the REST response in `callGeminiAPI`/`callGeminiAPIBatch` |
| `src/server/pricing.ts` | Create | `PRICING_CATALOG`, `GROUNDING_PRICE_PER_1000_QUERIES`, `resolvePricing` |
| `src/server/cost-tracking.ts` | Create | `computeRunStats` — pure aggregation from `GeminiResponse[]` |
| `src/server/utils.ts` | Modify | Add `writeRunStats` |
| `src/server/index.ts` | Modify | `runBatchAI` signature → `RunStats \| null`; timing + stats write |
| `src/server/config.ts` | No change | `CONFIG.DEFAULT_MODEL`'s value is already a valid `ModelId` literal |
| `rollup.config.js` | Modify | Fix `runBatchAI` footer stub to `return` its value |
| `src/client/google.d.ts` | Modify | `runBatchAI` return type → `RunStats \| null` |
| `src/client/services.ts` | Modify | `runBatchAI` wrapper return type → `Promise<RunStats \| null>` |
| `src/client/job-store.ts` | Modify | `dispatch` becomes generic `dispatch<T>` |
| `src/client/panels/configure-ai-run.ts` | Modify | `#test-btn`/`#test-results` UI, `handleTest()`, `SavedState.lastTestStats`, restore/staleness check |
| `src/client/sidebar.css` | Modify | Stack `.panel-buttons` vertically; add `.btn-test--success`, `.test-results` |

---

### Task 1: Shared types and config-snapshot utilities

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/run-stats.ts`
- Test: `__tests__/run-stats.test.ts`

**Interfaces:**
- Produces: `RunStatsConfigSnapshot` (type), `RunStats` (interface), `buildConfigSnapshot(config: Partial<RunConfig>): RunStatsConfigSnapshot`, `configsMatch(a: RunStatsConfigSnapshot, b: RunStatsConfigSnapshot): boolean`

- [ ] **Step 1: Write the failing test**

Create `__tests__/run-stats.test.ts`:

```typescript
import { buildConfigSnapshot, configsMatch } from "../src/shared/run-stats";
import type { RunConfig } from "../src/shared/types";

describe("buildConfigSnapshot", () => {
  it("picks only the five cost-relevant fields", () => {
    const config: RunConfig = {
      promptCols: [{ col: "col_a", kind: "text" }],
      systemPromptCol: "sys",
      outputCol: "out",
      rowRange: { start: 2, end: 11 },
      tools: ["google_search"],
      includeGrounding: true,
      applyMarkdown: true,
      prefixWithColName: true,
      model: "gemini-3.1-pro-preview",
    };
    expect(buildConfigSnapshot(config)).toEqual({
      promptCols: [{ col: "col_a", kind: "text" }],
      systemPromptCol: "sys",
      tools: ["google_search"],
      prefixWithColName: true,
      model: "gemini-3.1-pro-preview",
    });
  });

  it("normalizes an absent tools array to []", () => {
    const config: Partial<RunConfig> = { promptCols: [], outputCol: "out" };
    expect(buildConfigSnapshot(config).tools).toEqual([]);
  });

  it("normalizes an absent prefixWithColName to false", () => {
    const config: Partial<RunConfig> = { promptCols: [], outputCol: "out" };
    expect(buildConfigSnapshot(config).prefixWithColName).toBe(false);
  });

  it("defaults promptCols to [] when absent (Partial<RunConfig> input)", () => {
    expect(buildConfigSnapshot({}).promptCols).toEqual([]);
  });
});

describe("configsMatch", () => {
  it("returns true for two snapshots built the same way", () => {
    const config: RunConfig = { promptCols: [{ col: "a", kind: "text" }], outputCol: "out" };
    expect(configsMatch(buildConfigSnapshot(config), buildConfigSnapshot(config))).toBe(true);
  });

  it("treats tools: undefined and tools: [] as equal", () => {
    const a = buildConfigSnapshot({ promptCols: [], outputCol: "out", tools: undefined });
    const b = buildConfigSnapshot({ promptCols: [], outputCol: "out", tools: [] });
    expect(configsMatch(a, b)).toBe(true);
  });

  it("returns false when promptCols differ", () => {
    const a = buildConfigSnapshot({ promptCols: [{ col: "a", kind: "text" }], outputCol: "out" });
    const b = buildConfigSnapshot({ promptCols: [{ col: "b", kind: "text" }], outputCol: "out" });
    expect(configsMatch(a, b)).toBe(false);
  });

  it("returns false when model differs", () => {
    const a = buildConfigSnapshot({ promptCols: [], outputCol: "out", model: "gemini-3.1-flash-lite" });
    const b = buildConfigSnapshot({
      promptCols: [],
      outputCol: "out",
      model: "gemini-3.1-pro-preview",
    });
    expect(configsMatch(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest run-stats.test.ts`
Expected: FAIL with `Cannot find module '../src/shared/run-stats'`

- [ ] **Step 3: Add the types to `src/shared/types.ts`**

Add at the end of the file (after `ExtractTextConfig`):

```typescript
// ── Run stats (cost/time tracking) ───────────────────────────────

/**
 * The subset of RunConfig that affects cost — used to detect whether a
 * cached RunStats is still relevant to the currently configured run.
 * Deliberately excludes outputCol, includeGrounding, and applyMarkdown,
 * which affect where/how output is written, not what it costs to generate.
 */
export type RunStatsConfigSnapshot = Pick<
  RunConfig,
  "promptCols" | "systemPromptCol" | "tools" | "prefixWithColName" | "model"
>;

/**
 * Measured cost/time/token stats from a single runBatchAI invocation
 * (a full run, one chunk of a full run, or a capped Test click).
 * Stores totals, not averages — per-row figures are a trivial division
 * wherever displayed.
 */
export interface RunStats {
  /** Rows successfully measured (had usageMetadata in the response). */
  rowCount: number;
  /** Wall-clock time for the whole invocation. */
  totalTimeMs: number;
  /** Sum of promptTokenCount (already includes tool-use/cached-content overhead). */
  totalInputTokens: number;
  /** Sum of (candidatesTokenCount + thoughtsTokenCount) — both billed at the output rate. */
  totalOutputTokens: number;
  /** USD, token pricing only. */
  totalTokenCost: number;
  /** Sum of groundingMetadata.webSearchQueries.length across measured rows. */
  totalGroundingQueries: number;
  /** USD, at the Standard grounding rate. Ignores the shared monthly free quota. */
  totalGroundingCost: number;
  /** Timestamp (ms) when this invocation started. */
  testedAt: number;
  config: RunStatsConfigSnapshot;
}
```

- [ ] **Step 4: Create `src/shared/run-stats.ts`**

```typescript
/**
 * run-stats.ts — Config-snapshot utilities shared by client and server.
 *
 * Both sides need to agree on exactly which RunConfig fields affect cost;
 * living here (not shared/types.ts, which is types-only) keeps that single
 * definition from drifting between the server's stats-write path and the
 * client's staleness check.
 */

import type { RunConfig, RunStatsConfigSnapshot } from "./types";

export function buildConfigSnapshot(config: Partial<RunConfig>): RunStatsConfigSnapshot {
  return {
    promptCols: config.promptCols ?? [],
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

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest run-stats.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/run-stats.ts __tests__/run-stats.test.ts
git commit -m "feat(AI-87): add RunStats types and config-snapshot utilities"
```

---

### Task 2: Capture `usageMetadata` from the Gemini API response

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/api.ts`
- Test: `__tests__/api.test.ts`

**Interfaces:**
- Produces: `GeminiUsageMetadata` (type), `GeminiResponse.usageMetadata?: GeminiUsageMetadata`

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/api.test.ts`, inside the existing `describe("callGeminiAPI", ...)` block (after the `"returns undefined groundingMetadata and codePairs when not present"` test):

```typescript
  it("populates usageMetadata when present in the response", () => {
    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.usageMetadata).toEqual({
      promptTokenCount: 10,
      candidatesTokenCount: 5,
      totalTokenCount: 15,
    });
  });

  it("passes through thoughtsTokenCount when present", () => {
    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "ok" }] } }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 20,
        totalTokenCount: 35,
      },
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.usageMetadata?.thoughtsTokenCount).toBe(20);
  });

  it("leaves usageMetadata undefined when not present in the response", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    expect(callGeminiAPI(baseReq).usageMetadata).toBeUndefined();
  });
```

Add to the `describe("callGeminiAPIBatch", ...)` block (after the `"returns one GeminiResponse per request"` test):

```typescript
  it("populates usageMetadata per response", () => {
    mockFetchAllResponses([
      {
        candidates: [{ content: { parts: [{ text: "A" }] } }],
        usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 },
      },
      { candidates: [{ content: { parts: [{ text: "B" }] } }] },
    ]);
    const reqs: GeminiRequest[] = [
      { apiKey: "key", userParts: [{ text: "Q1" }] },
      { apiKey: "key", userParts: [{ text: "Q2" }] },
    ];
    const results = callGeminiAPIBatch(reqs);
    expect(results[0].usageMetadata).toEqual({
      promptTokenCount: 8,
      candidatesTokenCount: 4,
      totalTokenCount: 12,
    });
    expect(results[1].usageMetadata).toBeUndefined();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest api.test.ts`
Expected: FAIL — `usageMetadata` is `undefined` in all cases (property doesn't exist yet on the returned object, or TypeScript error if referenced before the type exists)

- [ ] **Step 3: Add `GeminiUsageMetadata` to `src/server/types.ts`**

Add after the `GeminiCodePair` interface (around line 101), and add `ModelId` to the existing `shared/types` import at the top of the file:

```typescript
// Change this line:
import type { PromptColumnSpec, ToolId } from "../shared/types";
// to:
import type { ModelId, PromptColumnSpec, ToolId } from "../shared/types";
```

```typescript
/**
 * Token usage for a single generateContent response.
 * Field relationships (per the Gemini API reference): promptTokenCount is the
 * complete effective prompt size — cachedContentTokenCount and
 * toolUsePromptTokenCount are subsets of it, not additional, so neither is
 * captured here. thoughtsTokenCount IS additional and bills at the output
 * rate — it is not an edge case for this app, since thinking is on by
 * default for both models in PRICING_CATALOG.
 */
export interface GeminiUsageMetadata {
  promptTokenCount: number;
  candidatesTokenCount: number;
  thoughtsTokenCount?: number;
  totalTokenCount: number;
}
```

Add `usageMetadata?: GeminiUsageMetadata;` to the `GeminiResponse` interface, right after the `text: string;` field:

```typescript
export interface GeminiResponse {
  /** Assembled from all text parts in candidates[0].content.parts. */
  text: string;
  /** Token usage for this response. Present on essentially every successful call. */
  usageMetadata?: GeminiUsageMetadata;
  /** Present when google_search grounding was active. */
  groundingMetadata?: GeminiGroundingMetadata;
  /** Present when code_execution was active and code blocks were returned. */
  codePairs?: GeminiCodePair[];
}
```

Also fix `AppConfig.DEFAULT_MODEL`'s type — it's always a `ModelId` literal in practice, and Task 5 needs this precision to pass it into `computeRunStats` without a cast:

```typescript
// Change this line in the AppConfig interface:
DEFAULT_MODEL: string;
// to:
DEFAULT_MODEL: ModelId;
```

- [ ] **Step 4: Extract `usageMetadata` in `callGeminiAPI` (`src/server/api.ts`)**

In `callGeminiAPI`, right after the existing `const groundingMetadata = ...` block, add:

```typescript
  const usageMetadata = json.usageMetadata as GeminiUsageMetadata | undefined;
```

Change the function's `return` statement from:

```typescript
  return {
    text,
    ...(groundingMetadata !== undefined && { groundingMetadata }),
    ...(codePairs.length > 0 && { codePairs }),
  };
```

to:

```typescript
  return {
    text,
    usageMetadata,
    ...(groundingMetadata !== undefined && { groundingMetadata }),
    ...(codePairs.length > 0 && { codePairs }),
  };
```

Add `GeminiUsageMetadata` to the existing type import at the top of `api.ts`:

```typescript
// Change:
import type { GeminiRequest, GeminiResponse, GeminiCodePair } from "./types";
// to:
import type { GeminiRequest, GeminiResponse, GeminiCodePair, GeminiUsageMetadata } from "./types";
```

- [ ] **Step 5: Extract `usageMetadata` in `callGeminiAPIBatch` (`src/server/api.ts`)**

Inside the `responses.map((response) => { ... })` callback, right after the existing `const groundingMetadata = ...` block, add the same line:

```typescript
    const usageMetadata = json.usageMetadata as GeminiUsageMetadata | undefined;
```

Change that callback's `return` statement from:

```typescript
    return {
      text,
      ...(groundingMetadata !== undefined && { groundingMetadata }),
      ...(codePairs.length > 0 && { codePairs }),
    };
```

to:

```typescript
    return {
      text,
      usageMetadata,
      ...(groundingMetadata !== undefined && { groundingMetadata }),
      ...(codePairs.length > 0 && { codePairs }),
    };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest api.test.ts`
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 7: Commit**

```bash
git add src/server/types.ts src/server/api.ts __tests__/api.test.ts
git commit -m "feat(AI-87): capture usageMetadata from Gemini API responses"
```

---

### Task 3: Pricing catalog and cost aggregation

**Files:**
- Create: `src/server/pricing.ts`
- Create: `src/server/cost-tracking.ts`
- Test: `__tests__/pricing.test.ts`
- Test: `__tests__/cost-tracking.test.ts`

**Interfaces:**
- Consumes: `GeminiResponse` (`src/server/types.ts`, Task 2), `RunStats` (`src/shared/types.ts`, Task 1)
- Produces: `PRICING_CATALOG`, `GROUNDING_PRICE_PER_1000_QUERIES`, `resolvePricing(model: ModelId, promptTokenCount: number): { inputPerMillion: number; outputPerMillion: number }`, `computeRunStats(results: GeminiResponse[], elapsedMs: number, model: ModelId): Omit<RunStats, "testedAt" | "config">`

- [ ] **Step 1: Write the failing pricing test**

Create `__tests__/pricing.test.ts`:

```typescript
import { resolvePricing, PRICING_CATALOG, GROUNDING_PRICE_PER_1000_QUERIES } from "../src/server/pricing";

describe("PRICING_CATALOG", () => {
  it("has an entry for every model", () => {
    expect(PRICING_CATALOG["gemini-3.1-flash-lite"]).toBeDefined();
    expect(PRICING_CATALOG["gemini-3.1-pro-preview"]).toBeDefined();
  });
});

describe("GROUNDING_PRICE_PER_1000_QUERIES", () => {
  it("is 14.00", () => {
    expect(GROUNDING_PRICE_PER_1000_QUERIES).toBe(14.0);
  });
});

describe("resolvePricing", () => {
  it("returns flat pricing for gemini-3.1-flash-lite regardless of prompt size", () => {
    expect(resolvePricing("gemini-3.1-flash-lite", 5)).toEqual({
      inputPerMillion: 0.25,
      outputPerMillion: 1.5,
    });
    expect(resolvePricing("gemini-3.1-flash-lite", 500_000)).toEqual({
      inputPerMillion: 0.25,
      outputPerMillion: 1.5,
    });
  });

  it("returns standard-tier pricing for gemini-3.1-pro-preview at or below 200k prompt tokens", () => {
    expect(resolvePricing("gemini-3.1-pro-preview", 200_000)).toEqual({
      inputPerMillion: 2.0,
      outputPerMillion: 12.0,
    });
  });

  it("returns the over-200k tier for gemini-3.1-pro-preview above 200k prompt tokens", () => {
    expect(resolvePricing("gemini-3.1-pro-preview", 200_001)).toEqual({
      inputPerMillion: 4.0,
      outputPerMillion: 18.0,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest pricing.test.ts`
Expected: FAIL with `Cannot find module '../src/server/pricing'`

- [ ] **Step 3: Create `src/server/pricing.ts`**

```typescript
/**
 * pricing.ts — Gemini API pricing catalog (Standard tier).
 *
 * Uses Standard synchronous pricing, not the discounted async Batch API tier —
 * this app calls generateContent synchronously via UrlFetchApp.fetchAll, which
 * bills at Standard rates regardless of this codebase's own "runBatchAI" naming.
 *
 * Source: https://ai.google.dev/gemini-api/docs/pricing (fetched 2026-07-16).
 */

import type { ModelId } from "../shared/types";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  inputPerMillionOver200k?: number;
  outputPerMillionOver200k?: number;
}

export const PRICING_CATALOG: Record<ModelId, ModelPricing> = {
  "gemini-3.1-flash-lite": { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  "gemini-3.1-pro-preview": {
    inputPerMillion: 2.0,
    outputPerMillion: 12.0,
    inputPerMillionOver200k: 4.0,
    outputPerMillionOver200k: 18.0,
  },
};

/**
 * Google Search grounding is billed per query, separate from token pricing.
 * Ignores the shared monthly free quota (5,000 queries/month, account-wide) —
 * that state is outside this app's visibility, so cost is always computed
 * "as if paid."
 */
export const GROUNDING_PRICE_PER_1000_QUERIES = 14.0;

const PRO_PREVIEW_TIER_THRESHOLD_TOKENS = 200_000;

/** Resolves the correct pricing tier for a single request based on its prompt size. */
export function resolvePricing(
  model: ModelId,
  promptTokenCount: number,
): { inputPerMillion: number; outputPerMillion: number } {
  const base = PRICING_CATALOG[model];
  if (
    promptTokenCount > PRO_PREVIEW_TIER_THRESHOLD_TOKENS &&
    base.inputPerMillionOver200k !== undefined
  ) {
    return {
      inputPerMillion: base.inputPerMillionOver200k,
      outputPerMillion: base.outputPerMillionOver200k ?? base.outputPerMillion,
    };
  }
  return { inputPerMillion: base.inputPerMillion, outputPerMillion: base.outputPerMillion };
}
```

- [ ] **Step 4: Run pricing test to verify it passes**

Run: `npx jest pricing.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing cost-tracking test**

Create `__tests__/cost-tracking.test.ts`:

```typescript
import { computeRunStats } from "../src/server/cost-tracking";
import type { GeminiResponse } from "../src/server/types";

function withUsage(
  promptTokenCount: number,
  candidatesTokenCount: number,
  thoughtsTokenCount?: number,
): GeminiResponse {
  return {
    text: "ok",
    usageMetadata: {
      promptTokenCount,
      candidatesTokenCount,
      thoughtsTokenCount,
      totalTokenCount: promptTokenCount + candidatesTokenCount + (thoughtsTokenCount ?? 0),
    },
  };
}

describe("computeRunStats", () => {
  it("computes rowCount, totalTimeMs, and token totals for a normal case", () => {
    const results = [withUsage(100, 50), withUsage(200, 75)];
    const stats = computeRunStats(results, 4200, "gemini-3.1-flash-lite");
    expect(stats.rowCount).toBe(2);
    expect(stats.totalTimeMs).toBe(4200);
    expect(stats.totalInputTokens).toBe(300);
    expect(stats.totalOutputTokens).toBe(125);
  });

  it("computes token cost using flash-lite standard pricing", () => {
    const results = [withUsage(1_000_000, 1_000_000)];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    // 1M input @ $0.25/M + 1M output @ $1.50/M = $1.75
    expect(stats.totalTokenCost).toBeCloseTo(1.75, 5);
  });

  it("folds thoughtsTokenCount into totalOutputTokens and bills it at the output rate", () => {
    const results = [withUsage(1_000_000, 0, 1_000_000)];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.totalOutputTokens).toBe(1_000_000);
    // 1M input @ $0.25/M + 1M thinking-as-output @ $1.50/M = $1.75
    expect(stats.totalTokenCost).toBeCloseTo(1.75, 5);
  });

  it("does not double-count input when toolUsePromptTokenCount would have been added", () => {
    // promptTokenCount already reflects the complete effective prompt —
    // there is no toolUsePromptTokenCount field on GeminiUsageMetadata to add.
    const results = [withUsage(100_000, 10_000)];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.totalInputTokens).toBe(100_000);
  });

  it("applies the over-200k pricing tier per-request for Pro Preview", () => {
    const results = [withUsage(250_000, 10_000)];
    const stats = computeRunStats(results, 1000, "gemini-3.1-pro-preview");
    // 250k input @ $4.00/M + 10k output @ $18.00/M
    const expected = (250_000 / 1_000_000) * 4.0 + (10_000 / 1_000_000) * 18.0;
    expect(stats.totalTokenCost).toBeCloseTo(expected, 5);
  });

  it("skips results with no usageMetadata (errors) when counting rows and tokens", () => {
    const results: GeminiResponse[] = [withUsage(100, 50), { text: "Error: boom" }];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.rowCount).toBe(1);
    expect(stats.totalInputTokens).toBe(100);
  });

  it("returns a zero-value result when no results have usageMetadata", () => {
    const results: GeminiResponse[] = [{ text: "Error: boom" }, { text: "Error: also boom" }];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.rowCount).toBe(0);
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.totalTokenCost).toBe(0);
  });

  it("sums grounding queries across measured results unconditionally", () => {
    const results: GeminiResponse[] = [
      { ...withUsage(100, 50), groundingMetadata: { webSearchQueries: ["q1", "q2"] } },
      { ...withUsage(100, 50), groundingMetadata: { webSearchQueries: ["q3"] } },
      withUsage(100, 50), // no grounding at all
    ];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.totalGroundingQueries).toBe(3);
    // 3 queries / 1000 * $14.00
    expect(stats.totalGroundingCost).toBeCloseTo(0.042, 5);
  });

  it("has zero grounding cost when no result has groundingMetadata", () => {
    const results = [withUsage(100, 50)];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.totalGroundingQueries).toBe(0);
    expect(stats.totalGroundingCost).toBe(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx jest cost-tracking.test.ts`
Expected: FAIL with `Cannot find module '../src/server/cost-tracking'`

- [ ] **Step 7: Create `src/server/cost-tracking.ts`**

```typescript
/**
 * cost-tracking.ts — Pure cost/usage aggregation from Gemini API responses.
 *
 * No GAS globals. computeRunStats is the sole entry point, called by
 * runBatchAI after every invocation (full run, one chunk, or a Test click)
 * to measure what that invocation actually cost.
 */

import { resolvePricing, GROUNDING_PRICE_PER_1000_QUERIES } from "./pricing";
import type { GeminiResponse } from "./types";
import type { ModelId, RunStats } from "../shared/types";

export function computeRunStats(
  results: GeminiResponse[],
  elapsedMs: number,
  model: ModelId,
): Omit<RunStats, "testedAt" | "config"> {
  const measured = results.filter((r) => r.usageMetadata !== undefined);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokenCost = 0;

  for (const result of measured) {
    const usage = result.usageMetadata!;
    const outputTokens = usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0);
    const pricing = resolvePricing(model, usage.promptTokenCount);

    totalInputTokens += usage.promptTokenCount;
    totalOutputTokens += outputTokens;
    totalTokenCost +=
      (usage.promptTokenCount / 1_000_000) * pricing.inputPerMillion +
      (outputTokens / 1_000_000) * pricing.outputPerMillion;
  }

  const totalGroundingQueries = measured.reduce(
    (sum, r) => sum + (r.groundingMetadata?.webSearchQueries?.length ?? 0),
    0,
  );
  const totalGroundingCost = (totalGroundingQueries / 1000) * GROUNDING_PRICE_PER_1000_QUERIES;

  return {
    rowCount: measured.length,
    totalTimeMs: elapsedMs,
    totalInputTokens,
    totalOutputTokens,
    totalTokenCost,
    totalGroundingQueries,
    totalGroundingCost,
  };
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest cost-tracking.test.ts pricing.test.ts`
Expected: PASS (all tests)

- [ ] **Step 9: Commit**

```bash
git add src/server/pricing.ts src/server/cost-tracking.ts __tests__/pricing.test.ts __tests__/cost-tracking.test.ts
git commit -m "feat(AI-87): add pricing catalog and computeRunStats"
```

---

### Task 4: `writeRunStats` cache helper

**Files:**
- Modify: `src/server/utils.ts`
- Test: `__tests__/utils.test.ts`

**Interfaces:**
- Consumes: `RunStats` (`src/shared/types.ts`, Task 1)
- Produces: `writeRunStats(cache: GoogleAppsScript.Cache.Cache, spreadsheetId: string, stats: RunStats): void`

- [ ] **Step 1: Write the failing test**

Add to `__tests__/utils.test.ts`, after the existing `describe("writeJobProgress", ...)` block:

```typescript
describe("writeRunStats", () => {
  it("writes serialized stats to cache keyed by spreadsheet ID with a 6-hour TTL", () => {
    const mockPut = jest.fn();
    const mockCache = { put: mockPut } as unknown as GoogleAppsScript.Cache.Cache;
    const stats: RunStats = {
      rowCount: 10,
      totalTimeMs: 4200,
      totalInputTokens: 500,
      totalOutputTokens: 300,
      totalTokenCost: 0.002,
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

    writeRunStats(mockCache, "sheet-abc", stats);

    expect(mockPut).toHaveBeenCalledWith("runStats:sheet-abc", JSON.stringify(stats), 21600);
  });
});
```

Add `RunStats` to the test file's imports and `writeRunStats` to the import from `../src/server/utils`:

```typescript
import type { RunStats } from "../src/shared/types";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest utils.test.ts -t writeRunStats`
Expected: FAIL — `writeRunStats` is not exported

- [ ] **Step 3: Add `writeRunStats` to `src/server/utils.ts`**

Add `RunStats` to the existing type import at the top of the file:

```typescript
// Change:
import type { DriveFileInfo, GeminiResponse } from "./types";
// to:
import type { DriveFileInfo, GeminiResponse } from "./types";
import type { RunStats } from "../shared/types";
```

Add after `writeJobProgress`:

```typescript
/**
 * Writes run stats to CacheService, keyed per spreadsheet (the UserCache is
 * already scoped to the current user; the spreadsheet ID additionally
 * prevents collisions if the same user has this add-on open in multiple
 * sheets). TTL is 21600s (6 hours — CacheService's max), long enough to
 * survive a reasonable gap between a test run and a later full run in the
 * same working session.
 */
export function writeRunStats(
  cache: GoogleAppsScript.Cache.Cache,
  spreadsheetId: string,
  stats: RunStats,
): void {
  cache.put(`runStats:${spreadsheetId}`, JSON.stringify(stats), 21600);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest utils.test.ts`
Expected: PASS (all tests, including the new one)

- [ ] **Step 5: Commit**

```bash
git add src/server/utils.ts __tests__/utils.test.ts
git commit -m "feat(AI-87): add writeRunStats cache helper"
```

---

### Task 5: Wire stats into `runBatchAI` and the RPC boundary

**Files:**
- Modify: `src/server/index.ts:307-576` (the `runBatchAI` function)
- Modify: `rollup.config.js:84`
- Modify: `src/client/google.d.ts`
- Modify: `src/client/services.ts`
- Test: `__tests__/services.test.ts`

**Interfaces:**
- Consumes: `computeRunStats` (Task 3), `writeRunStats` (Task 4), `buildConfigSnapshot` (Task 1), `RunStats` (Task 1)
- Produces: `runBatchAI(config: RunConfig, jobId?: string): RunStats | null` (was `void`)

- [ ] **Step 1: Write the failing services test**

Add to `__tests__/services.test.ts`, inside the existing `describe("runBatchAI", ...)` block:

```typescript
  it("resolves with the RunStats returned by the RPC call", async () => {
    const handlers = captureHandlers();
    const config = { promptCols: [{ col: "col_a", kind: "text" }], outputCol: "out" };
    const stats = {
      rowCount: 10,
      totalTimeMs: 4200,
      totalInputTokens: 500,
      totalOutputTokens: 300,
      totalTokenCost: 0.002,
      totalGroundingQueries: 0,
      totalGroundingCost: 0,
      testedAt: 1234567890,
      config: {
        promptCols: [{ col: "col_a", kind: "text" }],
        tools: [],
        prefixWithColName: false,
      },
    };
    const promise = services.runBatchAI(config as import("../src/shared/types").RunConfig);
    handlers.resolve(stats);
    await expect(promise).resolves.toEqual(stats);
  });

  it("resolves with null when the RPC call returns null", async () => {
    const handlers = captureHandlers();
    const config = { promptCols: [{ col: "col_a", kind: "text" }], outputCol: "out" };
    const promise = services.runBatchAI(config as import("../src/shared/types").RunConfig);
    handlers.resolve(null);
    await expect(promise).resolves.toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest services.test.ts -t "resolves with the RunStats"`
Expected: FAIL — TypeScript error, `Promise<void>` has no overlap with the expected `RunStats` shape (or the test passes vacuously against the old `void` return depending on ts-jest's leniency — either way, this locks in the new contract before Step 3 changes the implementation)

- [ ] **Step 3: Fix `AppConfig.DEFAULT_MODEL`'s type (already done in Task 2, Step 3 — verify it)**

Confirm `src/server/types.ts`'s `AppConfig.DEFAULT_MODEL` is typed `ModelId`, not `string`. If Task 2 wasn't run first, do it now.

- [ ] **Step 4: Update `runBatchAI` in `src/server/index.ts`**

Add three new imports. Change:

```typescript
import { callGeminiAPIBatch } from "./api";
```

to:

```typescript
import { callGeminiAPIBatch } from "./api";
import { computeRunStats } from "./cost-tracking";
import { buildConfigSnapshot } from "../shared/run-stats";
```

Add `writeRunStats` to the existing `./utils` import list:

```typescript
import {
  extractId,
  isValidDriveLink,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  resolveColumns,
  writeJobProgress,
  writeRunStats,
  interpolateTemplate,
  flattenArg,
  markAIOutputRange,
  resolveGroundingUris,
} from "./utils";
```

Add `RunStats` to the existing `../shared/types` type import list:

```typescript
import type {
  RunConfig,
  RunStats,
  PrepRecipeParams,
  PrepRecipeResult,
  ImportDriveLinksConfig,
  ExtractTextConfig,
} from "../shared/types";
```

Now change the function itself. The signature line:

```typescript
// Change:
export function runBatchAI(config: RunConfig, jobId?: string): void {
// to:
export function runBatchAI(config: RunConfig, jobId?: string): RunStats | null {
```

Add `const startTime = Date.now();` as the very first line inside the function body, before `const ss = SpreadsheetApp.getActiveSpreadsheet();`.

Change every bare `return;` inside the function to `return null;`. There are 6 of them — locate each by its surrounding context:

1. After `ui.alert("Error", "The active sheet has no column headers.", ...)`
2. After the "Error: Missing Columns" alert for missing prompt columns
3. After the "Error: Missing Columns" alert for missing system prompt column
4. `if (!range) return;` (inside the row-range `else` branch)
5. After `ui.alert("Error", \`${CONFIG.API_KEY_PROPERTY} script property not set\`, ...)`
6. After `SpreadsheetApp.getActive().toast("No rows to process.", "Info", 5); SpreadsheetApp.flush();`

Each becomes `return null;` instead of `return;` — no other change to those blocks.

Finally, replace the function's closing section. Change:

```typescript
  SpreadsheetApp.flush();
  markAIOutputRange(sheet, outputIdx + 1, startRow, numRows);

  const successCount = results.filter((r) => !r.text.startsWith("Error:")).length;
  const errorCount = results.length - successCount + directWrites.size;
  SpreadsheetApp.getActive().toast(
    errorCount === 0
      ? `Complete! Processed ${results.length} rows.`
      : `Complete! Processed ${successCount} of ${results.length + directWrites.size} rows (${errorCount} errors).`,
    "Success",
    5,
  );
}
```

to:

```typescript
  SpreadsheetApp.flush();
  markAIOutputRange(sheet, outputIdx + 1, startRow, numRows);

  const successCount = results.filter((r) => !r.text.startsWith("Error:")).length;
  const errorCount = results.length - successCount + directWrites.size;
  SpreadsheetApp.getActive().toast(
    errorCount === 0
      ? `Complete! Processed ${results.length} rows.`
      : `Complete! Processed ${successCount} of ${results.length + directWrites.size} rows (${errorCount} errors).`,
    "Success",
    5,
  );

  let stats: RunStats | null = null;
  try {
    const computed: RunStats = {
      ...computeRunStats(results, Date.now() - startTime, config.model ?? CONFIG.DEFAULT_MODEL),
      testedAt: startTime,
      config: buildConfigSnapshot(config),
    };
    if (computed.rowCount > 0) {
      writeRunStats(cache, ss.getId(), computed);
      stats = computed;
    }
  } catch (_e) {
    // Stats/cost tracking is best-effort and must never fail the underlying
    // AI run, which has already fully completed by this point.
  }

  return stats;
}
```

- [ ] **Step 5: Fix the `rollup.config.js` footer stub**

Change:

```javascript
function runBatchAI(config, jobId) { _GASEntry.runBatchAI(config, jobId); }
```

to:

```javascript
function runBatchAI(config, jobId) { return _GASEntry.runBatchAI(config, jobId); }
```

(This was silently dropping the return value at the Apps Script boundary — necessary for the new `RunStats | null` to ever reach the client.)

- [ ] **Step 6: Update `src/client/google.d.ts`**

Change:

```typescript
    runBatchAI(config: RunConfig, jobId?: string): void;
```

to:

```typescript
    runBatchAI(config: RunConfig, jobId?: string): RunStats | null;
```

Add `RunStats` to the file's existing type import:

```typescript
import type {
  RunConfig,
  RunStats,
  PrepRecipeParams,
  PrepRecipeResult,
  ImportDriveLinksConfig,
  ExtractTextConfig,
} from "../shared/types";
```

- [ ] **Step 7: Update `src/client/services.ts`**

Change:

```typescript
export function runBatchAI(config: RunConfig, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .runBatchAI(config, jobId);
  });
}
```

to:

```typescript
export function runBatchAI(config: RunConfig, jobId?: string): Promise<RunStats | null> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) => resolve(result as RunStats | null))
      .withFailureHandler((err: Error) => reject(err))
      .runBatchAI(config, jobId);
  });
}
```

Add `RunStats` to the file's existing type import:

```typescript
import type {
  ExtractTextConfig,
  ImportDriveLinksConfig,
  PrepRecipeParams,
  PrepRecipeResult,
  RunConfig,
  RunStats,
} from "../shared/types";
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx jest services.test.ts`
Expected: PASS (all tests, including the 2 new ones)

Run: `npm run typecheck`
Expected: PASS — this is the step that actually validates the `google.d.ts`/`services.ts`/`index.ts` signature changes are all consistent with each other

- [ ] **Step 9: Commit**

```bash
git add src/server/index.ts src/server/types.ts rollup.config.js src/client/google.d.ts src/client/services.ts __tests__/services.test.ts
git commit -m "feat(AI-87): return RunStats from runBatchAI through the RPC boundary"
```

---

### Task 6: Make `jobStore.dispatch` generic

**Files:**
- Modify: `src/client/job-store.ts`
- Test: `__tests__/job-store.test.ts`

**Interfaces:**
- Produces: `dispatch<T>(id: string, label: string, fn: Promise<T>): Promise<T>` (was `dispatch(id: string, label: string, fn: Promise<void>): Promise<void>`)

- [ ] **Step 1: Write the failing test**

Add to `__tests__/job-store.test.ts`, after the existing `"marks job complete when promise resolves"` test:

```typescript
  it("resolves with the value the dispatched promise resolves to", async () => {
    const result = await store.dispatch("job-typed", "Test", Promise.resolve({ rows: 10 }));
    expect(result).toEqual({ rows: 10 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest job-store.test.ts -t "resolves with the value"`
Expected: FAIL — `result` is `undefined` (current `dispatch` discards the resolved value)

- [ ] **Step 3: Update `dispatch` in `src/client/job-store.ts`**

Change:

```typescript
  dispatch(id: string, label: string, fn: Promise<void>): Promise<void> {
```

to:

```typescript
  dispatch<T>(id: string, label: string, fn: Promise<T>): Promise<T> {
```

Change:

```typescript
    return fn.then(
      () => this.complete(id),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.fail(id, message);
        throw err;
      },
    );
```

to:

```typescript
    return fn.then(
      (result) => {
        this.complete(id);
        return result;
      },
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.fail(id, message);
        throw err;
      },
    );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest job-store.test.ts`
Expected: PASS (all tests, including the new one)

Run: `npm run typecheck`
Expected: PASS — confirms existing `Promise<void>` call sites (`handleRun`'s two dispatches, `importDriveLinks`, `extractText`) still typecheck with `T` inferred as `void`

- [ ] **Step 5: Commit**

```bash
git add src/client/job-store.ts __tests__/job-store.test.ts
git commit -m "feat(AI-87): make jobStore.dispatch generic so callers can get a typed result"
```

---

### Task 7: Test button UI and `handleTest()`

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Modify: `src/client/sidebar.css`
- Test: `__tests__/panels/configure-ai-run.test.ts`

**Interfaces:**
- Consumes: `runBatchAI` returning `Promise<RunStats | null>` (Task 5), `jobStore.dispatch<T>` (Task 6)
- Produces: `ConfigureAIRunPanel.handleTest` (private), `#test-btn`, `#test-results` in the rendered template

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/panels/configure-ai-run.test.ts`, after the closing `});` of the existing `describe("ConfigureAIRunPanel — model selector", ...)` block (i.e. at the end of the file). First add this shared fixture near the top of the file, right after `const DEFAULT_HEADERS = [...]`:

```typescript
const TEST_STATS: import("../../src/shared/types").RunStats = {
  rowCount: 10,
  totalTimeMs: 4200,
  totalInputTokens: 500,
  totalOutputTokens: 300,
  totalTokenCost: 0.002,
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
```

Then append this new describe block:

```typescript
describe("ConfigureAIRunPanel — Test AI", () => {
  it("alerts and does not call runBatchAI when no user prompt cols selected", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith("Please select at least one User prompt column.");
    expect(services.runBatchAI).not.toHaveBeenCalled();
  });

  it("alerts when no output column selected", async () => {
    const { container } = await mountAndLoad();
    addPromptCol(container, "col_a");
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith("Please select an output column.");
  });

  it("calls runBatchAI with a row range capped to 10 rows from an explicit rowRange", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 100 },
    });
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 11 } }),
      expect.stringMatching(/^test-ai-\d+$/),
    );
  });

  it("caps to the actual range size when the explicit rowRange has fewer than 10 rows", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 5 },
    });
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 5 } }),
      expect.any(String),
    );
  });

  it("falls back to the active selection, capped to 10 rows, when no explicit rowRange is set", async () => {
    (services.getActiveRangeInfo as jest.Mock).mockResolvedValue({ start: 3, end: 200 });
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 3, end: 12 } }),
      expect.any(String),
    );
  });

  it("shows a neutral message and never calls runBatchAI when there is no active selection", async () => {
    (services.getActiveRangeInfo as jest.Mock).mockResolvedValue(null);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(services.runBatchAI).not.toHaveBeenCalled();
    const results = container.querySelector<HTMLElement>("#test-results")!;
    expect(results.hidden).toBe(false);
    expect(results.textContent).toContain("didn't produce measurable results");
  });

  it("renders rows tested, time, avg cost, and total cost on success", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 11 },
    });
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const results = container.querySelector<HTMLElement>("#test-results")!;
    expect(results.hidden).toBe(false);
    expect(results.textContent).toContain("Tested 10 rows");
  });

  it("flashes a success state on the test button after a successful test", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 11 },
    });
    const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;
    testBtn.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(testBtn.classList.contains("btn-test--success")).toBe(true);
  });

  it("shows a neutral message when runBatchAI returns null (nothing measurable)", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(null);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 11 },
    });
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const results = container.querySelector<HTMLElement>("#test-results")!;
    expect(results.hidden).toBe(false);
    expect(results.textContent).toContain("didn't produce measurable results");
  });

  it("alerts on failure", async () => {
    (services.runBatchAI as jest.Mock).mockRejectedValue(new Error("API error"));
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 11 },
    });
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(globalThis.alert).toHaveBeenCalledWith("Error: API error");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest panels/configure-ai-run.test.ts -t "Test AI"`
Expected: FAIL — `#test-btn` doesn't exist in the template yet (`Cannot read properties of null`)

- [ ] **Step 3: Add the template markup**

In `src/client/panels/configure-ai-run.ts`, in the `template()` method, change:

```typescript
      <div class="panel-buttons">
        <button id="run-btn" class="btn-run">Run AI</button>
      </div>
```

to:

```typescript
      <div class="panel-buttons">
        <p class="field-helper">Execute your configuration across the first 10 rows in your selection. Evaluate for quality. Estimate cost.</p>
        <button id="test-btn" class="btn-outline">Test</button>
        <div id="test-results" class="test-results" hidden></div>
        <button id="run-btn" class="btn-run">Run AI</button>
      </div>
```

- [ ] **Step 4: Add `RunStats` import and the `lastTestStats` field placeholder isn't needed yet — wire the click handler and `handleTest()`**

Add `RunStats` to the file's existing `../../shared/types` import:

```typescript
// Change:
import type { RunConfig, ToolId, ModelId } from "../../shared/types";
// to:
import type { RunConfig, ToolId, ModelId, RunStats } from "../../shared/types";
```

In `loadHeaders()`, change:

```typescript
        if (!this.headersLoaded) {
          container.querySelector<HTMLElement>("#config-form")!.style.display = "block";
          container
            .querySelector<HTMLButtonElement>("#run-btn")!
            .addEventListener("click", () => this.handleRun(container));
          this.headersLoaded = true;
        }
```

to:

```typescript
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
```

Add the new private methods right after `handleRun` and its helpers (after the closing brace of `runChunks`, before `assembleRunConfig`):

```typescript
  private handleTest(container: HTMLElement): void {
    const config = this.assembleRunConfig();
    if (!config) return;

    const jobId = `test-ai-${Date.now()}`;
    const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;

    const resolveRange: Promise<{ start: number; end: number } | null> = config.rowRange
      ? Promise.resolve(config.rowRange)
      : getActiveRangeInfo();

    jobStore
      .dispatch(
        jobId,
        "Test AI Run",
        resolveRange.then((range) => {
          if (!range) return null;
          const cappedEnd = Math.min(range.start + 9, range.end);
          return runBatchAI(
            { ...config, rowRange: { start: range.start, end: cappedEnd } },
            jobId,
          );
        }),
      )
      .then((stats) => {
        if (stats) {
          this.renderTestStats(container, stats);
          this.flashTestSuccess(testBtn);
        } else {
          this.renderTestMessage(
            container,
            "Test didn't produce measurable results — check the sheet for errors in the tested rows.",
          );
        }
      })
      .catch((err: Error) => {
        globalThis.alert("Error: " + err.message);
      });
  }

  private renderTestStats(container: HTMLElement, stats: RunStats): void {
    const el = container.querySelector<HTMLElement>("#test-results")!;
    const totalCost = stats.totalTokenCost + stats.totalGroundingCost;
    const avgCost = totalCost / stats.rowCount;
    el.innerHTML = `
      <p>Tested ${stats.rowCount} row${stats.rowCount === 1 ? "" : "s"} in ${(stats.totalTimeMs / 1000).toFixed(1)}s.</p>
      <p>Avg cost per row: $${avgCost.toFixed(4)} — total cost of this test: $${totalCost.toFixed(4)}</p>
    `;
    el.hidden = false;
  }

  private renderTestMessage(container: HTMLElement, message: string): void {
    const el = container.querySelector<HTMLElement>("#test-results")!;
    el.innerHTML = `<p>${message}</p>`;
    el.hidden = false;
  }

  private flashTestSuccess(btn: HTMLButtonElement): void {
    const original = btn.textContent;
    btn.classList.add("btn-test--success");
    btn.textContent = "Tested ✓";
    setTimeout(() => {
      btn.classList.remove("btn-test--success");
      btn.textContent = original;
    }, 3000);
  }
```

- [ ] **Step 5: Add the CSS for the new elements**

In `src/client/sidebar.css`, change:

```css
.panel-buttons { display: flex; gap: 8px; margin-top: 24px; }
```

to:

```css
.panel-buttons { display: flex; flex-direction: column; gap: 8px; margin-top: 24px; }
```

(Safe for the other two panels using this class — `extract-text.ts` and `import-drive-links.ts` each render exactly one button, so a single flex child's layout is unaffected by direction; `align-items: stretch` still keeps it full-width.)

Add after the existing `.btn-run:disabled { ... }` rule:

```css
.btn-test--success {
    background: #34a853;
    color: white;
    border-color: #34a853;
}

.test-results {
    margin-top: 4px;
    padding: 8px 12px;
    background: #f8f9fa;
    border-radius: 4px;
    font-size: var(--font-size-200);
    color: var(--text-secondary);
}

.test-results p { margin: 0 0 4px 0; }
.test-results p:last-child { margin-bottom: 0; }
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest panels/configure-ai-run.test.ts`
Expected: PASS (all tests, including the 10 new ones)

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/client/panels/configure-ai-run.ts src/client/sidebar.css __tests__/panels/configure-ai-run.test.ts
git commit -m "feat(AI-87): add Test button with capped row range and results display"
```

---

### Task 8: Persist and validate `lastTestStats` across navigation

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Test: `__tests__/panels/configure-ai-run.test.ts`

**Interfaces:**
- Consumes: `buildConfigSnapshot`, `configsMatch` (`src/shared/run-stats.ts`, Task 1); `renderTestStats`, `renderTestMessage` (Task 7)
- Produces: `SavedState.lastTestStats: RunStats | null`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/panels/configure-ai-run.test.ts`, as a new describe block after `"ConfigureAIRunPanel — Test AI"`:

```typescript
describe("ConfigureAIRunPanel — lastTestStats persistence", () => {
  it("unmount saves lastTestStats after a successful test", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container, panel } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
      rowRange: { start: 2, end: 11 },
    });
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const state = panel.unmount();
    expect(state?.lastTestStats).toEqual(TEST_STATS);
  });

  it("unmount saves lastTestStats: null when no test has run yet", async () => {
    const { container, panel } = await mountAndLoad();
    addPromptCol(container, "col_a");
    const state = panel.unmount();
    expect(state?.lastTestStats).toBeNull();
  });

  it("restores and renders lastTestStats from savedState when the config still matches", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_a", kind: "text" as const }],
      systemPromptCol: "",
      outputCol: "ai_inference",
      lastTestStats: TEST_STATS,
    });
    const results = container.querySelector<HTMLElement>("#test-results")!;
    expect(results.hidden).toBe(false);
    expect(results.textContent).toContain("Tested 10 rows");
  });

  it("shows a stale notice instead of numbers when the restored config no longer matches", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_b", kind: "text" as const }], // differs from TEST_STATS.config
      systemPromptCol: "",
      outputCol: "ai_inference",
      lastTestStats: TEST_STATS,
    });
    const results = container.querySelector<HTMLElement>("#test-results")!;
    expect(results.hidden).toBe(false);
    expect(results.textContent).toContain("Configuration changed since last test");
  });

  it("does not flash the success state when restoring from savedState", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_a", kind: "text" as const }],
      systemPromptCol: "",
      outputCol: "ai_inference",
      lastTestStats: TEST_STATS,
    });
    const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;
    expect(testBtn.classList.contains("btn-test--success")).toBe(false);
  });

  it("renders nothing when there is no lastTestStats in savedState", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_a", kind: "text" as const }],
      systemPromptCol: "",
      outputCol: "ai_inference",
    });
    const results = container.querySelector<HTMLElement>("#test-results")!;
    expect(results.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest panels/configure-ai-run.test.ts -t "lastTestStats persistence"`
Expected: FAIL — `state?.lastTestStats` is `undefined` (field doesn't exist on `SavedState` yet), and the restore tests find `#test-results` still `hidden`

- [ ] **Step 3: Add `lastTestStats` to `SavedState` and the private field**

Change the `SavedState` type definition:

```typescript
export type SavedState = Required<
  Omit<
    RunConfig,
    "rowRange" | "tools" | "includeGrounding" | "applyMarkdown" | "prefixWithColName" | "model"
  >
> &
  Pick<
    RunConfig,
    "rowRange" | "tools" | "includeGrounding" | "applyMarkdown" | "prefixWithColName" | "model"
  > & {
    toolsExpanded?: boolean;
    modelExpanded?: boolean;
  };
```

to:

```typescript
export type SavedState = Required<
  Omit<
    RunConfig,
    "rowRange" | "tools" | "includeGrounding" | "applyMarkdown" | "prefixWithColName" | "model"
  >
> &
  Pick<
    RunConfig,
    "rowRange" | "tools" | "includeGrounding" | "applyMarkdown" | "prefixWithColName" | "model"
  > & {
    toolsExpanded?: boolean;
    modelExpanded?: boolean;
    lastTestStats?: RunStats | null;
  };
```

Add a new private field alongside the other private fields in `ConfigureAIRunPanel` (right after `private modelExpanded = false;`):

```typescript
  private lastTestStats: RunStats | null = null;
```

- [ ] **Step 4: Set `lastTestStats` on test success and read it in `mount()`**

In `handleTest()`'s success branch, set the field before rendering:

```typescript
// Change:
      .then((stats) => {
        if (stats) {
          this.renderTestStats(container, stats);
          this.flashTestSuccess(testBtn);
        } else {
// to:
      .then((stats) => {
        if (stats) {
          this.lastTestStats = stats;
          this.renderTestStats(container, stats);
          this.flashTestSuccess(testBtn);
        } else {
```

In `mount()`, initialize the field from `savedState` — add this line right after `this.headersLoaded = false;`:

```typescript
    this.lastTestStats = savedState?.lastTestStats ?? null;
```

- [ ] **Step 5: Add the restore/staleness check**

Add `buildConfigSnapshot` and `configsMatch` to the file's imports (new import line, since these come from `shared/run-stats`, not `shared/types`):

```typescript
import { buildConfigSnapshot, configsMatch } from "../../shared/run-stats";
```

In `loadHeaders()`, extend the `!this.headersLoaded` block (from Task 7, Step 4) to run the restore check right after wiring the listeners:

```typescript
// Change:
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
// to:
        if (!this.headersLoaded) {
          container.querySelector<HTMLElement>("#config-form")!.style.display = "block";
          container
            .querySelector<HTMLButtonElement>("#run-btn")!
            .addEventListener("click", () => this.handleRun(container));
          container
            .querySelector<HTMLButtonElement>("#test-btn")!
            .addEventListener("click", () => this.handleTest(container));
          this.headersLoaded = true;

          if (this.lastTestStats) {
            const liveSnapshot = buildConfigSnapshot(this.currentPreset());
            if (configsMatch(liveSnapshot, this.lastTestStats.config)) {
              this.renderTestStats(container, this.lastTestStats);
            } else {
              this.renderTestMessage(
                container,
                "Configuration changed since last test — click Test to refresh.",
              );
            }
          }
        }
```

- [ ] **Step 6: Add `lastTestStats` to `unmount()`'s returned object**

Change:

```typescript
    return {
      promptCols,
      systemPromptCol: this.systemPromptList?.getValue()[0] ?? "",
      outputCol: this.outputColList?.getValue()[0] ?? "",
      rowRange: this.rowRangeComp?.getValue(),
      tools: (this.toolsList?.getValue() ?? []) as ToolId[],
      includeGrounding: this.includeGroundingCb?.checked ?? false,
      applyMarkdown: this.applyMarkdownCb?.checked ?? false,
      prefixWithColName: this.prefixWithColNameCb?.checked ?? false,
      toolsExpanded: this.toolsExpanded,
      model: this.getSelectedModel(),
      modelExpanded: this.modelExpanded,
    };
```

to:

```typescript
    return {
      promptCols,
      systemPromptCol: this.systemPromptList?.getValue()[0] ?? "",
      outputCol: this.outputColList?.getValue()[0] ?? "",
      rowRange: this.rowRangeComp?.getValue(),
      tools: (this.toolsList?.getValue() ?? []) as ToolId[],
      includeGrounding: this.includeGroundingCb?.checked ?? false,
      applyMarkdown: this.applyMarkdownCb?.checked ?? false,
      prefixWithColName: this.prefixWithColNameCb?.checked ?? false,
      toolsExpanded: this.toolsExpanded,
      model: this.getSelectedModel(),
      modelExpanded: this.modelExpanded,
      lastTestStats: this.lastTestStats,
    };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest panels/configure-ai-run.test.ts`
Expected: PASS (all tests, including the 6 new ones)

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 8: Run the full suite and coverage check**

Run: `npx jest --silent`
Expected: PASS, all suites

Run: `npm run test:coverage`
Expected: PASS — check that `src/client/panels/configure-ai-run.ts` stays at or above its threshold (`statements: 85, branches: 70, functions: 90` in `jest.config.cjs`); if it dips, the new `renderTestMessage`/`flashTestSuccess`/restore-check branches likely need one more test case covering an untested branch

- [ ] **Step 9: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "feat(AI-87): persist test results across navigation with staleness check"
```

---

## Self-Review Notes

**Spec coverage:** Every section of the design spec maps to a task — types (Task 1), `usageMetadata` capture (Task 2), pricing/cost math including the tool-use/thinking-token fixes (Task 3), cache write (Task 4), `runBatchAI`/RPC signature change (Task 5), generic `dispatch` (Task 6), Test button + fresh render (Task 7), `SavedState`/staleness (Task 8). The spec's explicitly-deferred items (`getRunStats()` read RPC, full-run cost estimate, live-editing invalidation) have no task — correct, they're out of scope for AI-87.

**Type consistency check performed:** `RunStats`/`RunStatsConfigSnapshot` field names are identical across Tasks 1, 3, 4, 5, 7, 8 (`rowCount`, `totalTimeMs`, `totalInputTokens`, `totalOutputTokens`, `totalTokenCost`, `totalGroundingQueries`, `totalGroundingCost`, `testedAt`, `config`). `buildConfigSnapshot`/`configsMatch` signatures match between Task 1's definition and Tasks 5/8's call sites. `runBatchAI`'s new return type (`RunStats | null`) is threaded consistently through Tasks 5 (index.ts, google.d.ts, services.ts), 7 (handleTest), and 8 (unmount).
