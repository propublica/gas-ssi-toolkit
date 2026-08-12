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
export type ModelId = "gemini-3.1-flash-lite" | "gemini-3.1-pro-preview";

// ── Prompt column spec ──────────────────────────────────────────

/**
 * A reference to a spreadsheet column together with its prompt kind.
 * Crosses the RPC boundary in RunConfig.promptCols.
 */
export interface PromptColumnSpec {
  col: string;
  kind: "text" | "file" | "auto";
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
  /**
   * When true (default), each prompt part is wrapped in an XML-style tag named
   * after its source column, e.g. <case_notes>...</case_notes>. Absent is
   * treated as true — set explicitly to false to disable tag wrapping.
   */
  wrapPromptsInTags?: boolean;
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

// ── Run stats (cost/time tracking) ───────────────────────────────

/**
 * The subset of RunConfig that affects cost — used to detect whether a
 * cached RunStats is still relevant to the currently configured run.
 * Deliberately excludes outputCol, includeGrounding, and applyMarkdown,
 * which affect where/how output is written, not what it costs to generate.
 */
export type RunStatsConfigSnapshot = Pick<
  RunConfig,
  "promptCols" | "systemPromptCol" | "tools" | "wrapPromptsInTags" | "model"
>;

/**
 * Measured cost/time/token stats from a single runBatchAI invocation
 * (a full run, one chunk of a full run, or a capped Test click).
 * Stores totals, not averages — per-row figures are a trivial division
 * wherever displayed.
 */
export interface RunStats {
  /** Rows successfully measured (had usageMetadata in the response). */
  rowCount: number;
  /** Wall-clock time for the whole invocation. */
  totalTimeMs: number;
  /** Sum of promptTokenCount (already includes tool-use/cached-content overhead). */
  totalInputTokens: number;
  /** Sum of (candidatesTokenCount + thoughtsTokenCount) — both billed at the output rate. */
  totalOutputTokens: number;
  /** USD, token pricing only. */
  totalTokenCost: number;
  /** Sum of groundingMetadata.webSearchQueries.length across measured rows. */
  totalGroundingQueries: number;
  /** USD, at the Standard grounding rate. Ignores the shared monthly free quota. */
  totalGroundingCost: number;
  /** Timestamp (ms) when this invocation started. */
  testedAt: number;
  config: RunStatsConfigSnapshot;
}
