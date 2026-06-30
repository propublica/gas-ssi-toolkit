/**
 * utils.ts — Small helpers with no dependency on Apps Script global singletons.
 *
 * Functions that accept GAS object parameters (Sheet, Folder) receive them
 * as arguments, making them testable via duck-typed fakes without globalThis mocking.
 * Functions that operate purely on plain values have no GAS dependency at all.
 */

import type { DriveFileInfo, GeminiResponse } from "./types";

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
 * Truncate text to maxLength characters, appending a suffix if truncated.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + "... [TRUNCATED]";
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
 * Find a column by header title in row 1, or append a new one.
 * Returns the 1-based column index.
 * Pass wrapStrategy to apply a wrap format to the entire new column on creation.
 */
export function findOrCreateColumn(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  title: string,
  wrapStrategy?: GoogleAppsScript.Spreadsheet.WrapStrategy,
): number {
  const lastCol = sheet.getLastColumn();
  if (lastCol > 0) {
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0] as string[];
    const idx = headers.indexOf(title);
    if (idx !== -1) return idx + 1;
  }
  const newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(title);
  if (wrapStrategy !== undefined) {
    sheet.getRange(1, newCol, sheet.getMaxRows(), 1).setWrapStrategy(wrapStrategy);
  }
  return newCol;
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
 * Write an array of string values to a column starting at row 2.
 * Uses a single setValues() call for efficiency.
 * Pass wrapStrategy to apply a wrap format to the written range.
 */
export function writeColumn(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  colIdx: number,
  values: string[],
  wrapStrategy?: GoogleAppsScript.Spreadsheet.WrapStrategy,
): void {
  if (values.length === 0) return;
  const range = sheet.getRange(2, colIdx, values.length, 1);
  range.setValues(values.map((v) => [v]));
  if (wrapStrategy !== undefined) {
    range.setWrapStrategy(wrapStrategy);
  }
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

// Sheets functions that make outbound HTTP requests — the exfiltration vector for formula injection.
// We scan the whole formula body so nested calls like =IF(1=1,IMAGE("evil"),0) are caught too.
const WEB_FETCH_PATTERN = /\b(image|importdata|importxml|importhtml|importrange|importfeed)\s*\(/i;

/**
 * Prevent formula injection when writing AI-generated text to a Sheets cell.
 *
 * Sheets evaluates values beginning with =, +, or - as formulas. If the formula
 * contains a web-fetch function (IMAGE, IMPORTDATA, IMPORTXML, IMPORTHTML, IMPORTRANGE,
 * IMPORTFEED) — anywhere in the formula, including nested positions — it could make an
 * outbound HTTP request that exfiltrates adjacent cell data. Those values are rejected
 * with an explicit error string.
 *
 * Other formula-prefixed values (=SUM, -IF, etc.) are safe to prefix with ' so Sheets
 * treats them as literal text instead of evaluating them.
 */
export function sanitizeForCell(value: string): string {
  if (!value.length || !/^[=+-]/.test(value[0])) return value;
  if (WEB_FETCH_PATTERN.test(value)) {
    return "[SSI Error: AI response contained an external request formula — output rejected]";
  }
  return `'${value}`;
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
