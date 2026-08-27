/**
 * inference.ts — Unified inference handler for menu-triggered AI calls.
 *
 * runInference normalizes raw cell values into a Gemini request and executes
 * it via callGeminiAPI. It has no SpreadsheetApp dependency — callers are
 * responsible for writing the returned value to the sheet.
 *
 * buildInferenceRequest is the pure request-builder. Exported so callers can build
 * a request without executing it — used by runInference and by the batch path
 * (runBatchAI).
 */

import { callGeminiAPI } from "./api";
import { prepareDriveAttachments } from "./drive";
import {
  flattenArg,
  isValidDriveLink,
  isValidYouTubeLink,
  extractId,
  sanitizeTagName,
} from "./utils";
import type { GeminiRequest, GeminiResponse, GeminiUserPart, PromptInput } from "./types";
import type { ToolId } from "../shared/types";

function resolveFileParts(
  fileIds: string[],
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiUserPart[] {
  if (fileIds.length === 0) return [];
  if (fileUriMap) {
    const parts: GeminiUserPart[] = [];
    for (const fileId of fileIds) {
      const fileInfo = fileUriMap.get(fileId);
      if (fileInfo) {
        parts.push({ file_data: { file_uri: fileInfo.uri, mime_type: fileInfo.mimeType } });
      }
    }
    return parts;
  }
  return prepareDriveAttachments(fileIds).map((inline_data) => ({ inline_data }));
}

/**
 * Resolve a single raw cell value to file parts if it looks like a Drive link
 * or a YouTube link, or null if it's neither. YouTube URLs are passed straight
 * through as a file_uri — Gemini resolves them server-side, no download/upload
 * pipeline needed.
 */
function tryFileParts(
  raw: string,
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiUserPart[] | null {
  if (isValidDriveLink(raw)) return resolveFileParts([extractId(raw)], fileUriMap);
  if (isValidYouTubeLink(raw)) return [{ file_data: { file_uri: raw } }];
  return null;
}

function buildInputParts(
  input: PromptInput,
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiUserPart[] {
  if (input.kind === "text") {
    return flattenArg(input.value).map((text) => ({ text }));
  }

  if (input.kind === "file") {
    return flattenArg(input.value).flatMap((raw) => tryFileParts(raw, fileUriMap) ?? []);
  }

  // "auto" — classify each flattened value individually; a column can mix
  // plain text, Drive links, and YouTube links across rows, so the decision
  // is per-value, not per-column.
  const parts: GeminiUserPart[] = [];
  for (const raw of flattenArg(input.value)) {
    const fileParts = tryFileParts(raw, fileUriMap);
    if (fileParts) {
      parts.push(...fileParts);
    } else {
      parts.push({ text: raw });
    }
  }
  return parts;
}

function buildUserParts(
  promptInputs: PromptInput[],
  wrapPromptsInTags: boolean,
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiUserPart[] {
  const userParts: GeminiUserPart[] = [];

  promptInputs.forEach((input, index) => {
    const parts = buildInputParts(input, fileUriMap);
    if (parts.length === 0) return;

    if (wrapPromptsInTags && input.label) {
      const tag = sanitizeTagName(input.label, index);
      userParts.push({ text: `<${tag}>` }, ...parts, { text: `</${tag}>` });
    } else {
      userParts.push(...parts);
    }
  });

  return userParts;
}

/**
 * Build a GeminiRequest from raw prompt inputs.
 *
 * @param promptInputs  Ordered prompt inputs, each carrying a kind ("text", "file", or
 *                      "auto") and a raw cell value.
 * @param systemPrompt  Cell value for the system instruction. First non-empty
 *                      string is used. Omit or pass `undefined` to use the model default.
 * @param tools         Tool IDs to enable for this inference call.
 * @param wrapPromptsInTags  When true (default), each labeled input's parts are wrapped
 *                      in an XML tag pair named after its (sanitized) label.
 * @param fileUriMap    Optional map from Drive file ID to Gemini Files API URI +
 *                      mimeType. When provided, file inputs use the file_data path
 *                      (Files API); when absent, the inline_data path is used instead.
 * @returns The request object, or null if no prompt inputs produce any
 *          content (signals caller to skip the row).
 */
export function buildInferenceRequest(
  promptInputs: PromptInput[],
  systemPrompt?: unknown,
  tools?: ToolId[],
  wrapPromptsInTags: boolean = true,
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiRequest | null {
  const userParts = buildUserParts(promptInputs, wrapPromptsInTags, fileUriMap);
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
 * @param promptInputs Ordered prompt inputs, each carrying a kind ("text", "file", or
 *                     "auto") and a raw cell value. Iterated in declaration
 *                     order to preserve the caller's intended part sequence.
 *                     Text values are flattened via flattenArg; file values are
 *                     resolved via prepareDriveAttachments for Drive links, or
 *                     passed straight through as a file_uri for YouTube links.
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
    return callGeminiAPI(req);
  } catch (e) {
    return { text: "Error: " + (e as Error).message };
  }
}
