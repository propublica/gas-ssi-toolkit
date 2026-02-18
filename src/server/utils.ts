/**
 * utils.ts — Small pure helpers.
 *
 * These have no dependency on Apps Script globals, which makes them
 * trivially testable without mocking.
 */

import type { AIContext, AIMode, ColumnMap, DriveFileInfo } from "../shared/types";

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
): void {
  const files = folder.getFiles();
  while (files.hasNext()) {
    fileList.push({ url: files.next().getUrl() });
  }
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    getAllFilesRecursive(subfolders.next(), fileList);
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
 * Determine the AI context for a row, or return null to skip it.
 * Pure function — no GAS dependencies.
 */
export function getAIContext(row: unknown[], map: ColumnMap, mode: AIMode): AIContext | null {
  if (mode === "TEXT") {
    const txt = map.source_text > -1 ? (row[map.source_text] as string) : "";
    if (txt && txt.length > 5 && !txt.includes("Error")) {
      return { textContext: txt };
    }
    return null;
  }
  if (mode === "FILE") {
    const link = row[map.source_drive] as string;
    if (isValidDriveLink(link)) {
      return { fileId: extractId(link) };
    }
    return null;
  }
  return null;
}
