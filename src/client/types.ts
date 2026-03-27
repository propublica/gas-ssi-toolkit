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

export type ColStrategyKind = "list-drive-folder" | "fill-value" | "create-empty";
export type ColRole = "userPrompt" | "systemPrompt" | "driveLink" | "output";

export interface AppendField {
  id: string;
  label: string;
  placeholder?: string;
  /** Text injected before the reporter's value, e.g. "\n\nYou are looking for:\n\n" */
  prefix?: string;
}

export interface RecipeSettings {
  tools?: ToolId[];
  applyMarkdown?: boolean;
  includeGrounding?: boolean;
}

export interface ColumnDef {
  /** UI section heading shown in the recipe panel */
  label: string;
  /** How this column maps into RunConfig after prep */
  role: ColRole;
  /** What PrepColSpec.strategy type to generate during prep */
  strategyKind: ColStrategyKind;
  /** Lockable column header field */
  colTitle: RecipeFieldConfig;
  /** Lockable prompt text — present for fill-value columns */
  prompt?: RecipeFieldConfig;
  /** Lockable URL input — present for drive columns */
  url?: RecipeFieldConfig;
  /** Extra reporter inputs composed into the prompt before prep */
  appendFields?: AppendField[];
  helperText?: string;
  /** Show * in section heading */
  required?: boolean;
}

export interface RecipeParams {
  columns: ColumnDef[];
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
