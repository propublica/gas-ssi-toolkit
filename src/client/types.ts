/**
 * All registered panel identifiers. Add new panels here first.
 */
export type PanelId = "tool-list" | "configure-ai-run" | "recipes-list" | "document-summarization";

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
