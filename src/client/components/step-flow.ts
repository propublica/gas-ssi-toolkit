import type { Step, StepContext, StepFlowSavedState } from "../types";
import { truncate } from "../format";

const SUMMARY_MAX_LENGTH = 60;

export interface StepFlowOptions {
  /** Called whenever the editing-exclusivity gate opens or closes (Edit
   * clicked on a step, or that edit resolving via Cancel or a successful
   * recommit) -- lets the host panel disable its own chrome (e.g. a
   * "Refresh columns" button) while an edit is unresolved elsewhere. */
  onEditingChange?: (isEditing: boolean) => void;
}

/** A row's DOM parts, captured once at build time so later renders read/write
 * them directly instead of re-querying the row's subtree on every update. */
interface RowRefs {
  icon: HTMLElement;
  /** Edit and Cancel share one slot -- see applyRowDisplay for why a row
   * never needs both at once. */
  actionBtn: HTMLButtonElement;
  summary: HTMLElement;
  flavor: HTMLElement;
  body: HTMLElement;
}

export class StepFlow {
  private readonly container: HTMLElement;
  private readonly steps: Step[];
  private statuses: Array<"locked" | "active" | "complete">;
  private savedByIndex: Array<{ savedState: unknown; summary: string } | undefined>;
  private hasErrorByIndex: boolean[];
  private busyByIndex: boolean[];
  /** activeIndex to restore on Cancel, recorded by editStep(); null when the
   * step isn't currently mid-edit. */
  private preEditActiveIndex: Array<number | null>;
  /** Status the step at preEditActiveIndex[index] had before editStep(index)
   * collapsed it, so cancelEdit() can restore it exactly (an ordinary step
   * reopens as "active"; the terminal step may reopen as "complete" if it
   * had already finished a run). null when editStep(index) found nothing to
   * collapse. */
  private preEditRelockedStatus: Array<"active" | "complete" | null>;
  /** Index of the step currently mid-edit (Edit clicked, not yet resolved
   * by Cancel or a successful recommit), or null when nothing is being
   * edited. At most one step is ever mid-edit at a time. */
  private editingIndex: number | null = null;
  private readonly onEditingChange?: (isEditing: boolean) => void;
  private activeIndex: number;
  private rowEls: HTMLElement[] = [];
  private rowRefs: RowRefs[] = [];

  constructor(
    container: HTMLElement,
    steps: Step[],
    savedState?: StepFlowSavedState,
    options?: StepFlowOptions,
  ) {
    if (steps.length === 0) throw new Error("StepFlow requires at least one step");
    this.container = container;
    this.steps = steps;
    this.onEditingChange = options?.onEditingChange;

    if (savedState) {
      this.statuses = savedState.steps.map((s) => s.status);
      this.savedByIndex = savedState.steps.map((s) => s.saved);
      this.activeIndex = savedState.activeStepIndex;
    } else {
      this.statuses = steps.map((_, i) => (i === 0 ? "active" : "locked"));
      this.savedByIndex = steps.map(() => undefined);
      this.activeIndex = 0;
    }
    this.hasErrorByIndex = steps.map(() => false);
    this.busyByIndex = steps.map(() => false);
    this.preEditActiveIndex = steps.map(() => null);
    this.preEditRelockedStatus = steps.map(() => null);

    this.container.innerHTML = "";
    this.rowEls = steps.map((step, i) => this.buildRow(step, i));
    this.rowEls.forEach((row) => this.container.appendChild(row));
    steps.forEach((_, i) => {
      if (this.isMountedState(i)) this.mountStep(i);
      if (this.savedByIndex[i]) steps[i].hydrate?.(this.savedByIndex[i]!.savedState);
    });
  }

  /** Tears down every step's own resources (see Step.destroy). Call this only
   * when the flow itself is being discarded, not on every getValue(). */
  destroy(): void {
    this.steps.forEach((step) => step.destroy?.());
  }

  getValue(): StepFlowSavedState {
    this.steps.forEach((_, i) => {
      if (this.isMountedState(i)) this.recordUnmount(i, this.steps[i].unmount());
    });
    return {
      activeStepIndex: this.activeIndex,
      steps: this.statuses.map((status, i) => ({ status, saved: this.savedByIndex[i] })),
    };
  }

