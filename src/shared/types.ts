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
