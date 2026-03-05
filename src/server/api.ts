/**
 * api.ts — Gemini API interaction via UrlFetchApp.
 *
 * Pure HTTP adapter. All preprocessing (Drive file fetching, base64 encoding,
 * text assembly) is the caller's responsibility.
 *
 * Requires oauth scope: https://www.googleapis.com/auth/script.external_request
 */

import { CONFIG } from "./config";
import { TOOL_REGISTRY } from "./tools";
import type {
  GeminiInlineData,
  GeminiRequest,
  GeminiResponse,
  GeminiCodePair,
  GeminiGroundingSupport,
} from "./types";

interface GeminiPart {
  text?: string;
  inline_data?: GeminiInlineData;
}

export interface Citation {
  startIndex: number;
  endIndex: number;
  sources: Array<{ uri: string; title: string }>;
}

/**
 * Assemble the Gemini generateContent request payload from a GeminiRequest.
 * Pure function — no GAS globals. Independently testable.
 */
export function buildGeminiPayload(req: GeminiRequest): Record<string, unknown> {
  const parts: GeminiPart[] = req.userTexts.map((text) => ({ text }));
  req.inlineData?.forEach((d) => parts.push({ inline_data: d }));

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
    const entries = req.tools.map((id) => TOOL_REGISTRY[id]);

    const groundingEntries = entries
      .filter((t): t is Extract<typeof t, { kind: "grounding" }> => t.kind === "grounding")
      .map((t) => ({ [t.id]: {} }));

    const functionDeclarations = entries
      .filter((t): t is Extract<typeof t, { kind: "function" }> => t.kind === "function")
      .map((t) => t.declaration);

    const toolsPayload = [
      ...groundingEntries,
      ...(functionDeclarations.length ? [{ function_declarations: functionDeclarations }] : []),
    ];

    payload.tools = toolsPayload;
  }

  return payload;
}

/**
 * Call the Gemini generateContent endpoint and return the response as GeminiResponse.
 */
export function callGeminiAPI(req: GeminiRequest): GeminiResponse {
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

  const candidate = (json.candidates as Array<Record<string, unknown>> | undefined)?.[0];
  const parts =
    (candidate?.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts ?? [];

  // Assemble text from all text parts (may be interspersed with code execution parts)
  const textParts = parts
    .filter((p): p is { text: string } => typeof p["text"] === "string")
    .map((p) => p.text);
  const text = textParts.join("\n\n") || "No response.";

  // Extract consecutive executable_code + code_execution_result pairs (snake_case REST JSON)
  const codePairs: GeminiCodePair[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const curr = parts[i];
    const next = parts[i + 1];
    if (curr["executable_code"] !== undefined && next["code_execution_result"] !== undefined) {
      codePairs.push({
        code: curr["executable_code"] as GeminiCodePair["code"],
        result: next["code_execution_result"] as GeminiCodePair["result"],
      });
      i++; // skip the result part — already consumed
    }
  }

  const groundingMetadata = candidate?.["groundingMetadata"] as
    | GeminiResponse["groundingMetadata"]
    | undefined;

  return {
    text,
    ...(groundingMetadata !== undefined && { groundingMetadata }),
    ...(codePairs.length > 0 && { codePairs }),
  };
}

/**
 * Resolve the Gemini API key from Script Properties and call callGeminiAPI.
 * This is the preferred entry point for all production Gemini calls.
 * Throws if the API key property is not set.
 */
export function invokeGemini(params: Omit<GeminiRequest, "apiKey">): GeminiResponse {
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
  if (!apiKey) throw new Error(`${CONFIG.API_KEY_PROPERTY} script property not set`);
  return callGeminiAPI({ apiKey, ...params });
}

/**
 * Resolve groundingSupports entries into Citation objects with sources
 * joined from groundingChunks by index. Pure — no GAS globals.
 */
export function getCitations(response: GeminiResponse): Citation[] {
  const supports = response.groundingMetadata?.groundingSupports ?? [];
  const chunks = response.groundingMetadata?.groundingChunks ?? [];
  return supports.map((s: GeminiGroundingSupport) => ({
    startIndex: s.segment.startIndex,
    endIndex: s.segment.endIndex,
    sources: s.groundingChunkIndices
      .map((i) => {
        const chunk = chunks[i];
        return chunk?.web ?? chunk?.retrievedContext ?? null;
      })
      .filter((src): src is { uri: string; title: string } => src !== null),
  }));
}
