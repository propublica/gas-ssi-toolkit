/**
 * drive.ts — Drive and text extraction operations.
 *
 * Note: extractTextUniversal uses the Drive Advanced Service (Drive.Files),
 * NOT just DriveApp. The advanced service must be enabled in the Apps Script
 * editor (Services > + > Drive API v3) and declared in appsscript.json.
 */

import { CONFIG } from "./config";
import type { GeminiInlineData } from "./types";

/**
 * Check that the Drive Advanced Service is available.
 * Returns truthy if available, false (and shows alert) if not.
 */
export function checkDriveService(ui: GoogleAppsScript.Base.Ui): boolean {
  try {
    // Accessing Drive.Files will throw if the advanced service isn't enabled.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    Drive.Files;
    return true;
  } catch (_e) {
    ui.alert(
      "🛑 Setup Required",
      'Please enable "Drive API" in the Services list (+ icon on left).',
      ui.ButtonSet.OK,
    );
    return false;
  }
}

/**
 * Extract text from a Drive file. Handles:
 * - Google Docs (native text extraction)
 * - PDFs and images (OCR via temporary conversion to Google Doc)
 * - Everything else returns a skip message.
 */
export function extractTextUniversal(fileId: string): string {
  try {
    const file = DriveApp.getFileById(fileId);
    const mimeType = file.getMimeType();

    // Native Google Doc — read directly
    if (mimeType === MimeType.GOOGLE_DOCS) {
      return DocumentApp.openById(fileId).getBody().getText();
    }

    // PDF or image — OCR via temporary Doc conversion (Drive API v3)
    if (mimeType === MimeType.PDF || mimeType.includes("image/")) {
      const resource = {
        name: "Temp_" + file.getName(),
        mimeType: MimeType.GOOGLE_DOCS,
      };
      // Drive.Files.create with content triggers server-side OCR
      // TODO: enforce a max file size here if needed before calling the Drive API
      // e.g. if (file.getBlob().getBytes().length > MAX_BYTES) return "[Skipped: File too large]";
      const tempFile = Drive.Files.create(resource, file.getBlob());
      const tempId = tempFile.id!;
      const text = DocumentApp.openById(tempId).getBody().getText();
      Drive.Files.remove(tempId);
      return text;
    }

    return "[Skipped: Unsupported Type]";
  } catch (e) {
    return `[Error: ${(e as Error).message}]`;
  }
}

/**
 * Route a single Drive file by MIME type, export or fetch its content,
 * and return base64-encoded inline data parts ready for Gemini.
 *
 * Returns an array because Google Sheets files produce one part per sheet.
 * All other types return a single-element array.
 *
 * Does NOT perform size validation — that is the responsibility of
 * prepareDriveAttachments, which sees the full set of files for a row.
 */
function exportAndEncodeFile(
  fileId: string,
  file: GoogleAppsScript.Drive.File,
): GeminiInlineData[] {
  const mimeType = file.getMimeType();

  if (mimeType === MimeType.GOOGLE_DOCS) {
    // file.getAs() handles the Drive export correctly (includes alt=media internally).
    // Drive.Files.export() alone returns metadata, not content.
    const pdfBlob = file.getAs("application/pdf");
    return [
      {
        mime_type: "application/pdf",
        data: Utilities.base64Encode(pdfBlob.getBytes()),
      },
    ];
  }

  if (mimeType === MimeType.GOOGLE_SHEETS) {
    // SpreadsheetApp is used here intentionally: Drive.Files.export only exports the
    // first sheet as CSV. Per-sheet export requires SpreadsheetApp to enumerate sheets
    // and get each sheet's values directly. This is a data-access use of SpreadsheetApp,
    // not a UI concern, so the index.ts-only rule does not apply here.
    // NOTE: Multi-sheet Sheets files can only export the first sheet as CSV.
    // Per-sheet parallelization is a known limitation (design doc deferred feature).
    const ss = SpreadsheetApp.openById(fileId);
    return ss.getSheets().map((sheet) => {
      const values = sheet.getDataRange().getValues();
      const csv = [
        `Sheet: ${sheet.getName()}`,
        ...values.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
        ),
      ].join("\n");
      return {
        mime_type: "text/csv",
        data: Utilities.base64Encode(csv, Utilities.Charset.UTF_8),
      };
    });
  }

  if (
    mimeType === MimeType.PDF ||
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/")
  ) {
    return [
      {
        mime_type: mimeType,
        data: Utilities.base64Encode(file.getBlob().getBytes()),
      },
    ];
  }

  throw new Error(
    `Unsupported file type: ${mimeType} (${file.getName()}). ` +
      `Supported types: Google Docs, Google Sheets, PDF, image/*, video/*, audio/*.`,
  );
}