  /** The single place an unmount() result is ever stored. Truncates the
   * summary here, once, at the moment a step hands over its final data --
   * not on every render, since a collapsed step's summary never changes
   * again after this point. */
  private recordUnmount(
    index: number,
    result: { savedState: unknown; summary: string } | undefined,
  ): void {
    if (!result) return;
    this.savedByIndex[index] = { ...result, summary: truncate(result.summary, SUMMARY_MAX_LENGTH) };
  }

  private isLastStep(index: number): boolean {
    return index === this.steps.length - 1;
  }

  private isMountedState(index: number): boolean {
    const status = this.statuses[index];
    return status !== "locked" && !(status === "complete" && !this.isLastStep(index));
  }

  private iconFor(index: number): string {
    if (this.hasErrorByIndex[index]) return "✕";
    if (this.statuses[index] === "complete") return "✓";
    if (this.statuses[index] === "locked") return "○";
    return "●";
  }

  private buildRow(step: Step, index: number): HTMLElement {
    const row = document.createElement("div");
    row.className = `step-row step-row--${this.statuses[index]}`;
    row.setAttribute("data-step-index", String(index));
    row.innerHTML = `
      <div class="step-header">
        <span class="step-icon">${this.iconFor(index)}</span>
        <span class="step-title-text">${step.title}</span>
        <button type="button" class="step-action-btn" hidden></button>
      </div>
      <p class="step-summary" hidden></p>
      <p class="step-flavor-text" hidden></p>
      <div class="step-body" hidden></div>
    `;
    const refs: RowRefs = {
      icon: row.querySelector<HTMLElement>(".step-icon")!,
      actionBtn: row.querySelector<HTMLButtonElement>(".step-action-btn")!,
      summary: row.querySelector<HTMLElement>(".step-summary")!,
      flavor: row.querySelector<HTMLElement>(".step-flavor-text")!,
      body: row.querySelector<HTMLElement>(".step-body")!,
    };
    // Dispatches on the button's own current mode rather than a fixed
    // handler -- Edit and Cancel are never both on offer for a row (see
    // applyRowDisplay), so whichever the button is showing is what a click
    // means.
    refs.actionBtn.addEventListener("click", () => {
      if (refs.actionBtn.dataset.mode === "cancel") this.cancelEdit(index);
      else this.editStep(index);
    });
    this.rowRefs[index] = refs;
    this.applyRowDisplay(index);
    return row;
  }

  private applyRowDisplay(index: number): void {
    const step = this.steps[index];
    const status = this.statuses[index];
    const expanded = this.isMountedState(index);
    const refs = this.rowRefs[index];

    // Only a genuinely "complete" step offers [Edit] -- a relocked step must
    // be reached by walking forward through the intervening locked steps,
    // not jumped to directly.
    const showEdit = status === "complete" && !this.isLastStep(index);
    // Keyed on editingIndex -- the authoritative "this step is actually being
    // edited" signal -- NOT on the old "active && has cached data" heuristic.
    // After a recommit's relock cascade the immediate-next step is legitimately
    // "active" WITH cached data without anyone having clicked its [Edit], and
    // offering Cancel there used to strand the panel with no step expanded at
    // all (cancelEdit would collapse it while everything downstream stayed
    // locked). Also excludes: the terminal step (never offers Cancel, even
    // while its own Test/Run holds editingIndex -- see handleBusyChange) and a
    // step with no cached data yet (editingIndex can now be held by a step's
    // OWN first-time-completion request, which has nothing to cancel back to).
    const showCancel =
      this.editingIndex === index &&
      !this.isLastStep(index) &&
      this.savedByIndex[index] !== undefined;
    // showEdit and showCancel are mutually exclusive: editingIndex === index
    // only while that row's own status is "active" (set by editStep() /
    // handleBusyChange()), never "complete" -- so a row is never asked to
    // show both, and one <button> can serve as both slots.
    refs.actionBtn.hidden = !showEdit && !showCancel;
    if (showCancel) {
      refs.actionBtn.textContent = "Cancel";
      refs.actionBtn.dataset.mode = "cancel";
      refs.actionBtn.disabled = this.busyByIndex[index];
    } else if (showEdit) {
      refs.actionBtn.textContent = "Edit";
      refs.actionBtn.dataset.mode = "edit";
      refs.actionBtn.disabled = this.editingIndex !== null && this.editingIndex !== index;
    }

    // Independent of showEdit/showCancel: any collapsed, non-terminal step
    // with cached data shows its summary, whether that's because it's
    // complete OR because it relocked with its old data still intact.
    const hasSummary =
      !expanded && !this.isLastStep(index) && this.savedByIndex[index] !== undefined;
    refs.summary.hidden = !hasSummary;
    refs.summary.textContent = this.savedByIndex[index]?.summary ?? "";

    refs.flavor.hidden = !expanded || step.flavorText === "";
    refs.flavor.textContent = step.flavorText;
    refs.body.hidden = !expanded;
  }

