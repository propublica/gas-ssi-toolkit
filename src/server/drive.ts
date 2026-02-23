/**
 * drive.ts — Drive and text extraction operations.
 *
 * Note: extractTextUniversal uses the Drive Advanced Service (Drive.Files),
 * NOT just DriveApp. The advanced service must be enabled in the Apps Script
 * editor (Services > + > Drive API v3) and declared in appsscript.json.
 */

import { CONFIG } from "./config";
import type { GeminiInlineData } from "../shared/types";

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
 * Fetch a Drive file by ID and return it as base64-encoded inline data
 * ready for the Gemini API. Throws if the file exceeds the 25MB limit.
 *
 * Uses the Drive REST API via UrlFetchApp rather than DriveApp directly,
 * because DriveApp is unavailable in custom function execution contexts.
 *
 * NOTE: Custom functions in bound scripts run in AuthMode.CUSTOM_FUNCTION,
 * which gives ScriptApp.getOAuthToken() a token scoped only to
 * spreadsheets.currentonly — not drive. Drive file fetching therefore only
 * works from menu-triggered functions (e.g. runBatchAI). Calling this from
 * the SSI() custom function will throw with a clear error pointing users to
 * runBatchAI. A service account key in Script Properties could bypass this
 * (see Google's fact-check sample), but every file would need to be shared
 * with the service account email — poor UX for a cell formula.
 *
 * Requires oauth scope: https://www.googleapis.com/auth/drive.readonly
 */
export function fetchAndEncodeFile(fileId: string): GeminiInlineData {
  const token = ScriptApp.getOAuthToken();
  if (!token) {
    throw new Error(
      "Drive file access requires full OAuth authorization, which is not available " +
        "in spreadsheet formula context (AuthMode.CUSTOM_FUNCTION). " +
        "Use the ⚡ SSI Toolkit menu > Run AI to process Drive files.",
    );
  }
  const headers = { Authorization: `Bearer ${token}` };

  const metaResp = UrlFetchApp.fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType%2Csize`,
    { headers, muteHttpExceptions: true },
  );
  if (metaResp.getResponseCode() !== 200) {
    const body = JSON.parse(metaResp.getContentText()) as { error?: { message: string } };
    throw new Error(
      body.error?.message ?? `Drive metadata request failed (${metaResp.getResponseCode()})`,
    );
  }
  const { mimeType, size } = JSON.parse(metaResp.getContentText()) as {
    mimeType: string;
    size: string;
  };

  if (parseInt(size, 10) > CONFIG.MAX_FILE_SIZE_BYTES) {
    throw new Error("File too large (>25MB).");
  }

  const contentResp = UrlFetchApp.fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers, muteHttpExceptions: true },
  );
  if (contentResp.getResponseCode() !== 200) {
    const body = JSON.parse(contentResp.getContentText()) as { error?: { message: string } };
    throw new Error(
      body.error?.message ?? `Drive download failed (${contentResp.getResponseCode()})`,
    );
  }

  return {
    mime_type: mimeType,
    data: Utilities.base64Encode(contentResp.getContent()),
  };
}