/**
 * Prepare all Drive file attachments for a single Gemini inference call.
 *
 * Fetches and encodes each file, then enforces two size validation tiers:
 *
 * Tier 1 — Pre-flight (checked before blob download, binary types only):
 *   - PDF: estimated encoded size must not exceed INLINE_MAX_PDF_BYTES.
 *   - image/video/audio: estimated encoded size must not exceed INLINE_MAX_TOTAL_BYTES.
 *   - Workspace files (Docs/Sheets) are skipped here — exported size is unknown pre-export.
 *
 * Tier 1 post-encode — Per-PDF ceiling (covers native PDFs and Docs exported as PDF):
 *   Each encoded PDF part must not exceed INLINE_MAX_PDF_BYTES.
 *
 * Tier 2 — Total request check (checked after all files are encoded):
 *   Sum of all encoded part lengths must not exceed INLINE_MAX_TOTAL_BYTES.
 *
 * For files exceeding inline limits, consider the Gemini Files API (up to 2GB,
 * no base64 overhead): https://ai.google.dev/api/files
 * TODO: implement uploadToFilesAPI() and route oversized files here instead of throwing.
 */
export function prepareDriveAttachments(fileIds: string[]): GeminiInlineData[] {
  if (fileIds.length === 0) return [];

  const parts: GeminiInlineData[] = [];

  for (const fileId of fileIds) {
    const file = DriveApp.getFileById(fileId);
    const mimeType = file.getMimeType();

    // Tier 1 pre-flight: check raw size for binary file types before downloading blob.
    // Workspace exports (Docs/Sheets) are skipped — exported size is unknown pre-export.
    if (
      mimeType === MimeType.PDF ||
      mimeType.startsWith("image/") ||
      mimeType.startsWith("video/") ||
      mimeType.startsWith("audio/")
    ) {
      const estimatedEncodedSize = file.getSize() * CONFIG.INLINE_PREFLIGHT_FACTOR;
      if (mimeType === MimeType.PDF && estimatedEncodedSize > CONFIG.INLINE_MAX_PDF_BYTES) {
        throw new Error(
          `File too large: "${file.getName()}" (~${Math.round(file.getSize() / 1024 / 1024)}MB raw). ` +
            `PDFs must be under ~${Math.round(CONFIG.INLINE_MAX_PDF_BYTES / CONFIG.INLINE_PREFLIGHT_FACTOR / 1024 / 1024)}MB raw ` +
            `(${Math.round(CONFIG.INLINE_MAX_PDF_BYTES / 1024 / 1024)}MB encoded). ` +
            `consider breaking up the file into smaller components`,
        );
      }
      if (mimeType !== MimeType.PDF && estimatedEncodedSize > CONFIG.INLINE_MAX_TOTAL_BYTES) {
        throw new Error(
          `File too large: "${file.getName()}" (~${Math.round(file.getSize() / 1024 / 1024)}MB raw). ` +
            `Estimated encoded size (~${Math.round(estimatedEncodedSize / 1024 / 1024)}MB) exceeds the ` +
            `${Math.round(CONFIG.INLINE_MAX_TOTAL_BYTES / 1024 / 1024)}MB inline total limit. ` +
            `consider breaking up the file into smaller components`,
        );
      }
    }

    parts.push(...exportAndEncodeFile(fileId, file));
  }

  // Tier 1 post-encode: verify each individual PDF part is within its per-file limit.
  for (const part of parts) {
    if (part.mime_type === "application/pdf" && part.data.length > CONFIG.INLINE_MAX_PDF_BYTES) {
      throw new Error(
        `PDF too large after encoding (~${Math.round(part.data.length / 1024 / 1024)}MB encoded, ` +
          `limit ${Math.round(CONFIG.INLINE_MAX_PDF_BYTES / 1024 / 1024)}MB). ` +
          `consider breaking up the file into smaller components`,
      );
    }
  }

  // Tier 2: verify total combined encoded size across all parts.
  const totalEncodedBytes = parts.reduce((sum, part) => sum + part.data.length, 0);
  if (totalEncodedBytes > CONFIG.INLINE_MAX_TOTAL_BYTES) {
    throw new Error(
      `Attachments too large: combined encoded size is ~${Math.round(totalEncodedBytes / 1024 / 1024)}MB, ` +
        `exceeds ${Math.round(CONFIG.INLINE_MAX_TOTAL_BYTES / 1024 / 1024)}MB inline limit. ` +
        `consider breaking up the file into smaller components`,
    );
  }

  return parts;
}

