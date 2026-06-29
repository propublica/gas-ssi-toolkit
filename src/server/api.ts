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
import type { GeminiRequest, GeminiResponse, GeminiCodePair } from "./types";

/**
 * Assemble the Gemini generateContent request payload from a GeminiRequest.
 * Pure function — no GAS globals. Independently testable.
 */
export function buildGeminiPayload(req: GeminiRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    system_instruction: {
      parts: [{ text: req.systemPrompt || "You are a helpful assistant." }],
    },
    contents: [{ role: "user", parts: req.userParts }],
  };

  payload.generationConfig = {
    ...req.generationConfig,
  };

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
  const modelName = req.modelName ?? CONFIG.DEFAULT_MODEL;
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

  // Extract consecutive executableCode + codeExecutionResult pairs (camelCase REST JSON)
  const codePairs: GeminiCodePair[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const curr = parts[i];
    const next = parts[i + 1];
    if (curr["executableCode"] !== undefined && next["codeExecutionResult"] !== undefined) {
      codePairs.push({
        code: curr["executableCode"] as GeminiCodePair["code"],
        result: next["codeExecutionResult"] as GeminiCodePair["result"],
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
 * Call the Gemini generateContent endpoint for multiple requests in parallel using UrlFetchApp.fetchAll.
 * Unlike callGeminiAPI (which throws on error), the batch version maps errors to { text: "Error: ..." }
 * so one bad row does not abort the whole chunk.
 */
export function callGeminiAPIBatch(reqs: GeminiRequest[]): GeminiResponse[] {
  if (reqs.length === 0) return [];

  const requests = reqs.map((req) => {
    const modelName = req.modelName ?? CONFIG.DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${req.apiKey}`;
    return {
      url,
      method: "post" as const,
      contentType: "application/json",
      payload: JSON.stringify(buildGeminiPayload(req)),
      muteHttpExceptions: true,
    };
  });

  const responses = UrlFetchApp.fetchAll(requests);

  return responses.map((response) => {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(response.getContentText()) as Record<string, unknown>;
    } catch (_e) {
      return { text: `Error: invalid response body (HTTP ${response.getResponseCode()})` };
    }

    if (json.error) {
      return { text: `Error: ${(json.error as { message: string }).message}` };
    }

    const candidate = (json.candidates as Array<Record<string, unknown>> | undefined)?.[0];
    const parts =
      (candidate?.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts ?? [];

    const textParts = parts
      .filter((p): p is { text: string } => typeof p["text"] === "string")
      .map((p) => p.text);
    const text = textParts.join("\n\n") || "No response.";

    const codePairs: GeminiCodePair[] = [];
    for (let i = 0; i < parts.length - 1; i++) {
      const curr = parts[i];
      const next = parts[i + 1];
      if (curr["executableCode"] !== undefined && next["codeExecutionResult"] !== undefined) {
        codePairs.push({
          code: curr["executableCode"] as GeminiCodePair["code"],
          result: next["codeExecutionResult"] as GeminiCodePair["result"],
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
  });
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
