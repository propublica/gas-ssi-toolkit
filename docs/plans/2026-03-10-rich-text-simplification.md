# Rich Text Simplification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite `rich-text.ts` to eliminate the `posMap`/`mapIndex` mechanism by pre-processing citation spans as `[text](url)` markdown syntax before parsing, then letting a simplified unified markdown parser handle everything.

**Architecture:** Citations from Gemini's `groundingSupports` are injected directly into the raw response text as `[text](url)` markdown links (right-to-left to avoid index shifting), skipping any citation that overlaps an existing model-generated `[text](url)` link. `parseMarkdown` is then simplified to track clean-text positions as it goes — no position remapping needed. `processInline` becomes a pure function returning `{ text, ranges }` rather than mutating shared state.

**Tech Stack:** TypeScript, Jest, `src/server/rich-text.ts`, `__tests__/rich-text.test.ts`

---

## Background: What Changes and Why

**Current implementation:**
- `parseMarkdown` maintains a `posMap: number[]` array (one entry per character of the original markdown text) that maps every original index to a clean-text index after syntax stripping.
- `buildInferenceCellContent` calls `parseMarkdown`, then calls `getCitations`, and uses `mapIndex` to remap each citation's `startIndex`/`endIndex` from original-text space into clean-text space.
- This is needed because Gemini's `groundingSupports` gives character offsets into the raw markdown string — after stripping `**bold**` → `bold`, every subsequent index shifts.

**New approach:**
1. Extract and merge citation ranges from `groundingMetadata` (in original text space).
2. Detect existing `[text](url)` patterns in the raw text.
3. Inject each non-overlapping citation as `[citedText](url)` into the raw text (right-to-left).
4. Run the simplified `parseMarkdown` on the pre-processed text. Citations are now just `[text](url)` links — the parser handles them uniformly with bold, italic, and headings.

**What gets deleted:** `posMap`, `mapIndex`, `ParsedMarkdown` interface, the mutation-heavy signature of `processInline`.

**Key behavior change:** When a citation span overlaps an existing model-generated `[text](url)` link, the citation is silently skipped (a range can only carry one URL in Sheets). One existing test covers this scenario and must be updated to reflect the new behavior.

---

## Task 1: Update the citation-overlaps-link test

The test "citation remapping still works when inline links are present" (line 351 of `__tests__/rich-text.test.ts`) currently asserts that BOTH the inline link AND the citation coexist. Under the new approach, the citation is skipped when it overlaps the existing link. Update the test to verify the new behavior.

**Files:**
- Modify: `__tests__/rich-text.test.ts:351-376`

**Step 1: Read the test to understand the current assertions**

Open `__tests__/rich-text.test.ts` at line 351.

**Step 2: Replace the test with new behavior assertion**

Find and replace the entire test block (currently titled "citation remapping still works when inline links are present") with:

```ts
it("skips citation injection when the span overlaps an existing [text](url) link", () => {
  // The entire model-generated link "[the docs](...)" spans chars 0-36.
  // The grounding citation also targets chars 0-36 — direct overlap.
  // Option A: skip the citation rather than produce nested/malformed markup.
  const response = makeResponse({
    text: "[the docs](https://example.com/docs) is good",
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://citation.com", title: "Citation" } }],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 36, text: "[the docs](https://example.com/docs)" },
          groundingChunkIndices: [0],
        },
      ],
      webSearchQueries: [],
    },
  });
  const result = buildInferenceCellContent(response);
  // The inline link is preserved.
  const inlineLink = result.ranges.find((r) => r.url === "https://example.com/docs");
  expect(inlineLink).toBeDefined();
  // The citation is skipped — only one URL range present.
  const citation = result.ranges.find((r) => r.url === "https://citation.com");
  expect(citation).toBeUndefined();
  expect(result.ranges.filter((r) => r.url)).toHaveLength(1);
});
```

