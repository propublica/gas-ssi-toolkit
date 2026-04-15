/**
 * utils.ts — Small helpers with no dependency on Apps Script global singletons.
 *
 * Functions that accept GAS object parameters (Sheet, Folder) receive them
 * as arguments, making them testable via duck-typed fakes without globalThis mocking.
 * Functions that operate purely on plain values have no GAS dependency at all.
 */

import type { DriveFileInfo } from "./types";

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
 * Replace {{inputId}} placeholders in a template string with values from a map.
 * Unknown placeholders are replaced with an empty string.
 */
export function interpolateTemplate(
  template: string,
  inputValues: Record<string, string>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, id: string) => inputValues[id] ?? "");
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
