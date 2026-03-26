/**
 * customFunctions.ts — Google Sheets custom functions.
 *
 * Functions here are callable directly from spreadsheet cells via the
 * @customfunction JSDoc tag. Key constraints vs. menu-triggered functions:
 * - Cannot display UI (no dialogs, no prompts, no alerts)
 * - Errors must be returned as strings — thrown exceptions show as generic
 *   script errors in the cell with no useful message
 * - PropertiesService.getScriptProperties() is available after the add-on
 *   has been authorized by the user (opening the menu triggers authorization)
 * - Range arguments arrive as unknown[][], single cells as raw scalars
 */

import { invokeGemini } from "./api";
import { flattenArg } from "./utils";
import { TOOL_REGISTRY } from "./tools";
import type { ToolId } from "../shared/types";
import type { GeminiUserPart } from "./types";

/**
 * Call the Gemini API from a spreadsheet cell.
 *
 * @param {string|Array} userTexts One or more text parts for the user message.
 *   Pass a single string, a cell reference, or a range / array literal.
 *   Example: "Summarize this" or A1 or A1:A3 or {A1,B4,B10}
 * @param {string} [systemPrompt] (Optional) System-level instruction for the model.
 *   Example: "You are a concise summarizer."
 * @param {string|Array} [toolNames] (Optional) Names of tools to enable.
 *   Example: "google_search" or {A5,A6}
 * @return {string} The model's text response, or "[SSI Error: ...]" on failure.
 * @customfunction
 */
export function SSI(userTexts: unknown, systemPrompt?: string, toolNames?: unknown): string {
  try {
    const resolvedToolIds = flattenArg(toolNames).map((name) => {
      if (!TOOL_REGISTRY[name as ToolId]) throw new Error(`unknown tool '${name}'`);
      return name as ToolId;
    });

    return invokeGemini({
      systemPrompt: systemPrompt || undefined,
      userParts: flattenArg(userTexts).map((text): GeminiUserPart => ({ kind: "text", text })),
      tools: resolvedToolIds.length ? resolvedToolIds : undefined,
    }).text;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `[SSI Error: ${msg}]`;
  }
}
