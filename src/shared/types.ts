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

// ── Configuration ───────────────────────────────────────────────

export interface RunConfig {
  userPromptCols: string[];
  driveFileCols?: string[];
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
   * Future: recipes could pre-set this via PrepRecipeParams/PrepRecipeResult —
   * follow the tools echo pattern if needed.
   */
  applyMarkdown?: boolean;
}

// ── Recipes ─────────────────────────────────────────────────────

export interface PrepRecipeParams {
  driveFolder?: { url: string; colTitle: string };
  systemPrompt?: { colTitle: string; value: string };
  userPrompts?: Array<{ colTitle: string; value: string }>;
  outputCol?: { colTitle: string };
  /**
   * Tool IDs to pass through to PrepRecipeResult.
   * The server does not process these during prep — they are echoed back
   * to preserve the single-source-of-truth invariant for preppedRunConfig.
   */
  tools?: ToolId[];
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
  colNames: {
    driveLink?: string;
    systemPrompt?: string;
    userPrompts?: string[];
    outputCol?: string;
  };
  /** Echoed from PrepRecipeParams — no server-side processing. */
  tools?: ToolId[];
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
  /** Inclusive row range (1-based data rows) over which extraction runs. */
  rowRange: { start: number; end: number };
}
