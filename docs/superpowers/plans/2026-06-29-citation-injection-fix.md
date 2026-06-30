# Citation Injection Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `injectCitations` in `src/server/gemini-grounding.ts` so it always produces structurally valid markdown, eliminating three classes of rendering bugs seen in testing.

**Architecture:** Two targeted changes to `src/server/gemini-grounding.ts`: (1) fix `truncateToFirstBlock` to recognise when a citation starts on a heading or bullet line, and extend the injection loop to skip block-level prefix characters outside the link; (2) add a `snapToWordBoundaries` helper and integrate it into the injection loop so citations never start or end mid-word. `parseMarkdown` and `index.ts` are not touched.

**Tech Stack:** TypeScript, Jest/ts-jest. No new dependencies.

## Global Constraints

- All changes confined to `src/server/gemini-grounding.ts` and `__tests__/gemini-grounding.test.ts`.
- `parseMarkdown` (`src/server/markdown-to-rich-text.ts`) must not be modified.
- Run tests with `npx jest __tests__/gemini-grounding.test.ts --no-coverage` after each step; run `npm test` before committing.
- All 41 existing tests in `__tests__/gemini-grounding.test.ts` must continue to pass after each task.

---

### Task 1: Block-safe injection — truncation fix + prefix skip

Fix two coupled problems in one task so tests reflect the final expected output from the start:

1. `truncateToFirstBlock` runs off the end of a heading/bullet line into the next paragraph because it only checks lines after the first. A citation on `### Trade Deadline Looming\nBecause...` produces `[### Trade Deadline Looming\nBecause...](url)`.
2. Even when truncation works correctly, block-level prefix characters (`### `, `* `, `- `) end up inside the link. A citation on `### Managerial Search` produces `[### Managerial Search](url)`, making `###` visible literal text in the cell.

After this task a citation that starts on a heading or bullet line will produce e.g. `### [Managerial Search](url)` — prefix preserved outside the link, parser sees a normal heading.

**Files:**
- Modify: `src/server/gemini-grounding.ts:48-56` (`truncateToFirstBlock`)
- Modify: `src/server/gemini-grounding.ts:90-100` (injection loop body)
- Test: `__tests__/gemini-grounding.test.ts`

**Interfaces:**
- Consumes: nothing new — `injectCitations` signature unchanged
- Produces: `injectCitations` with correct behaviour for heading/bullet citations; Task 2 builds on this

- [ ] **Step 1: Write the two failing tests**

Add these inside the existing `describe("injectCitations", () => {` block in `__tests__/gemini-grounding.test.ts`:

```typescript
it("preserves heading prefix outside link and truncates before following paragraph", () => {
  const response = makeResponse({
    text: "### Trade Deadline Looming\nBecause the team is struggling heavily.",
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
      groundingSupports: [
        {
          segment: {
            startIndex: 0,
            endIndex: 50,
            text: "### Trade Deadline Looming\nBecause the team is st",
          },
          groundingChunkIndices: [0],
        },
      ],
    },
  });
  expect(injectCitations(response)).toBe(
    "### [Trade Deadline Looming](https://example.com)\nBecause the team is struggling heavily."
  );
});

it("preserves bullet prefix outside link and truncates before following paragraph", () => {
  const response = makeResponse({
    text: "* Candidates are being evaluated.\nMore details follow.",
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
      groundingSupports: [
        {
          segment: {
            startIndex: 0,
            endIndex: 48,
            text: "* Candidates are being evaluated.\nMore details f",
          },
          groundingChunkIndices: [0],
        },
      ],
    },
  });
  expect(injectCitations(response)).toBe(
    "* [Candidates are being evaluated.](https://example.com)\nMore details follow."
  );
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/gemini-grounding.test.ts --no-coverage
```

Expected: 2 new failures. Current output for the heading test will be something like `[### Trade Deadline Looming\nBecause the team is st](https://example.com)Because the team is struggling heavily.` — the truncation is wrong and the `###` is inside the link.

- [ ] **Step 3: Fix `truncateToFirstBlock`**

Replace lines 48-56 in `src/server/gemini-grounding.ts`:

```typescript
function truncateToFirstBlock(text: string): string {
  const lines = text.split("\n");
  // If the span starts on a heading or bullet line it must not cross into the next line.
  if (/^(#{1,6} |\* |- )/.test(lines[0])) {
    return lines[0];
  }
  for (let i = 1; i < lines.length; i++) {
    if (/^(\* |- |#{1,6} |$)/.test(lines[i])) {
      return lines.slice(0, i).join("\n");
    }
  }
  return text;
}
```

- [ ] **Step 4: Update the injection loop to skip block-level prefixes**

Replace lines 90-100 in `src/server/gemini-grounding.ts` (inside the `for` loop, after the `overlaps` check):

