import type { Step, StepContext, StepFlowSavedState } from "../types";
import { truncate } from "../format";

const SUMMARY_MAX_LENGTH = 60;

export class StepFlow {
  private readonly container: HTMLElement;
  private readonly steps: Step[];
  private statuses: Array<"locked" | "active" | "complete">;
  private savedByIndex: Array<{ savedState: unknown; summary: string } | undefined>;
  private hasErrorByIndex: boolean[];
  /** activeIndex to restore on Cancel, recorded by editStep(); null when the
   * step isn't currently mid-edit. */
  private preEditActiveIndex: Array<number | null>;
  private activeIndex: number;
  private rowEls: HTMLElement[] = [];

  constructor(container: HTMLElement, steps: Step[], savedState?: StepFlowSavedState) {
    if (steps.length === 0) throw new Error("StepFlow requires at least one step");
    this.container = container;
    this.steps = steps;

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
    const collapsedNonTerminalComplete = status === "complete" && !this.isLastStep(index);
    const editingExistingStep =
      status === "active" && !this.isLastStep(index) && this.savedByIndex[index] !== undefined;

    row.querySelector<HTMLElement>(".step-edit-btn")!.hidden = !collapsedNonTerminalComplete;
    row.querySelector<HTMLElement>(".step-cancel-btn")!.hidden = !editingExistingStep;

    const summaryEl = row.querySelector<HTMLElement>(".step-summary")!;
    summaryEl.hidden = !collapsedNonTerminalComplete;
    summaryEl.textContent = this.savedByIndex[index]?.summary ?? "";

    const expanded = status !== "locked" && !collapsedNonTerminalComplete;
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
      return;
    }

    this.recordUnmount(index, this.steps[index].unmount());
    this.statuses[index] = "complete";

    const nextIndex = index + 1;
    const nextWasLocked = this.statuses[nextIndex] === "locked";
    if (nextWasLocked) this.statuses[nextIndex] = "active";
    this.activeIndex = nextIndex;
    if (nextWasLocked) {
      this.mountStep(nextIndex);
    } else {
      // This wasn't a first-time completion (nextIndex already progressed
      // past locked) -- it's a re-commit after [Edit]. A downstream step's
      // "complete" status is no longer trustworthy once something it
      // depends on has changed underneath it.
      this.uncompleteDownstreamSteps(index);
    }

    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.applyRowDisplay(this.rowEls[nextIndex], nextIndex, this.steps[nextIndex]);
    this.updateIcon(index);
    this.updateIcon(nextIndex);
  }

  /** Reverts every already-complete step after fromIndex back to "active" --
   * a downstream step's completion no longer means anything once something
   * it depends on has been recommitted. For a non-terminal step this
   * re-expands it (the same mounted DOM/state it left off with, not a fresh
   * mount); for the terminal step, which never collapses, it only flips the
   * checklist icon. */
  private uncompleteDownstreamSteps(fromIndex: number): void {
    for (let i = fromIndex + 1; i < this.steps.length; i++) {
      if (this.statuses[i] !== "complete") continue;
      this.statuses[i] = "active";
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

  private editStep(index: number): void {
    const previousActive = this.activeIndex;
    this.preEditActiveIndex[index] = previousActive;
    this.statuses[index] = "active";
    this.activeIndex = index;
    this.mountStep(index);
    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.updateIcon(index);
    if (previousActive !== index) {
      this.applyRowDisplay(this.rowEls[previousActive], previousActive, this.steps[previousActive]);
    }
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
    const restoreIndex = this.preEditActiveIndex[index];
    this.preEditActiveIndex[index] = null;
    this.statuses[index] = "complete";
    if (restoreIndex !== null) this.activeIndex = restoreIndex;
    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.updateIcon(index);
  }
}
