# Grounding Metadata Presentation Refinements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Introduce a `rich-text.ts` module as the canonical layer between `GeminiResponse` and Sheets cell content, then deliver five user-requested polish items: remove the "Unverified" section, hyperlink search queries to Google, move the grounding checkbox into the Tools field-group with conditional visibility, fix the code execution format in the grounding column, and render Gemini markdown (bold, italic, headings) in output cells.

**Architecture:** New `src/server/rich-text.ts` owns all pure response-to-cell logic (`parseMarkdown`, private `getCitations`/`getAllSources`, `buildInferenceCellContent`, `buildGroundingCellContent`). `api.ts` is stripped back to a pure HTTP adapter. `index.ts` gets a single `toCellValue` GAS wrapper that converts `CellContent → RichTextValue` and replaces the two `render*` functions. The UI checkbox change is self-contained in `configure-ai-run.ts`.

**Tech Stack:** TypeScript, Jest/jsdom, Google Apps Script (`SpreadsheetApp.newRichTextValue`, `SpreadsheetApp.newTextStyle`)

---

## Reference: current files

- `src/server/api.ts` — currently exports `buildGeminiPayload`, `callGeminiAPI`, `invokeGemini`, `Citation`, `getCitations`, `getAllSources`, `Span`, `getUngroundedSpans`
- `src/server/index.ts` — imports `getCitations`, `getUngroundedSpans`, `getAllSources` from `./api`; contains `renderInference` and `renderGrounding` (lines ~230-314), `runBatchAI` (line ~316)
- `src/server/types.ts` — `GeminiResponse`, `GeminiGroundingMetadata`, `GeminiGroundingSupport`, `GeminiCodePair`
- `src/client/panels/configure-ai-run.ts` — tools list initialized synchronously (lines ~45-49); checkbox initialized in async headers callback (lines ~82-88); `template()` has separate field-group for checkbox
- `src/client/sidebar.css` — no `.grounding-hint` rule yet
- `__tests__/api.test.ts` — tests for `getCitations` (~5 cases), `getAllSources` (~5 cases), `getUngroundedSpans` (~10 cases)
- `__tests__/panels/configure-ai-run.test.ts` — `"includeGrounding checkbox"` describe block (6 tests)

---

## Task 1: Remove `getUngroundedSpans` and `Span` from `api.ts`

**Files:**
- Modify: `src/server/api.ts`
- Modify: `src/server/index.ts`
- Modify: `__tests__/api.test.ts`

No new tests — this is pure deletion. Verified by running the test suite.

### Step 1: Remove `Span` interface and `getUngroundedSpans` from `src/server/api.ts`

Delete the `Span` interface (lines ~31-35):
```typescript
// DELETE:
export interface Span {
  startIndex: number;
  endIndex: number;
  text: string;
}
```

Delete the entire `getUngroundedSpans` function and its JSDoc (lines ~143-190).

Leave `Citation`, `getCitations`, `getAllSources` intact — they are removed in Task 3.

### Step 2: Update `src/server/index.ts`

**a)** Remove `getUngroundedSpans` from the import line:
```typescript
// BEFORE:
import { getCitations, getUngroundedSpans, getAllSources } from "./api";

// AFTER:
import { getCitations, getAllSources } from "./api";
```

**b)** In `renderGrounding`, remove the `unverified` variable, update the null guard, and delete the Unverified section push:

```typescript
// BEFORE (lines ~259-288):
const unverified = getUngroundedSpans(response);
if (!sources.length && !queries.length && !unverified.length && !codePairs.length) {
  return null;
}
// ...
if (unverified.length) {
  sections.push(`Unverified:\n${unverified.map((s) => `• "${s.text}"`).join("\n")}`);
}

// AFTER:
// (delete unverified line, simplify null guard, delete unverified section push)
if (!sources.length && !queries.length && !codePairs.length) {
  return null;
}
```

### Step 3: Remove `getUngroundedSpans` tests from `__tests__/api.test.ts`

**a)** Remove `getUngroundedSpans` from the import line.

**b)** Delete the entire `describe("getUngroundedSpans", ...)` block (~10 tests, lines ~364-511).

### Step 4: Run tests

```bash
npm test
```

Expected: all pass (fewer tests — the `getUngroundedSpans` suite is gone).

### Step 5: Typecheck

```bash
npm run typecheck
```

Expected: passes.

### Step 6: Commit

```bash
git add src/server/api.ts src/server/index.ts __tests__/api.test.ts
git commit -m "refactor: remove getUngroundedSpans — Unverified section dropped from grounding column"
```

---

## Task 2: Create `src/server/rich-text.ts` with `CellContent`/`TextRange` and all pure cell-building logic

**Files:**
- Create: `src/server/rich-text.ts`
- Create: `__tests__/rich-text.test.ts`

This task introduces the new module with full TDD. All five user refinements (remove Unverified, query hyperlinks, code execution format, markdown rendering, and the groundwork for checkbox UX) are implemented here as pure logic that never touches GAS globals.