```typescript
    const rawSpan = truncateToFirstBlock(result.slice(startIndex, endIndex));
    const prefixMatch = rawSpan.match(/^(#{1,6} |\* |- )/);
    const prefixLength = prefixMatch ? prefixMatch[1].length : 0;
    const spanText = rawSpan.slice(prefixLength);
    if (!spanText) continue;
    result =
      result.slice(0, startIndex) +
      rawSpan.slice(0, prefixLength) +
      `[${spanText}](${url})` +
      result.slice(startIndex + rawSpan.length);
```

The full updated `injectCitations` body looks like:

```typescript
export function injectCitations(
  response: GeminiResponse,
  resolvedUris?: Map<string, string>,
): string {
  const citations = getCitations(response, resolvedUris).sort(
    (a, b) => a.startIndex - b.startIndex,
  );
  const merged = mergeCitations(citations);
  if (merged.length === 0) return response.text;
  const existingLinkSpans = findExistingLinkSpans(response.text);
  let result = response.text;
  // Reverse order preserves original indices — forward inserts would shift byte positions of earlier spans.
  for (let i = merged.length - 1; i >= 0; i--) {
    const { startIndex, endIndex, url } = merged[i];
    const overlaps = existingLinkSpans.some(
      (span) => startIndex < span.end && endIndex > span.start,
    );
    if (overlaps) continue;
    const rawSpan = truncateToFirstBlock(result.slice(startIndex, endIndex));
    const prefixMatch = rawSpan.match(/^(#{1,6} |\* |- )/);
    const prefixLength = prefixMatch ? prefixMatch[1].length : 0;
    const spanText = rawSpan.slice(prefixLength);
    if (!spanText) continue;
    result =
      result.slice(0, startIndex) +
      rawSpan.slice(0, prefixLength) +
      `[${spanText}](${url})` +
      result.slice(startIndex + rawSpan.length);
  }
  return result;
}
```

- [ ] **Step 5: Run the new tests**

```bash
npx jest __tests__/gemini-grounding.test.ts --no-coverage
```

Expected: all 43 tests pass (41 existing + 2 new).

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/gemini-grounding.ts __tests__/gemini-grounding.test.ts
git commit -m "$(cat <<'EOF'
fix: block-safe citation injection — truncate at heading/bullet line start, skip prefix chars

