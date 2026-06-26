# Grounding URI Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace expiring Vertex AI Search redirect URLs in Gemini grounding citations with the actual destination URLs by following the HTTP redirect once per unique URI, batched across a whole AI run.

**Architecture:** A new `resolveGroundingUris` function in `utils.ts` fires one `UrlFetchApp.fetchAll` after `callGeminiAPIBatch` returns, collects `Location` headers from all 3xx responses, and returns a `Map<redirectUri, actualUri>`. Both rich-text builder functions accept this map as an optional second parameter and do a fallback-safe lookup when building citation links and source lists. `GeminiResponse` is never mutated — it stays faithful to the actual Gemini API response.

**Tech Stack:** TypeScript, Google Apps Script (`UrlFetchApp.fetchAll`), Jest

## Global Constraints

- Apps Script runtime is V8 — target ES2019, no Node.js built-ins
- `rich-text.ts` must stay pure TypeScript — no GAS globals (`Map` is a JS built-in, acceptable)
- All new exports must be named (no default exports)
- `src/server/index.ts` is excluded from test coverage — no test file for Task 3
- Run `npm test` after every task before committing; all 517 existing tests must stay green
- Run `npm run typecheck` before committing Task 3

---

### Task 1: `resolveGroundingUris` in utils.ts

**Files:**

- Modify: `src/server/utils.ts`
- Test: `__tests__/utils.test.ts`

**Interfaces:**

- Consumes: `GeminiResponse` from `./types` (uses `groundingMetadata.groundingChunks[].web.uri` and `.retrievedContext.uri`)
- Produces: `resolveGroundingUris(responses: GeminiResponse[]): Map<string, string>` — keys are redirect URIs, values are resolved actual URIs; only successfully resolved URIs are present

- [ ] **Step 1: Add failing tests**

Open `__tests__/utils.test.ts`. Add a new `describe` block at the bottom. The `UrlFetchApp` mock must be set up in `beforeEach` — it's only called inside the function body (not at import time), so module-level setup is not needed.

```ts
import { resolveGroundingUris } from "@server/utils";
import type { GeminiResponse } from "@server/types";

// Add inside the file, after existing describe blocks:

describe("resolveGroundingUris", () => {
  const mockFetchAll = jest.fn();

  beforeEach(() => {
    mockFetchAll.mockReset();
    (globalThis as unknown as { UrlFetchApp: unknown }).UrlFetchApp = {
      fetchAll: mockFetchAll,
    };
  });

  it("returns empty map and skips fetchAll when no responses have groundingChunks", () => {
    const responses: GeminiResponse[] = [{ text: "hello" }];
    const result = resolveGroundingUris(responses);
    expect(result.size).toBe(0);
    expect(mockFetchAll).not.toHaveBeenCalled();
  });

  it("deduplicates the same URI appearing in multiple responses", () => {
    const sharedUri = "https://vertexaisearch.cloud.google.com/redirect/abc";
    const responses: GeminiResponse[] = [
      {
        text: "a",
        groundingMetadata: {
          groundingChunks: [{ web: { uri: sharedUri, title: "A" } }],
        },
      },
      {
        text: "b",
        groundingMetadata: {
          groundingChunks: [{ web: { uri: sharedUri, title: "A" } }],
        },
      },
    ];
    mockFetchAll.mockReturnValue([
      {
        getResponseCode: () => 301,
        getHeaders: () => ({ Location: "https://example.com" }),
      },
    ]);
    resolveGroundingUris(responses);
    const calls = mockFetchAll.mock.calls[0][0] as Array<{ url: string }>;
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(sharedUri);
  });

  it("maps redirect URI to the Location header value on 3xx response", () => {
    const redirectUri = "https://vertexaisearch.cloud.google.com/redirect/abc";
    const actualUri = "https://example.com/article";
    const responses: GeminiResponse[] = [
      {
        text: "a",
        groundingMetadata: {
          groundingChunks: [{ web: { uri: redirectUri, title: "A" } }],
        },
      },
    ];
    mockFetchAll.mockReturnValue([
      {
        getResponseCode: () => 301,
        getHeaders: () => ({ Location: actualUri }),
      },
    ]);
    const result = resolveGroundingUris(responses);
    expect(result.get(redirectUri)).toBe(actualUri);
  });

  it("omits URI from map when response is not a redirect (e.g. expired URL returns 404)", () => {
    const redirectUri = "https://vertexaisearch.cloud.google.com/redirect/expired";
    const responses: GeminiResponse[] = [
      {
        text: "a",
        groundingMetadata: {
          groundingChunks: [{ web: { uri: redirectUri, title: "A" } }],
        },
      },
    ];
    mockFetchAll.mockReturnValue([
      { getResponseCode: () => 404, getHeaders: () => ({}) },
    ]);
    const result = resolveGroundingUris(responses);
    expect(result.has(redirectUri)).toBe(false);
  });

  it("resolves URIs from retrievedContext chunks as well as web chunks", () => {
    const redirectUri = "https://vertexaisearch.cloud.google.com/redirect/ctx";
    const actualUri = "https://example.com/ctx-article";
    const responses: GeminiResponse[] = [
      {
        text: "a",
        groundingMetadata: {
          groundingChunks: [
            { retrievedContext: { uri: redirectUri, title: "Ctx" } },
          ],
        },
      },
    ];
    mockFetchAll.mockReturnValue([
      {
        getResponseCode: () => 302,
        getHeaders: () => ({ Location: actualUri }),
      },
    ]);
    const result = resolveGroundingUris(responses);
    expect(result.get(redirectUri)).toBe(actualUri);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/utils.test.ts -t "resolveGroundingUris"
```

