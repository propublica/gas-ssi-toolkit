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

// ---- Private helpers ----

interface ParsedMarkdown {
  cleanText: string;
  ranges: TextRange[];
  mapIndex: (originalIndex: number) => number;
}

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
        // Find the matching close paren — use lastIndexOf from end of segment
        // to handle URLs containing literal parentheses (e.g. Wikipedia links).
        // We don't look past the next '[' to avoid eating into subsequent links.
        const nextBracket = segment.indexOf("[", closeBracket + 2);
        const searchEnd = nextBracket === -1 ? segment.length - 1 : nextBracket - 1;
        const closeParen = segment.lastIndexOf(")", searchEnd);
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
          if (cleanLen > spanStart) {
            ranges.push({ startIndex: spanStart, endIndex: cleanLen, url });
          }
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

interface CitationRange {
  startIndex: number;
  endIndex: number;
  sources: Array<{ uri: string; title: string }>;
}

function getCitations(response: GeminiResponse): CitationRange[] {
  const supports = response.groundingMetadata?.groundingSupports ?? [];
  const chunks = response.groundingMetadata?.groundingChunks ?? [];
  return supports.map((s: GeminiGroundingSupport) => ({
    startIndex: s.segment.startIndex ?? 0, // Gemini omits startIndex when it is 0 (proto3 default)
    endIndex: s.segment.endIndex,
    sources: s.groundingChunkIndices
      .map((idx) => {
        const chunk = chunks[idx];
        return chunk?.web ?? chunk?.retrievedContext ?? null;
      })
      .filter((src): src is { uri: string; title: string } => src !== null),
  }));
}

function getAllSources(response: GeminiResponse): Array<{ uri: string; title: string }> {
  return (response.groundingMetadata?.groundingChunks ?? [])
    .map((chunk) => chunk.web ?? chunk.retrievedContext ?? null)
    .filter((src): src is { uri: string; title: string } => src !== null);
}

// ---- Public builders ----

export function buildInferenceCellContent(response: GeminiResponse): CellContent {
  const { cleanText, ranges: mdRanges, mapIndex } = parseMarkdown(response.text);

  // Sort citations and merge overlapping ranges (Gemini can return overlapping supports).
  // When ranges overlap we keep the first source URI — the first support is generally
  // the highest-confidence citation for the merged span.
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
    // code_execution and google_search are mutually exclusive in practice.
    // When code pairs are present, grounding sources/queries are omitted from the cell
    // to keep the output focused — code results are the primary artifact.
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
          searchFrom = idx + bullet.length; // advance past this occurrence
        }
      });
    }
  }

  return { text: fullText, ranges };
}
