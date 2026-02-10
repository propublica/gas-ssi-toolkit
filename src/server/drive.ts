/**
 * drive.ts — Drive and text extraction operations.
 *
 * Note: extractTextUniversal uses the Drive Advanced Service (Drive.Files),
 * NOT just DriveApp. The advanced service must be enabled in the Apps Script
 * editor (Services > + > Drive API v3) and declared in appsscript.json.
 */

/**
 * Check that the Drive Advanced Service is available.
 * Returns truthy if available, false (and shows alert) if not.
 */
export function checkDriveService(
  ui: GoogleAppsScript.Base.Ui,
): boolean {
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
      const tempFile = Drive.Files.create(
        resource,
        file.getBlob(),
      );
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
