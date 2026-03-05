/**
 * inference.ts — Unified inference handler for menu-triggered AI calls.
 *
 * runInference normalizes raw cell values into a Gemini request and executes
 * it via invokeGemini. It has no SpreadsheetApp dependency — callers are
 * responsible for writing the returned value to the sheet.
 */

import { invokeGemini } from "./api";
import { fetchAndEncodeFile } from "./drive";
import { flattenArg, isValidDriveLink, extractId } from "./utils";
import type { GeminiInlineData, GeminiResponse } from "./types";
import type { ToolId } from "../shared/types";

/**
 * Execute a single Gemini inference from raw cell values.
 *
 * @param userPrompts  Cell value(s) for the user message — scalar or 2D range.
 * @param driveLinks   Cell value(s) containing Drive URLs to attach as inline
 *                     data. Invalid or non-Drive strings are silently filtered.
 *                     Omit or pass `undefined` to skip Drive attachment.
 * @param systemPrompt Cell value for the system instruction. First non-empty
 *                     string is used. Omit or pass `undefined` to use the model default.
 * @param tools        Tool IDs to enable for this inference call.
 * @returns The model response object, an object with "Error: ..." text on failure,
 *          or null if userPrompts is empty (signals caller to skip this row).
 */
export function runInference(
  userPrompts: unknown,
  driveLinks?: unknown,
  systemPrompt?: unknown,
  tools?: ToolId[],
): GeminiResponse | null {
  const userTexts = flattenArg(userPrompts);
  if (userTexts.length === 0) return null;

  try {
    const inlineData: GeminiInlineData[] =
      driveLinks !== undefined
        ? flattenArg(driveLinks)
            .filter(isValidDriveLink)
            .map((link) => fetchAndEncodeFile(extractId(link)))
        : [];

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