  private mountStep(index: number): void {
    const body = this.rowRefs[index].body;
    const ctx: StepContext = {
      onComplete: () => this.handleComplete(index),
      onError: () => this.handleError(index),
      onBusyChange: (isBusy: boolean) => this.handleBusyChange(index, isBusy),
    };
    this.steps[index].mount(body, ctx, this.savedByIndex[index]?.savedState);
    // The editing-exclusivity gate is an invariant, not a paired open/close
    // event: a step can mount for the first time WHILE a gate is already open
    // (e.g. an in-flight Continue resolves after [Edit] was clicked elsewhere,
    // advancing the flow and mounting the next step). Telling every step its
    // correct state at mount time is what keeps such a step from coming up
    // enabled and letting the user fire a real AI run against a half-edited
    // upstream config.
    this.steps[index].setInteractive?.(this.isStepInteractive(index));
  }

  /** A step's own busy request holds the SAME editing-exclusivity gate an
   * [Edit] session does -- e.g. RunStep's Test/Run AI are real, billed
   * actions against the sheet, and nothing should be able to start editing
   * an earlier step out from under them while they're in flight. Reuses
   * `editingIndex` itself (rather than a parallel concept) so every existing
   * consumer -- isStepInteractive, the [Edit]-button disable, Refresh-button
   * gating -- picks this up for free.
   *
   * Guarded so this can never override or prematurely release a REAL [Edit]
   * session: `preEditActiveIndex[index] !== null` means editStep() is what
   * opened the gate for this index, and only that session's own resolution
   * (Cancel or a successful recommit) may close it -- a busy signal from the
   * same step's own recommit request (editingIndex already === index) just
   * falls through to the plain per-row refresh below. */
  private handleBusyChange(index: number, isBusy: boolean): void {
    this.busyByIndex[index] = isBusy;
    if (isBusy && this.editingIndex === null) {
      this.editingIndex = index;
      this.applyEditingGate();
      this.refreshAllRowDisplays();
      this.onEditingChange?.(true);
    } else if (!isBusy && this.editingIndex === index && this.preEditActiveIndex[index] === null) {
      this.editingIndex = null;
      this.applyEditingGate();
      this.refreshAllRowDisplays();
      this.onEditingChange?.(false);
    } else {
      this.applyRowDisplay(index);
    }
  }

  private handleComplete(index: number): void {
    if (this.statuses[index] === "complete") return; // idempotent

    this.hasErrorByIndex[index] = false;

    if (this.isLastStep(index)) {
      // Stays mounted and expanded forever — only the icon changes. Its
      // savedState/summary are refreshed lazily by getValue() when the panel
      // is actually torn down, not eagerly here.
      this.statuses[index] = "complete";
      this.applyRowDisplay(index);
      this.updateIcon(index);
      // Reachable: a successful Run AI holds the gate via handleBusyChange()
      // (its own onBusyChange(true) call) for as long as it's in flight, and
      // ctx.onComplete() fires before that same action's onBusyChange(false)
      // -- so releasing it here, rather than waiting for the busy signal to
      // clear moments later, is what re-enables every other step immediately
      // once the run actually lands.
      this.releaseEditingGate(index);
      return;
    }

    this.recordUnmount(index, this.steps[index].unmount());
    this.statuses[index] = "complete";

    const nextIndex = index + 1;
    const nextWasLocked = this.statuses[nextIndex] === "locked";
    // One rule regardless of whether this is a first-time completion or a
    // recommit after [Edit]: the immediate next step becomes active, and
    // everything after that relocks -- its prior status (complete, or even
    // still-active/uncommitted for the terminal step) no longer means
    // anything once something it depends on has changed underneath it.
    this.relockStepsAfter(nextIndex);
    this.statuses[nextIndex] = "active";
    this.activeIndex = nextIndex;
    if (nextWasLocked) this.mountStep(nextIndex);

    this.applyRowDisplay(index);
    this.applyRowDisplay(nextIndex);
    this.updateIcon(index);
    this.updateIcon(nextIndex);
    this.releaseEditingGate(index);
  }