### Core interfaces

```typescript
// CellContent describes everything needed to build one Sheets cell.
// text: the full string content (markdown stripped, if applicable).
// ranges: character ranges that carry links and/or text styles.
//
// A single TextRange may carry both url and bold/italic — toCellValue in
// index.ts will call setLinkUrl and setTextStyle separately for the range.
export interface TextRange {
  startIndex: number; // inclusive
  endIndex: number;   // exclusive
  bold?: boolean;
  italic?: boolean;
  url?: string;
}

export interface CellContent {
  text: string;
  ranges: TextRange[];
}
```

### Private helpers (not exported)

**`parseMarkdown`** strips `**bold**`, `*italic*`, `# Heading` from text, returns:
- `cleanText` — markers removed
- `ranges` — `TextRange[]` with `bold`/`italic` flags, positions in `cleanText`
- `mapIndex(originalIdx)` — remaps a character index in the original text to `cleanText`

**`getCitations`** (moved from `api.ts`) resolves `groundingSupports` into `{ startIndex, endIndex, sources }[]`.

**`getAllSources`** (moved from `api.ts`) returns flat `{ uri, title }[]` from `groundingChunks`.

### Public functions

**`buildInferenceCellContent(response: GeminiResponse): CellContent`**

Steps:
1. Call `parseMarkdown(response.text)` → `{ cleanText, ranges: mdRanges, mapIndex }`
2. Call `getCitations(response)`, sort by `startIndex`, merge overlapping ranges (keeping first source URI), remap `startIndex`/`endIndex` through `mapIndex`
3. Skip merged ranges where `cleanStart >= cleanEnd`
4. Return `{ text: cleanText, ranges: [...mdRanges, ...citationRanges] }`

**`buildGroundingCellContent(response: GeminiResponse): CellContent | null`**

Steps:
1. `sources = getAllSources(response)`, `queries = response.groundingMetadata?.webSearchQueries ?? []`, `codePairs = response.codePairs ?? []`
2. If all empty → return `null`
3. Build `sections: string[]`:
   - If `codePairs.length > 0`: for each pair, push `Code (lang):\n{code}\n\nOutput:\n{output}` — plain text, no markdown fences (they render literally in Sheets)
   - Else: if `queries.length`, push `Search queries: "${q1}", "${q2}"`; if `sources.length`, push `Sources (N):\n• Title1\n• Title2`
4. `fullText = sections.join("\n\n")`
5. Build `ranges: TextRange[]`:
   - For each query: find `"${query}"` in fullText starting from the queries section header; add `{ startIndex, endIndex, url: "https://www.google.com/search?q=${encodeURIComponent(query)}" }`
   - For each source: find `• ${title}` within the Sources section boundaries; add `{ startIndex: bulletIdx+2, endIndex: bulletIdx+2+title.length, url: source.uri }`
6. Return `{ text: fullText, ranges }`

### Step 1: Write the failing tests in `__tests__/rich-text.test.ts`

