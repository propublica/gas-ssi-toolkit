import type { PrepColSpec, RunConfig } from "../shared/types";

// ── Recipe column types ──────────────────────────────────────────

/**
 * The AI inference role this column plays at run time.
 * Lives client-side only — the server never reads it.
 */
export type ColumnRole = "file-prompt" | "text-prompt" | "system-prompt" | "output";

/**
 * What recipe authors write: the RPC-crossing PrepColSpec plus the
 * client-only role that determines the column's place in the AI call.
 */
export interface RecipeColumn extends PrepColSpec {
  role?: ColumnRole;
}

// ── Loading / Progress types ─────────────────────────────────────────────────

export type LoadingStatus = "idle" | "loading" | "progress" | "cancelling" | "complete" | "error";

export interface LoadingState {
  status: LoadingStatus;
  message?: string;
  current?: number;
  total?: number;
}

export interface Job {
  id: string;
  label: string;
  state: LoadingState;
  startedAt: number;
  completedAt?: number;
}

// ── Recipe UI types ─────────────────────────────────────────────
// These are client-only — they define the journalist-facing form, not RPC payloads.

/**
 * Non-column AI settings a recipe can pre-configure.
 * These flow into RunConfig at cook time alongside the derived column references.
 * Typed as a Pick so it stays in sync with RunConfig automatically.
 */
export type RecipeSettings = Pick<
  RunConfig,
  "tools" | "applyMarkdown" | "includeGrounding" | "prefixWithColName"
>;

export interface RecipeInput {
  /**
   * Unique identifier for this input. Used as the key in template interpolation
   * (e.g. a fill strategy of `{{folder}}` resolves from `inputValues["folder"]`).
   *
   * Must be camelCase or underscore_separated — no hyphens. The interpolation
   * regex uses `\w+` which does not match `-`.
   */
  id: string;
  label: string;
  required?: boolean;
  helperText?: string;
  placeholder?: string;
}

/**
 * All registered panel identifiers. Add new panels here first.
 */
export type PanelId =
  | "tool-list"
  | "configure-ai-run"
  | "recipes-list"
  | "recipe"
  | "import-drive-links"
  | "extract-text";

/**
 * Passed to each panel's mount() so panels can trigger navigation
 * without importing the router directly.
 */
export interface NavigationContext {
  navigate(panelId: PanelId, params?: unknown): void;
  back(): void;
  canGoBack(): boolean;
}

/**
 * Contract every panel class must satisfy.
 * P = params type received on mount (from the calling panel).
 * S = saved state type returned by unmount (preserved on the stack).
 */
export interface Panel<P = unknown, S = unknown> {
  mount(container: HTMLElement, nav: NavigationContext, params?: P, savedState?: S): void;
  unmount(): S | undefined;
}

export interface RecipeDefinition {
  id: string;
  name: string;
  icon: string;
  description: string;
  /** Optional longer description rendered at the top of the recipe panel. */
  intro?: string;
  /** Journalist-facing form fields. Drives RecipePanel rendering. */
  inputs: RecipeInput[];
  /**
   * Column template passed to prepRecipe(). Each column's role field determines
   * its place in the AI call — promptCols, systemPromptCol, outputCol are derived
   * from these roles at cook time via buildRunTemplate().
   */
  prepTemplate: RecipeColumn[];
  /** Non-column AI settings (tools, markdown, grounding, etc.). */
  settings?: RecipeSettings;
}
