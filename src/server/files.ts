/**
 * files.ts — Gemini Files API integration.
 *
 * Uploads Drive file bytes to the Gemini Files API and returns stable URI
 * references. Files are cached on Gemini's servers for 48 hours.
 * Using URIs instead of inline base64 eliminates GAS memory pressure and
 * enables deduplication across rows in a chunk.
 */

/**
 * Upload a batch of files to the Gemini Files API in parallel.
 * Processed in sub-batches of 10 to limit peak memory.
 * Returns partial results — files that fail are recorded in `errors` rather than
 * aborting the whole batch.
 *
 * @param files     Map of driveFileId → raw bytes (Uint8Array)
 * @param mimeTypes Map of driveFileId → MIME type string
 * @param apiKey    Gemini API key
 * @returns { uploads: Map of driveFileId → { uri, mimeType }, errors: Map of driveFileId → error message }
 */
export function uploadFilesToGemini(
  files: Map<string, Uint8Array>,
  mimeTypes: Map<string, string>,
  apiKey: string,
): { uploads: Map<string, { uri: string; mimeType: string }>; errors: Map<string, string> } {
  const uploads = new Map<string, { uri: string; mimeType: string }>();
  const errors = new Map<string, string>();
  const fileIds = Array.from(files.keys());
  if (fileIds.length === 0) return { uploads, errors };

  const BATCH_SIZE = 10;
  for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
    const batch = fileIds.slice(i, i + BATCH_SIZE);
    const requests = batch.map((fileId) =>
      buildUploadRequest(
        fileId,
        files.get(fileId)!,
        mimeTypes.get(fileId) ?? "application/octet-stream",
        apiKey,
      ),
    );

    const responses = UrlFetchApp.fetchAll(requests);
    responses.forEach((response, j) => {
      const fileId = batch[j];
      const code = response.getResponseCode();
      if (code >= 400) {
        errors.set(fileId, `HTTP ${code}`);
        return;
      }
      let json: { file?: { uri: string; mimeType: string }; error?: { message: string } };
      try {
        json = JSON.parse(response.getContentText()) as typeof json;
      } catch (_e) {
        errors.set(fileId, "Invalid JSON in upload response");
        return;
      }
      if (json.error || !json.file?.uri) {
        errors.set(fileId, json.error?.message ?? "missing URI in response");
        return;
      }
      uploads.set(fileId, { uri: json.file.uri, mimeType: json.file.mimeType });
    });
  }

  return { uploads, errors };
}

function buildUploadRequest(
  fileId: string,
  bytes: Uint8Array,
  mimeType: string,
  apiKey: string,
): GoogleAppsScript.URL_Fetch.URLFetchRequest {
  const boundary = "boundary" + Math.random().toString(36).slice(2, 18);
  const metadata = JSON.stringify({ file: { display_name: fileId } });

  const pre = stringToBytes(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const post = stringToBytes(`\r\n--${boundary}--`);

  const body = new Uint8Array(pre.length + bytes.length + post.length);
  body.set(pre, 0);
  body.set(bytes, pre.length);
  body.set(post, pre.length + bytes.length);

  return {
    url: `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    method: "post",
    contentType: `multipart/related; boundary=${boundary}`,
    headers: { "X-Goog-Upload-Protocol": "multipart" },
    payload: Array.from(body) as GoogleAppsScript.Byte[],
    muteHttpExceptions: true,
  };
}

// ASCII-only: used exclusively for multipart boundary headers and JSON metadata.
// Drive file IDs are always alphanumeric ASCII, so this is safe.
function stringToBytes(s: string): Uint8Array {
  return new Uint8Array(s.split("").map((c) => c.charCodeAt(0)));
}
