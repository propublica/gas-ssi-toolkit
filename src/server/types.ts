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
  /**
   * Inline data size limits for the Gemini REST API.
   * Source: https://ai.google.dev/gemini-api/docs/file-input-methods#method-comparison
   *
   * - Total request ceiling: 100MB (post-encoded, all inline_data parts combined)
   * - Per-PDF ceiling: 50MB (post-encoded, per individual PDF file)
   * - Base64 encoding expands raw file size by exactly 4/3
   *
   * We apply a 5% safety buffer to both ceilings to account for:
   *   1. JSON envelope overhead (prompt text, mime_type fields, etc.)
   *   2. Exported file size uncertainty (Docs/Sheets native size before export is unknown)
   *
   * For files exceeding these limits, consider the Gemini Files API (up to 2GB,
   * no base64 overhead): https://ai.google.dev/api/files
   */
  INLINE_MAX_TOTAL_BYTES: number; // 95MB (100MB ceiling × 0.95)
  INLINE_MAX_PDF_BYTES: number; // 47MB (50MB ceiling × 0.95)
  INLINE_PREFLIGHT_FACTOR: number; // exact base64 expansion ratio (4/3)
  MAX_OUTPUT_TOKENS: number;
}

export interface GeminiInlineData {
  mime_type: string;
  data: string; // base64-encoded bytes
}

export interface GeminiFileApiData {
  mime_type: string;
  /** URI returned by the Gemini Files API after uploading a file. */
  file_uri: string;
}

/**
 * A single part of the user turn in a Gemini request.
 *
 * - "text"        — plain text content in the user turn.
 * - "inline_data" — base64-encoded file bytes embedded in the request body; used when
 *                   file size is within the inline limit (~100 MB encoded).
 * - "file_uri"    — reference to a file uploaded via the Gemini Files API (up to 2 GB);
 *                   no producer exists yet. Type and payload path reserved for a future
 *                   phase when large-file support is wired up in drive.ts.
 *
 * Order within userParts[] is preserved through to the Gemini REST payload.
 */
export type GeminiUserPart =
  | { kind: "text"; text: string }
  | { kind: "inline_data"; data: GeminiInlineData }
  | { kind: "file_uri"; data: GeminiFileApiData };

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

export interface GeminiGroundingSupport {
  segment: {
    startIndex: number;
    endIndex: number;
    text: string;
  };
  groundingChunkIndices: number[];
  confidenceScores?: number[];
}

export interface GeminiGroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GeminiGroundingChunk[];
  groundingSupports?: GeminiGroundingSupport[];
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
  /** Ordered user-turn parts assembled by the caller. Maps 1:1 to contents[0].parts in the REST payload. */
  userParts: GeminiUserPart[];
  /** Tool IDs to enable. Resolved against TOOL_REGISTRY in buildGeminiPayload. */
  tools?: ToolId[];
  generationConfig?: GeminiGenerationConfig;
}
