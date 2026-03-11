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
