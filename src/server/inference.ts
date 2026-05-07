/**
 * inference.ts — Unified inference handler for menu-triggered AI calls.
 *
 * runInference normalizes raw cell values into a Gemini request and executes
 * it via invokeGemini. It has no SpreadsheetApp dependency — callers are
 * responsible for writing the returned value to the sheet.
 *
 * buildInferenceRequest is the pure request-builder. Exported so callers can build
 * a request without executing it — used by runInference; also available for the
 * batch path (runBatchAI) in the upcoming parallel pipeline refactor.
 */

import { invokeGemini } from "./api";
import { prepareDriveAttachments } from "./drive";
import { flattenArg, isValidDriveLink, extractId } from "./utils";
import type { GeminiRequest, GeminiResponse, GeminiUserPart, PromptInput } from "./types";
import type { ToolId } from "../shared/types";

function buildUserParts(
  promptInputs: PromptInput[],
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiUserPart[] {
  const userParts: GeminiUserPart[] = [];

  for (const input of promptInputs) {
    if (input.kind === "text") {
      const texts = flattenArg(input.value);
      const parts = input.label
        ? texts.map((text) => ({ text: `${input.label}: ${text}` }))
        : texts.map((text) => ({ text }));
      userParts.push(...parts);
    } else {
      const fileIds = flattenArg(input.value).filter(isValidDriveLink).map(extractId);
      if (fileIds.length === 0) continue;

      if (fileUriMap) {
        for (const fileId of fileIds) {
          const fileInfo = fileUriMap.get(fileId);
          if (fileInfo) {
            userParts.push({
              file_data: { file_uri: fileInfo.uri, mime_type: fileInfo.mimeType },
            });
          }
        }
      } else {
        const attachments = prepareDriveAttachments(fileIds);
        userParts.push(...attachments.map((inline_data) => ({ inline_data })));
      }
    }
  }

  return userParts;
}

/**
 * Build a GeminiRequest (without apiKey) from raw prompt inputs.
 *
 * @param promptInputs  Ordered prompt inputs, each carrying a kind ("text" or
 *                      "file") and a raw cell value.
 * @param systemPrompt  Cell value for the system instruction. First non-empty
 *                      string is used. Omit or pass `undefined` to use the model default.
 * @param tools         Tool IDs to enable for this inference call.
 * @param fileUriMap    Optional map from Drive file ID to Gemini Files API URI +
 *                      mimeType. When provided, file inputs use the file_data path
 *                      (Files API); when absent, the inline_data path is used instead.
 * @returns The request object (without apiKey), or null if no prompt inputs
 *          produce any content (signals caller to skip the row).
 */
export function buildInferenceRequest(
  promptInputs: PromptInput[],
  systemPrompt?: unknown,
  tools?: ToolId[],
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): Omit<GeminiRequest, "apiKey"> | null {
  const userParts = buildUserParts(promptInputs, fileUriMap);
  if (userParts.length === 0) return null;

  return {
    systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
    userParts,
    tools: tools?.length ? tools : undefined,
  };
}

/**
 * Execute a single Gemini inference from raw cell values.
 *
 * @param promptInputs Ordered prompt inputs, each carrying a kind ("text" or
 *                     "file") and a raw cell value. Iterated in declaration
 *                     order to preserve the caller's intended part sequence.
 *                     Text values are flattened via flattenArg; file values are
 *                     resolved via prepareDriveAttachments after filtering for
 *                     valid Drive links.
 * @param systemPrompt Cell value for the system instruction. First non-empty
 *                     string is used. Omit or pass `undefined` to use the model default.
 * @param tools        Tool IDs to enable for this inference call.
 * @returns The model response object, an object with "Error: ..." text on failure,
 *          or null if no prompt inputs produce any content (signals caller to skip row).
 */
export function runInference(
  promptInputs: PromptInput[],
  systemPrompt?: unknown,
  tools?: ToolId[],
): GeminiResponse | null {
  try {
    const req = buildInferenceRequest(promptInputs, systemPrompt, tools);
    if (req === null) return null;
    return invokeGemini(req);
  } catch (e) {
    return { text: "Error: " + (e as Error).message };
  }
}