```typescript
/// <reference types="node" />
import type { GeminiResponse } from "../src/server/types";
import {
  buildInferenceCellContent,
  buildGroundingCellContent,
  type CellContent,
  type TextRange,
} from "../src/server/rich-text";

// ---- helpers ----

function makeResponse(overrides: Partial<GeminiResponse> = {}): GeminiResponse {
  return { text: "Hello world.", ...overrides };
}

function makeGroundedResponse(overrides: Partial<GeminiResponse> = {}): GeminiResponse {
  return {
    text: "Paris is the capital of France.",
    groundingMetadata: {
      groundingChunks: [
        { web: { uri: "https://example.com/paris", title: "Paris - Wikipedia" } },
      ],
      groundingSupports: [
        { segment: { startIndex: 0, endIndex: 31 }, groundingChunkIndices: [0] },
      ],
      webSearchQueries: ["capital of France"],
    },
    ...overrides,
  };
}

// ============================================================
// buildInferenceCellContent
// ============================================================

describe("buildInferenceCellContent", () => {
  it("returns plain text with no ranges for a simple response", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "Hello world." }));
    expect(result.text).toBe("Hello world.");
    expect(result.ranges).toHaveLength(0);
  });

  it("strips **bold** markers and produces a bold range", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "The **sky** is blue." }));
    expect(result.text).toBe("The sky is blue.");
    const bold = result.ranges.find((r) => r.bold);
    expect(bold).toEqual({ startIndex: 4, endIndex: 7, bold: true });
  });

  it("strips *italic* markers and produces an italic range", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "A *quick* test." }));
    expect(result.text).toBe("A quick test.");
    const italic = result.ranges.find((r) => r.italic);
    expect(italic).toEqual({ startIndex: 2, endIndex: 7, italic: true });
  });

  it("strips ## heading prefix and produces a bold range", () => {
    const result = buildInferenceCellContent(
      makeResponse({ text: "## Section Title\nBody text." }),
    );
    expect(result.text).toBe("Section Title\nBody text.");
    expect(result.ranges[0]).toEqual({ startIndex: 0, endIndex: 13, bold: true });
  });

  it("adds url range for a citation, remapped through markdown position map", () => {
    // "The **sky** is blue." → cleanText "The sky is blue." (len 16)
    // groundingSupport: segment 0..15 (covers "The **sky** is" in original)
    // original idx 0 → clean 0, original idx 15 → clean 11
    const response = makeResponse({
      text: "The **sky** is blue.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }],
        groundingSupports: [{ segment: { startIndex: 0, endIndex: 15 }, groundingChunkIndices: [0] }],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    const link = result.ranges.find((r) => r.url);
    expect(link).toBeDefined();
    expect(link?.url).toBe("https://example.com");
    // remapped: 0→0, 15→11
    expect(link?.startIndex).toBe(0);
    expect(link?.endIndex).toBe(11);
  });

  it("merges overlapping citation ranges and keeps the first URI", () => {
    const response = makeResponse({
      text: "Hello world.",
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "A" } },
          { web: { uri: "https://b.com", title: "B" } },
        ],
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 8 }, groundingChunkIndices: [0] },
          { segment: { startIndex: 5, endIndex: 12 }, groundingChunkIndices: [1] },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    const links = result.ranges.filter((r) => r.url);
    expect(links).toHaveLength(1);
    expect(links[0].startIndex).toBe(0);
    expect(links[0].endIndex).toBe(12);
    expect(links[0].url).toBe("https://a.com");
  });

  it("skips citations with no sources", () => {
    const response = makeResponse({
      text: "Hello world.",
      groundingMetadata: {
        groundingChunks: [],
        groundingSupports: [{ segment: { startIndex: 0, endIndex: 5 }, groundingChunkIndices: [] }],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    expect(result.ranges.filter((r) => r.url)).toHaveLength(0);
  });

  it("returns text with no ranges when groundingMetadata is absent", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "Plain text." }));
    expect(result.ranges.filter((r) => r.url)).toHaveLength(0);
  });
});

// ============================================================
// buildGroundingCellContent
// ============================================================

describe("buildGroundingCellContent", () => {
  it("returns null when response has no grounding data", () => {
    expect(buildGroundingCellContent(makeResponse())).toBeNull();
  });

  it("returns null when groundingMetadata has empty arrays", () => {
    const response = makeResponse({
      groundingMetadata: { groundingChunks: [], groundingSupports: [], webSearchQueries: [] },
    });
    expect(buildGroundingCellContent(response)).toBeNull();
  });

  it("includes search query text and a Google Search url range", () => {
    const response = makeGroundedResponse();
    const result = buildGroundingCellContent(response)!;
    expect(result.text).toContain('"capital of France"');
    const queryLink = result.ranges.find((r) =>
      r.url?.startsWith("https://www.google.com/search"),
    );
    expect(queryLink).toBeDefined();
    expect(queryLink?.url).toBe(
      "https://www.google.com/search?q=capital%20of%20France",
    );
    // The link should cover the quoted query text
    const quotedQuery = '"capital of France"';
    const idx = result.text.indexOf(quotedQuery);
    expect(queryLink?.startIndex).toBe(idx);
    expect(queryLink?.endIndex).toBe(idx + quotedQuery.length);
  });

  it("includes source title text and a url range pointing to the source URI", () => {
    const response = makeGroundedResponse();
    const result = buildGroundingCellContent(response)!;
    expect(result.text).toContain("Paris - Wikipedia");
    const sourceLink = result.ranges.find((r) => r.url?.startsWith("https://example.com/paris"));
    expect(sourceLink).toBeDefined();
    const titleText = "Paris - Wikipedia";
    const idx = result.text.indexOf(titleText);
    expect(sourceLink?.startIndex).toBe(idx);
    expect(sourceLink?.endIndex).toBe(idx + titleText.length);
  });

  it("does not include an Unverified section", () => {
    const response = makeGroundedResponse();
    const result = buildGroundingCellContent(response)!;
    expect(result.text).not.toContain("Unverified");
  });

  it("formats code execution as plain text without markdown fences", () => {
    const response = makeResponse({
      codePairs: [
        {
          code: { language: "PYTHON", code: "print(1+1)" },
          result: { outcome: "OUTCOME_OK", output: "2\n" },
        },
      ],
    });
    const result = buildGroundingCellContent(response)!;
    expect(result.text).toContain("Code (python):");
    expect(result.text).toContain("print(1+1)");
    expect(result.text).toContain("Output:");
    expect(result.text).toContain("2\n");
    expect(result.text).not.toContain("```");
    expect(result.ranges).toHaveLength(0);
  });

  it("handles multiple sources with individual url ranges", () => {
    const response = makeResponse({
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "Site A" } },
          { web: { uri: "https://b.com", title: "Site B" } },
        ],
        groundingSupports: [],
        webSearchQueries: [],
      },
    });
    const result = buildGroundingCellContent(response)!;
    const links = result.ranges.filter((r) => r.url);
    expect(links).toHaveLength(2);
    expect(links.map((r) => r.url)).toEqual(
      expect.arrayContaining(["https://a.com", "https://b.com"]),
    );
  });

  it("handles multiple search queries with individual url ranges", () => {
    const response = makeResponse({
      groundingMetadata: {
        groundingChunks: [],
        groundingSupports: [],
        webSearchQueries: ["query one", "query two"],
      },
    });
    const result = buildGroundingCellContent(response)!;
    const links = result.ranges.filter((r) => r.url?.includes("google.com"));
    expect(links).toHaveLength(2);
    expect(links[0].url).toBe("https://www.google.com/search?q=query%20one");
    expect(links[1].url).toBe("https://www.google.com/search?q=query%20two");
  });

  it("returns only code section — no search/source sections — when codePairs present", () => {
    const response = makeResponse({
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://x.com", title: "X" } }],
        groundingSupports: [],
        webSearchQueries: ["something"],
      },
      codePairs: [
        {
          code: { language: "PYTHON", code: "x=1" },
          result: { outcome: "OUTCOME_OK", output: "1" },
        },
      ],
    });
    const result = buildGroundingCellContent(response)!;
    expect(result.text).not.toContain("Search queries");
    expect(result.text).not.toContain("Sources");
    expect(result.text).toContain("Code");
  });
});

