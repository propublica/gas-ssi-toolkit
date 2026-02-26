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

// ── Recipes ────────────────────────────────────────────────────

export interface RecipeFieldConfig {
  value: string;
  locked?: boolean; // defaults to true
  placeholder?: string;
}

export interface RecipeParams {
  driveFolder?: {
    colTitle: string;
    helperText?: string;
  };
  systemPrompt?: {
    colTitle: RecipeFieldConfig;
    prompt: RecipeFieldConfig;
  };
  userPrompts?: Array<{
    colTitle: RecipeFieldConfig;
    prompt: RecipeFieldConfig;
  }>;
  outputCol?: {
    colTitle: RecipeFieldConfig;
  };
}

export interface PrepRecipeParams {
  driveFolder?: { url: string; colTitle: string };
  systemPrompt?: { colTitle: string; value: string };
  userPrompts?: Array<{ colTitle: string; value: string }>;
  outputCol?: { colTitle: string };
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
  colNames: {
    driveLink?: string;
    systemPrompt?: string;
    userPrompts?: string[];
    outputCol?: string;
  };
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