truncateToFirstBlock now returns early when the span starts on a heading
or bullet line, preventing citations from spanning into the following
paragraph. The injection loop strips block-level prefix characters
(### , * , - ) from the citation content so the parser always sees a
well-formed heading or bullet with an inline link.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Word-boundary snapping

Gemini's grounding character offsets are not always word-aligned. A `startIndex` that lands mid-word produces a link opening inside a word (`Ma[rcus Semien]`); an `endIndex` that lands mid-word produces a link closing inside a word (`[...Whil]e he gave up`). Both leave visible broken text in the rendered cell.

This task adds a `snapToWordBoundaries` helper and integrates it into the injection loop. The helper expands the content range outward: start snaps backward to the beginning of its containing word; end snaps forward to the end of its containing word. The unified reconstruction replaces the Task 1 reconstruction.

**Files:**
- Modify: `src/server/gemini-grounding.ts` (new helper + updated injection loop)
- Test: `__tests__/gemini-grounding.test.ts`

**Interfaces:**
- Consumes: `truncateToFirstBlock` (Task 1), prefix detection logic (Task 1)
- Produces: final `injectCitations` with all three fixes applied

- [ ] **Step 1: Write two failing tests**

Character positions verified: `"Injury: Marcus Semien is out."` → `I`=0 … ` `=7 `M`=8 `a`=9 `r`=10; `startIndex: 10` lands on `r` mid-word, snap back finds `M` at 8. `"Starting pitcher Clay Holmes. While he pitched well."` → `W`=30 `h`=31 `i`=32 `l`=33 `e`=34 ` `=35; `endIndex: 33` (exclusive, so last included char is `i` at 32) leaves `le` unlinked, snap forward to 35 includes full `While`.

Add inside the existing `describe("injectCitations", () => {` block in `__tests__/gemini-grounding.test.ts`:

```typescript
it("snaps startIndex backward to word boundary when citation begins mid-word", () => {
  const response = makeResponse({
    text: "Injury: Marcus Semien is out.",
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
      groundingSupports: [
        {
          segment: { startIndex: 10, endIndex: 29, text: "rcus Semien is out." },
          groundingChunkIndices: [0],
        },
      ],
    },
  });
  expect(injectCitations(response)).toBe(
    "Injury: [Marcus Semien is out.](https://example.com)"
  );
});

it("snaps endIndex forward to word boundary when citation ends mid-word", () => {
  const response = makeResponse({
    text: "Starting pitcher Clay Holmes. While he pitched well.",
    groundingMetadata: {
      groundingChunks: [{ web: { uri: "https://example.com", title: "Source" } }],
      groundingSupports: [
        {
          segment: { startIndex: 0, endIndex: 33, text: "Starting pitcher Clay Holmes. Whi" },
          groundingChunkIndices: [0],
        },
      ],
    },
  });
  expect(injectCitations(response)).toBe(
    "[Starting pitcher Clay Holmes. While](https://example.com) he pitched well."
  );
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx jest __tests__/gemini-grounding.test.ts --no-coverage
```

Expected: 2 new failures. The start-snap test will produce `"Injury: Ma[rcus Semien is out.](https://example.com)"` and the end-snap test will produce `"[Starting pitcher Clay Holmes. Whi](https://example.com)le he pitched well."`.

- [ ] **Step 3: Add `snapToWordBoundaries` helper**

Add this function to `src/server/gemini-grounding.ts` immediately after `truncateToFirstBlock` (before `findExistingLinkSpans`):

```typescript
function snapToWordBoundaries(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  let snappedStart = start;
  while (snappedStart > 0 && /\w/.test(text[snappedStart - 1])) {
    snappedStart--;
  }
  let snappedEnd = end;
  while (snappedEnd < text.length && /\w/.test(text[snappedEnd])) {
    snappedEnd++;
  }
  return { start: snappedStart, end: snappedEnd };
}
```

`\w` matches `[a-zA-Z0-9_]`. Spaces, punctuation, `*`, `#`, and `-` are not matched, so the scan stops at block-prefix boundaries and punctuation. The start scan cannot reach past a block prefix's trailing space.

- [ ] **Step 4: Update the injection loop to use `snapToWordBoundaries`**

Replace the injection loop body (after the `overlaps` check) in `injectCitations` with the following. This replaces the Task 1 reconstruction entirely:

```typescript
    const rawSpan = truncateToFirstBlock(result.slice(startIndex, endIndex));
    const prefixMatch = rawSpan.match(/^(#{1,6} |\* |- )/);
    const prefixLength = prefixMatch ? prefixMatch[1].length : 0;
    // Snap word boundaries on the content portion only (after block prefix).
    // snappedStart cannot reach past the prefix's trailing space since \w excludes it.
    const contentStart = startIndex + prefixLength;
    const rawContentEnd = startIndex + rawSpan.length;
    const { start: snappedStart, end: snappedEnd } = snapToWordBoundaries(
      result,
      contentStart,
      rawContentEnd,
    );
    const spanText = result.slice(snappedStart, snappedEnd);
    if (!spanText) continue;
    // result.slice(0, snappedStart) naturally preserves prefix chars when
    // snappedStart === contentStart (the common case with a block prefix).
    result =
      result.slice(0, snappedStart) +
      `[${spanText}](${url})` +
      result.slice(snappedEnd);
```

The full updated `injectCitations`:

```typescript
export function injectCitations(
  response: GeminiResponse,
  resolvedUris?: Map<string, string>,
): string {
  const citations = getCitations(response, resolvedUris).sort(
    (a, b) => a.startIndex - b.startIndex,
  );
  const merged = mergeCitations(citations);
  if (merged.length === 0) return response.text;
  const existingLinkSpans = findExistingLinkSpans(response.text);
  let result = response.text;
  // Reverse order preserves original indices — forward inserts would shift byte positions of earlier spans.
  for (let i = merged.length - 1; i >= 0; i--) {
    const { startIndex, endIndex, url } = merged[i];
    const overlaps = existingLinkSpans.some(
      (span) => startIndex < span.end && endIndex > span.start,
    );
    if (overlaps) continue;
    const rawSpan = truncateToFirstBlock(result.slice(startIndex, endIndex));
    const prefixMatch = rawSpan.match(/^(#{1,6} |\* |- )/);
    const prefixLength = prefixMatch ? prefixMatch[1].length : 0;
    const contentStart = startIndex + prefixLength;
    const rawContentEnd = startIndex + rawSpan.length;
    const { start: snappedStart, end: snappedEnd } = snapToWordBoundaries(
      result,
      contentStart,
      rawContentEnd,
    );
    const spanText = result.slice(snappedStart, snappedEnd);
    if (!spanText) continue;
    result =
      result.slice(0, snappedStart) +
      `[${spanText}](${url})` +
      result.slice(snappedEnd);
  }
  return result;
}
```

- [ ] **Step 5: Run the new tests**

```bash
npx jest __tests__/gemini-grounding.test.ts --no-coverage
```

Expected: all 45 tests pass (43 from Task 1 + 2 new).

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/gemini-grounding.ts __tests__/gemini-grounding.test.ts
git commit -m "$(cat <<'EOF'
fix: snap citation boundaries to word edges to prevent mid-word link splits

Adds snapToWordBoundaries helper that expands citation start backward and
end forward to the nearest word boundary. Integrates with the unified
injection loop reconstruction so block-prefix preservation and word-
boundary snapping compose cleanly.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
