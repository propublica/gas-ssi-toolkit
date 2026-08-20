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

export class StepFlow {
  private readonly container: HTMLElement;
  private readonly steps: Step[];
  private statuses: Array<"locked" | "active" | "complete">;
  private savedByIndex: Array<{ savedState: unknown; summary: string } | undefined>;
  private hasErrorByIndex: boolean[];
  /** activeIndex to restore on Cancel, recorded by editStep(); null when the
   * step isn't currently mid-edit. */
  private preEditActiveIndex: Array<number | null>;
  /** Index of the step currently mid-edit (Edit clicked, not yet resolved
   * by Cancel or a successful recommit), or null when nothing is being
   * edited. At most one step is ever mid-edit at a time. */
  private editingIndex: number | null = null;
  private readonly onEditingChange?: (isEditing: boolean) => void;
  private activeIndex: number;
  private rowEls: HTMLElement[] = [];

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
    this.preEditActiveIndex = steps.map(() => null);

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
    row.className = "step-row";
    row.setAttribute("data-step-index", String(index));
    row.innerHTML = `
      <div class="step-header">
        <span class="step-icon">${this.iconFor(index)}</span>
        <span class="step-title-text">${step.title}</span>
        <button type="button" class="step-edit-btn" hidden>Edit</button>
        <button type="button" class="step-cancel-btn" hidden>Cancel</button>
      </div>
      <p class="step-summary" hidden></p>
      <p class="step-flavor-text" hidden></p>
      <div class="step-body" hidden></div>
    `;
    row
      .querySelector<HTMLButtonElement>(".step-edit-btn")!
      .addEventListener("click", () => this.editStep(index));
    row
      .querySelector<HTMLButtonElement>(".step-cancel-btn")!
      .addEventListener("click", () => this.cancelEdit(index));
    this.applyRowDisplay(row, index, step);
    return row;
  }

  private applyRowDisplay(row: HTMLElement, index: number, step: Step): void {
    const status = this.statuses[index];
    const expanded = this.isMountedState(index);
    // Only a genuinely "complete" step offers [Edit] -- a relocked step must
    // be reached by walking forward through the intervening locked steps,
    // not jumped to directly.
    const isEditable = status === "complete" && !this.isLastStep(index);
    // Independent of isEditable: any collapsed, non-terminal step with
    // cached data shows its summary, whether that's because it's complete
    // OR because it relocked with its old data still intact.
    const hasSummary =
      !expanded && !this.isLastStep(index) && this.savedByIndex[index] !== undefined;
    const editingExistingStep =
      status === "active" && !this.isLastStep(index) && this.savedByIndex[index] !== undefined;

    const editBtn = row.querySelector<HTMLButtonElement>(".step-edit-btn")!;
    editBtn.hidden = !isEditable;
    editBtn.disabled = this.editingIndex !== null && this.editingIndex !== index;
    row.querySelector<HTMLElement>(".step-cancel-btn")!.hidden = !editingExistingStep;

    const summaryEl = row.querySelector<HTMLElement>(".step-summary")!;
    summaryEl.hidden = !hasSummary;
    summaryEl.textContent = this.savedByIndex[index]?.summary ?? "";

    const flavorEl = row.querySelector<HTMLElement>(".step-flavor-text")!;
    flavorEl.hidden = !expanded || step.flavorText === "";
    flavorEl.textContent = step.flavorText;
    row.querySelector<HTMLElement>(".step-body")!.hidden = !expanded;
  }

  private mountStep(index: number): void {
    const body = this.rowEls[index].querySelector<HTMLElement>(".step-body")!;
    const ctx: StepContext = {
      onComplete: () => this.handleComplete(index),
      onError: () => this.handleError(index),
    };
    this.steps[index].mount(body, ctx, this.savedByIndex[index]?.savedState);
  }

  private handleComplete(index: number): void {
    if (this.statuses[index] === "complete") return; // idempotent

    this.hasErrorByIndex[index] = false;

    if (this.isLastStep(index)) {
      // Stays mounted and expanded forever — only the icon changes. Its
      // savedState/summary are refreshed lazily by getValue() when the panel
      // is actually torn down, not eagerly here.
      this.statuses[index] = "complete";
      this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
      this.updateIcon(index);
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

    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.applyRowDisplay(this.rowEls[nextIndex], nextIndex, this.steps[nextIndex]);
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
   * starting over. */
  private relockStepsAfter(fromIndex: number): void {
    for (let i = fromIndex + 1; i < this.steps.length; i++) {
      if (this.statuses[i] === "locked") continue;
      if (this.isMountedState(i)) this.recordUnmount(i, this.steps[i].unmount());
      this.statuses[i] = "locked";
      this.applyRowDisplay(this.rowEls[i], i, this.steps[i]);
      this.updateIcon(i);
    }
  }

  private handleError(index: number): void {
    this.hasErrorByIndex[index] = true;
    this.updateIcon(index);
  }

  private updateIcon(index: number): void {
    const icon = this.rowEls[index].querySelector<HTMLElement>(".step-icon");
    if (icon) {
      icon.textContent = this.iconFor(index);
      icon.classList.toggle("step-icon--error", this.hasErrorByIndex[index]);
    }
  }

  private setStepInteractive(index: number, enabled: boolean): void {
    this.steps[index].setInteractive?.(enabled);
  }

  /** Re-applies every row's display -- needed whenever editingIndex changes,
   * since an [[Edit]] button's disabled state (distinct from its hidden
   * state) depends on whether ANY other step is currently mid-edit, not
   * just this row's own status. */
  private refreshAllRowDisplays(): void {
    this.steps.forEach((step, i) => this.applyRowDisplay(this.rowEls[i], i, step));
  }

  private editStep(index: number): void {
    const previousActive = this.activeIndex;
    this.preEditActiveIndex[index] = previousActive;
    this.editingIndex = index;
    this.statuses[index] = "active";
    this.activeIndex = index;
    this.mountStep(index);
    this.updateIcon(index);
    if (previousActive !== index) {
      this.setStepInteractive(previousActive, false);
    }
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
   * release). Re-enables whichever other step's buttons were disabled when
   * the edit began, and refreshes every row's [Edit]-disabled state.
   * Returns the index to restore activeIndex to, or null. */
  private releaseEditingGate(index: number): number | null {
    if (this.editingIndex !== index) return null;
    this.editingIndex = null;
    const restoreIndex = this.preEditActiveIndex[index];
    this.preEditActiveIndex[index] = null;
    if (restoreIndex !== null) this.setStepInteractive(restoreIndex, true);
    this.refreshAllRowDisplays();
    this.onEditingChange?.(false);
    return restoreIndex;
  }
}
