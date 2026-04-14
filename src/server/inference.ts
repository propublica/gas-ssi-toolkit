/**
 * inference.ts — Unified inference handler for menu-triggered AI calls.
 *
 * runInference normalizes raw cell values into a Gemini request and executes
 * it via invokeGemini. It has no SpreadsheetApp dependency — callers are
 * responsible for writing the returned value to the sheet.
 */

import { invokeGemini } from "./api";
import { prepareDriveAttachments } from "./drive";
import { flattenArg, isValidDriveLink, extractId } from "./utils";
import type { GeminiResponse, GeminiUserPart, PromptInput } from "./types";
import type { ToolId } from "../shared/types";

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
        if (fileIds.length > 0) {
          const attachments = prepareDriveAttachments(fileIds);
          userParts.push(...attachments.map((inline_data) => ({ inline_data })));
        }
      }
    }

    if (userParts.length === 0) return null;

    return invokeGemini({
      systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
      userParts,
      tools: tools?.length ? tools : undefined,
    });
  } catch (e) {
    return { text: "Error: " + (e as Error).message };
  }
}
