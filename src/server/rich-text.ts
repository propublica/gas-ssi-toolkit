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

function parseMarkdown(text: string): ParsedMarkdown {
  const ranges: TextRange[] = [];
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
        const prefixLen = level + 1;
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

    // Plain character
    posMap[i] = cleanLen;
    cleanParts.push(text[i]);
    cleanLen++;
    i++;
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
    startIndex: s.segment.startIndex,
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
      sources.forEach(({ uri, title }) => {
        const bullet = `\u2022 ${title}`;
        const idx = fullText.indexOf(bullet, sourceSectionStart);
        if (idx !== -1 && idx < sourceSectionEnd) {
          ranges.push({ startIndex: idx + 2, endIndex: idx + 2 + title.length, url: uri });
        }
      });
    }
  }

  return { text: fullText, ranges };
}
