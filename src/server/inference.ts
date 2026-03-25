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
import type { GeminiResponse } from "./types";
import type { ToolId } from "../shared/types";

/** A single part of the user prompt — either a text value or a Drive file link. */
export interface UserPromptPart {
  kind: "text" | "file";
  value: unknown;
}

/**
 * Execute a single Gemini inference from an ordered array of prompt parts.
 *
 * @param userPromptParts  Ordered parts — text cell values and/or Drive URLs to
 *                         attach as inline data. Invalid or non-Drive strings are
 *                         silently filtered from file parts.
 * @param systemPrompt     Cell value for the system instruction. First non-empty
 *                         string is used. Omit or pass `undefined` to use the model default.
 * @param tools            Tool IDs to enable for this inference call.
 * @returns The model response object, an object with "Error: ..." text on failure,
 *          or null if all text parts are empty (signals caller to skip this row).
 */
export function runInference(
  userPromptParts: UserPromptPart[],
  systemPrompt?: unknown,
  tools?: ToolId[],
): GeminiResponse | null {
  const textParts = userPromptParts.filter((p) => p.kind === "text");
  const userTexts = textParts.flatMap((p) => flattenArg(p.value));
  if (userTexts.filter(Boolean).length === 0) return null;

  try {
    const fileParts = userPromptParts.filter((p) => p.kind === "file");
    const driveIds = fileParts
      .flatMap((p) => flattenArg(p.value))
      .filter(isValidDriveLink)
      .map(extractId);

    const inlineData = driveIds.length > 0 ? prepareDriveAttachments(driveIds) : [];

    // Note: buildGeminiPayload groups all text parts before all inline_data parts
    // in the Gemini request — interleaved text/file ordering is not currently preserved
    // through to the API call. For most recipes this is acceptable. See docs/plans/
    // 2026-03-25-find-a-thing-recipe-design.md §2.2 for future ordering work.
    return invokeGemini({
      systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
      userTexts,
      inlineData: inlineData.length ? inlineData : undefined,
      tools: tools?.length ? tools : undefined,
    });
  } catch (e) {
    return { text: "Error: " + (e as Error).message };
  }
}
