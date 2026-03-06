# Grounding Metadata Enrichment — Design

## Problem

The three Gemini grounding tools (Google Search, URL Context, Code Execution) return metadata alongside the model's text response that the current implementation discards. `callGeminiAPI` extracts only `candidates[0].content.parts[0].text` and throws away everything else. Users who enable these tools get no visibility into what sources were consulted, what queries were run, or what code executed.

## Scope of This Design

This document covers the **call-chain refactor**: lifting response parsing out of `callGeminiAPI` so that the full structured response is preserved for callers. How the metadata is ultimately presented in the spreadsheet (formatting, column strategy, etc.) is a separate decision deferred to a follow-up design.

## What Each Tool Returns

### Google Search
Metadata in `candidates[0].groundingMetadata`:
- `webSearchQueries` — the search queries used
- `groundingChunks[].web` — `{ uri, title }` for each source

### URL Context
Metadata in `candidates[0].groundingMetadata`:
- `groundingChunks[].retrievedContext` — `{ uri, title }` for each fetched URL
- No `webSearchQueries`

### Code Execution
Extra parts interspersed in `candidates[0].content.parts`:
- `executableCode: { language, code }` — the generated code
- `codeExecutionResult: { outcome, output }` — what it returned
- Text parts appear before and after code blocks; all must be joined for a coherent response.

## Design Decisions

### Decision 1: Lift response parsing out of `callGeminiAPI`

**Decision:** Change `callGeminiAPI` (and `invokeGemini`, `runInference`) to return a typed `GeminiResponse` object instead of a bare `string`. Callers are then responsible for extracting what they need.

**Alternatives considered:**
- Keep `callGeminiAPI` returning `string`, add a parallel `callGeminiAPIRich` path — rejected as duplication.
- String-append metadata to the text in `callGeminiAPI` — rejected because it mixes structured data with prose, is not reversible, and locks in a presentation decision at the wrong layer.

**Why this approach:** Clean separation of concerns. `callGeminiAPI` is a pure HTTP adapter; it should faithfully parse and return the API response. Presentation decisions belong to callers. Both are independently testable.

### Decision 2: No external typing package for Gemini response types

**Decision:** Define lean types in `server/types.ts` for only the fields we consume (`GeminiGroundingChunk`, `GeminiGroundingMetadata`, `GeminiCodePair`, `GeminiResponse`).

**Alternatives considered:**
- Add `@google/generative-ai` as a devDependency, use `import type` — zero runtime cost, but brings in a large type surface we don't use, and the SDK's processed response types may drift from the raw REST JSON returned by `UrlFetchApp`.

**Why this approach:** Scope is narrow and well-defined. Owning the types means no surprise breakage from SDK updates.

### Decision 3: `runInference` returns `GeminiResponse | null`

**Decision:** Update `runInference` to return `GeminiResponse | null`. Error cases (caught exceptions) return `{ text: "Error: ..." }` — a `GeminiResponse` with no metadata, preserving existing error-string behavior at the cell level.

**Why:** `runBatchAI` is the only caller of `runInference`. Changing the return type affects exactly one callsite. Returning a `GeminiResponse` for errors keeps `runBatchAI`'s loop simple — no special-casing needed for error vs. success.

### Decision 4: `SSI` calls `.text` — behavior unchanged

**Decision:** `SSI` (the Sheets custom function) has a single-cell `string` return contract. It calls `invokeGemini(...).text`. No metadata is surfaced via `SSI`; metadata is a batch-run concern deferred to a follow-up design.

## Files Changed (This Phase)

| File | Change |
|------|--------|
| `src/server/types.ts` | Add `GeminiGroundingChunk`, `GeminiGroundingMetadata`, `GeminiCodePair`, `GeminiResponse` |
| `src/server/api.ts` | `callGeminiAPI` → `GeminiResponse`; `invokeGemini` → `GeminiResponse` |
| `src/server/inference.ts` | `runInference` → `GeminiResponse \| null`; error catch returns `{ text: "Error: ..." }` |
| `src/server/customFunctions.ts` | `SSI` calls `invokeGemini(...).text` |
| `__tests__/api.test.ts` | Update return type assertions; add new tests for metadata fields |
| `__tests__/inference.test.ts` | Update return type assertions |
| `__tests__/customFunctions.test.ts` | No behavior changes; tests pass as-is |

## Deferred

- How metadata is formatted for the spreadsheet cell
- Whether metadata goes in the same cell as text or a separate column
- Whether `runBatchAI` needs `RunConfig` changes to support metadata output
