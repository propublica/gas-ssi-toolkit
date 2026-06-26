# Design: Grounding URI Resolution

**Date:** 2026-06-26
**Status:** Approved

## Problem

Gemini's grounding API returns citation URLs as Vertex AI Search redirect URLs:

```
https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQGRLv...
```

These URLs have two problems for journalists:
1. **They expire** — the opaque token has a TTL, so saved spreadsheets contain dead links
2. **They're opaque** — you can't tell the source from the URL itself

The actual destination URL is available as the `Location` header of the first HTTP redirect hop.

## Solution Overview

Add a dedicated resolution phase in `runBatchAI` between the batch Gemini call and the write loop. The phase collects all unique redirect URIs across all responses, resolves them in a single batched HTTP call, and passes the resulting map into the rich-text builders.

`GeminiResponse` stays faithful to the actual Gemini API response throughout — no mutation.

## Architecture

### New execution phase in `runBatchAI`

```
1. callGeminiAPIBatch(requests)        → GeminiResponse[]  (redirect URIs intact)
2. resolveGroundingUris(responses)     → Map<redirectUri, actualUri>   ← new
3. for loop: buildRichInferenceCellContent(result, resolvedUris)
             buildRichGroundingCellContent(result, resolvedUris)
4. SpreadsheetApp.flush()
```

The resolution phase (step 2) only runs when it can produce a result: `(config.applyMarkdown || config.includeGrounding)` AND at least one response contains `groundingChunks`. Otherwise it returns an empty `Map` immediately and the write loop proceeds unchanged.

### `resolveGroundingUris` — `src/server/utils.ts`

```ts
function resolveGroundingUris(responses: GeminiResponse[]): Map<string, string>
```

1. Collects all unique `web.uri` values from `groundingChunks` across all responses
2. Issues one `UrlFetchApp.fetchAll` with `{ followRedirects: false, muteHttpExceptions: true }` — a GET that stops at the first hop, reading only the `Location` header (no body download)
3. For each response: if status is 3xx and `Location` is present, maps `redirectUri → actualUri`
4. Returns the map — entries are only present for successfully resolved URIs

Deduplication across rows means if 10 rows all cite the same source, it's one HTTP request.

### `rich-text.ts` — optional `resolvedUris` parameter

Both public builder functions gain an optional second parameter:

```ts
buildRichInferenceCellContent(response: GeminiResponse, resolvedUris?: Map<string, string>): CellContent
buildRichGroundingCellContent(response: GeminiResponse, resolvedUris?: Map<string, string>): CellContent | null
```

The map is threaded down to the two private helpers that first read URIs from the response:

- **`getCitations`** — maps `groundingChunkIndices` to `{ uri, title }` source objects; does `resolvedUris?.get(uri) ?? uri` on each `web.uri`
- **`getAllSources`** — builds the source list for the grounding column; same lookup

`rich-text.ts` remains pure TypeScript — `Map` is a JS built-in, no GAS globals introduced. All existing call sites pass no second argument and are unaffected.

## File Inventory

| File | Change |
|------|--------|
| `src/server/utils.ts` | Add `resolveGroundingUris(responses): Map<string, string>` |
| `src/server/rich-text.ts` | Add optional `resolvedUris?` to both builders; thread to `getCitations` + `getAllSources` |
| `src/server/index.ts` | Add guarded resolution phase between `callGeminiAPIBatch` and write loop |

No changes to `src/server/types.ts`, `src/server/api.ts`, `src/client/`, or `src/shared/`.

## Error Handling

- Non-3xx response (expired URL, network error): no entry added to map; `?? uri` fallback means the original redirect URL is used — graceful degradation, not a hard failure
- Empty `groundingChunks`: guard condition skips the phase entirely
- `UrlFetchApp.fetchAll` quota: at most one batch call per `runBatchAI` chunk, bounded by the number of unique sources (typically single digits)

## Testing

**`utils.ts`** (new tests):
- Mock `UrlFetchApp.fetchAll`; verify deduplication (N responses with same URI → 1 fetch request)
- Verify 3xx with `Location` header → correct map entry
- Verify non-3xx → no map entry (graceful fallback)
- Verify empty responses array → empty map, no fetch call

**`rich-text.ts`** (additive tests):
- Existing tests all pass unchanged (parameter is optional)
- New: `buildRichInferenceCellContent` with a populated map uses resolved URI in citation link
- New: `buildRichGroundingCellContent` with a populated map uses resolved URI in source list
- New: unknown URI (not in map) falls back to redirect URI unchanged

## Out of Scope

- The `SSI` custom function (`customFunctions.ts`) calls `invokeGemini` directly and returns a plain string — it bypasses the rich-text pipeline entirely and is unaffected
- Refactoring `runBatchAI` into named phase helpers (tracked in [issue #116](https://github.com/propublica/gas-ssi-toolkit/issues/116))