/**
 * Fetch metadata for multiple Drive files in parallel using UrlFetchApp.fetchAll.
 * Returns partial results — files that fail are recorded in `errors` rather than
 * aborting the whole batch.
 *
 * Note: Google Workspace native files (Docs, Sheets, Slides) do not have a
 * size field in the Drive API v3 response; size will be 0 for those types.
 *
 * @param fileIds - Array of Drive file IDs to fetch metadata for
 * @param oauthToken - OAuth token with Drive API access
 * @returns { metadata: Map of fileId to { mimeType, size }, errors: Map of fileId to error message }
 */
export function fetchDriveMetadata(
  fileIds: string[],
  oauthToken: string,
): { metadata: Map<string, { mimeType: string; size: number }>; errors: Map<string, string> } {
  if (fileIds.length === 0) return { metadata: new Map(), errors: new Map() };

  const requests = fileIds.map((id) => ({
    url: `https://www.googleapis.com/drive/v3/files/${id}?fields=id%2CmimeType%2Csize&supportsAllDrives=true`,
    method: "get" as const,
    headers: { Authorization: `Bearer ${oauthToken}` },
    muteHttpExceptions: true,
  }));

  const responses = UrlFetchApp.fetchAll(requests);
  const metadata = new Map<string, { mimeType: string; size: number }>();
  const errors = new Map<string, string>();

  responses.forEach((response, i) => {
    const code = response.getResponseCode();
    if (code >= 400) {
      let message = `HTTP ${code}`;
      try {
        const parsed = JSON.parse(response.getContentText()) as { error?: { message: string } };
        if (parsed.error?.message) message = parsed.error.message;
      } catch (_e) {
        // ignore parse errors, use HTTP code in message
      }
      errors.set(fileIds[i], message);
      return;
    }
    const json = JSON.parse(response.getContentText()) as {
      mimeType?: string;
      size?: string;
    };
    metadata.set(fileIds[i], {
      mimeType: json.mimeType ?? "application/octet-stream",
      size: parseInt(json.size ?? "0", 10),
    });
  });

  return { metadata, errors };
}

/**
 * Download multiple Drive files in parallel using UrlFetchApp.fetchAll.
 * Handles format conversion for Google Docs (→ PDF) and Sheets (→ CSV).
 * Returns partial results — files that fail are recorded in `errors` rather than
 * aborting the whole batch.
 *
 * @param fileIds - Array of Drive file IDs to download
 * @param metadata - Map of fileId to { mimeType, size } from fetchDriveMetadata
 * @param oauthToken - OAuth token with Drive API access
 * @returns { bytes: Map of fileId to Uint8Array, errors: Map of fileId to error message }
 */
export function downloadDriveFiles(
  fileIds: string[],
  metadata: Map<string, { mimeType: string; size: number }>,
  oauthToken: string,
): { bytes: Map<string, Uint8Array>; errors: Map<string, string> } {
  if (fileIds.length === 0) return { bytes: new Map(), errors: new Map() };

  const DOCS_MIME = "application/vnd.google-apps.document";
  const SHEETS_MIME = "application/vnd.google-apps.spreadsheet";

  const requests = fileIds.map((id) => {
    const mimeType = metadata.get(id)?.mimeType ?? "";
    let url: string;
    if (mimeType === DOCS_MIME) {
      url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application/pdf&supportsAllDrives=true`;
    } else if (mimeType === SHEETS_MIME) {
      url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text/csv&supportsAllDrives=true`;
    } else {
      url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`;
    }
    return {
      url,
      method: "get" as const,
      headers: { Authorization: `Bearer ${oauthToken}` },
      muteHttpExceptions: true,
    };
  });

  const responses = UrlFetchApp.fetchAll(requests);
  const bytes = new Map<string, Uint8Array>();
  const errors = new Map<string, string>();

  responses.forEach((response, i) => {
    const code = response.getResponseCode();
    if (code >= 400) {
      errors.set(fileIds[i], `HTTP ${code}`);
      return;
    }
    bytes.set(fileIds[i], new Uint8Array(response.getContent()));
  });

  return { bytes, errors };
}
