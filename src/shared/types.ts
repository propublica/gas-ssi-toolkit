/**
 * Shared types for the SSI Toolkit.
 *
 * IMPORTANT: This file is the client↔server RPC boundary.
 * Only types that cross google.script.run calls belong here.
 * - Server-only types (Gemini API shapes, AppConfig): src/server/types.ts
 * - Client-only types (UI, panels, recipes): src/client/types.ts
 */

// ── Tool vocabulary ─────────────────────────────────────────────

/**
 * All tool IDs recognized by the toolkit.
 * Extend this union when adding a new tool — the compiler will then
 * require a matching entry in TOOL_REGISTRY (server/tools.ts)
 * and TOOL_CATALOG (client/tools.ts).
 */
export type ToolId = "google_search" | "url_context" | "code_execution";

/**
 * All model IDs supported by the toolkit.
 * Extend this union when adding a new model option.
 */
export type ModelId = "gemini-3.1-flash-lite" | "gemini-3.5-flash" | "gemini-3.1-pro-preview";

// ── Prompt column spec ──────────────────────────────────────────

/**
 * A reference to a spreadsheet column together with its prompt kind.
 * Crosses the RPC boundary in RunConfig.promptCols.
 */
export interface PromptColumnSpec {
  col: string;
  kind: "text" | "file";
}

// ── Configuration ───────────────────────────────────────────────

export interface RunConfig {
  promptCols: PromptColumnSpec[];
  systemPromptCol?: string;
  outputCol: string;
  rowRange?: { start: number; end: number };
  /** Tool IDs to enable for every row in this run. */
  tools?: ToolId[];
  /** When true, runBatchAI writes a {outputCol}_grounding column with source attribution. */
  includeGrounding?: boolean;
  /**
   * When true, runBatchAI applies markdown parsing and rich text formatting to the output
   * column. When false (default), result.text is written directly via setValue.
   * The grounding column is unaffected by this setting.
   *
   * Recipes pre-set this via RecipeSettings (client-only) — it flows into RunConfig
   * through buildRunConfig() without any server echo.
   */
  applyMarkdown?: boolean;
  /** When true, each text prompt part is prefixed with its source column name as "<col>: <value>". */
  prefixWithColName?: boolean;
  /** Model ID to use for this run. When omitted, defaults to CONFIG.DEFAULT_MODEL. */
  model?: ModelId;
}

// ── Recipes ─────────────────────────────────────────────────────

export type FillStrategy =
  | { kind: "list-drive-folder"; inputId: string }
  | { kind: "fill-value"; value: string }
  | { kind: "template"; template: string }
  | { kind: "create-empty" };

export interface PrepColSpec {
  colTitle: string;
  fillStrategy: FillStrategy;
}

export interface PrepRecipeParams {
  cols: PrepColSpec[];
  inputValues: Record<string, string>;
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
}

// ── Import Drive Links ───────────────────────────────────────────

export interface ImportDriveLinksConfig {
  folderUrl: string;
  outputCol: string;
  /** MIME type prefix strings. Absent = import all files. */
  mimeTypes?: string[];
}

// ── Extract Text ────────────────────────────────────────────────

export interface ExtractTextConfig {
  /** Header of the column containing Drive links or file IDs to extract text from. */
  sourceCol: string;
  /** Header of the column where extracted text will be written. */
  outputCol: string;
  /** Inclusive row range (1-based data rows) over which extraction runs. Absent = use active sheet selection. */
  rowRange?: { start: number; end: number };
}