  /** Reverts every step after fromIndex back to "locked" -- regardless of
   * whether it was previously "complete" or (for the terminal step, which
   * never collapses on its own completion) still "active" -- since a
   * downstream step's prior status no longer means anything once something
   * it depends on has been recommitted. Captures live state via unmount()
   * only for a step that was actually mounted; an already-collapsed
   * complete step's cached savedByIndex entry is already correct and is
   * left untouched. Either way the cached data survives, so walking
   * forward to the step again later resumes from where it was rather than
   * starting over. A relocked step renders plain: its transient per-step flags
   * (a ✕ from a failed commit, a busy flag from a request that was in flight)
   * are cleared alongside the status flip, so it can't come back showing an
   * error icon or a stuck-disabled Cancel button for an attempt that no longer
   * has any bearing on it. */
  private relockStepsAfter(fromIndex: number): void {
    for (let i = fromIndex + 1; i < this.steps.length; i++) {
      if (this.statuses[i] === "locked") continue;
      if (this.isMountedState(i)) this.recordUnmount(i, this.steps[i].unmount());
      this.statuses[i] = "locked";
      this.hasErrorByIndex[i] = false;
      this.busyByIndex[i] = false;
      this.applyRowDisplay(i);
      this.updateIcon(i);
    }
  }

  private handleError(index: number): void {
    this.hasErrorByIndex[index] = true;
    this.updateIcon(index);
  }

  private updateIcon(index: number): void {
    const { icon } = this.rowRefs[index];
    icon.textContent = this.iconFor(index);
    icon.classList.toggle("step-icon--error", this.hasErrorByIndex[index]);
    // The badge fill and the rail segment leading into the next badge are
    // both driven by this same row-level status class -- see .step-row--*
    // in sidebar.css.
    const row = this.rowEls[index];
    row.classList.remove("step-row--locked", "step-row--active", "step-row--complete");
    row.classList.add(`step-row--${this.statuses[index]}`);
  }

  /** The interactive state step `index` must be in RIGHT NOW, derived purely
   * from the gate: everything is interactive when no edit is open; while one
   * is, only the step being edited. Deriving it (rather than remembering which
   * single step was disabled when the gate opened) is what makes the gate hold
   * for steps that mount, relock, or otherwise change shape mid-edit. */
  private isStepInteractive(index: number): boolean {
    return this.editingIndex === null || this.editingIndex === index;
  }

  /** Re-asserts the gate across every currently-mounted step. Skipping
   * unmounted steps is deliberate: a step that relockStepsAfter() just
   * relocked has been torn down and will be told its state again by
   * mountStep() if it's ever walked forward to, so re-enabling it here would
   * only touch a discarded instance. */
  private applyEditingGate(): void {
    this.steps.forEach((step, i) => {
      if (this.isMountedState(i)) step.setInteractive?.(this.isStepInteractive(i));
    });
  }

  /** Re-applies every row's display -- needed whenever editingIndex changes,
   * since an [Edit] button's disabled state (distinct from its hidden
   * state) depends on whether ANY other step is currently mid-edit, not
   * just this row's own status. */
  private refreshAllRowDisplays(): void {
    this.steps.forEach((_, i) => this.applyRowDisplay(i));
  }

