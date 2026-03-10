# Markdown Parser Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the character-by-character `parseMarkdown` in `rich-text.ts` with a line-oriented regex approach that correctly handles bullet lists and inline `[text](url)` links while preserving the `posMap` citation-remapping system.

**Architecture:** `parseMarkdown` already sits behind a stable `ParsedMarkdown` interface — the rewrite swaps the implementation without touching the interface or its callers. A new private `processInline` helper handles all inline patterns within a single line (bold, italic, links), keeping the outer function responsible only for structural/line-level concerns (headings, bullets, newlines). The `posMap` array is built incrementally as characters are consumed or stripped, so grounding citation remapping continues to work unchanged.

**Tech Stack:** TypeScript, Jest (ts-jest). No new dependencies.

---

## Separation contract (the "easy to remove" escape hatch)

`parseMarkdown` is called in exactly one place: the top of `buildInferenceCellContent`. If the new parser causes regressions, revert to a pass-through by replacing:

```ts
const { cleanText, ranges: mdRanges, mapIndex } = parseMarkdown(response.text);
```

with:

```ts
const cleanText = response.text;
const mdRanges: TextRange[] = [];
const mapIndex = (i: number): number => i;
```

This is the only change needed — `buildGroundingCellContent` does not call `parseMarkdown` and is unaffected.

---

## Task 1: Write failing tests for bullet lists

**Files:**
- Modify: `__tests__/rich-text.test.ts`

**Step 1: Add the failing test cases** to the existing `"buildInferenceCellContent markdown edge cases"` describe block:

```ts
it("strips '* ' bullet prefix and replaces with bullet character", () => {
  const result = buildInferenceCellContent(makeResponse({ text: "* item one\n* item two" }));
  expect(result.text).toBe("• item one\n• item two");
  expect(result.ranges.filter((r) => r.italic)).toHaveLength(0);
});

it("strips '- ' bullet prefix and replaces with bullet character", () => {
  const result = buildInferenceCellContent(makeResponse({ text: "- item one" }));
  expect(result.text).toBe("• item one");
  expect(result.ranges.filter((r) => r.italic)).toHaveLength(0);
});

it("handles bullet with bold label: '* **Key:** description'", () => {
  const result = buildInferenceCellContent(
    makeResponse({ text: "* **Standardization:** A universal format." }),
  );
  expect(result.text).toBe("• Standardization: A universal format.");
  const bold = result.ranges.find((r) => r.bold);
  expect(bold).toBeDefined();
  expect(result.text.slice(bold!.startIndex, bold!.endIndex)).toBe("Standardization:");
});
```

**Step 2: Run to confirm they fail**

```bash
npx jest __tests__/rich-text.test.ts -t "bullet" --no-coverage
```

Expected: 3 FAILs (current parser treats leading `*` as italic marker).

---

## Task 2: Write failing tests for inline `[text](url)` links

**Files:**
- Modify: `__tests__/rich-text.test.ts`

**Step 1: Add to the same edge cases describe block:**

```ts
it("parses [text](url) inline link — strips syntax, keeps text, adds url range", () => {
  const result = buildInferenceCellContent(
    makeResponse({ text: "See [the docs](https://example.com/docs) for more." }),
  );
  expect(result.text).toBe("See the docs for more.");
  const link = result.ranges.find((r) => r.url === "https://example.com/docs");
  expect(link).toBeDefined();
  const idx = result.text.indexOf("the docs");
  expect(link!.startIndex).toBe(idx);
  expect(link!.endIndex).toBe(idx + "the docs".length);
});

it("parses multiple [text](url) links in a line", () => {
  const result = buildInferenceCellContent(
    makeResponse({ text: "[A](https://a.com) and [B](https://b.com)" }),
  );
  expect(result.text).toBe("A and B");
  const links = result.ranges.filter((r) => r.url);
  expect(links).toHaveLength(2);
  expect(links[0].url).toBe("https://a.com");
  expect(links[1].url).toBe("https://b.com");
});

it("citation remapping still works when inline links are present", () => {
  // "[the docs](https://example.com/docs) is good"
  // cleanText = "the docs is good" (len 16)
  // grounding support: segment 0..9 covers "[the doc" in raw (indices 0-8)
  // raw 0 → clean 0 (start of link text), raw 9 → clean 8 ("the docs" is 8 chars)
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
  // The inline link range covers "the docs"
  const inlineLink = result.ranges.find((r) => r.url === "https://example.com/docs");
  expect(inlineLink).toBeDefined();
  // The citation range should be remapped to the clean text span for "the docs"
  const citation = result.ranges.find((r) => r.url === "https://citation.com");
  expect(citation).toBeDefined();
  expect(citation!.startIndex).toBe(0);
  expect(citation!.endIndex).toBe(8); // "the docs" = 8 chars
});
```

