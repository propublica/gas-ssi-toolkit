/**
 * api.ts — Gemini API interaction via UrlFetchApp.
 *
 * Pure HTTP adapter. All preprocessing (Drive file fetching, base64 encoding,
 * text assembly) is the caller's responsibility.
 *
 * Requires oauth scope: https://www.googleapis.com/auth/script.external_request
 */

import { CONFIG } from "./config";
import type { GeminiInlineData, GeminiRequest } from "../shared/types";

interface GeminiPart {
  text?: string;
  inline_data?: GeminiInlineData;
}

/**
 * Assemble the Gemini generateContent request payload from a GeminiRequest.
 * Pure function — no GAS globals. Independently testable.
 */
export function buildGeminiPayload(req: GeminiRequest): Record<string, unknown> {
  const parts: GeminiPart[] = req.userTexts.map((text) => ({ text }));
  if (req.inlineData) {
    parts.push({ inline_data: req.inlineData });
  }

  const payload: Record<string, unknown> = {
    system_instruction: {
      parts: [{ text: req.systemPrompt || "You are a helpful assistant." }],
    },
    contents: [{ role: "user", parts }],
  };

  if (req.generationConfig) {
    payload.generationConfig = req.generationConfig;
  }

  if (req.tools && req.tools.length > 0) {
    payload.tools = [{ function_declarations: req.tools }];
  }

  return payload;
}

/**
 * Call the Gemini generateContent endpoint and return the response text.
 */
export function callGeminiAPI(req: GeminiRequest): string {
  const modelName = req.modelName ?? CONFIG.MODEL_NAME;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${req.apiKey}`;

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(buildGeminiPayload(req)),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText()) as Record<string, unknown>;

  if (json.error) throw new Error((json.error as { message: string }).message);
  const candidates = json.candidates as
    | Array<{ content: { parts: Array<{ text: string }> } }>
    | undefined;
  return candidates?.[0]?.content?.parts?.[0]?.text ?? "No response.";
}
