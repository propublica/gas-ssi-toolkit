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
import type { GeminiInlineData } from "../shared/types";

/**
 * Execute a single Gemini inference from raw cell values.
 *
 * @param userPrompts  Cell value(s) for the user message — scalar or 2D range.
 * @param driveLinks   Cell value(s) containing Drive URLs to attach as inline
 *                     data. Invalid or non-Drive strings are silently filtered.
 *                     Pass null to omit.
 * @param systemPrompt Cell value for the system instruction. First non-empty
 *                     string is used. Pass null to use the model default.
 * @returns The model response string, an "Error: ..." string on failure,
 *          or null if userPrompts is empty (signals caller to skip this row).
 */
export function runInference(
  userPrompts: unknown,
  driveLinks: unknown,
  systemPrompt: unknown,
): string | null {
  const userTexts = flattenArg(userPrompts).filter((s) => s !== "");
  if (userTexts.length === 0) return null;

  try {
    const inlineData: GeminiInlineData[] = flattenArg(driveLinks)
      .filter(isValidDriveLink)
      .map((link) => fetchAndEncodeFile(extractId(link)));

    return invokeGemini({
      systemPrompt: flattenArg(systemPrompt)[0] ?? undefined,
      userTexts,
      inlineData: inlineData.length ? inlineData : undefined,
    });
  } catch (e) {
    return "Error: " + (e as Error).message;
  }
}
