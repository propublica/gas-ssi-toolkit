/**
 * utils.ts — Small helpers with no dependency on Apps Script global singletons.
 *
 * Functions that accept GAS object parameters (Sheet, Folder) receive them
 * as arguments, making them testable via duck-typed fakes without globalThis mocking.
 * Functions that operate purely on plain values have no GAS dependency at all.
 */

import type { DriveFileInfo, GeminiResponse } from "./types";
import type { RunStats } from "../shared/types";

/**
 * Extract a Google Drive file/folder ID from a URL or raw ID string.
 * Matches any alphanumeric-dash-underscore string of 25+ characters.
 */
export function extractId(input: unknown): string {
  if (!input || typeof input !== "string") return "";
  const match = input.match(/[-\w]{25,}/);
  return match ? match[0] : input;
}

/**
 * Check whether a string looks like a Google Drive link.
 */
export function isValidDriveLink(input: unknown): boolean {
  return typeof input === "string" && (input.includes("drive.google.com") || input.includes("/d/"));
}

/**
 * Check whether a string looks like a single-video YouTube link (standard watch URL,
 * youtu.be short link, or Shorts URL). Deliberately excludes playlist/channel/search
 * URLs, which aren't single videos Gemini can process this way.
 *
 * Anchored to the start of the string (host must actually be youtube.com/youtu.be)
 * rather than a loose substring match: unlike a Drive link, this value is passed
 * straight through as the Gemini request's file_uri with no ID extraction, so a
 * looser match would let a YouTube-shaped path on an attacker-controlled host
 * (e.g. "https://evil.example.com/youtube.com/watch?v=xyz") get sent to Gemini
 * as the fetch target.
 */
export function isValidYouTubeLink(input: unknown): boolean {
  if (typeof input !== "string") return false;
  return /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:\S*&)?v=[\w-]+|shorts\/[\w-]+)|youtu\.be\/[\w-]+)/.test(
    input.trim(),
  );
}

/**
 * Seeded pseudo-random number generator (LCG).
 * Returns a function that produces values in [0, 1).
 */
export function createSeededRandom(seed?: number): () => number {
  const m = 0x80000000;
  const a = 1103515245;
  const c = 12345;
  let state = seed ?? Math.floor(Math.random() * (m - 1));

  return function (): number {
    state = (a * state + c) % m;
    return state / (m - 1);
  };
}

/**
 * Recursively collect all file URLs from a Drive folder.
 */
export function getAllFilesRecursive(
  folder: GoogleAppsScript.Drive.Folder,
  fileList: DriveFileInfo[],
  mimeTypePrefixes?: string[],
): void {
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (mimeTypePrefixes) {
      const mime = file.getMimeType();
      if (!mimeTypePrefixes.some((p) => mime.startsWith(p))) continue;
    }
    fileList.push({ url: file.getUrl() });
  }
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    getAllFilesRecursive(subfolders.next(), fileList, mimeTypePrefixes);
  }
}

/**
 * Sample `sampleSize` rows from `data` using a seeded Fisher-Yates shuffle.
 * Reproducible: same seed always produces the same selection.
 */
export function sampleRows(data: unknown[][], sampleSize: number, seed: number): unknown[][] {
  const seededRandom = createSeededRandom(seed);
  const indices = data.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, sampleSize).map((index) => data[index]);
}

/**
 * Suffix appended by truncateText, and the marker ensureTruncatedCellHighlighting
 * matches on to highlight incomplete extractions — kept in one place so the two
 * never drift apart.
 */
export const TRUNCATION_SUFFIX = "... [TRUNCATED]";

/**
 * Truncate text to maxLength characters, appending a suffix if truncated.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + TRUNCATION_SUFFIX;
}

/**
 * Deterministic column-title → XML-tag-name mapping. Column headers are not
 * valid tag names (spaces, #, /, leading digits, or empty titles are all
 * legal headers) — this is the single place that rule is applied.
 */
