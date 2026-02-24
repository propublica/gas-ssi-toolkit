/**
 * Shared types for the SSI Drive & AI Tools project.
 */

// ── Configuration ──────────────────────────────────────────────

export interface AppConfig {
  API_KEY_PROPERTY: string;
  MODEL_NAME: string;
  MAX_FILE_SIZE_BYTES: number;
}

export interface RunConfig {
  userPromptCols: string[];
  driveFileCols?: string[];
  systemPromptCol?: string;
  outputCol: string;
  rowRange?: { start: number; end: number };
}

// ── Gemini API ─────────────────────────────────────────────────

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

export interface GeminiRequest {
  apiKey: string;
  modelName?: string; // defaults to CONFIG.MODEL_NAME if omitted
  systemPrompt?: string;
  userTexts: string[]; // assembled into parts: [{text}, {text}, ...]
  inlineData?: GeminiInlineData[]; // each item appended as an inline_data part
  tools?: GeminiFunctionDeclaration[];
  generationConfig?: GeminiGenerationConfig;
}

// ── Drive ──────────────────────────────────────────────────────

export interface DriveFileInfo {
  url: string;
}
