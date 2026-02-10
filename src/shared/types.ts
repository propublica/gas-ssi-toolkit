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

// ── AI Context ─────────────────────────────────────────────────

export type AIMode = "TEXT" | "FILE";

export interface TextContext {
  textContext: string;
  fileId?: never;
}

export interface FileContext {
  fileId: string;
  textContext?: never;
}

export type AIContext = TextContext | FileContext;

// ── Drive ──────────────────────────────────────────────────────

export interface DriveFileInfo {
  url: string;
}
