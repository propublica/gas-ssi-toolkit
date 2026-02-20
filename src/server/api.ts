/**
 * api.ts — Gemini API interaction via UrlFetchApp. test change
 *
 * Requires oauth scope: https://www.googleapis.com/auth/script.external_request
 */

import { CONFIG } from "./config";
import type { AIContext } from "../shared/types";

/**
 * Call the Gemini generateContent endpoint.
 *
 * Supports two context modes:
 * - textContext: appends text to the user prompt (fast, text-only)
 * - fileId: base64-encodes the Drive file as inline_data (multimodal)
 */
export function callGeminiAPI(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  context: AIContext,
): string {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL_NAME}:generateContent?key=${apiKey}`;

  const payload: Record<string, unknown> = {
    system_instruction: {
      parts: [{ text: systemPrompt || "You are a helpful assistant." }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userPrompt }],
      },
    ],
  };

  // Branch on context type
  const parts = (payload.contents as { parts: Record<string, unknown>[] }[])[0].parts;

  if (context.textContext) {
    // Append text context to the user prompt part
    parts[parts.length - 1].text += `\n\n--- CONTEXT ---\n${context.textContext}`;
  } else if (context.fileId) {
    // Base64-encode the file and attach as inline_data
    const file = DriveApp.getFileById(context.fileId);
    if (file.getSize() > CONFIG.MAX_FILE_SIZE_BYTES) {
      throw new Error("File too large (>25MB).");
    }
    parts.push({
      inline_data: {
        mime_type: file.getMimeType(),
        data: Utilities.base64Encode(file.getBlob().getBytes()),
      },
    });
  }

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());

  if (json.error) throw new Error(json.error.message);
  return json.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
}
