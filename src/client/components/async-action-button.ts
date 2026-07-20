/**
 * async-action-button.ts — Reusable disable/spinner/label state for a single
 * button that fires an async action the panel wants to show progress for.
 *
 * Purely a state display: it owns no click listener and no async logic of
 * its own — the owning panel drives it explicitly (setLoading/setDone/setIdle)
 * at whatever points its own orchestration reaches. This lets "done" be set
 * directly without a click having happened at all (e.g. restoring an
 * already-successful result from saved state), which an onClick-owning
 * component couldn't express.
 */

export type AsyncButtonState = "idle" | "loading" | "done";

export interface AsyncActionButtonConfig {
  idleLabel: string;
  loadingLabel: string;
  doneLabel: string;
}

export class AsyncActionButton {
  private state: AsyncButtonState = "idle";

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly config: AsyncActionButtonConfig,
  ) {
    this.render();
  }

  getState(): AsyncButtonState {
    return this.state;
  }

  setLoading(): void {
    this.state = "loading";
    this.render();
  }

  setDone(): void {
    this.state = "done";
    this.render();
  }

  setIdle(): void {
    this.state = "idle";
    this.render();
  }

  private render(): void {
    this.button.disabled = this.state === "loading";
    if (this.state === "loading") {
      this.button.innerHTML = `<span class="btn-spinner"></span>${this.config.loadingLabel}`;
    } else if (this.state === "done") {
      this.button.textContent = this.config.doneLabel;
    } else {
      this.button.textContent = this.config.idleLabel;
    }
  }
}