// ============================================================
// parseMarkdown (tested indirectly, but sanity-check edge cases here)
// ============================================================

describe("buildInferenceCellContent markdown edge cases", () => {
  it("does not treat unmatched * as italic", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "Price: $5 * tax" }));
    expect(result.text).toBe("Price: $5 * tax");
    expect(result.ranges.filter((r) => r.italic)).toHaveLength(0);
  });

  it("handles # heading at the very start", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "# Title" }));
    expect(result.text).toBe("Title");
    expect(result.ranges[0]).toEqual({ startIndex: 0, endIndex: 5, bold: true });
  });

  it("handles multiple bold spans", () => {
    const result = buildInferenceCellContent(makeResponse({ text: "**A** and **B**" }));
    expect(result.text).toBe("A and B");
    const bold = result.ranges.filter((r) => r.bold);
    expect(bold).toHaveLength(2);
    expect(bold[0]).toEqual({ startIndex: 0, endIndex: 1, bold: true });
    expect(bold[1]).toEqual({ startIndex: 6, endIndex: 7, bold: true });
  });
});
```

### Step 2: Run to confirm failures

```bash
npx jest __tests__/rich-text.test.ts
```

Expected: FAIL — module not found.

### Step 3: Create `src/server/rich-text.ts`

```typescript
/**
 * rich-text.ts — Pure TypeScript layer between GeminiResponse and Sheets cell content.
 *
 * Exports CellContent and TextRange interfaces + two builder functions.
 * All helpers are private. No GAS globals — fully testable with Jest.
 *
 * GAS rendering (toCellValue) lives in index.ts which is excluded from coverage.
 */

import type { GeminiResponse, GeminiGroundingSupport } from "./types";

// ---- Public interfaces ----

/** A character range within a CellContent's text that carries link and/or style info. */
export interface TextRange {
  startIndex: number; // inclusive
  endIndex: number;   // exclusive
  bold?: boolean;
  italic?: boolean;
  url?: string;
}

/** Everything needed to construct a Sheets RichTextValue for one cell. */
export interface CellContent {
  text: string;
  ranges: TextRange[];
}

// ---- Private helpers ----

interface ParsedMarkdown {
  cleanText: string;
  /** Style spans (bold/italic) in cleanText coordinates. */
  ranges: TextRange[];
  /** Maps a character index in the original text to the corresponding index in cleanText. */
  mapIndex: (originalIndex: number) => number;
}

/**
 * Strip **bold**, *italic*, and # heading markers from text.
 * Returns the clean string, styled ranges (in cleanText coordinates),
 * and a function to remap original character indices to cleanText indices.
 * Unmatched markers are left verbatim.
 */