export function sanitizeTagName(title: string, fallbackIndex: number): string {
  const stripped = title.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (stripped === "") return `input_${fallbackIndex}`;
  return /^[0-9]/.test(stripped) ? `_${stripped}` : stripped;
}

/**
 * Normalize a custom function argument to a flat array of non-empty strings.
 * GAS passes single-cell references as raw scalars and ranges as 2D arrays.
 */
export function flattenArg(val: unknown): string[] {
  if (!Array.isArray(val)) return val != null && String(val) !== "" ? [String(val)] : [];
  return (val as unknown[][])
    .flat()
    .filter((v) => v !== "" && v != null)
    .map(String);
}

/**
 * Map an array of column header names to their zero-based indices.
 * Returns -1 for any name not found in `headers`.
 */
export function resolveColumns(headers: string[], names: string[]): number[] {
  return names.map((name) => headers.indexOf(name));
}

/**
 * Writes job progress to CacheService so the sidebar can poll it.
 * TTL is 300s (5 minutes) — long enough for any single operation.
 */
export function writeJobProgress(
  cache: GoogleAppsScript.Cache.Cache,
  jobId: string,
  state: { message?: string; current?: number; total?: number },
): void {
  cache.put(jobId, JSON.stringify(state), 300);
}

/**
 * Writes run stats to CacheService, keyed per spreadsheet (the UserCache is
 * already scoped to the current user; the spreadsheet ID additionally
 * prevents collisions if the same user has this add-on open in multiple
 * sheets). TTL is 21600s (6 hours — CacheService's max), long enough to
 * survive a reasonable gap between a test run and a later full run in the
 * same working session.
 */
export function writeRunStats(
  cache: GoogleAppsScript.Cache.Cache,
  spreadsheetId: string,
  stats: RunStats,
): void {
  cache.put(`runStats:${spreadsheetId}`, JSON.stringify(stats), 21600);
}

/**
 * Replace {{inputId}} placeholders and {{#key}}...{{/key}} conditional blocks
 * in a template string with values from a map.
 *
 * Conditional blocks: content is included only when the named key has a non-empty value.
 * Simple placeholders: unknown keys are replaced with an empty string.
 * Nesting conditional blocks is not supported.
 */
export function interpolateTemplate(template: string, inputValues: Record<string, string>): string {
  // Pass 1: conditional blocks — include content only if value is non-empty
  const withBlocks = template.replace(
    /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_, id: string, content: string) => ((inputValues[id] ?? "") ? content : ""),
  );
  // Pass 2: simple interpolations
  return withBlocks.replace(/\{\{(\w+)\}\}/g, (_, id: string) => inputValues[id] ?? "");
}

/**
 * Idempotent — re-applied on each chunk; header colour and note content never change between calls.
 */
export function markAIOutputRange(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  colIdx: number,
  startRow: number,
  numRows: number,
): void {
  const header = sheet.getRange(1, colIdx);
  header.setBackground("#F9AB00");
  header.setNote(
    "Some cells in this column may be AI-generated — exercise good judgement when using",
  );
  sheet.getRange(startRow, colIdx, numRows, 1).setBackground("#FFF8E1");
}

/**
 * Highlights a truncated-text cell, or clears the highlight when the cell is
 * no longer truncated (e.g. a re-extraction that comes back short enough to
 * fit) so the background never goes stale. Called on every extract-text write,
 * mirroring markAIOutputRange's direct-write approach rather than a
 * conditional format rule.
 */
export function markTruncationHighlight(
  cell: GoogleAppsScript.Spreadsheet.Range,
  truncated: boolean,
): void {
  cell.setBackground(truncated ? "#FCE8E6" : null);
}

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
  const fetchRequests: GoogleAppsScript.URL_Fetch.URLFetchRequest[] = uriArray.map((uri) => ({
    url: uri,
    method: "get" as GoogleAppsScript.URL_Fetch.HttpMethod,
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
