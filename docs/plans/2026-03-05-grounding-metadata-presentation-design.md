# Grounding Metadata Presentation — Design

## Goal

Surface Gemini grounding tool metadata in the spreadsheet in a way that gives journalists actionable pathways to verify AI-generated claims. Inline citations link specific claims directly to their sources; an optional provenance column exposes the full picture.

## Scope

Builds on the `GeminiResponse` refactor (PR #35). That PR gave callers access to `groundingMetadata` and `codePairs`; this design specifies how to render them into spreadsheet cells.

---

## User Experience

### `{outputCol}` cell (always)

`{outputCol}` is whatever the user configured in the sidebar (e.g., `ai_inference`, `results`, any column name). The model's text response is written as a `RichTextValue`. Character spans identified by `groundingSupports` are hyperlinked to their source URIs — the journalist clicks the claim, lands on the source. Attribution is driven by structured span data from the API, not markdown parsing.

### `{outputCol}_grounding` cell (opt-in)

Auto-named from the output column (e.g., if `outputCol` is `my_results`, the grounding column is `my_results_grounding`). Created when the user checks "Include sources column" in the sidebar. Only written when grounding metadata is actually returned. Contains three sections as a `RichTextValue` with clickable source links:

```
Search queries: "query one", "query two"

Sources (3):
• Source Title A        ← clickable hyperlink
• Source Title B        ← clickable hyperlink
• Source Title C        ← clickable hyperlink

Unverified:
• "claim text with no source support"
• "another ungrounded sentence"
```

For `code_execution` runs the column shows the code block(s) and output instead.

The "Unverified" section is derived by finding text spans NOT covered by any `groundingSupports` entry — claims the model made without citation evidence.

---

## Type Changes

### Add `GeminiGroundingSupport` and extend `GeminiGroundingMetadata` (`server/types.ts`)

```typescript
export interface GeminiGroundingSupport {
  segment: {
    startIndex: number;
    endIndex: number;
    text: string;
  };
  groundingChunkIndices: number[];
  confidenceScores?: number[];
}

export interface GeminiGroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GeminiGroundingChunk[];
  groundingSupports?: GeminiGroundingSupport[]; // NEW
}
```

`groundingSupports` is nested inside `groundingMetadata` in the raw REST JSON, so the existing spread in `callGeminiAPI` picks it up automatically once the type is extended — no parser change needed.

### Add `includeGrounding` to `RunConfig` (`shared/types.ts`)

```typescript
export interface RunConfig {
  // ... existing fields
  includeGrounding?: boolean;
}
```

---

## Architecture

### Layer 1 — Pure helpers (testable, `api.ts`)

Three small exported functions, each accepting `GeminiResponse` directly. No intermediate bundling type — `GeminiResponse` is already a robust interface.

```typescript
interface Citation {
  startIndex: number;
  endIndex: number;
  sources: Array<{ uri: string; title: string }>;
}

interface Span {
  startIndex: number;
  endIndex: number;
  text: string;
}

/** Resolve groundingSupports entries into Citation objects with sources joined from groundingChunks. */
export function getCitations(response: GeminiResponse): Citation[]

/** Find text regions in inferenceText not covered by any groundingSupports segment. */
export function getUngroundedSpans(response: GeminiResponse): Span[]

/** Return the flat list of all groundingChunks as { uri, title } pairs. */
export function getAllSources(response: GeminiResponse): Array<{ uri: string; title: string }>
```

`getUngroundedSpans` is the non-trivial one — it sorts supports by `startIndex`, merges overlaps, and finds gaps. It is the primary reason this layer exists as pure testable code.

### Layer 2 — GAS rendering (in `index.ts`, excluded from coverage)

Two thin functions that call the pure helpers and translate to GAS types:

```typescript
function renderInference(response: GeminiResponse): GoogleAppsScript.Spreadsheet.RichTextValue {
  const builder = SpreadsheetApp.newRichTextValue().setText(response.text);
  getCitations(response).forEach(({ startIndex, endIndex, sources }) => {
    if (sources[0]) builder.setLinkUrl(startIndex, endIndex, sources[0].uri);
  });
  return builder.build();
}

function renderGrounding(response: GeminiResponse): GoogleAppsScript.Spreadsheet.RichTextValue | null {
  // Returns null if nothing to show
  // Calls getUngroundedSpans, getAllSources on response
  // Builds three-section RichTextValue (queries / sources with links / unverified)
  // or code block format for code_execution
}
```

No logic here worth testing — just mechanical translation from `GeminiResponse` to GAS types. All interesting decisions live in the pure helpers.

---

## Data Flow

```
runBatchAI
  → runInference(...)                         → GeminiResponse | null
  → renderInference(response)                 → RichTextValue          [GAS, index.ts]
      calls getCitations(response)            → Citation[]             [pure, api.ts]
  → outputCell.setRichTextValue(...)

  if config.includeGrounding:
    → renderGrounding(response)               → RichTextValue | null   [GAS, index.ts]
        calls getAllSources(response)         → Source[]               [pure, api.ts]
        calls getUngroundedSpans(response)    → Span[]                 [pure, api.ts]
    → if non-null: groundingCell.setRichTextValue(...)
```

---

## UI Change

### `ConfigureAIRunPanel` (client)

Add a checkbox below the tool selector. Label: `Include sources column ({outputCol}_grounding)`. The label updates dynamically to reflect the current output column name. Always visible — applies to all grounding tools and code execution alike. Bound to `includeGrounding` in the `RunConfig` assembled before calling `runBatchAI`.

---

## Column Naming

The grounding column is always `config.outputCol + "_grounding"`. Auto-created in `runBatchAI` using the same inline pattern as the output column (check `headers`, append if missing, push name to `headers` array to keep subsequent rows in sync).

---

## Edge Cases

| Scenario | Behavior |
|---|---|
| Grounding tools active, no metadata returned | `{outputCol}` gets plain `RichTextValue` (no links); grounding cell left empty |
| `includeGrounding` checked, `code_execution` active | Grounding cell shows code block + output instead of sources/queries |
| `groundingSupports` absent but `groundingChunks` present | Citations skipped; grounding cell shows sources + queries only (no Unverified section) |
| Multiple sources per span | First source URI used for the hyperlink; all sources appear in the grounding column |
| Plain run (no tools) | `{outputCol}` written as plain `RichTextValue` (no links); grounding cell not written |

---

## Testing

The pure helpers are fully unit-testable with Jest:

- `getCitations` — given `groundingSupports` + `groundingChunks`, assert spans and resolved sources are correct
- `getUngroundedSpans` — given full text with partial coverage, assert gaps are identified correctly; test overlapping supports, adjacent supports, fully covered text, fully uncovered text
- `getAllSources` — given `groundingChunks`, assert flat list is correct; empty when no chunks

`renderInference` and `renderGrounding` live in `index.ts` (excluded from coverage) — verified manually against a live sheet.

---

## Files Changed

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `includeGrounding?: boolean` to `RunConfig` |
| `src/server/types.ts` | Add `GeminiGroundingSupport`; add `groundingSupports` to `GeminiGroundingMetadata` |
| `src/server/api.ts` | Add `getCitations`, `getUngroundedSpans`, `getAllSources` pure helpers; add `Citation` and `Span` interfaces |
| `src/server/index.ts` | Add `renderInference`, `renderGrounding`; update `runBatchAI` to use both |
| `src/client/panels/configure-ai-run.ts` | Add `includeGrounding` checkbox |
| `__tests__/api.test.ts` | Add tests for the three pure helpers |