function parseMarkdown(text: string): ParsedMarkdown {
  const ranges: TextRange[] = [];
  // posMap[i] = position in cleanText for original character i.
  const posMap = new Array<number>(text.length + 1).fill(0);
  const cleanParts: string[] = [];
  let cleanLen = 0;
  let i = 0;

  while (i < text.length) {
    // **bold** — must be checked before single *
    if (text[i] === "*" && text[i + 1] === "*") {
      const closeIdx = text.indexOf("**", i + 2);
      if (closeIdx > i + 2) {
        posMap[i] = cleanLen;
        posMap[i + 1] = cleanLen;
        const spanStart = cleanLen;
        const content = text.slice(i + 2, closeIdx);
        for (let j = 0; j < content.length; j++) {
          posMap[i + 2 + j] = cleanLen + j;
          cleanParts.push(content[j]);
        }
        cleanLen += content.length;
        posMap[closeIdx] = cleanLen;
        posMap[closeIdx + 1] = cleanLen;
        ranges.push({ startIndex: spanStart, endIndex: cleanLen, bold: true });
        i = closeIdx + 2;
        continue;
      }
    }

    // *italic* — single * with a matching closing *
    if (text[i] === "*" && text[i + 1] !== "*") {
      const closeIdx = text.indexOf("*", i + 1);
      if (closeIdx > i + 1 && text[closeIdx + 1] !== "*") {
        posMap[i] = cleanLen;
        const spanStart = cleanLen;
        const content = text.slice(i + 1, closeIdx);
        for (let j = 0; j < content.length; j++) {
          posMap[i + 1 + j] = cleanLen + j;
          cleanParts.push(content[j]);
        }
        cleanLen += content.length;
        posMap[closeIdx] = cleanLen;
        ranges.push({ startIndex: spanStart, endIndex: cleanLen, italic: true });
        i = closeIdx + 1;
        continue;
      }
    }

    // # Heading — only at the start of text or after a newline
    if (text[i] === "#" && (i === 0 || text[i - 1] === "\n")) {
      let level = 0;
      while (i + level < text.length && text[i + level] === "#") level++;
      if (level >= 1 && level <= 6 && text[i + level] === " ") {
        const prefixLen = level + 1; // e.g. "## " = 3 chars
        for (let j = 0; j < prefixLen; j++) posMap[i + j] = cleanLen;
        const lineEnd = text.indexOf("\n", i + prefixLen);
        const end = lineEnd === -1 ? text.length : lineEnd;
        const content = text.slice(i + prefixLen, end);
        const spanStart = cleanLen;
        for (let j = 0; j < content.length; j++) {
          posMap[i + prefixLen + j] = cleanLen + j;
          cleanParts.push(content[j]);
        }
        cleanLen += content.length;
        ranges.push({ startIndex: spanStart, endIndex: cleanLen, bold: true });
        i = end;
        continue;
      }
    }

    // Plain character — pass through verbatim
    posMap[i] = cleanLen;
    cleanParts.push(text[i]);
    cleanLen++;
    i++;
  }
  posMap[text.length] = cleanLen;

  const cleanText = cleanParts.join("");
  const mapIndex = (idx: number): number =>
    posMap[Math.min(Math.max(0, idx), text.length)];

  return { cleanText, ranges, mapIndex };
}

interface CitationRange {
  startIndex: number;
  endIndex: number;
  sources: Array<{ uri: string; title: string }>;
}

/** Resolve groundingSupports entries into citation ranges with sources. */
function getCitations(response: GeminiResponse): CitationRange[] {
  const supports = response.groundingMetadata?.groundingSupports ?? [];
  const chunks = response.groundingMetadata?.groundingChunks ?? [];
  return supports.map((s: GeminiGroundingSupport) => ({
    startIndex: s.segment.startIndex,
    endIndex: s.segment.endIndex,
    sources: s.groundingChunkIndices
      .map((i) => {
        const chunk = chunks[i];
        return chunk?.web ?? chunk?.retrievedContext ?? null;
      })
      .filter((src): src is { uri: string; title: string } => src !== null),
  }));
}

/** Return all grounding sources as a flat { uri, title } array. */
function getAllSources(response: GeminiResponse): Array<{ uri: string; title: string }> {
  return (response.groundingMetadata?.groundingChunks ?? [])
    .map((chunk) => chunk.web ?? chunk.retrievedContext ?? null)
    .filter((src): src is { uri: string; title: string } => src !== null);
}

// ---- Public builders ----

/**
 * Build a CellContent for the AI inference output column.
 * Strips markdown, applies bold/italic ranges, and hyperlinks cited text
 * to the first source URI for each support segment.
 */
export function buildInferenceCellContent(response: GeminiResponse): CellContent {
  const { cleanText, ranges: mdRanges, mapIndex } = parseMarkdown(response.text);

  // Sort citations and merge overlapping ranges (Gemini can return overlapping supports).
  const citations = getCitations(response).sort((a, b) => a.startIndex - b.startIndex);
  const merged: Array<{ startIndex: number; endIndex: number; url: string }> = [];
  for (const { startIndex, endIndex, sources } of citations) {
    if (!sources[0]) continue;
    const cleanStart = mapIndex(startIndex);
    const cleanEnd = mapIndex(endIndex);
    if (cleanStart >= cleanEnd) continue;
    const last = merged[merged.length - 1];
    if (last && cleanStart < last.endIndex) {
      last.endIndex = Math.max(last.endIndex, cleanEnd);
    } else {
      merged.push({ startIndex: cleanStart, endIndex: cleanEnd, url: sources[0].uri });
    }
  }

  const citationRanges: TextRange[] = merged.map(({ startIndex, endIndex, url }) => ({
    startIndex,
    endIndex,
    url,
  }));

  return { text: cleanText, ranges: [...mdRanges, ...citationRanges] };
}

