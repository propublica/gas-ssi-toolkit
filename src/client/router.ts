import type { Panel, PanelId, NavigationContext } from "./types";

interface StackEntry {
  panelId: PanelId;
  params?: unknown;
  savedState?: unknown;
}

export class Router {
  private stack: StackEntry[] = [];
  private currentPanel: Panel | null = null;
  private readonly panels: Map<PanelId, Panel>;
  private readonly container: HTMLElement;

  constructor(container: HTMLElement, panels: Map<PanelId, Panel>) {
    this.container = container;
    this.panels = panels;
  }

  start(initialPanelId: PanelId): void {
    const panel = this.panels.get(initialPanelId);
    if (!panel) throw new Error(`Unknown panel: ${initialPanelId}`);
    this.stack = [{ panelId: initialPanelId }];
    this.currentPanel = panel;
    this.container.innerHTML = "";
    panel.mount(this.container, this.makeNav(), undefined, undefined);
  }

  navigate(panelId: PanelId, params?: unknown): void {
    const panel = this.panels.get(panelId);
    if (!panel) throw new Error(`Unknown panel: ${panelId}`);
    if (this.currentPanel && this.stack.length > 0) {
      this.stack[this.stack.length - 1].savedState = this.currentPanel.unmount();
    }
    this.stack.push({ panelId, params });
    this.currentPanel = panel;
    this.container.innerHTML = "";
    panel.mount(this.container, this.makeNav(), params, undefined);
  }

  back(): void {
    if (this.stack.length <= 1) return;
    this.currentPanel?.unmount();
    this.stack.pop();
    const entry = this.stack[this.stack.length - 1];
    const panel = this.panels.get(entry.panelId)!;
    this.currentPanel = panel;
    this.container.innerHTML = "";
    panel.mount(this.container, this.makeNav(), entry.params, entry.savedState);
  }

  canGoBack(): boolean {
    return this.stack.length > 1;
  }

  private makeNav(): NavigationContext {
    return {
      navigate: (id, params) => this.navigate(id, params),
      back: () => this.back(),
      canGoBack: () => this.canGoBack(),
    };
  }
}
