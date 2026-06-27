import type { GeminiResponse, GeminiGroundingSupport } from "./types";

interface CitationRange {
  startIndex: number;
  endIndex: number;
  sources: Array<{ uri: string; title: string }>;
}

function getCitations(
  response: GeminiResponse,
  resolvedUris?: Map<string, string>,
): CitationRange[] {
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
        return { ...src, uri: resolvedUris?.get(src.uri) ?? src.uri };
      })
      .filter((src): src is { uri: string; title: string } => src !== null),
  }));
}

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

// Truncate a citation span at the first line that opens a block-level construct
// (bullet, heading, or blank line). Links are inline constructs and cannot cross
// block boundaries — groupBlocks() splits on these lines before inline parsing runs.
function truncateToFirstBlock(text: string): string {
  const lines = text.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (/^(\* |- |#{1,6} |$)/.test(lines[i])) {
      return lines.slice(0, i).join("\n");
    }
  }
  return text;
}

function findExistingLinkSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const linkRegex = /\[([^\]]*)\]\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(text)) !== null) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

function getAllSources(
  response: GeminiResponse,
  resolvedUris?: Map<string, string>,
): Array<{ uri: string; title: string }> {
  return (response.groundingMetadata?.groundingChunks ?? [])
    .map((chunk) => chunk.web ?? chunk.retrievedContext ?? null)
    .filter((src): src is { uri: string; title: string } => src !== null)
    .map((src) => ({ ...src, uri: resolvedUris?.get(src.uri) ?? src.uri }));
}

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
    const spanText = truncateToFirstBlock(result.slice(startIndex, endIndex));
    result =
      result.slice(0, startIndex) +
      `[${spanText}](${url})` +
      result.slice(startIndex + spanText.length);
  }
  return result;
}

export function groundingToMarkdown(
  response: GeminiResponse,
  resolvedUris?: Map<string, string>,
): string | null {
  const sources = getAllSources(response, resolvedUris);
  const queries = response.groundingMetadata?.webSearchQueries ?? [];
  const codePairs = response.codePairs ?? [];

  if (!sources.length && !queries.length && !codePairs.length) {
    return null;
  }

  if (codePairs.length > 0) {
    return codePairs
      .map(({ code, result }) => {
        const lang = code.language ? `(${code.language.toLowerCase()})` : "";
        const outputLine = result.output ? `\n\nOutput:\n${result.output}` : "";
        return `Code ${lang}:\n${code.code}${outputLine}`;
      })
      .join("\n\n");
  }

  const parts: string[] = [];

  if (queries.length) {
    const queryLinks = queries.map(
      (q) => `["${q}"](https://www.google.com/search?q=${encodeURIComponent(q)})`,
    );
    parts.push(`Search queries: ${queryLinks.join(", ")}`);
  }

  if (sources.length) {
    const sourceLines = sources.map(({ uri, title }) => `* [${title}](${uri})`);
    parts.push(`Sources (${sources.length}):\n${sourceLines.join("\n")}`);
  }

  return parts.join("\n\n");
}
