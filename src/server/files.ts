/**
 * files.ts — Gemini Files API integration.
 *
 * Uploads Drive file blobs to the Gemini Files API via the resumable upload
 * protocol and returns stable URI references. Files are cached on Gemini's
 * servers for 48 hours.
 *
 * Resumable upload (two fetchAll passes) is used instead of multipart upload
 * because the Blob payload is passed directly to UrlFetchApp without ever
 * calling getContent() / Array.from(), avoiding the ~8× memory expansion that
 * the Uint8Array → Byte[] conversion causes in the V8 GAS runtime.
 */

/**
 * Upload a batch of Drive file blobs to the Gemini Files API in parallel.
 * Uses a two-phase resumable protocol: init (get session URIs) then upload (send blobs).
 * Returns partial results — files that fail are recorded in `errors` rather than
 * aborting the whole batch.
 *
 * @param files     Map of driveFileId → GAS Blob (from UrlFetchApp response.getBlob())
 * @param mimeTypes Map of driveFileId → MIME type string
 * @param apiKey    Gemini API key
 * @returns { uploads: Map of driveFileId → { uri, mimeType }, errors: Map of driveFileId → error message }
 */
export function uploadFilesToGemini(
  files: Map<string, GoogleAppsScript.Base.Blob>,
  mimeTypes: Map<string, string>,
  apiKey: string,
): { uploads: Map<string, { uri: string; mimeType: string }>; errors: Map<string, string> } {
  const uploads = new Map<string, { uri: string; mimeType: string }>();
  const errors = new Map<string, string>();
  const fileIds = Array.from(files.keys());
  if (fileIds.length === 0) return { uploads, errors };

  // Phase 1: initiate all resumable uploads in parallel — lightweight JSON requests only
  const initRequests = fileIds.map((fileId) => ({
    url: `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    method: "post" as const,
    contentType: "application/json",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Type": mimeTypes.get(fileId) ?? "application/octet-stream",
    },
    payload: JSON.stringify({ file: { display_name: fileId } }),
    muteHttpExceptions: true,
  }));

  const initResponses = UrlFetchApp.fetchAll(initRequests);

  // Collect session URIs; record any init errors
  const sessionPairs: Array<{ fileId: string; sessionUri: string }> = [];
  initResponses.forEach((resp, i) => {
    const fileId = fileIds[i];
    if (resp.getResponseCode() >= 400) {
      errors.set(fileId, `HTTP ${resp.getResponseCode()}`);
      return;
    }
    const headers = resp.getHeaders() as Record<string, string>;
    // GAS normalizes response header keys to lowercase; search case-insensitively.
    const sessionUri = Object.entries(headers).find(
      ([k]) => k.toLowerCase() === "x-goog-upload-url",
    )?.[1];
    if (!sessionUri) {
      errors.set(fileId, "Missing upload session URI");
      return;
    }
    sessionPairs.push({ fileId, sessionUri });
  });

  if (sessionPairs.length === 0) return { uploads, errors };

  // Phase 2: upload file content in parallel — Blob passed directly, no Array.from() needed
  const uploadRequests = sessionPairs.map(({ fileId, sessionUri }) => ({
    url: sessionUri,
    method: "post" as const,
    contentType: mimeTypes.get(fileId) ?? "application/octet-stream",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
    },
    payload: files.get(fileId)!,
    muteHttpExceptions: true,
  }));

  const uploadResponses = UrlFetchApp.fetchAll(uploadRequests);

  uploadResponses.forEach((resp, i) => {
    const { fileId } = sessionPairs[i];
    if (resp.getResponseCode() >= 400) {
      errors.set(fileId, `HTTP ${resp.getResponseCode()}`);
      return;
    }
    let json: { file?: { uri: string; mimeType: string }; error?: { message: string } };
    try {
      json = JSON.parse(resp.getContentText()) as typeof json;
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

  return { uploads, errors };
}
