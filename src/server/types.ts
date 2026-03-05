/**
 * Server-only types. Never imported by client code.
 *
 * GeminiTool is an internal discriminated union used by buildGeminiPayload
 * to split tool IDs into the correct Gemini REST API payload shapes.
 * Grounding tools produce { google_search: {} } entries; function-calling
 * tools produce { function_declarations: [...] } entries — both in the same
 * tools array, but with different structures.
 */

import type { ToolId } from "../shared/types";

export interface AppConfig {
  API_KEY_PROPERTY: string;
  MODEL_NAME: string;
  MAX_FILE_SIZE_BYTES: number;
}

export interface GeminiInlineData {
  mime_type: string;
  data: string; // base64-encoded bytes
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>; // JSON Schema object
}

export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
}

export interface GeminiGroundingChunk {
  web?: { uri: string; title: string };
  retrievedContext?: { uri: string; title: string };
}

export interface GeminiGroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GeminiGroundingChunk[];
}

export interface GeminiCodePair {
  code: { language: string; code: string };
  result: { outcome: string; output: string };
}

/**
 * Structured representation of a Gemini generateContent response.
 * Returned by callGeminiAPI and invokeGemini in place of a bare string.
 */
export interface GeminiResponse {
  /** Assembled from all text parts in candidates[0].content.parts. */
  text: string;
  /** Present when google_search grounding was active. */
  groundingMetadata?: GeminiGroundingMetadata;
  /** Present when code_execution was active and code blocks were returned. */
  codePairs?: GeminiCodePair[];
}

/**
 * Discriminated union for Gemini REST API tool payload construction.
 * External callers pass ToolId[] — this type is internal to buildGeminiPayload,
 * which resolves IDs and acts on the kind discriminant to assemble the correct
 * payload shape for each tool category.
 * Lives here (rather than in api.ts) so TOOL_REGISTRY can reference it.
 */
export type GeminiTool =
  | { kind: "grounding"; id: ToolId }
  | { kind: "function"; declaration: GeminiFunctionDeclaration };

export interface DriveFileInfo {
  url: string;
}

export interface GeminiRequest {
  apiKey: string;
  modelName?: string; // defaults to CONFIG.MODEL_NAME if omitted
  systemPrompt?: string;
  userTexts: string[]; // assembled into parts: [{text}, {text}, ...]
  inlineData?: GeminiInlineData[]; // each item appended as an inline_data part
  /** Tool IDs to enable. Resolved against TOOL_REGISTRY in buildGeminiPayload. */
  tools?: ToolId[];
  generationConfig?: GeminiGenerationConfig;
}