/**
 * Build a CellContent for the grounding metadata column.
 * Returns null when there is no grounding data to show (caller should skip the cell).
 *
 * Sections:
 * - Code execution: plain-text code/output pairs (no markdown fences)
 * - OR: Search queries (hyperlinked to Google Search) + Sources (hyperlinked titles)
 */
export function buildGroundingCellContent(response: GeminiResponse): CellContent | null {
  const sources = getAllSources(response);
  const queries = response.groundingMetadata?.webSearchQueries ?? [];
  const codePairs = response.codePairs ?? [];

  if (!sources.length && !queries.length && !codePairs.length) {
    return null;
  }

  const sections: string[] = [];

  if (codePairs.length > 0) {
    // Plain-text format — markdown fences render literally in Sheets cells.
    codePairs.forEach(({ code, result }) => {
      const lang = code.language ? `(${code.language.toLowerCase()})` : "";
      sections.push(`Code ${lang}:\n${code.code}\n\nOutput:\n${result.output}`);
    });
    return { text: sections.join("\n\n"), ranges: [] };
  }

  if (queries.length) {
    sections.push(`Search queries: ${queries.map((q) => `"${q}"`).join(", ")}`);
  }
  if (sources.length) {
    sections.push(
      `Sources (${sources.length}):\n${sources.map((s) => `• ${s.title}`).join("\n")}`,
    );
  }

  const fullText = sections.join("\n\n");
  const ranges: TextRange[] = [];

  // Hyperlink each quoted query to a Google Search.
  if (queries.length) {
    const queriesHeader = "Search queries: ";
    const queriesSectionStart = fullText.indexOf(queriesHeader);
    if (queriesSectionStart >= 0) {
      queries.forEach((q) => {
        const quoted = `"${q}"`;
        const idx = fullText.indexOf(quoted, queriesSectionStart);
        if (idx !== -1) {
          const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
          ranges.push({ startIndex: idx, endIndex: idx + quoted.length, url });
        }
      });
    }
  }

  // Hyperlink source titles within the Sources section only.
  if (sources.length) {
    const sourcesHeader = `Sources (${sources.length}):`;
    const sourceSectionStart = fullText.indexOf(sourcesHeader);
    const sourceSectionEnd =
      sourceSectionStart >= 0
        ? (() => {
            const next = fullText.indexOf("\n\n", sourceSectionStart + sourcesHeader.length);
            return next !== -1 ? next : fullText.length;
          })()
        : -1;

    if (sourceSectionStart >= 0) {
      sources.forEach(({ uri, title }) => {
        const bullet = `• ${title}`;
        const idx = fullText.indexOf(bullet, sourceSectionStart);
        if (idx !== -1 && idx < sourceSectionEnd) {
          ranges.push({ startIndex: idx + 2, endIndex: idx + 2 + title.length, url: uri });
        }
      });
    }
  }

  return { text: fullText, ranges };
}
```

### Step 4: Run tests

```bash
npx jest __tests__/rich-text.test.ts
```

Expected: all tests pass.

### Step 5: Run full test suite

```bash
npm test
```

Expected: all pass.

### Step 6: Typecheck

```bash
npm run typecheck
```

Expected: passes.

### Step 7: Commit

```bash
git add src/server/rich-text.ts __tests__/rich-text.test.ts
git commit -m "feat: add rich-text.ts — pure CellContent/TextRange builders for inference and grounding cells"
```

---

## Task 3: Strip `api.ts` to HTTP adapter — move `getCitations`/`getAllSources` tests to `rich-text.test.ts`

**Files:**
- Modify: `src/server/api.ts`
- Modify: `__tests__/api.test.ts`

`getCitations` and `getAllSources` are now private in `rich-text.ts`. Remove them from `api.ts` and their tests from `api.test.ts`. The `Citation` type becomes an internal detail of `rich-text.ts`.

**Note:** `rich-text.test.ts` already tests `getCitations`/`getAllSources` indirectly through `buildInferenceCellContent` and `buildGroundingCellContent`. No new tests needed here.

### Step 1: Remove from `src/server/api.ts`

Delete:
- `Citation` interface (lines ~25-29)
- `getCitations` function and its JSDoc (lines ~203-220)
- `getAllSources` function and its JSDoc (lines ~192-201)
- `GeminiGroundingSupport` import (it is no longer used in api.ts after removing `getCitations`)

After removal, `api.ts` exports only: `buildGeminiPayload`, `callGeminiAPI`, `invokeGemini`.

### Step 2: Remove from `__tests__/api.test.ts`

**a)** Remove `getCitations` and `getAllSources` from the import line.

**b)** Delete the entire `describe("getCitations", ...)` block.

**c)** Delete the entire `describe("getAllSources", ...)` block.

### Step 3: Run tests

```bash
npm test
```

Expected: all pass.

### Step 4: Typecheck

```bash
npm run typecheck
```

Expected: passes.

### Step 5: Commit

```bash
git add src/server/api.ts __tests__/api.test.ts
git commit -m "refactor: strip api.ts to pure HTTP adapter — getCitations/getAllSources moved to rich-text.ts"
```

---

## Task 4: Update `index.ts` — `toCellValue` wrapper + wire `runBatchAI` to `rich-text.ts`

**Files:**
- Modify: `src/server/index.ts`

No new tests — `index.ts` is excluded from coverage. Verified by typecheck + build.

### Step 1: Update imports

**a)** Replace the `api.ts` grounding import:
```typescript
// REMOVE:
import { getCitations, getAllSources } from "./api";  // (whatever remains after Task 3)

