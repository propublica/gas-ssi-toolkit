import type { PrepColSpec, RunConfig, RunStats } from "../shared/types";

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

// ── Step framework (Guided AI Inference) ──────────────────────────
// Positional, not kind-based: whether completing a step collapses it and
// unlocks a next step, or leaves it expanded forever, is decided by the
// StepFlow shell based on array position — the last step behaves
// differently, but nothing on the step itself declares that.

export interface StepContext {
  /** Called by the step, at its own discretion, when it considers its own
   * designated action to have succeeded. May be called more than once —
   * the shell's handling of this is idempotent. */
  onComplete(): void;
  /** Purely cosmetic — flips this step's checklist icon to a red ✕. Does
   * NOT change locked/active/complete status. The step itself is
   * responsible for surfacing the failure to the user — currently via
   * `globalThis.alert()`, consistent with how every other RPC-failure path
   * in this codebase reports errors. The shell only ever renders the icon,
   * never message text. */
  onError(): void;
}

export interface Step<S = unknown> {
  title: string;
  flavorText: string;
  mount(container: HTMLElement, ctx: StepContext, savedState?: S): void;
  unmount(): { savedState: S; summary: string } | undefined;
  /** Optional. Called by the shell immediately after construction for any
   * step that is NOT being mounted this session (locked, or complete and
   * collapsed) but has cached savedState from a prior session — so a later
   * step's derived result (e.g. via getResult()) stays correct even when
   * this step is never re-mounted after a panel reload. Steps whose result
   * is entirely derivable from their own savedState should implement this;
   * omit it if nothing downstream depends on this step's derived state. */
  hydrate?(savedState: S): void;
  /** Optional. Tears down anything unmount() doesn't (and can't, since
   * unmount() is also called on steps that remain visibly mounted -- see
   * StepFlow.getValue()) -- e.g. a step's own TokenInput instances, whose
   * document-level listeners outlive their container's DOM otherwise.
   * Called by StepFlow.destroy() when the whole flow is being discarded. */
  destroy?(): void;
}

export interface StepFlowSavedState {
  activeStepIndex: number;
  steps: Array<{
    status: "locked" | "active" | "complete";
    saved?: { savedState: unknown; summary: string };
  }>;
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
  "tools" | "applyMarkdown" | "includeGrounding" | "wrapPromptsInTags" | "model"
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
  | "guided-ai-inference"
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

// ── Run AI test display ──────────────────────────────────────────
// Client-only — the server has no concept of an "uncapped" row count, only
// the capped test range it actually ran. Bundled with its RunStats into one
// object (rather than two parallel fields on the panel) so the two values
// can never be set or cleared out of sync with each other.

export interface TestRunDisplay {
  stats: RunStats;
  /** The full (uncapped) row count the test's range was resolved from, before capping to 10 rows. */
  fullRowCount: number;
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
