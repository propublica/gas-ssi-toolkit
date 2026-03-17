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
    this.el = container.querySelector("#panel-loader")!;
    this.barWrap = this.el.querySelector(".panel-loader__bar-wrap")!;
    this.barFill = this.el.querySelector(".panel-loader__bar-fill")!;
    this.spinner = this.el.querySelector(".panel-loader__spinner")!;
    this.message = this.el.querySelector(".panel-loader__message")!;
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
