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
  /** Defaults to idleLabel. Omit when a consumer never calls setDone() (e.g.
   * a commit button whose success collapses the whole step, leaving no
   * "done" state to display). */
  doneLabel?: string;
}

export class AsyncActionButton {
  private state: AsyncButtonState = "idle";
  /** Externally-imposed enablement, independent of `state` -- persisted rather
   * than written straight to the DOM so a later state change (setIdle/setDone/
   * setLoading) recomputes `disabled` from BOTH inputs instead of clobbering
   * it. Without this, a step disabled by the editing-exclusivity gate silently
   * re-enabled itself the next time its own button state changed. */
  private interactive = true;

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

  /** Disables/enables the button independent of its own loading/idle/done
   * state -- used by a step to gray out its own action button while a
   * DIFFERENT step is mid-edit. Re-enabling can't spring a button loose
   * mid-request: render() keeps a loading button disabled whatever
   * `interactive` says. */
  setInteractive(enabled: boolean): void {
    this.interactive = enabled;
    this.render();
  }

  private render(): void {
    this.button.disabled = this.state === "loading" || !this.interactive;
    if (this.state === "loading") {
      this.button.innerHTML = `<span class="btn-spinner"></span>${this.config.loadingLabel}`;
    } else if (this.state === "done") {
      this.button.textContent = this.config.doneLabel ?? this.config.idleLabel;
    } else {
      this.button.textContent = this.config.idleLabel;
    }
  }
}