// ADD:
import { buildInferenceCellContent, buildGroundingCellContent } from "./rich-text";
```

The `runInference` import from `./inference` stays as-is.

### Step 2: Replace `renderInference` and `renderGrounding` with `toCellValue`

Delete both `renderInference` and `renderGrounding` functions entirely. Add `toCellValue` in their place:

```typescript
/**
 * Convert a pure CellContent descriptor into a GAS RichTextValue.
 * Each TextRange may carry url (setLinkUrl) and/or bold/italic (setTextStyle) — both are applied.
 */
function toCellValue(content: import("./rich-text").CellContent): GoogleAppsScript.Spreadsheet.RichTextValue {
  const builder = SpreadsheetApp.newRichTextValue().setText(content.text);
  content.ranges.forEach(({ startIndex, endIndex, bold, italic, url }) => {
    if (bold || italic) {
      const style = SpreadsheetApp.newTextStyle();
      if (bold) style.setBold(true);
      if (italic) style.setItalic(true);
      builder.setTextStyle(startIndex, endIndex, style.build());
    }
    if (url) builder.setLinkUrl(startIndex, endIndex, url);
  });
  return builder.build();
}
```

**Note on the import:** add `CellContent` to the `rich-text` import line at the top of the file:
```typescript
import { buildInferenceCellContent, buildGroundingCellContent, type CellContent } from "./rich-text";
```

Then use `CellContent` as the parameter type:
```typescript
function toCellValue(content: CellContent): GoogleAppsScript.Spreadsheet.RichTextValue {
```

### Step 3: Update `runBatchAI` to use `buildInferenceCellContent`/`buildGroundingCellContent`/`toCellValue`

In the per-row try/catch block (lines ~422-434), replace:
```typescript
// BEFORE:
sheet.getRange(realRowIndex, outputIdx + 1).setRichTextValue(renderInference(result));
if (config.includeGrounding && groundingIdx >= 0) {
  const groundingValue = renderGrounding(result);
  if (groundingValue !== null) {
    sheet.getRange(realRowIndex, groundingIdx + 1).setRichTextValue(groundingValue);
  }
}
```

With:
```typescript
// AFTER:
sheet.getRange(realRowIndex, outputIdx + 1).setRichTextValue(toCellValue(buildInferenceCellContent(result)));

if (config.includeGrounding && groundingIdx >= 0) {
  const groundingContent = buildGroundingCellContent(result);
  if (groundingContent !== null) {
    sheet.getRange(realRowIndex, groundingIdx + 1).setRichTextValue(toCellValue(groundingContent));
  }
}
```

The fallback in the catch block stays as-is:
```typescript
} catch (_e) {
  sheet.getRange(realRowIndex, outputIdx + 1).setValue(result.text);
}
```

### Step 4: Typecheck

```bash
npm run typecheck
```

Expected: passes.

### Step 5: Build

```bash
npm run build
```

Expected: clean build, no warnings.

### Step 6: Run full test suite

```bash
npm test
```

Expected: all pass.

### Step 7: Commit

```bash
git add src/server/index.ts
git commit -m "refactor: replace renderInference/renderGrounding with toCellValue(buildInferenceCellContent/buildGroundingCellContent)"
```

---

## Task 5: Grounding checkbox UX — move into Tools group, conditional visibility

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Modify: `src/client/sidebar.css`
- Modify: `__tests__/panels/configure-ai-run.test.ts`

### Step 1: Write failing tests

Read `__tests__/panels/configure-ai-run.test.ts` first to understand `mountAndLoad`, `applyPreset`, and the existing 6 tests in the `"includeGrounding checkbox"` describe block.

Add these tests after the existing 6 in that describe block:

```typescript
it("hides the grounding group when no tools are selected", async () => {
  const { container } = await mountAndLoad();
  const group = container.querySelector<HTMLElement>("#include-grounding-group");
  expect(group?.style.display).toBe("none");
});

it("shows the grounding group when a tool is selected", async () => {
  const { container } = await mountAndLoad();
  container.querySelector<HTMLElement>("#tools-list .tag")?.click();
  const group = container.querySelector<HTMLElement>("#include-grounding-group");
  expect(group?.style.display).toBe("block");
});

it("shows the grounding group on mount when tools are pre-selected in savedState", async () => {
  const { container } = await mountAndLoad(undefined, {
    userPromptCols: ["col_a"],
    driveFileCols: [],
    systemPromptCol: "",
    outputCol: "ai_inference",
    tools: ["google_search"],
    includeGrounding: false,
  });
  const group = container.querySelector<HTMLElement>("#include-grounding-group");
  expect(group?.style.display).toBe("block");
});

