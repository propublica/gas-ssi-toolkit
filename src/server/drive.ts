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
  // Cast to the GAS enum type to avoid collision with DOM's MimeType interface.
  const GASMimeType = MimeType as unknown as GoogleAppsScript.Base.MimeType;
  try {
    const file = DriveApp.getFileById(fileId);
    const mimeType = file.getMimeType();

    // Native Google Doc — read directly
    if (mimeType === GASMimeType.GOOGLE_DOCS) {
      return DocumentApp.openById(fileId).getBody().getText();
    }

    // PDF or image — OCR via temporary Doc conversion (Drive API v3)
    if (mimeType === GASMimeType.PDF || mimeType.includes("image/")) {
      const resource = {
        name: "Temp_" + file.getName(),
        mimeType: GASMimeType.GOOGLE_DOCS,
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
 */
export function fetchAndEncodeFile(fileId: string): GeminiInlineData {
  const file = DriveApp.getFileById(fileId);
  if (file.getSize() > CONFIG.MAX_FILE_SIZE_BYTES) {
    throw new Error("File too large (>25MB).");
  }
  return {
    mime_type: file.getMimeType(),
    data: Utilities.base64Encode(file.getBlob().getBytes()),
  };
}
