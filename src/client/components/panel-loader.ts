import type { LoadingState } from "../types";

/**
 * Drives the pre-structured panel loading skeleton.
 *
 * The container must already contain the following markup (typically
 * injected by the panel's template() method):
 *
 *   <div id="panel-loader" class="panel-loader" hidden>
 *     <div class="panel-loader__bar-wrap" hidden>
 *       <div class="panel-loader__bar-fill"></div>
 *     </div>
 *     <div class="panel-loader__spinner" hidden></div>
 *     <p class="panel-loader__message"></p>
 *   </div>
 */
export class PanelLoader {
  private el: HTMLElement;
  private barWrap: HTMLElement;
  private barFill: HTMLElement;
  private spinner: HTMLElement;
  private message: HTMLElement;

  constructor(container: HTMLElement) {
    const el = container.querySelector<HTMLElement>("#panel-loader");
    if (!el) throw new Error("PanelLoader: #panel-loader not found in container");
    const barWrap = el.querySelector<HTMLElement>(".panel-loader__bar-wrap");
    if (!barWrap) throw new Error("PanelLoader: .panel-loader__bar-wrap not found");
    const barFill = el.querySelector<HTMLElement>(".panel-loader__bar-fill");
    if (!barFill) throw new Error("PanelLoader: .panel-loader__bar-fill not found");
    const spinner = el.querySelector<HTMLElement>(".panel-loader__spinner");
    if (!spinner) throw new Error("PanelLoader: .panel-loader__spinner not found");
    const message = el.querySelector<HTMLElement>(".panel-loader__message");
    if (!message) throw new Error("PanelLoader: .panel-loader__message not found");

    this.el = el;
    this.barWrap = barWrap;
    this.barFill = barFill;
    this.spinner = spinner;
    this.message = message;
  }

  setState(state: LoadingState): void {
    if (state.status === "idle") {
      this.el.hidden = true;
      return;
    }

    this.el.hidden = false;

    const hasDeterminate = state.current !== undefined && state.total !== undefined;
    this.barWrap.hidden = !hasDeterminate;
    this.spinner.hidden = hasDeterminate;

    if (hasDeterminate) {
      const pct = Math.round((state.current! / state.total!) * 100);
      this.barFill.style.width = `${Math.min(pct, 100)}%`;
    }

    this.message.textContent = state.message ?? "";
  }
}
