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
  /**
   * Ordered parts of the user message. Each part references a column by header name.
   * Text parts are read as strings; file parts are fetched from Drive and encoded
   * as inline data. Order is preserved in the Gemini request.
   */
  userPromptParts: Array<{ kind: "text" | "file"; col: string }>;
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
   * Recipe settings can pre-set this via PrepRecipeParams/PrepRecipeResult settings echo.
   */
  applyMarkdown?: boolean;
}

// ── Recipes ─────────────────────────────────────────────────────

export type ColumnKind =
  | "drive-file-folder"
  | "drive-file-constant"
  | "system-prompt"
  | "user-prompt"
  | "output";

export interface PrepRecipeParams {
  columns: Array<
    | { kind: "drive-file-folder"; colTitle: string; url: string }
    | { kind: "drive-file-constant"; colTitle: string; url: string }
    | { kind: "system-prompt"; colTitle: string; text: string }
    | { kind: "user-prompt"; colTitle: string; text: string }
    | { kind: "output"; colTitle: string }
  >;
  /**
   * Non-column settings echoed back in PrepRecipeResult without server processing.
   * Preserves single-source-of-truth for RunConfig assembly on the client.
   */
  settings?: {
    tools?: ToolId[];
    applyMarkdown?: boolean;
    includeGrounding?: boolean;
  };
}

export interface PrepRecipeResult {
  rowRange: { start: number; end: number };
  /**
   * Columns as written to the sheet, in the same order as PrepRecipeParams.columns.
   * The client assembles RunConfig from this — it is the single source of truth.
   */
  columns: Array<{ kind: ColumnKind; colTitle: string }>;
  /** Echoed from PrepRecipeParams.settings — no server-side processing. */
  settings?: {
    tools?: ToolId[];
    applyMarkdown?: boolean;
    includeGrounding?: boolean;
  };
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
