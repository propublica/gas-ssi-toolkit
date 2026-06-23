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
  strikethrough?: boolean;
  fontFamily?: string;
  fontSize?: number;
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

    // ~~strikethrough~~ — must check before plain ~ fallback
    if (segment[i] === "~" && segment[i + 1] === "~") {
      const closeIdx = segment.indexOf("~~", i + 2);
      if (closeIdx > i + 2) {
        const spanStart = cleanLen;
        const inner = segment.slice(i + 2, closeIdx);
        parts.push(inner);
        cleanLen += inner.length;
        ranges.push({ startIndex: spanStart, endIndex: cleanLen, strikethrough: true });
        i = closeIdx + 2;
        continue;
      }
    }

    // `inline code` — single-backtick span
    if (segment[i] === "`") {
      const closeIdx = segment.indexOf("`", i + 1);
      if (closeIdx > i + 1) {
        const spanStart = cleanLen;
        const inner = segment.slice(i + 1, closeIdx);
        parts.push(inner);
        cleanLen += inner.length;
        ranges.push({ startIndex: spanStart, endIndex: cleanLen, fontFamily: "Courier New" });
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
export function parseMarkdown(text: string): CellContent {
  const ranges: TextRange[] = [];
  const cleanParts: string[] = [];
  let cleanLen = 0;

  const lines = text.split("\n");
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    let content = line;
    let isHeading = false;
    let headingDepth = 0;

    // Structural prefix: heading (# Title → bold)
    const headingMatch = line.match(/^(#{1,6}) /);
    if (headingMatch) {
      content = line.slice(headingMatch[1].length + 1);
      isHeading = true;
      headingDepth = headingMatch[1].length;
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
      const fontSize =
        headingDepth === 1 ? 14 : headingDepth === 2 ? 13 : headingDepth === 3 ? 12 : undefined;
      const range: TextRange = { startIndex: spanStart, endIndex: cleanLen, bold: true };
      if (fontSize !== undefined) range.fontSize = fontSize;
      ranges.push(range);
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

export function buildRichInferenceCellContent(response: GeminiResponse): CellContent {
  const citations = getCitations(response).sort((a, b) => a.startIndex - b.startIndex);
  const merged = mergeCitations(citations);

  if (merged.length === 0) {
    return parseMarkdown(response.text);
  }

  const existingLinkSpans = findExistingLinkSpans(response.text);
  const preprocessed = injectCitationLinks(response.text, merged, existingLinkSpans);
  return parseMarkdown(preprocessed);
}

export function buildRichGroundingCellContent(response: GeminiResponse): CellContent | null {
  const sources = getAllSources(response);
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
      append("\u2022 ");
      ranges.push({ startIndex: pos, endIndex: pos + title.length, url: uri });
      append(title);
    });
  }

  return { text: parts.join(""), ranges };
}
