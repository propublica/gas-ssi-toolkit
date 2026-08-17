import type { Step, StepContext, StepFlowSavedState } from "../types";

export class StepFlow {
  private readonly container: HTMLElement;
  private readonly steps: Step[];
  private statuses: Array<"locked" | "active" | "complete">;
  private savedByIndex: Array<{ savedState: unknown; summary: string } | undefined>;
  private hasErrorByIndex: boolean[];
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

    this.container.innerHTML = "";
    this.rowEls = steps.map((step, i) => this.buildRow(step, i));
    this.rowEls.forEach((row) => this.container.appendChild(row));
    steps.forEach((_, i) => {
      if (this.isMountedState(i)) this.mountStep(i);
    });
  }

  getValue(): StepFlowSavedState {
    this.steps.forEach((_, i) => {
      if (this.isMountedState(i)) {
        const result = this.steps[i].unmount();
        if (result) this.savedByIndex[i] = result;
      }
    });
    return {
      activeStepIndex: this.activeIndex,
      steps: this.statuses.map((status, i) => ({ status, saved: this.savedByIndex[i] })),
    };
  }

  private isLastStep(index: number): boolean {
    return index === this.steps.length - 1;
  }

  private isMountedState(index: number): boolean {
    return (
      index === this.activeIndex || (this.isLastStep(index) && this.statuses[index] === "complete")
    );
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
      </div>
      <p class="step-summary" hidden></p>
      <p class="step-flavor-text" hidden></p>
      <div class="step-body" hidden></div>
    `;
    row
      .querySelector<HTMLButtonElement>(".step-edit-btn")!
      .addEventListener("click", () => this.editStep(index));
    this.applyRowDisplay(row, index, step);
    return row;
  }

  private applyRowDisplay(row: HTMLElement, index: number, step: Step): void {
    const status = this.statuses[index];
    const collapsedNonTerminalComplete = status === "complete" && !this.isLastStep(index);

    row.querySelector<HTMLElement>(".step-edit-btn")!.hidden = !collapsedNonTerminalComplete;

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

    const result = this.steps[index].unmount();
    if (result) this.savedByIndex[index] = result;
    this.statuses[index] = "complete";

    const nextIndex = index + 1;
    if (this.statuses[nextIndex] === "locked") this.statuses[nextIndex] = "active";
    this.activeIndex = nextIndex;
    this.mountStep(nextIndex);

    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.applyRowDisplay(this.rowEls[nextIndex], nextIndex, this.steps[nextIndex]);
    this.updateIcon(index);
    this.updateIcon(nextIndex);
  }

  private handleError(index: number): void {
    this.hasErrorByIndex[index] = true;
    this.updateIcon(index);
  }

  private updateIcon(index: number): void {
    const icon = this.rowEls[index].querySelector<HTMLElement>(".step-icon");
    if (icon) icon.textContent = this.iconFor(index);
  }

  private editStep(index: number): void {
    const previousActive = this.activeIndex;
    this.statuses[index] = "active";
    this.activeIndex = index;
    this.mountStep(index);
    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.updateIcon(index);
    if (previousActive !== index) {
      this.applyRowDisplay(this.rowEls[previousActive], previousActive, this.steps[previousActive]);
    }
  }
}