it("hides the grounding group again when all tools are deselected", async () => {
  const { container } = await mountAndLoad();
  const tag = container.querySelector<HTMLElement>("#tools-list .tag")!;
  tag.click(); // select
  tag.click(); // deselect
  const group = container.querySelector<HTMLElement>("#include-grounding-group");
  expect(group?.style.display).toBe("none");
});
```

Also update the existing `"restores includeGrounding from savedState"` test to include a tool (so the group is visible when restoring):

```typescript
it("restores includeGrounding from savedState", async () => {
  const { container } = await mountAndLoad(undefined, {
    userPromptCols: ["col_a"],
    driveFileCols: [],
    systemPromptCol: "",
    outputCol: "ai_inference",
    tools: ["google_search"],   // ← add this
    includeGrounding: true,
  });
  const cb = container.querySelector<HTMLInputElement>("#include-grounding-cb")!;
  expect(cb.checked).toBe(true);
});
```

### Step 2: Run to confirm failures

```bash
npx jest __tests__/panels/configure-ai-run.test.ts -t "includeGrounding"
```

Expected: 4 new tests FAIL (`#include-grounding-group` not found or always visible).

### Step 3: Update `template()` in `configure-ai-run.ts`

Move the checkbox inside the Tools field-group. Replace:

```html
<!-- REMOVE: -->
<div class="field-group">
  <span class="field-label">Tools <span class="optional">(optional)</span></span>
  <div id="tools-list" class="tag-list"></div>
</div>
<div class="field-group">
  <label class="checkbox-label">
    <input type="checkbox" id="include-grounding-cb" />
    Include sources column (<span id="grounding-col-name">_grounding</span>)
  </label>
</div>
```

With:

```html
<!-- REPLACE with: -->
<div class="field-group">
  <span class="field-label">Tools <span class="optional">(optional)</span></span>
  <div id="tools-list" class="tag-list"></div>
  <div id="include-grounding-group" style="display:none">
    <label class="grounding-hint">
      <input type="checkbox" id="include-grounding-cb" />
      Include sources column (<span id="grounding-col-name">_grounding</span>)
    </label>
  </div>
</div>
```

### Step 4: Move checkbox initialization to synchronous scope in `mount()`

The checkbox is now outside the async headers callback — initialize it synchronously alongside `this.toolsList`.

**a)** Delete the `this.includeGroundingCb` initialization block from inside `getSheetHeaders().then()` (the lines that read the `#include-grounding-cb` element and set `checked`).

**b)** After the `this.toolsList = new TagList(...)` block, add:

```typescript
this.includeGroundingCb =
  container.querySelector<HTMLInputElement>("#include-grounding-cb");
if (this.includeGroundingCb && preset.includeGrounding) {
  this.includeGroundingCb.checked = true;
}

const updateGroundingVisibility = (): void => {
  const group = container.querySelector<HTMLElement>("#include-grounding-group");
  if (group) {
    group.style.display = (this.toolsList?.getValue().length ?? 0) > 0 ? "block" : "none";
  }
};
updateGroundingVisibility();
container.querySelector("#tools-list")?.addEventListener("click", updateGroundingVisibility);
```

**c)** Keep `updateGroundingLabel` in the async `getSheetHeaders().then()` callback — it depends on `this.outputColList` which is initialized there.

### Step 5: Add `.grounding-hint` CSS to `src/client/sidebar.css`

Add after the `.field-group` rule (read the file first to find the right location):

```css
.grounding-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 8px;
    cursor: pointer;
}
```

### Step 6: Run tests

```bash
npx jest __tests__/panels/configure-ai-run.test.ts
```

Expected: all pass.

### Step 7: Typecheck

```bash
npm run typecheck
```

Expected: passes.

### Step 8: Run full suite

```bash
npm test
```

Expected: all pass.

### Step 9: Commit

```bash
git add src/client/panels/configure-ai-run.ts src/client/sidebar.css __tests__/panels/configure-ai-run.test.ts
git commit -m "feat: move grounding checkbox into Tools section with conditional visibility"
```

---

## Task 6: Full verification

### Step 1: Coverage

```bash
npm run test:coverage
```

Expected: all pass, per-file thresholds met.

**Note:** `src/server/rich-text.ts` is a new file. Check if the per-file coverage threshold in `jest.config.cjs` needs a new entry for it. If coverage is already above threshold from the tests written in Task 2, no change needed. If the threshold file has explicit per-file overrides, add `rich-text.ts` there.

### Step 2: Build

```bash
npm run build
```

Expected: clean build, no warnings.

### Step 3: Lint and format check

```bash
npm run lint && npm run format:check
```

Expected: no issues. If lint flags explicit return types on the new functions, add them. If Prettier flags formatting in `rich-text.ts`, run `npm run format` then re-check.

### Step 4: Typecheck

```bash
npm run typecheck
```

Expected: passes.