Expected: 5 failures with `TypeError: resolveGroundingUris is not a function` (or similar — the export doesn't exist yet).

- [ ] **Step 3: Add the import and implementation to utils.ts**

At the top of `src/server/utils.ts`, add the import after the existing `DriveFileInfo` import:

```ts
import type { GeminiResponse } from "./types";
```

At the bottom of `src/server/utils.ts`, add:

```ts
/**
 * Resolve Vertex AI Search redirect URIs to their actual destination URLs.
 * Fires one UrlFetchApp.fetchAll for all unique URIs across all responses,
 * reading the Location header from each 3xx reply. Non-redirect responses
 * (e.g. expired URLs) are silently omitted — callers fall back to the
 * redirect URI via `resolvedUris?.get(uri) ?? uri`.
 */
export function resolveGroundingUris(responses: GeminiResponse[]): Map<string, string> {
  const redirectUris = new Set<string>();
  for (const response of responses) {
    for (const chunk of response.groundingMetadata?.groundingChunks ?? []) {
      const src = chunk.web ?? chunk.retrievedContext;
      if (src?.uri) redirectUris.add(src.uri);
    }
  }

  if (redirectUris.size === 0) return new Map();

  const uriArray = Array.from(redirectUris);
  const fetchRequests = uriArray.map((uri) => ({
    url: uri,
    method: "get",
    followRedirects: false,
    muteHttpExceptions: true,
  }));

  const fetchResponses = UrlFetchApp.fetchAll(fetchRequests);
  const resolved = new Map<string, string>();

  for (let i = 0; i < uriArray.length; i++) {
    const resp = fetchResponses[i];
    const status = resp.getResponseCode();
    if (status >= 300 && status < 400) {
      const headers = resp.getHeaders() as Record<string, string>;
      const location = headers["Location"] ?? headers["location"];
      if (location) resolved.set(uriArray[i], location);
    }
  }

  return resolved;
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx jest __tests__/utils.test.ts
```

Expected: all tests pass (existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/server/utils.ts __tests__/utils.test.ts
git commit -m "feat: add resolveGroundingUris to batch-resolve Vertex AI redirect URLs"
```

---

### Task 2: Thread `resolvedUris` through rich-text.ts

**Files:**

- Modify: `src/server/rich-text.ts`
- Test: `__tests__/rich-text.test.ts`

**Interfaces:**

- Consumes: `resolvedUris?: Map<string, string>` — optional, from Task 1. When absent (or when a URI has no entry), falls back to the original URI unchanged.
- Produces: updated signatures:
  - `buildRichInferenceCellContent(response: GeminiResponse, resolvedUris?: Map<string, string>): CellContent`
  - `buildRichGroundingCellContent(response: GeminiResponse, resolvedUris?: Map<string, string>): CellContent | null`

- [ ] **Step 1: Add failing tests**

Open `__tests__/rich-text.test.ts`. Add a new `describe` block (or tests inside the existing `buildRichInferenceCellContent` / `buildRichGroundingCellContent` describes). No GAS mocking needed — `rich-text.ts` is pure TypeScript.

```ts
// Add to the buildRichInferenceCellContent describe block:
it("uses resolved URI from map for inline citation link", () => {
  const redirectUri = "https://vertexaisearch.cloud.google.com/redirect/abc";
  const actualUri = "https://example.com/real-article";
  const response: GeminiResponse = {
    text: "Hello world.",
    groundingMetadata: {
      groundingChunks: [{ web: { uri: redirectUri, title: "Real Article" } }],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 5, text: "Hello" },
          groundingChunkIndices: [0],
        },
      ],
    },
  };
  const resolvedUris = new Map([[redirectUri, actualUri]]);
  const result = buildRichInferenceCellContent(response, resolvedUris);
  const citationRange = result.ranges.find((r) => r.url !== undefined);
  expect(citationRange?.url).toBe(actualUri);
});

