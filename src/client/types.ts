import type { ToolId } from "../shared/types";

// ── Loading / Progress types ─────────────────────────────────────────────────

export type LoadingStatus = "idle" | "loading" | "progress" | "complete" | "error";

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
// These are client-only — they define sidebar form structure, not RPC payloads.

export interface RecipeFieldConfig {
  value: string;
  locked?: boolean; // defaults to true
  placeholder?: string;
}

// ── Recipe column specs ──────────────────────────────────────────────────────

export interface PromptAppendField {
  id: string;
  label: string;
  placeholder?: string;
  /**
   * Text injected before the reporter's value when concatenating onto the base prompt.
   * e.g. "\n\nYou are specifically looking for:\n\n"
   * For system-prompt columns: required because Gemini systemInstruction is a single string.
   * For user-prompt columns: preferred to keep related inputs in one column (less sheet clutter).
   */
  prefix?: string;
}

export interface DriveColumnSpec {
  colTitle: RecipeFieldConfig;
  url: RecipeFieldConfig;
  helperText?: string;
}

export interface PromptColumnSpec {
  colTitle: RecipeFieldConfig;
  prompt: RecipeFieldConfig;
  appendFields?: PromptAppendField[];
  helperText?: string;
}

export interface OutputColumnSpec {
  colTitle: RecipeFieldConfig;
  helperText?: string;
}

export type ColumnSpec =
  | ({ kind: "drive-file-folder" } & DriveColumnSpec)
  | ({ kind: "drive-file-constant" } & DriveColumnSpec)
  | ({ kind: "system-prompt" } & PromptColumnSpec)
  | ({ kind: "user-prompt" } & PromptColumnSpec)
  | ({ kind: "output" } & OutputColumnSpec);

export interface RecipeSettings {
  tools?: ToolId[];
  applyMarkdown?: boolean;
  includeGrounding?: boolean;
  // future: modelId?: string;
}

export interface RecipeParams {
  columns: ColumnSpec[];
  /**
   * Optional recipe-level AI run settings pre-applied to RunConfig after Prep.
   * Reporters can still adjust them in ConfigureAIRunPanel.
   */
  settings?: RecipeSettings;
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
  panelId: PanelId;
  params?: RecipeParams;
}