**Step 2: Run to confirm they fail**

```bash
npx jest __tests__/rich-text.test.ts -t "inline" --no-coverage
```

Expected: all FAILs.

---

## Task 3: Rewrite `parseMarkdown` with the line-oriented approach

**Files:**
- Modify: `src/server/rich-text.ts`

**Step 1: Replace the `parseMarkdown` function** (lines 37–119) with the new implementation below. Do **not** touch any other function. The `ParsedMarkdown` interface (lines 31–35) stays unchanged.

```ts
/**
 * processInline — applies **bold**, *italic*, and [text](url) patterns to one
 * segment of text (a single line after structural prefixes have been stripped).
 *
 * Mutates posMap and cleanParts in place. Returns the updated cleanLen.
 * origOffset is the absolute character position in the original full text where
 * `segment` begins — used so posMap entries land at the right indices.
 */
function processInline(
  segment: string,
  origOffset: number,
  posMap: number[],
  cleanParts: string[],
  cleanLen: number,
  ranges: TextRange[],
): number {
  let i = 0;
  while (i < segment.length) {
    // [text](url) — inline link
    if (segment[i] === "[") {
      const closeBracket = segment.indexOf("]", i + 1);
      if (closeBracket > i && segment[closeBracket + 1] === "(") {
        const closeParen = segment.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket + 1) {
          const linkText = segment.slice(i + 1, closeBracket);
          const url = segment.slice(closeBracket + 2, closeParen);
          // '[' stripped
          posMap[origOffset + i] = cleanLen;
          const spanStart = cleanLen;
          for (let j = 0; j < linkText.length; j++) {
            posMap[origOffset + i + 1 + j] = cleanLen + j;
            cleanParts.push(linkText[j]);
          }
          cleanLen += linkText.length;
          // '](url)' stripped — map all those chars to current clean position
          const syntaxTail = closeParen - closeBracket + 1; // '](' + url + ')'
          for (let j = 0; j < syntaxTail; j++) {
            posMap[origOffset + closeBracket + j] = cleanLen;
          }
          ranges.push({ startIndex: spanStart, endIndex: cleanLen, url });
          i = closeParen + 1;
          continue;
        }
      }
    }

    // **bold** — must be checked before single *
    if (segment[i] === "*" && segment[i + 1] === "*") {
      const closeIdx = segment.indexOf("**", i + 2);
      if (closeIdx > i + 2) {
        posMap[origOffset + i] = cleanLen;
        posMap[origOffset + i + 1] = cleanLen;
        const spanStart = cleanLen;
        const content = segment.slice(i + 2, closeIdx);
        for (let j = 0; j < content.length; j++) {
          posMap[origOffset + i + 2 + j] = cleanLen + j;
          cleanParts.push(content[j]);
        }
        cleanLen += content.length;
        posMap[origOffset + closeIdx] = cleanLen;
        posMap[origOffset + closeIdx + 1] = cleanLen;
        ranges.push({ startIndex: spanStart, endIndex: cleanLen, bold: true });
        i = closeIdx + 2;
        continue;
      }
    }

    // *italic* — single * with matching closing *
    if (segment[i] === "*" && segment[i + 1] !== "*") {
      const closeIdx = segment.indexOf("*", i + 1);
      if (closeIdx > i + 1 && segment[closeIdx + 1] !== "*") {
        posMap[origOffset + i] = cleanLen;
        const spanStart = cleanLen;
        const content = segment.slice(i + 1, closeIdx);
        for (let j = 0; j < content.length; j++) {
          posMap[origOffset + i + 1 + j] = cleanLen + j;
          cleanParts.push(content[j]);
        }
        cleanLen += content.length;
        posMap[origOffset + closeIdx] = cleanLen;
        ranges.push({ startIndex: spanStart, endIndex: cleanLen, italic: true });
        i = closeIdx + 1;
        continue;
      }
    }

    // Plain character
    posMap[origOffset + i] = cleanLen;
    cleanParts.push(segment[i]);
    cleanLen++;
    i++;
  }
  return cleanLen;
}

function parseMarkdown(text: string): ParsedMarkdown {
  const ranges: TextRange[] = [];
  const posMap = new Array<number>(text.length + 1).fill(0);
  const cleanParts: string[] = [];
  let cleanLen = 0;

  const lines = text.split("\n");
  let origOffset = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let lineContent = line;
    let contentOrigOffset = origOffset;

    // --- Structural prefix: heading (# Title) ---
    const headingMatch = line.match(/^(#{1,6}) /);
    let isHeading = false;
    if (headingMatch) {
      const prefixLen = headingMatch[1].length + 1; // e.g. "## " = 3
      for (let j = 0; j < prefixLen; j++) posMap[origOffset + j] = cleanLen;
      lineContent = line.slice(prefixLen);
      contentOrigOffset = origOffset + prefixLen;
      isHeading = true;
    }
    // --- Structural prefix: bullet (* item or - item) ---
    else if (/^\* /.test(line) || /^- /.test(line)) {
      // Map the two stripped chars ('* ' or '- ') to the bullet char position
      posMap[origOffset] = cleanLen;
      posMap[origOffset + 1] = cleanLen + 1;
      cleanParts.push("•", " ");
      cleanLen += 2;
      lineContent = line.slice(2);
      contentOrigOffset = origOffset + 2;
    }

    // --- Inline processing ---
    const spanStart = cleanLen;
    cleanLen = processInline(lineContent, contentOrigOffset, posMap, cleanParts, cleanLen, ranges);

    if (isHeading) {
      ranges.push({ startIndex: spanStart, endIndex: cleanLen, bold: true });
    }

    // Add newline between lines (not after the last one)
    if (lineIdx < lines.length - 1) {
      posMap[origOffset + line.length] = cleanLen;
      cleanParts.push("\n");
      cleanLen++;
    }

    origOffset += line.length + (lineIdx < lines.length - 1 ? 1 : 0);
  }

  posMap[text.length] = cleanLen;
  const cleanText = cleanParts.join("");
  const mapIndex = (idx: number): number => posMap[Math.min(Math.max(0, idx), text.length)];
  return { cleanText, ranges, mapIndex };
}
```

**Step 2: Delete the old `parseMarkdown` function** (the one above it in the file, lines 37–119).

---

## Task 4: Run the full test suite

```bash
npx jest __tests__/rich-text.test.ts --no-coverage
```

Expected: all tests pass, including the pre-existing ones (bold, italic, heading, citation remapping, overlapping citations). If any pre-existing test fails, fix `processInline` or the structural stripping logic — do not modify the tests.

---

## Task 5: Run lint and typecheck

```bash
npm run lint && npm run typecheck
```

Fix any ESLint or TypeScript errors before committing.

---

## Task 6: Commit

```bash
git add src/server/rich-text.ts __tests__/rich-text.test.ts
git commit -m "$(cat <<'EOF'
refactor: rewrite parseMarkdown with line-oriented approach

Fixes bullet list (* and -) misparse and adds [text](url) inline link
support. processInline helper separates structural stripping (headings,
bullets) from inline pattern matching, making the parser easier to
reason about and remove if needed. posMap citation remapping preserved.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```