  private editStep(index: number): void {
    const previousActive = this.activeIndex;
    this.preEditActiveIndex[index] = previousActive;
    this.preEditRelockedStatus[index] = null;
    // Only one step is ever open at a time. If a different step was the one
    // actually open (active, or the terminal step still expanded after a
    // completed run), collapse it now rather than leaving it visibly
    // editable alongside the step being edited. Its live state survives via
    // the same recordUnmount() every other relock already uses, and
    // cancelEdit() reopens it verbatim if this edit is abandoned; a
    // successful recommit instead walks it forward again like any other
    // downstream step, via the existing relockStepsAfter()/mountStep() path.
    if (previousActive !== index && this.isMountedState(previousActive)) {
      this.preEditRelockedStatus[index] = this.statuses[previousActive] as "active" | "complete";
      this.recordUnmount(previousActive, this.steps[previousActive].unmount());
      this.statuses[previousActive] = "locked";
      this.hasErrorByIndex[previousActive] = false;
      this.busyByIndex[previousActive] = false;
      this.applyRowDisplay(previousActive);
      this.updateIcon(previousActive);
    }
    this.editingIndex = index;
    this.statuses[index] = "active";
    this.activeIndex = index;
    this.mountStep(index);
    this.updateIcon(index);
    // Still needed on top of mountStep()'s own call: the steps this gate has
    // to disable are already mounted, so nothing would otherwise tell them the
    // gate just opened.
    this.applyEditingGate();
    this.refreshAllRowDisplays();
    this.onEditingChange?.(true);
  }

  /** Discards whatever is currently typed in an edited step's form -- no
   * unmount() call, so the cached savedState/summary from its last real
   * completion is untouched -- and reverts it to collapsed/complete. An
   * error icon from a failed commit attempt during this edit is left as-is
   * (cleared only by a real onComplete()), so it persists as a visible
   * reminder even though the underlying data reverted to the old good
   * state. Restoring activeIndex is best-effort: a StepFlow freshly
   * constructed from a saved state where this step was already active has
   * no recorded pre-edit index to fall back to, so activeIndex is simply
   * left as-is rather than skipping the cancel entirely. */
  private cancelEdit(index: number): void {
    this.statuses[index] = "complete";
    const restoreIndex = this.releaseEditingGate(index);
    if (restoreIndex !== null) this.activeIndex = restoreIndex;
    // Reopens whatever this edit collapsed at its start -- nothing upstream
    // actually changed, so it snaps back exactly as it was rather than
    // sitting locked awaiting a fresh walk-forward. Guarded on still being
    // "locked": if that step resolved itself independently while this edit
    // was open (e.g. its own commit completed), this edit no longer has
    // anything to restore.
    const relockedStatus = this.preEditRelockedStatus[index];
    this.preEditRelockedStatus[index] = null;
    if (
      restoreIndex !== null &&
      relockedStatus !== null &&
      this.statuses[restoreIndex] === "locked"
    ) {
      this.statuses[restoreIndex] = relockedStatus;
      this.mountStep(restoreIndex);
      this.updateIcon(restoreIndex);
    }
    // Unconditional, not folded into releaseEditingGate: a step restored
    // directly into "active" from saved state holds no editing gate, so
    // releaseEditingGate() is a no-op for it -- but its row still has to
    // collapse. Redundant with the gate path's own refresh; both are
    // idempotent.
    this.refreshAllRowDisplays();
    this.updateIcon(index);
  }

  /** Releases the editing-exclusivity gate if `index` was the step actually
   * being edited (a no-op for a plain first-time completion, or for a step
   * restored directly into "active" from saved state that was never
   * actually edited this session -- in either case there's no gate to
   * release). Re-enables every still-mounted step's buttons and refreshes
   * every row's [Edit]-disabled state. Returns the index to restore
   * activeIndex to, or null. */
  private releaseEditingGate(index: number): number | null {
    if (this.editingIndex !== index) return null;
    this.editingIndex = null;
    const restoreIndex = this.preEditActiveIndex[index];
    this.preEditActiveIndex[index] = null;
    // Re-derived from the (now-closed) gate across all mounted steps rather
    // than un-disabling the one step recorded at open time: by the time an
    // edit resolves, that step may have completed and collapsed, or relocked,
    // while some OTHER step advanced into place and is the one now needing to
    // be re-enabled.
    this.applyEditingGate();
    this.refreshAllRowDisplays();
    this.onEditingChange?.(false);
    return restoreIndex;
  }
}