it("falls back to redirect URI when map has no entry for it", () => {
  const redirectUri = "https://vertexaisearch.cloud.google.com/redirect/abc";
  const response: GeminiResponse = {
    text: "Hello world.",
    groundingMetadata: {
      groundingChunks: [{ web: { uri: redirectUri, title: "Article" } }],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 5, text: "Hello" },
          groundingChunkIndices: [0],
        },
      ],
    },
  };
  const resolvedUris = new Map<string, string>(); // empty — URI not resolved
  const result = buildRichInferenceCellContent(response, resolvedUris);
  const citationRange = result.ranges.find((r) => r.url !== undefined);
  expect(citationRange?.url).toBe(redirectUri);
});

// Add to the buildRichGroundingCellContent describe block:
it("uses resolved URI from map in grounding source list", () => {
  const redirectUri = "https://vertexaisearch.cloud.google.com/redirect/abc";
  const actualUri = "https://example.com/real-article";
  const response: GeminiResponse = {
    text: "Answer.",
    groundingMetadata: {
      groundingChunks: [{ web: { uri: redirectUri, title: "Real Article" } }],
      groundingSupports: [],
    },
  };
  const resolvedUris = new Map([[redirectUri, actualUri]]);
  const result = buildRichGroundingCellContent(response, resolvedUris);
  expect(result).not.toBeNull();
  const sourceRange = result!.ranges.find((r) => r.url !== undefined);
  expect(sourceRange?.url).toBe(actualUri);
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/rich-text.test.ts -t "resolved URI"
```

Expected: 3 failures — the parameter doesn't exist yet, so resolved URIs are silently ignored and the redirect URL is used instead of the actual URL.

- [ ] **Step 3: Update getCitations and getAllSources**

In `src/server/rich-text.ts`, update the two private helpers to accept and apply the map.

Replace `getCitations`:

```ts
function getCitations(response: GeminiResponse, resolvedUris?: Map<string, string>): CitationRange[] {
  const supports = response.groundingMetadata?.groundingSupports ?? [];
  const chunks = response.groundingMetadata?.groundingChunks ?? [];
  return supports.map((s: GeminiGroundingSupport) => ({
    startIndex: s.segment.startIndex ?? 0,
    endIndex: s.segment.endIndex,
    sources: s.groundingChunkIndices
      .map((idx) => {
        const chunk = chunks[idx];
        const src = chunk?.web ?? chunk?.retrievedContext ?? null;
        if (!src) return null;
        const uri = resolvedUris?.get(src.uri) ?? src.uri;
        return { ...src, uri };
      })
      .filter((src): src is { uri: string; title: string } => src !== null),
  }));
}
```

Replace `getAllSources`:

```ts
function getAllSources(
  response: GeminiResponse,
  resolvedUris?: Map<string, string>,
): Array<{ uri: string; title: string }> {
  return (response.groundingMetadata?.groundingChunks ?? [])
    .map((chunk) => chunk.web ?? chunk.retrievedContext ?? null)
    .filter((src): src is { uri: string; title: string } => src !== null)
    .map((src) => ({ ...src, uri: resolvedUris?.get(src.uri) ?? src.uri }));
}
```

- [ ] **Step 4: Update the public builder signatures**

Replace `buildRichInferenceCellContent`:

```ts
export function buildRichInferenceCellContent(
  response: GeminiResponse,
  resolvedUris?: Map<string, string>,
): CellContent {
  const citations = getCitations(response, resolvedUris).sort(
    (a, b) => a.startIndex - b.startIndex,
  );
  const merged = mergeCitations(citations);

  if (merged.length === 0) {
    return parseMarkdown(response.text);
  }

  const existingLinkSpans = findExistingLinkSpans(response.text);
  const preprocessed = injectCitationLinks(response.text, merged, existingLinkSpans);
  return parseMarkdown(preprocessed);
}
```

Replace `buildRichGroundingCellContent`:

```ts
export function buildRichGroundingCellContent(
  response: GeminiResponse,
  resolvedUris?: Map<string, string>,
): CellContent | null {
  const sources = getAllSources(response, resolvedUris);
  const queries = response.groundingMetadata?.webSearchQueries ?? [];
  const codePairs = response.codePairs ?? [];

  if (!sources.length && !queries.length && !codePairs.length) {
    return null;
  }

  if (codePairs.length > 0) {
    const sections = codePairs.map(({ code, result }) => {
      const lang = code.language ? `(${code.language.toLowerCase()})` : "";
      return `Code ${lang}:\n${code.code}\n\nOutput:\n${result.output}`;
    });
    return { text: sections.join("\n\n"), ranges: [] };
  }

  const parts: string[] = [];
  const ranges: TextRange[] = [];
  let pos = 0;

  function append(s: string): void {
    parts.push(s);
    pos += s.length;
  }

  if (queries.length) {
    append("Search queries: ");
    queries.forEach((q, i) => {
      if (i > 0) append(", ");
      const quoted = `"${q}"`;
      const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
      ranges.push({ startIndex: pos, endIndex: pos + quoted.length, url });
      append(quoted);
    });
  }

  if (sources.length) {
    if (parts.length > 0) append("\n\n");
    append(`Sources (${sources.length}):\n`);
    sources.forEach(({ uri, title }, i) => {
      if (i > 0) append("\n");
      append("• ");
      ranges.push({ startIndex: pos, endIndex: pos + title.length, url: uri });
      append(title);
    });
  }

  return { text: parts.join(""), ranges };
}
```

- [ ] **Step 5: Run all rich-text tests**

```bash
npx jest __tests__/rich-text.test.ts
```

Expected: all tests pass. The new parameter is optional so all existing call sites (no second argument) are unaffected.

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: 520 tests pass (517 existing + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/server/rich-text.ts __tests__/rich-text.test.ts
git commit -m "feat: thread resolvedUris map through rich-text builders for real citation URLs"
```

---

### Task 3: Wire resolution phase into runBatchAI

**Files:**

- Modify: `src/server/index.ts` (excluded from coverage — no test file)

**Interfaces:**

- Consumes:
  - `resolveGroundingUris(responses: GeminiResponse[]): Map<string, string>` from Task 1
  - `buildRichInferenceCellContent(response, resolvedUris?)` from Task 2
  - `buildRichGroundingCellContent(response, resolvedUris?)` from Task 2
- Produces: nothing new — wires Tasks 1 and 2 together inside `runBatchAI`

- [ ] **Step 1: Add resolveGroundingUris to the utils import**

In `src/server/index.ts`, find the existing import block from `"./utils"` (around line 28–35). Add `resolveGroundingUris` to it:

```ts
import {
  extractId,
  isValidDriveLink,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  resolveColumns,
  findOrCreateColumn,
  writeColumn,
  resolveGroundingUris,  // add this line
} from "./utils";
```

- [ ] **Step 2: Add the resolution phase after callGeminiAPIBatch**

In `runBatchAI`, find the line (around line 522):

```ts
const results = requests.length > 0 ? callGeminiAPIBatch(requests) : [];
```

Insert the resolution phase immediately after it, before the write loop comment:

```ts
const results = requests.length > 0 ? callGeminiAPIBatch(requests) : [];

const resolvedUris =
  (config.applyMarkdown || config.includeGrounding) &&
  results.some((r) => (r.groundingMetadata?.groundingChunks?.length ?? 0) > 0)
    ? resolveGroundingUris(results)
    : new Map<string, string>();
```

- [ ] **Step 3: Pass resolvedUris into both builder calls**

In the write loop (around lines 530–548), update the two builder invocations.

Change:

```ts
.setRichTextValue(toCellValue(buildRichInferenceCellContent(result)));
```

To:

```ts
.setRichTextValue(toCellValue(buildRichInferenceCellContent(result, resolvedUris)));
```

Change:

```ts
const groundingContent = buildRichGroundingCellContent(result);
```

To:

```ts
const groundingContent = buildRichGroundingCellContent(result, resolvedUris);
```

- [ ] **Step 4: Typecheck and run full test suite**

```bash
npm run typecheck && npm test
```

Expected: no type errors, all 520 tests pass.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: clean build with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add grounding URI resolution phase to runBatchAI"
```
