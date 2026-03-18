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

/**
 * All registered panel identifiers. Add new panels here first.
 */
export type PanelId = "tool-list" | "configure-ai-run" | "recipes-list" | "recipe";

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
