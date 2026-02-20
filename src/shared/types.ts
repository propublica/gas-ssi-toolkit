/**
 * Shared types for the SSI Drive & AI Tools project.
 */

// ── Configuration ──────────────────────────────────────────────

export interface AppConfig {
  API_KEY_PROPERTY: string;
  MODEL_NAME: string;
  MAX_FILE_SIZE_BYTES: number;
  COLUMNS: ColumnConfig;
}

export interface ColumnConfig {
  SOURCE_DRIVE: string;
  SOURCE_TEXT: string;
  SYS_PROMPT: string;
  USER_PROMPT: string;
  OUTPUT: string;
}

// ── Column Mapping ─────────────────────────────────────────────

export interface ColumnMap {
  source_drive: number;
  source_text: number;
  sys_prompt: number;
  user_prompt: number;
  output: number;
}

// ── AI Mode ────────────────────────────────────────────────────
export type AIMode = "TEXT" | "FILE";

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
  inlineData?: GeminiInlineData; // appended as a final part if present
  tools?: GeminiFunctionDeclaration[];
  generationConfig?: GeminiGenerationConfig;
}

// ── Drive ──────────────────────────────────────────────────────

export interface DriveFileInfo {
  url: string;
}