**Step 3: Run the test suite to confirm this test now FAILS (old implementation doesn't skip)**

```bash
npx jest __tests__/rich-text.test.ts -t "skips citation injection"
```

Expected: FAIL — old code does not skip the citation.

**Step 4: Commit**

```bash
git add __tests__/rich-text.test.ts
git commit -m "test: update citation-overlaps-link test to reflect new skip behavior"
```

---

## Task 2: Write tests for the new private helpers

Add unit tests that directly exercise the three new helpers (`findExistingLinkSpans`, `mergeCitations`, `injectCitationLinks`) by testing them through `buildInferenceCellContent`. These tests describe the new behavior concretely and will fail until the implementation is rewritten.

**Files:**
- Modify: `__tests__/rich-text.test.ts`

**Step 1: Add a new describe block for injection behavior**

Append the following block to the end of `__tests__/rich-text.test.ts`:

```ts
// ============================================================
// Citation injection (pre-processing step)
// ============================================================

describe("buildInferenceCellContent — citation injection", () => {
  it("injects a citation as a url range when there is no existing link overlap", () => {
    // Citation covers "Paris" (0..5). No existing [text](url) in raw text.
    // Injection: "[Paris](url) is the capital."
    // After parsing: text="Paris is the capital.", ranges=[{0,5,url}]
    const response = makeResponse({
      text: "Paris is the capital.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Paris" } }],
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 5, text: "Paris" }, groundingChunkIndices: [0] },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    const link = result.ranges.find((r) => r.url === "https://example.com");
    expect(link).toBeDefined();
    expect(link!.startIndex).toBe(0);
    expect(link!.endIndex).toBe(5);
  });

  it("citation spanning bold markdown maps to the correct clean-text range", () => {
    // Text: "The **sky** is blue." — citation at 0..15 covers "The **sky** is "
    // Injection: "[The **sky** is ](url) blue."
    // After parsing: text="The sky is blue.", citation range 0..11, bold range 4..7
    const response = makeResponse({
      text: "The **sky** is blue.",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 15, text: "The **sky** is" },
            groundingChunkIndices: [0],
          },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    expect(result.text).toBe("The sky is blue.");
    const link = result.ranges.find((r) => r.url === "https://example.com");
    expect(link).toBeDefined();
    expect(link!.startIndex).toBe(0);
    expect(link!.endIndex).toBe(11); // "The sky is " = 11 chars
    const bold = result.ranges.find((r) => r.bold);
    expect(bold).toEqual({ startIndex: 4, endIndex: 7, bold: true });
  });

  it("merges overlapping citations before injection", () => {
    // Two overlapping citations (0..8) and (5..12) merge into (0..12).
    const response = makeResponse({
      text: "Hello world.",
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "A" } },
          { web: { uri: "https://b.com", title: "B" } },
        ],
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 8, text: "Hello wo" }, groundingChunkIndices: [0] },
          { segment: { startIndex: 5, endIndex: 12, text: "world." }, groundingChunkIndices: [1] },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    const links = result.ranges.filter((r) => r.url);
    expect(links).toHaveLength(1);
    expect(links[0].startIndex).toBe(0);
    expect(links[0].endIndex).toBe(12);
    expect(links[0].url).toBe("https://a.com"); // first URI wins
  });

  it("handles non-overlapping citation adjacent to an existing link", () => {
    // Existing link: chars 0..36 "[the docs](https://example.com/docs)"
    // Citation: chars 37..44 " is good" — does NOT overlap the existing link
    const response = makeResponse({
      text: "[the docs](https://example.com/docs) is good",
      groundingMetadata: {
        groundingChunks: [{ web: { uri: "https://citation.com", title: "Citation" } }],
        groundingSupports: [
          {
            segment: { startIndex: 37, endIndex: 44, text: "is good" },
            groundingChunkIndices: [0],
          },
        ],
        webSearchQueries: [],
      },
    });
    const result = buildInferenceCellContent(response);
    // Both the inline link and the adjacent citation should be present.
    const inlineLink = result.ranges.find((r) => r.url === "https://example.com/docs");
    const citation = result.ranges.find((r) => r.url === "https://citation.com");
    expect(inlineLink).toBeDefined();
    expect(citation).toBeDefined();
  });
});
```

**Step 2: Run new tests to confirm they fail**

```bash
npx jest __tests__/rich-text.test.ts -t "citation injection"
```

Expected: some FAIL — the new `injectCitationLinks` logic doesn't exist yet.

**Step 3: Commit**

```bash
git add __tests__/rich-text.test.ts
git commit -m "test: add citation injection behavior tests before rewrite"
```

---

## Task 3: Rewrite `rich-text.ts`

Replace the entire contents of `src/server/rich-text.ts` with the simplified implementation. The public API (`CellContent`, `TextRange`, `buildInferenceCellContent`, `buildGroundingCellContent`) is unchanged — only the internals change.

**Files:**
- Modify: `src/server/rich-text.ts`

**Step 1: Read the current file in full**

Open `src/server/rich-text.ts` — you will replace it entirely.

**Step 2: Write the new implementation**

Replace the entire file with:

```ts
/**
 * rich-text.ts — Pure TypeScript layer between GeminiResponse and Sheets cell content.
 *
 * Exports CellContent and TextRange interfaces + two builder functions.
 * All helpers are private. No GAS globals — fully testable with Jest.
 *
 * GAS rendering (toCellValue) lives in index.ts which is excluded from coverage.
 *
 * Citation approach: Gemini groundingSupports are pre-processed into [text](url)
 * markdown syntax before parsing. This lets the unified markdown parser handle
 * all formatting (bold, italic, headings, links, citations) in a single pass
 * without index remapping.
 */

import type { GeminiResponse, GeminiGroundingSupport } from "./types";

// ---- Public interfaces ----

/** A character range within a CellContent's text that carries link and/or style info. */
export interface TextRange {
  startIndex: number; // inclusive
  endIndex: number; // exclusive
  bold?: boolean;
  italic?: boolean;
  url?: string;
}

/** Everything needed to construct a Sheets RichTextValue for one cell. */
export interface CellContent {
  text: string;
  ranges: TextRange[];
}

// ---- Private types ----

interface CitationRange {
  startIndex: number;
  endIndex: number;
  sources: Array<{ uri: string; title: string }>;
}

// ---- Private helpers ----

/**
 * Process inline markdown patterns (**bold**, *italic*, [text](url)) within a
 * segment of text. `offset` is the absolute position in the overall clean text
 * where this segment begins — used so returned range indices are absolute.
 *
 * Returns the clean text with syntax stripped and ranges at absolute positions.
 */
function processInline(segment: string, offset: number): { text: string; ranges: TextRange[] } {
  const ranges: TextRange[] = [];
  const parts: string[] = [];
  let cleanLen = offset;
  let i = 0;

  while (i < segment.length) {
    // [text](url) — inline link (also used for injected citation links)
    if (segment[i] === "[") {
      const closeBracket = segment.indexOf("]", i + 1);
      if (closeBracket > i && segment[closeBracket + 1] === "(") {
        // Use lastIndexOf to handle URLs containing literal parentheses.
        // Don't search past the next '[' to avoid consuming subsequent links.
        const nextBracket = segment.indexOf("[", closeBracket + 2);
        const searchEnd = nextBracket === -1 ? segment.length - 1 : nextBracket - 1;
        const closeParen = segment.lastIndexOf(")", searchEnd);
        if (closeParen > closeBracket + 1) {
          const linkText = segment.slice(i + 1, closeBracket);
          const url = segment.slice(closeBracket + 2, closeParen);
          const spanStart = cleanLen;
          // Recursively process link text to handle bold/italic inside links.
          const inner = processInline(linkText, cleanLen);
          parts.push(inner.text);
          cleanLen += inner.text.length;
          ranges.push(...inner.ranges);
          if (cleanLen > spanStart) {
            ranges.push({ startIndex: spanStart, endIndex: cleanLen, url });
          }
          i = closeParen + 1;
          continue;
        }
      }
    }

    // **bold** — must check before single *
    if (segment[i] === "*" && segment[i + 1] === "*") {
      const closeIdx = segment.indexOf("**", i + 2);
      if (closeIdx > i + 2) {
        const spanStart = cleanLen;
        const content = segment.slice(i + 2, closeIdx);
        parts.push(content);
        cleanLen += content.length;
        ranges.push({ startIndex: spanStart, endIndex: cleanLen, bold: true });
        i = closeIdx + 2;
        continue;
      }
    }

    // *italic* — single * with matching closing *
    if (segment[i] === "*" && segment[i + 1] !== "*") {
      const closeIdx = segment.indexOf("*", i + 1);
      if (closeIdx > i + 1 && segment[closeIdx + 1] !== "*") {
        const spanStart = cleanLen;
        const content = segment.slice(i + 1, closeIdx);
        parts.push(content);
        cleanLen += content.length;
        ranges.push({ startIndex: spanStart, endIndex: cleanLen, italic: true });
        i = closeIdx + 1;
        continue;
      }
    }

    // Plain character
    parts.push(segment[i]);
    cleanLen++;
    i++;
  }

  return { text: parts.join(""), ranges };
}

/**
 * Parse markdown text into CellContent. Handles headings, bullets, bold, italic,
 * and [text](url) links. No position remapping — tracks clean-text position directly.
 */
function parseMarkdown(text: string): CellContent {
  const ranges: TextRange[] = [];
  const cleanParts: string[] = [];
  let cleanLen = 0;

  const lines = text.split("\n");
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let content = line;
    let isHeading = false;

    // Structural prefix: heading (# Title → bold)
    const headingMatch = line.match(/^(#{1,6}) /);
    if (headingMatch) {
      content = line.slice(headingMatch[1].length + 1);
      isHeading = true;
    }
    // Structural prefix: bullet (* item or - item → • item)
    else if (/^\* /.test(line) || /^- /.test(line)) {
      cleanParts.push("• ");
      cleanLen += 2;
      content = line.slice(2);
    }

    const spanStart = cleanLen;
    const { text: inlineText, ranges: inlineRanges } = processInline(content, cleanLen);
    cleanParts.push(inlineText);
    cleanLen += inlineText.length;
    ranges.push(...inlineRanges);

    if (isHeading) {
      ranges.push({ startIndex: spanStart, endIndex: cleanLen, bold: true });
    }

    if (lineIdx < lines.length - 1) {
      cleanParts.push("\n");
      cleanLen++;
    }
  }

  return { text: cleanParts.join(""), ranges };
}

/** Extract citation ranges from groundingMetadata. Normalises absent startIndex to 0. */
function getCitations(response: GeminiResponse): CitationRange[] {
  const supports = response.groundingMetadata?.groundingSupports ?? [];
  const chunks = response.groundingMetadata?.groundingChunks ?? [];
  return supports.map((s: GeminiGroundingSupport) => ({
    startIndex: s.segment.startIndex ?? 0,
    endIndex: s.segment.endIndex,
    sources: s.groundingChunkIndices
      .map((idx) => {
        const chunk = chunks[idx];
        return chunk?.web ?? chunk?.retrievedContext ?? null;
      })
      .filter((src): src is { uri: string; title: string } => src !== null),
  }));
}

/** Merge overlapping citation ranges (sorted by startIndex). Keeps first URI per merged span. */
function mergeCitations(
  sorted: CitationRange[],
): Array<{ startIndex: number; endIndex: number; url: string }> {
  const merged: Array<{ startIndex: number; endIndex: number; url: string }> = [];
  for (const { startIndex, endIndex, sources } of sorted) {
    if (!sources[0]) continue;
    const last = merged[merged.length - 1];
    if (last && startIndex < last.endIndex) {
      last.endIndex = Math.max(last.endIndex, endIndex);
    } else {
      merged.push({ startIndex, endIndex, url: sources[0].uri });
    }
  }
  return merged;
}

/** Return the character spans of all [text](url) patterns in raw text. */
function findExistingLinkSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const linkRegex = /\[([^\]]*)\]\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/**
 * Inject citation spans as [text](url) into raw text.
 * Citations are processed right-to-left to avoid index shifting.
 * Any citation that overlaps an existing [text](url) span is silently skipped —
 * a Sheets range can only carry one URL, and the model-generated link takes precedence.
 */
function injectCitationLinks(
  text: string,
  citations: Array<{ startIndex: number; endIndex: number; url: string }>,
  existingLinkSpans: Array<{ start: number; end: number }>,
): string {
  let result = text;
  for (let i = citations.length - 1; i >= 0; i--) {
    const { startIndex, endIndex, url } = citations[i];
    const overlaps = existingLinkSpans.some(
      (span) => startIndex < span.end && endIndex > span.start,
    );
    if (overlaps) continue;
    const spanText = result.slice(startIndex, endIndex);
    result = result.slice(0, startIndex) + `[${spanText}](${url})` + result.slice(endIndex);
  }
  return result;
}

function getAllSources(response: GeminiResponse): Array<{ uri: string; title: string }> {
  return (response.groundingMetadata?.groundingChunks ?? [])
    .map((chunk) => chunk.web ?? chunk.retrievedContext ?? null)
    .filter((src): src is { uri: string; title: string } => src !== null);
}

// ---- Public builders ----

export function buildInferenceCellContent(response: GeminiResponse): CellContent {
  const citations = getCitations(response).sort((a, b) => a.startIndex - b.startIndex);
  const merged = mergeCitations(citations);

  if (merged.length === 0) {
    return parseMarkdown(response.text);
  }

  const existingLinkSpans = findExistingLinkSpans(response.text);
  const preprocessed = injectCitationLinks(response.text, merged, existingLinkSpans);
  return parseMarkdown(preprocessed);
}

export function buildGroundingCellContent(response: GeminiResponse): CellContent | null {
  const sources = getAllSources(response);
  const queries = response.groundingMetadata?.webSearchQueries ?? [];
  const codePairs = response.codePairs ?? [];

  if (!sources.length && !queries.length && !codePairs.length) {
    return null;
  }

  const sections: string[] = [];

  if (codePairs.length > 0) {
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
      `Sources (${sources.length}):\n${sources.map((s) => `\u2022 ${s.title}`).join("\n")}`,
    );
  }

  const fullText = sections.join("\n\n");
  const ranges: TextRange[] = [];

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

  if (sources.length) {
    const sourcesHeader = `Sources (${sources.length}):`;
    const sourceSectionStart = fullText.indexOf(sourcesHeader);
    const sourceSectionEnd =
      sourceSectionStart >= 0
        ? ((): number => {
            const next = fullText.indexOf("\n\n", sourceSectionStart + sourcesHeader.length);
            return next !== -1 ? next : fullText.length;
          })()
        : -1;

    if (sourceSectionStart >= 0) {
      let searchFrom = sourceSectionStart;
      sources.forEach(({ uri, title }) => {
        const bullet = `\u2022 ${title}`;
        const idx = fullText.indexOf(bullet, searchFrom);
        if (idx !== -1 && idx < sourceSectionEnd) {
          ranges.push({ startIndex: idx + 2, endIndex: idx + 2 + title.length, url: uri });
          searchFrom = idx + bullet.length;
        }
      });
    }
  }

  return { text: fullText, ranges };
}
```

**Step 3: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

**Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/server/rich-text.ts
git commit -m "refactor: rewrite rich-text.ts with citation pre-injection approach"
```

---

## Task 4: Run lint and final verification

**Step 1: Run lint**

```bash
npm run lint
```

Fix any issues, then re-run.

**Step 2: Run coverage to confirm thresholds still pass**

```bash
npm run test:coverage
```

Expected: coverage thresholds pass.

**Step 3: Commit any lint fixes**

If lint required changes:

```bash
git add src/server/rich-text.ts
git commit -m "fix: lint issues in rich-text.ts rewrite"
```

---

## What Was Removed

| Before | After |
|--------|-------|
| `ParsedMarkdown` interface with `mapIndex` fn | Deleted |
| `posMap: number[]` (one entry per raw char) | Deleted |
| `processInline` with 6 params + mutation | `processInline(segment, offset)` returns `{text, ranges}` |
| `mapIndex` calls to remap citation indices | Deleted — citations live in raw-text space until injection |
| Citation merging using `mapIndex` | Merging in raw-text space before injection |
| `getCitations` return values used for index remapping | Used directly for injection |
| ~50 lines of posMap bookkeeping | ~15 lines across `findExistingLinkSpans` + `injectCitationLinks` |
