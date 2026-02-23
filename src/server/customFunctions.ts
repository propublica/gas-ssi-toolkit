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

import { CONFIG } from "./config";
import { callGeminiAPI } from "./api";
import { fetchAndEncodeFile } from "./drive";
import { extractId } from "./utils";
import type { GeminiFunctionDeclaration } from "../shared/types";

// ── Tool Registry ────────────────────────────────────────────────────────────
//
// Map tool names to GeminiFunctionDeclaration objects.
// Add entries here as concrete tool use cases are designed.

export const TOOL_REGISTRY: Record<string, GeminiFunctionDeclaration> = {};

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Normalize a custom function argument to a flat array of non-empty strings.
 * GAS passes single-cell references as raw scalars and ranges as 2D arrays.
 */
function flattenArg(val: unknown): string[] {
  if (!Array.isArray(val)) return val != null ? [String(val)] : [];
  return (val as unknown[][])
    .flat()
    .filter((v) => v !== "" && v != null)
    .map(String);
}

// ── Custom Functions ─────────────────────────────────────────────────────────

/**
 * Call the Gemini API from a spreadsheet cell.
 *
 * @param {string|Array} userTexts One or more text parts for the user message.
 *   Pass a single string, a cell reference, or a range / array literal.
 *   Example: "Summarize this" or A1 or A1:A3 or {A1,B4,B10}
 * @param {string|Array} inlineData Drive URL(s) or file ID(s) to attach as
 *   inline data. Pass a single URL, a cell reference, or a range / array literal.
 *   Example: A2 or {A2,A3}
 * @param {string} systemPrompt System-level instruction for the model.
 *   Example: "You are a concise summarizer."
 * @param {string|Array} [toolNames] (Optional) Names of pre-registered tools to enable.
 *   Example: "myTool" or {A5,A6}
 * @return {string} The model's text response, or "[SSI Error: ...]" on failure.
 * @customfunction
 */
export function SSI(
  userTexts: unknown,
  inlineData?: unknown,
  systemPrompt?: string,
  toolNames?: unknown,
): string {
  try {
    // Resolve API key from Script Properties (set via Project Settings)
    const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
    if (!apiKey) {
      return `[SSI Error: ${CONFIG.API_KEY_PROPERTY} script property not set. Go to Project Settings > Script Properties to add it.]`;
    }

    // Normalize and validate tool names
    const resolvedTools = flattenArg(toolNames).map((name) => {
      const decl = TOOL_REGISTRY[name];
      if (!decl) throw new Error(`unknown tool '${name}'`);
      return decl;
    });

    // Normalize inlineData: fetch and encode each Drive URL / file ID
    const resolvedInlineData =
      inlineData != null
        ? flattenArg(inlineData).map((url) => {
            const id = extractId(url);
            if (!id) throw new Error(`Could not extract a Drive file ID from: "${url}"`);
            return fetchAndEncodeFile(id);
          })
        : undefined;

    return callGeminiAPI({
      apiKey,
      systemPrompt: systemPrompt || undefined,
      userTexts: flattenArg(userTexts),
      inlineData: resolvedInlineData?.length ? resolvedInlineData : undefined,
      tools: resolvedTools.length ? resolvedTools : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `[SSI Error: ${msg}]`;
  }
}
