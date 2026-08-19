# Guided AI Inference Step-Flow Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `StepFlow`'s "reactivate every downstream complete step simultaneously" cascade with a sequential relock, and close the gap that lets a user interact with an already-active step (in practice, the terminal `RunStep`) while an earlier step's edit is still unresolved.

**Architecture:** All changes are additive/behavioral inside the existing `Step`/`StepContext`/`StepFlow` framework — no new shell-visible statuses, no `StepFlowSavedState` shape changes. Four self-contained tasks, each independently testable: (1) rewrite the recommit cascade and split one overloaded row-display predicate into three independently-scoped ones, (2) add an editing-exclusivity gate (a new optional `Step.setInteractive()` plus shell-side Edit-button disabling), (3) wire that gate to the panel's "Refresh columns" button, (4) add a `StepContext.onBusyChange()` signal so the shell can disable Cancel while a recommit request is in flight.

**Tech Stack:** TypeScript, Jest + ts-jest (`@jest-environment jsdom` for anything touching the DOM), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-19-guided-ai-inference-step-flow-refinement-design.md`

## Global Constraints

- No new `StepFlowSavedState` fields or step statuses — the three-state model (`"locked" | "active" | "complete"`) is unchanged throughout.
- A relocked step's summary renders with **plain styling** — no "stale"/muted visual treatment (explicit spec decision).
- A relocked step can never show `[Edit]` — only a genuinely `"complete"` step can. This must hold even though a relocked step keeps its cached summary visible.
- `Step.setInteractive?()` and `Step.destroy?()` are optional; a step that has nothing to disable/tear down may omit them entirely.
- Named exports only, `const` by default, `===` always, avoid `any`, explicit return types, double quotes/trailing commas (Prettier) — per this repo's existing ESLint/Prettier config. Follow the file's existing style exactly; don't reformat unrelated lines.
- Run `npx jest <file> -t "<name>"` for a single test, `npm test` for the full suite before every commit.

---

## Task 1: Sequential relock cascade + decoupled row-display predicates

**Files:**
- Modify: `src/client/components/step-flow.ts`
- Test: `__tests__/components/step-flow.test.ts`

**Interfaces:**
- Consumes: existing `Step<S>`/`StepContext`/`StepFlowSavedState` from `src/client/types.ts` — unchanged in this task.
- Produces: `StepFlow.relockStepsAfter(fromIndex: number): void` (private, replaces the current `uncompleteDownstreamSteps`). No public API changes — `getValue()`/constructor signature are untouched in this task.

This task replaces `StepFlow.uncompleteDownstreamSteps()` (which reactivates every already-complete downstream step back to `"active"` simultaneously) with `relockStepsAfter()`, which reverts everything after the immediate-next step back to `"locked"` — including a step that's currently `"active"` but not yet complete (the terminal step, or, in a longer flow, any not-yet-committed downstream step), capturing its live state via `unmount()` first so nothing typed is lost. It also splits `applyRowDisplay()`'s one overloaded `collapsedNonTerminalComplete` flag into three independent predicates (expanded / summary-shown / Edit-shown), which is what makes a relocked step correctly show its old summary without also showing `[Edit]`.

None of the existing cascade-related tests in `step-flow.test.ts` assert on a downstream step two or more hops past the recommitted one — they only exercise the *immediate*-next step, whose behavior (becomes active, expands) is identical before and after this change. So this task is purely additive to the test file; nothing existing needs to change.

- [ ] **Step 1: Write the failing tests for relocking 2+ hops downstream**

Add this new `describe` block to `__tests__/components/step-flow.test.ts`, right after the existing `describe("StepFlow — uncompleting downstream steps on edit", ...)` block (i.e. after its closing `});` around line 337, before `describe("StepFlow — destroy()", ...)`):

```ts
describe("StepFlow — relocking steps two or more hops downstream", () => {
  it("relocks (does not reactivate) a non-terminal step two hops past the recommitted one, keeping its summary but hiding its body and [Edit]", () => {
    const [a, b, c, d] = [
      new FakeStep("A"),
      new FakeStep("B"),
      new FakeStep("C"),
      new FakeStep("D"),
    ];
    const container = makeContainer();
    new StepFlow(container, [a, b, c, d]);
    a.lastCtx!.onComplete(); // a: complete, b: active
    b.setValue("b-value");
    b.lastCtx!.onComplete(); // b: complete, c: active
    c.setValue("c-value");
    c.lastCtx!.onComplete(); // c: complete, d: active (terminal)

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a
    a.lastCtx!.onComplete(); // re-complete a

    const rows = container.querySelectorAll(".step-row");
    // b: immediate next -- becomes active/expanded, unchanged from before.
    expect(container.querySelectorAll(".step-icon")[1].textContent).toBe("●");
    expect(rows[1].querySelector<HTMLElement>(".step-body")!.hidden).toBe(false);

    // c: two hops downstream -- relocks instead of reactivating.
    expect(container.querySelectorAll(".step-icon")[2].textContent).toBe("○");
    expect(rows[2].querySelector<HTMLElement>(".step-body")!.hidden).toBe(true);
    expect(rows[2].querySelector<HTMLElement>(".step-summary")!.hidden).toBe(false);
    expect(rows[2].querySelector<HTMLElement>(".step-summary")!.textContent).toBe("c-value");
    expect(rows[2].querySelector<HTMLButtonElement>(".step-edit-btn")!.hidden).toBe(true);
  });

  it("relocks the terminal step when it's two or more hops downstream, and never shows a summary for it", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStep("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete(); // a: complete, b: active
    b.setValue("b-value");
    b.lastCtx!.onComplete(); // b: complete, c: active (terminal)
    c.setValue("c-value");
    c.lastCtx!.onComplete(); // c: complete (terminal, stays expanded per its own completion)

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a
    a.lastCtx!.onComplete(); // re-complete a -- b becomes active, c (terminal) relocks

    const rows = container.querySelectorAll(".step-row");
    expect(container.querySelectorAll(".step-icon")[2].textContent).toBe("○");
    expect(rows[2].querySelector<HTMLElement>(".step-body")!.hidden).toBe(true);
    expect(rows[2].querySelector<HTMLElement>(".step-summary")!.hidden).toBe(true); // terminal never shows one
  });

  it("captures a relocked step's live in-progress state, not just an already-complete step's", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStep("C")];
    const container = makeContainer();
    const flow = new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete(); // a: complete, b: active
    b.setValue("b-value");
    b.lastCtx!.onComplete(); // b: complete, c: active (terminal, never collapses on its own)
    c.setValue("live-uncommitted-c"); // c is still "active" (never completed) at this point

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a
    a.lastCtx!.onComplete(); // re-complete a -- c relocks while still uncompleted

    expect(flow.getValue().steps[2]).toEqual({
      status: "locked",
      saved: { savedState: { value: "live-uncommitted-c" }, summary: "live-uncommitted-c" },
    });
  });
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `npx jest __tests__/components/step-flow.test.ts -t "relocking steps two or more hops downstream"`
Expected: FAIL — the first two tests fail because today's code reactivates `c` to `"active"` (icon `●`, body not hidden) instead of relocking it; the third fails because today's code never touches `c` at all when it's still `"active"` (uncompleteDownstreamSteps only processes already-`"complete"` steps), so nothing captures its live value into `savedByIndex`.

- [ ] **Step 3: Replace `applyRowDisplay()` with three decoupled predicates**

In `src/client/components/step-flow.ts`, replace the entire current `applyRowDisplay` method:

```ts
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
```

with:

```ts
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

    row.querySelector<HTMLElement>(".step-edit-btn")!.hidden = !isEditable;
    row.querySelector<HTMLElement>(".step-cancel-btn")!.hidden = !editingExistingStep;

    const summaryEl = row.querySelector<HTMLElement>(".step-summary")!;
    summaryEl.hidden = !hasSummary;
    summaryEl.textContent = this.savedByIndex[index]?.summary ?? "";

    const flavorEl = row.querySelector<HTMLElement>(".step-flavor-text")!;
    flavorEl.hidden = !expanded || step.flavorText === "";
    flavorEl.textContent = step.flavorText;
    row.querySelector<HTMLElement>(".step-body")!.hidden = !expanded;
  }
```

- [ ] **Step 4: Replace `uncompleteDownstreamSteps()` with `relockStepsAfter()`, and rewrite `handleComplete()`**

Replace the current `handleComplete` method:

```ts
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
```

with:

```ts
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
```

- [ ] **Step 5: Run the full test file to verify everything passes**

Run: `npx jest __tests__/components/step-flow.test.ts -v`
Expected: PASS — all tests, including every pre-existing one (none needed modification) and the three new ones from Step 1.

- [ ] **Step 6: Run the full suite and commit**

Run: `npm test`
Expected: PASS (all suites).

```bash
git add src/client/components/step-flow.ts __tests__/components/step-flow.test.ts
git commit -m "$(cat <<'EOF'
Relock downstream steps sequentially instead of reactivating them all at once

Editing an earlier step now relocks everything after the immediate next
step (including an already-reached terminal step), rather than popping
every already-complete downstream step open simultaneously. Splits the
row-display logic into three independent predicates so a relocked step
still shows its old summary without offering [Edit].
EOF
)"
```

---

## Task 2: Editing-exclusivity gate

**Files:**
- Modify: `src/client/components/async-action-button.ts`
- Modify: `src/client/types.ts`
- Modify: `src/client/components/step-flow.ts`
- Modify: `src/client/panels/guided/inputs-step.ts`
- Modify: `src/client/panels/guided/prompt-step.ts`
- Modify: `src/client/panels/guided/run-step.ts`
- Modify: `src/client/components/run-controls.ts`
- Test: `__tests__/components/async-action-button.test.ts`
- Test: `__tests__/components/step-flow.test.ts`
- Test: `__tests__/panels/guided/inputs-step.test.ts`
- Test: `__tests__/panels/guided/prompt-step.test.ts`
- Test: `__tests__/panels/guided/run-step.test.ts`
- Test: `__tests__/components/run-controls.test.ts`

**Interfaces:**
- Consumes: `relockStepsAfter`/`applyRowDisplay`/`handleComplete` from Task 1 (this task edits `handleComplete`, `editStep`, and `cancelEdit` again, on top of Task 1's version).
- Produces: `AsyncActionButton.setInteractive(enabled: boolean): void`; `Step.setInteractive?(enabled: boolean): void` (new optional interface member); `RunControls.setInteractive(enabled: boolean): void`; `InputsStep.setInteractive`/`PromptStep.setInteractive`/`RunStep.setInteractive` (each delegating to their own action button(s)). Later tasks (3) read `StepFlow`'s new private `editingIndex` concept indirectly via the `StepFlowOptions` callback added in Task 3 — Task 2 itself adds no new public `StepFlow` API.

This task closes the actual bug the redesign is for: today, nothing stops a user from clicking "Test"/"Run AI" on the terminal step (or clicking `[Edit]` on a *different* already-complete step) while an earlier step's edit is still open and unresolved. From the moment `[Edit]` is clicked until it resolves (Cancel, or a successful recommit), every other step's own action button(s) are disabled, and every other complete step's `[Edit]` button is disabled too (not hidden — just unclickable), since a second, concurrent edit would break the single-edit-at-a-time assumption the whole cascade in Task 1 depends on.

- [ ] **Step 1: Write the failing test for `AsyncActionButton.setInteractive()`**

Add to `__tests__/components/async-action-button.test.ts`, inside the top-level `describe("AsyncActionButton", ...)` block, after the existing `describe("setIdle()", ...)` block:

```ts
  describe("setInteractive()", () => {
    it("disables the button when passed false", () => {
      asyncBtn.setInteractive(false);
      expect(btn.disabled).toBe(true);
    });

    it("re-enables the button when passed true", () => {
      asyncBtn.setInteractive(false);
      asyncBtn.setInteractive(true);
      expect(btn.disabled).toBe(false);
    });

    it("does not re-enable the button while genuinely loading", () => {
      asyncBtn.setLoading();
      asyncBtn.setInteractive(true);
      expect(btn.disabled).toBe(true);
    });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/components/async-action-button.test.ts -t "setInteractive"`
Expected: FAIL with `asyncBtn.setInteractive is not a function`.

- [ ] **Step 3: Implement `AsyncActionButton.setInteractive()`**

In `src/client/components/async-action-button.ts`, add this method to the `AsyncActionButton` class, after `setIdle()`:

```ts
  /** Disables/enables the button independent of its own loading/idle/done
   * state -- used by a step to gray out its own action button while a
   * DIFFERENT step is mid-edit. Re-enabling is a no-op while genuinely
   * loading, so an external caller can't accidentally re-enable a button
   * mid-request. */
  setInteractive(enabled: boolean): void {
    if (enabled && this.state === "loading") return;
    this.button.disabled = !enabled;
  }
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx jest __tests__/components/async-action-button.test.ts -v`
Expected: PASS (all tests).

- [ ] **Step 5: Add `Step.setInteractive?` to the shared types**

In `src/client/types.ts`, add this member to the `Step<S>` interface, immediately after `hydrate?(savedState: S): void;`:

```ts
  /** Optional. Called by the shell to enable/disable this step's own
   * action button(s) while a DIFFERENT step is mid-edit -- e.g. so the
   * terminal step's Run button can't be clicked while an earlier step's
   * edit is still unresolved. Must not alter mounted state, savedState, or
   * in-progress form values -- purely a button-disable. A step with
   * nothing to disable may omit this entirely. */
  setInteractive?(enabled: boolean): void;
```

- [ ] **Step 6: Write the failing shell-level tests for the exclusivity gate**

Add this new `FakeStep` subclass to `__tests__/components/step-flow.test.ts`, right after the existing `FakeStepWithDestroy` class:

```ts
class FakeStepWithInteractive extends FakeStep {
  interactiveCalls: boolean[] = [];
  setInteractive(enabled: boolean): void {
    this.interactiveCalls.push(enabled);
  }
}
```

Add this new `describe` block, after the `describe("StepFlow — relocking steps two or more hops downstream", ...)` block added in Task 1:

```ts
describe("StepFlow — editing exclusivity", () => {
  it("disables the previously-active step's own interactivity when a different step enters edit mode", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStepWithInteractive("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete(); // a: complete, b: active
    b.lastCtx!.onComplete(); // b: complete, c: active (terminal)

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    expect(c.interactiveCalls).toEqual([false]);
  });

  it("re-enables it when the edit is canceled", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStepWithInteractive("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete();
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.click();

    expect(c.interactiveCalls).toEqual([false, true]);
  });

  it("re-enables it when the edit is recommitted successfully", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStepWithInteractive("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete();
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    a.lastCtx!.onComplete(); // re-complete a

    expect(c.interactiveCalls).toEqual([false, true]);
  });

  it("disables every OTHER complete step's [Edit] button, not just the previously-active one", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStep("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete(); // a: complete, b: active
    b.lastCtx!.onComplete(); // b: complete, c: active (terminal)

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a (first [Edit] in DOM order)

    const rows = container.querySelectorAll(".step-row");
    const bEditBtn = rows[1].querySelector<HTMLButtonElement>(".step-edit-btn")!;
    expect(bEditBtn.hidden).toBe(false); // b is still complete -- still shown
    expect(bEditBtn.disabled).toBe(true); // but not clickable while a different edit is open
  });

  it("re-enables other complete steps' [Edit] buttons once the edit resolves", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStep("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete();
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.click();

    const rows = container.querySelectorAll(".step-row");
    expect(rows[1].querySelector<HTMLButtonElement>(".step-edit-btn")!.disabled).toBe(false);
  });
});
```

- [ ] **Step 7: Run the new tests to verify they fail**

Run: `npx jest __tests__/components/step-flow.test.ts -t "editing exclusivity"`
Expected: FAIL — `setInteractive` is never called on `c` today (no such mechanism exists), and `[Edit]` buttons on other complete steps are never disabled.

- [ ] **Step 8: Wire the exclusivity gate into `StepFlow`**

In `src/client/components/step-flow.ts`, add a new field right after `private preEditActiveIndex: Array<number | null>;`:

```ts
  /** Index of the step currently mid-edit (Edit clicked, not yet resolved
   * by Cancel or a successful recommit), or null when nothing is being
   * edited. At most one step is ever mid-edit at a time. */
  private editingIndex: number | null = null;
```

Add a helper method (anywhere among the other private methods, e.g. right after `updateIcon`):

```ts
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
```

Update `applyRowDisplay()`'s Edit-button line (added in Task 1) from:

```ts
    row.querySelector<HTMLElement>(".step-edit-btn")!.hidden = !isEditable;
```

to:

```ts
    const editBtn = row.querySelector<HTMLButtonElement>(".step-edit-btn")!;
    editBtn.hidden = !isEditable;
    editBtn.disabled = this.editingIndex !== null && this.editingIndex !== index;
```

Replace the current `editStep` method:

```ts
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
```

with:

```ts
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
  }
```

Replace the current `cancelEdit` method:

```ts
  private cancelEdit(index: number): void {
    const restoreIndex = this.preEditActiveIndex[index];
    this.preEditActiveIndex[index] = null;
    this.statuses[index] = "complete";
    if (restoreIndex !== null) this.activeIndex = restoreIndex;
    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.updateIcon(index);
  }
```

with:

```ts
  private cancelEdit(index: number): void {
    this.statuses[index] = "complete";
    const restoreIndex = this.releaseEditingGate(index);
    if (restoreIndex !== null) this.activeIndex = restoreIndex;
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
    return restoreIndex;
  }
```

Update `handleComplete()` (from Task 1) to release the gate on a successful recommit, in both branches. Replace:

```ts
    if (this.isLastStep(index)) {
      // Stays mounted and expanded forever — only the icon changes. Its
      // savedState/summary are refreshed lazily by getValue() when the panel
      // is actually torn down, not eagerly here.
      this.statuses[index] = "complete";
      this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
      this.updateIcon(index);
      return;
    }
```

with:

```ts
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
```

and replace the tail of `handleComplete` (after `relockStepsAfter`/status/mount handling):

```ts
    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.applyRowDisplay(this.rowEls[nextIndex], nextIndex, this.steps[nextIndex]);
    this.updateIcon(index);
    this.updateIcon(nextIndex);
  }
```

with:

```ts
    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
    this.applyRowDisplay(this.rowEls[nextIndex], nextIndex, this.steps[nextIndex]);
    this.updateIcon(index);
    this.updateIcon(nextIndex);
    this.releaseEditingGate(index);
  }
```

- [ ] **Step 9: Run the new tests to verify they pass**

Run: `npx jest __tests__/components/step-flow.test.ts -v`
Expected: PASS — all tests (Task 1's, plus the new exclusivity ones).

- [ ] **Step 10: Write the failing tests for each real step's `setInteractive()`**

Add to `__tests__/panels/guided/inputs-step.test.ts`, as a new top-level `describe` block:

```ts
describe("InputsStep — setInteractive", () => {
  it("disables and re-enables the Continue button", () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a"]);
    step.mount(container, makeCtx());

    step.setInteractive(false);
    expect(container.querySelector<HTMLButtonElement>("#gi-continue")!.disabled).toBe(true);

    step.setInteractive(true);
    expect(container.querySelector<HTMLButtonElement>("#gi-continue")!.disabled).toBe(false);
  });
});
```

Add to `__tests__/panels/guided/prompt-step.test.ts`, as a new top-level `describe` block:

```ts
describe("PromptStep — setInteractive", () => {
  it("disables and re-enables the Continue button", () => {
    const container = makeContainer();
    const step = new PromptStep();
    step.mount(container, makeCtx());

    step.setInteractive(false);
    expect(container.querySelector<HTMLButtonElement>("#gp-continue")!.disabled).toBe(true);

    step.setInteractive(true);
    expect(container.querySelector<HTMLButtonElement>("#gp-continue")!.disabled).toBe(false);
  });
});
```

Add to `__tests__/panels/guided/run-step.test.ts`, as a new top-level `describe` block:

```ts
describe("RunStep — setInteractive", () => {
  it("disables and re-enables the Run and Test buttons", async () => {
    const getPromptFields = jest.fn().mockReturnValue({
      promptCols: [{ col: "NoteCol", kind: "auto" as const }],
      systemPromptCol: "System Prompt",
    });
    const container = makeContainer();
    const step = new RunStep(getPromptFields, jest.fn());
    step.mount(container, makeCtx());
    for (let i = 0; i < 5; i++) await Promise.resolve();

    step.setInteractive(false);
    expect(container.querySelector<HTMLButtonElement>("#run-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);

    step.setInteractive(true);
    expect(container.querySelector<HTMLButtonElement>("#run-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
  });
});
```

Add to `__tests__/components/run-controls.test.ts`, as a new top-level `describe` block:

```ts
describe("RunControls — setInteractive", () => {
  it("disables and re-enables the Run and Test buttons", async () => {
    const { container, rc } = await mountAndSettle();

    rc.setInteractive(false);
    expect(container.querySelector<HTMLButtonElement>("#run-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);

    rc.setInteractive(true);
    expect(container.querySelector<HTMLButtonElement>("#run-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
  });
});
```

- [ ] **Step 11: Run the new tests to verify they fail**

Run: `npx jest __tests__/panels/guided/inputs-step.test.ts __tests__/panels/guided/prompt-step.test.ts __tests__/panels/guided/run-step.test.ts __tests__/components/run-controls.test.ts -t "setInteractive"`
Expected: FAIL — `setInteractive is not a function` on each.

- [ ] **Step 12: Implement `setInteractive()` on `RunControls`, `InputsStep`, `PromptStep`, `RunStep`**

In `src/client/components/run-controls.ts`, add this method to the `RunControls` class, after `checkTestStatsFreshness()`:

```ts
  /** Disables/enables Test and Run while a DIFFERENT step is mid-edit
   * (Guided AI Inference's terminal step is the only caller today).
   * Respects each button's own busy state on re-enable: Test won't be
   * force-enabled mid-request (AsyncActionButton.setInteractive() already
   * guards this); Run has no comparable busy state of its own (the job
   * strip communicates progress, not a disabled Run button), so it's a
   * plain flip. */
  setInteractive(enabled: boolean): void {
    const runBtn = this.container.querySelector<HTMLButtonElement>("#run-btn");
    if (runBtn) runBtn.disabled = !enabled;
    this.testButton?.setInteractive(enabled);
  }
```

In `src/client/panels/guided/inputs-step.ts`, add this method to the `InputsStep` class, after `getResult()`:

```ts
  setInteractive(enabled: boolean): void {
    this.continueButton?.setInteractive(enabled);
  }
```

In `src/client/panels/guided/prompt-step.ts`, add this method to the `PromptStep` class, after `getResult()`:

```ts
  setInteractive(enabled: boolean): void {
    this.continueButton?.setInteractive(enabled);
  }
```

In `src/client/panels/guided/run-step.ts`, add this method to the `RunStep` class, after `checkTestStatsFreshness()`:

```ts
  setInteractive(enabled: boolean): void {
    this.runControls?.setInteractive(enabled);
  }
```

- [ ] **Step 13: Run the new tests to verify they pass**

Run: `npx jest __tests__/panels/guided/inputs-step.test.ts __tests__/panels/guided/prompt-step.test.ts __tests__/panels/guided/run-step.test.ts __tests__/components/run-controls.test.ts -v`
Expected: PASS.

- [ ] **Step 14: Run the full suite and commit**

Run: `npm test`
Expected: PASS (all suites).

```bash
git add src/client/components/async-action-button.ts src/client/types.ts \
  src/client/components/step-flow.ts src/client/panels/guided/inputs-step.ts \
  src/client/panels/guided/prompt-step.ts src/client/panels/guided/run-step.ts \
  src/client/components/run-controls.ts __tests__/components/async-action-button.test.ts \
  __tests__/components/step-flow.test.ts __tests__/panels/guided/inputs-step.test.ts \
  __tests__/panels/guided/prompt-step.test.ts __tests__/panels/guided/run-step.test.ts \
  __tests__/components/run-controls.test.ts
git commit -m "$(cat <<'EOF'
Add an editing-exclusivity gate: only one step can be mid-edit at a time

Clicking [Edit] on a completed step now disables the currently-active
other step's own action button(s) (Continue/Test/Run) and every other
complete step's [Edit] button, closing a gap where the terminal RunStep's
Run/Test buttons stayed clickable while an earlier step's edit was still
unresolved. Releases on Cancel or a successful recommit.
EOF
)"
```

---

## Task 3: Gate "Refresh columns" on the exclusivity state

**Files:**
- Modify: `src/client/components/step-flow.ts`
- Modify: `src/client/panels/guided-ai-inference.ts`
- Test: `__tests__/components/step-flow.test.ts`
- Test: `__tests__/panels/guided-ai-inference.test.ts`

**Interfaces:**
- Consumes: `editingIndex`/`releaseEditingGate`/`editStep` from Task 2.
- Produces: `export interface StepFlowOptions { onEditingChange?: (isEditing: boolean) => void }`; `StepFlow`'s constructor gains a 4th optional parameter `options?: StepFlowOptions`.

- [ ] **Step 1: Write the failing test for the new constructor option**

Add to `__tests__/components/step-flow.test.ts`, as a new top-level `describe` block:

```ts
describe("StepFlow — onEditingChange option", () => {
  it("fires true when an edit begins and false when it's canceled", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const onEditingChange = jest.fn();
    new StepFlow(container, [a, b], undefined, { onEditingChange });
    a.lastCtx!.onComplete(); // a: complete, b: active

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a
    expect(onEditingChange).toHaveBeenLastCalledWith(true);

    container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.click();
    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("fires false when the edit resolves via a successful recommit", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const onEditingChange = jest.fn();
    new StepFlow(container, [a, b], undefined, { onEditingChange });
    a.lastCtx!.onComplete();
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    a.lastCtx!.onComplete(); // re-complete a

    expect(onEditingChange).toHaveBeenLastCalledWith(false);
  });

  it("is never called for a plain, non-edit completion", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const onEditingChange = jest.fn();
    new StepFlow(container, [a, b], undefined, { onEditingChange });

    a.lastCtx!.onComplete();

    expect(onEditingChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest __tests__/components/step-flow.test.ts -t "onEditingChange option"`
Expected: FAIL with a TypeScript error (no 4th constructor parameter exists yet) or, if the test file compiles loosely, `onEditingChange` never being called.

- [ ] **Step 3: Add the `StepFlowOptions` constructor parameter**

In `src/client/components/step-flow.ts`, add this exported interface right before the `StepFlow` class:

```ts
export interface StepFlowOptions {
  /** Called whenever the editing-exclusivity gate opens or closes (Edit
   * clicked on a step, or that edit resolving via Cancel or a successful
   * recommit) -- lets the host panel disable its own chrome (e.g. a
   * "Refresh columns" button) while an edit is unresolved elsewhere. */
  onEditingChange?: (isEditing: boolean) => void;
}
```

Add a field, right after `private editingIndex: number | null = null;`:

```ts
  private readonly onEditingChange?: (isEditing: boolean) => void;
```

Change the constructor signature from:

```ts
  constructor(container: HTMLElement, steps: Step[], savedState?: StepFlowSavedState) {
```

to:

```ts
  constructor(
    container: HTMLElement,
    steps: Step[],
    savedState?: StepFlowSavedState,
    options?: StepFlowOptions,
  ) {
```

and add this line inside the constructor body, right after `this.steps = steps;`:

```ts
    this.onEditingChange = options?.onEditingChange;
```

Update `editStep()` (from Task 2) to fire it — change the end of the method from:

```ts
    if (previousActive !== index) {
      this.setStepInteractive(previousActive, false);
    }
    this.refreshAllRowDisplays();
  }
```

to:

```ts
    if (previousActive !== index) {
      this.setStepInteractive(previousActive, false);
    }
    this.refreshAllRowDisplays();
    this.onEditingChange?.(true);
  }
```

Update `releaseEditingGate()` (from Task 2) to fire it — change:

```ts
    if (restoreIndex !== null) this.setStepInteractive(restoreIndex, true);
    this.refreshAllRowDisplays();
    return restoreIndex;
  }
```

to:

```ts
    if (restoreIndex !== null) this.setStepInteractive(restoreIndex, true);
    this.refreshAllRowDisplays();
    this.onEditingChange?.(false);
    return restoreIndex;
  }
```

- [ ] **Step 4: Run the new tests to verify they pass**

Run: `npx jest __tests__/components/step-flow.test.ts -v`
Expected: PASS (all tests).

- [ ] **Step 5: Write the failing panel-level test**

Add to `__tests__/panels/guided-ai-inference.test.ts`, as a new top-level `describe` block:

```ts
describe("GuidedAIInferencePanel — refresh disabled while editing", () => {
  it("disables the refresh button while an earlier step is being re-edited, and re-enables it on Cancel", async () => {
    const { container } = await mountAndLoad(["NoteCol"]);
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="NoteCol"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // re-edit Step 1
    expect(container.querySelector<HTMLButtonElement>("#refresh-btn")!.disabled).toBe(true);

    container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.click();
    expect(container.querySelector<HTMLButtonElement>("#refresh-btn")!.disabled).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx jest __tests__/panels/guided-ai-inference.test.ts -t "refresh disabled while editing"`
Expected: FAIL — the refresh button stays enabled today; nothing wires `StepFlowOptions` into `GuidedAIInferencePanel` yet.

- [ ] **Step 7: Wire `onEditingChange` into `GuidedAIInferencePanel`**

In `src/client/panels/guided-ai-inference.ts`, add two fields to the class, after `private nav: NavigationContext | null = null;`:

```ts
  private isEditingGuardActive = false;
  private isRefreshing = false;
```

Change the `StepFlow` construction inside `mount()`'s `.then()` callback from:

```ts
          this.stepFlow = new StepFlow(
            container.querySelector("#steps-container")!,
            [inputsStep, promptStep, runStep],
            savedState,
          );
```

to:

```ts
          this.stepFlow = new StepFlow(
            container.querySelector("#steps-container")!,
            [inputsStep, promptStep, runStep],
            savedState,
            {
              onEditingChange: (isEditing) => {
                this.isEditingGuardActive = isEditing;
                this.updateRefreshButtonState(container);
              },
            },
          );
```

Add this new private method, right before `handleRefresh`:

```ts
  private updateRefreshButtonState(container: HTMLElement): void {
    const btn = container.querySelector<HTMLButtonElement>("#refresh-btn")!;
    btn.disabled = this.isRefreshing || this.isEditingGuardActive;
  }
```

Replace `handleRefresh`:

```ts
  private handleRefresh(container: HTMLElement): void {
    const btn = container.querySelector<HTMLButtonElement>("#refresh-btn")!;
    btn.classList.add("spinning");
    btn.disabled = true;
    Promise.all([
      getSheetHeaders().then(
        (headers) => this.inputsStep?.updateHeaders(headers),
        (err: Error) => globalThis.alert("Error refreshing columns: " + err.message),
      ),
      this.runStep?.refreshRowRange(),
    ])
      .then(() => this.runStep?.checkTestStatsFreshness())
      .finally(() => {
        btn.classList.remove("spinning");
        btn.disabled = false;
      });
  }
```

with:

```ts
  private handleRefresh(container: HTMLElement): void {
    const btn = container.querySelector<HTMLButtonElement>("#refresh-btn")!;
    btn.classList.add("spinning");
    this.isRefreshing = true;
    this.updateRefreshButtonState(container);
    Promise.all([
      getSheetHeaders().then(
        (headers) => this.inputsStep?.updateHeaders(headers),
        (err: Error) => globalThis.alert("Error refreshing columns: " + err.message),
      ),
      this.runStep?.refreshRowRange(),
    ])
      .then(() => this.runStep?.checkTestStatsFreshness())
      .finally(() => {
        btn.classList.remove("spinning");
        this.isRefreshing = false;
        this.updateRefreshButtonState(container);
      });
  }
```

- [ ] **Step 8: Run the new test to verify it passes**

Run: `npx jest __tests__/panels/guided-ai-inference.test.ts -v`
Expected: PASS — including the pre-existing refresh-button tests (`btn.disabled` still flips `true`/`false` around the refresh fetch exactly as before, since `isEditingGuardActive` stays `false` throughout those tests).

- [ ] **Step 9: Run the full suite and commit**

Run: `npm test`
Expected: PASS (all suites).

```bash
git add src/client/components/step-flow.ts src/client/panels/guided-ai-inference.ts \
  __tests__/components/step-flow.test.ts __tests__/panels/guided-ai-inference.test.ts
git commit -m "$(cat <<'EOF'
Disable Refresh columns while a step is mid-edit elsewhere

Refreshing headers/row-range mid-edit could race with an unresolved
[Edit], so it now shares the same exclusivity gate introduced for
Continue/Test/Run/[Edit] buttons.
EOF
)"
```

---

## Task 4: `onBusyChange` — disable Cancel while a recommit request is in flight

**Files:**
- Modify: `src/client/types.ts`
- Modify: `src/client/components/step-flow.ts`
- Modify: `src/client/panels/guided/inputs-step.ts`
- Modify: `src/client/panels/guided/prompt-step.ts`
- Modify: `src/client/sidebar.css`
- Test: `__tests__/components/step-flow.test.ts`
- Test: `__tests__/panels/guided/inputs-step.test.ts`
- Test: `__tests__/panels/guided/prompt-step.test.ts`
- Test: `__tests__/panels/guided/run-step.test.ts` (helper update only)

**Interfaces:**
- Consumes: nothing from Tasks 1-3 beyond the existing `StepContext`/`StepFlow` shape.
- Produces: `StepContext.onBusyChange(isBusy: boolean): void` (new required `StepContext` member, implemented by the shell, called by a step around its own async commit action).

This closes a race: today, clicking Cancel while a recommit request is in flight reverts the row to `"complete"`, but if that request later resolves anyway, it still calls `onComplete()`/`onError()` against a row that's already moved on (`onComplete()` no-ops harmlessly thanks to the existing idempotency guard, but a late `onError()` would incorrectly flip an already-collapsed, already-good row's icon to ✕). Disabling Cancel while busy closes the window entirely.

- [ ] **Step 1: Add `onBusyChange` to `StepContext` and update every `makeCtx()` test helper**

In `src/client/types.ts`, add this member to the `StepContext` interface, after `onError(): void;`:

```ts
  /** Called by the step whenever its own committing action starts (true) or
   * finishes (false) -- successfully or not. Gates the shell's own Cancel
   * button for this step while a request is in flight, closing a race
   * where Cancel reverts this row to "complete" and a still-in-flight
   * request later calls onComplete()/onError() against a row that's
   * already moved on. A step with no async commit action may simply never
   * call it. */
  onBusyChange(isBusy: boolean): void;
```

In `__tests__/panels/guided/inputs-step.test.ts`, `__tests__/panels/guided/prompt-step.test.ts`, and `__tests__/panels/guided/run-step.test.ts`, update the local `makeCtx()` helper in each file from:

```ts
function makeCtx(): StepContext & { onComplete: jest.Mock; onError: jest.Mock } {
  return { onComplete: jest.fn(), onError: jest.fn() };
}
```

to:

```ts
function makeCtx(): StepContext & {
  onComplete: jest.Mock;
  onError: jest.Mock;
  onBusyChange: jest.Mock;
} {
  return { onComplete: jest.fn(), onError: jest.fn(), onBusyChange: jest.fn() };
}
```

- [ ] **Step 2: Run the full suite to verify only expected compile errors (no logic changes yet)**

Run: `npm run typecheck`
Expected: FAIL — `src/client/components/step-flow.ts`'s `mountStep()` constructs a `StepContext` object literal missing `onBusyChange`, so it no longer satisfies the interface. This is the expected, deliberate failure this step's next part fixes.

- [ ] **Step 3: Wire `onBusyChange` into `StepFlow`**

In `src/client/components/step-flow.ts`, add a field right after `private hasErrorByIndex: boolean[];`:

```ts
  private busyByIndex: boolean[];
```

Initialize it in the constructor, right after the existing `this.hasErrorByIndex = steps.map(() => false);` line:

```ts
    this.busyByIndex = steps.map(() => false);
```

Find the `mountStep` method:

```ts
  private mountStep(index: number): void {
    const body = this.rowEls[index].querySelector<HTMLElement>(".step-body")!;
    const ctx: StepContext = {
      onComplete: () => this.handleComplete(index),
      onError: () => this.handleError(index),
    };
    this.steps[index].mount(body, ctx, this.savedByIndex[index]?.savedState);
  }
```

Replace it with:

```ts
  private mountStep(index: number): void {
    const body = this.rowEls[index].querySelector<HTMLElement>(".step-body")!;
    const ctx: StepContext = {
      onComplete: () => this.handleComplete(index),
      onError: () => this.handleError(index),
      onBusyChange: (isBusy: boolean) => this.handleBusyChange(index, isBusy),
    };
    this.steps[index].mount(body, ctx, this.savedByIndex[index]?.savedState);
  }

  private handleBusyChange(index: number, isBusy: boolean): void {
    this.busyByIndex[index] = isBusy;
    this.applyRowDisplay(this.rowEls[index], index, this.steps[index]);
  }
```

Update `applyRowDisplay()`'s Cancel-button line from:

```ts
    row.querySelector<HTMLElement>(".step-cancel-btn")!.hidden = !editingExistingStep;
```

to:

```ts
    const cancelBtn = row.querySelector<HTMLButtonElement>(".step-cancel-btn")!;
    cancelBtn.hidden = !editingExistingStep;
    cancelBtn.disabled = this.busyByIndex[index];
```

- [ ] **Step 4: Write the failing test for Cancel being disabled while busy**

Add to `__tests__/components/step-flow.test.ts`, as a new top-level `describe` block:

```ts
describe("StepFlow — Cancel disabled while busy", () => {
  it("disables Cancel while the step reports itself busy, and re-enables it once idle", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete(); // a: complete, b: active
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    a.lastCtx!.onBusyChange(true);
    expect(container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.disabled).toBe(true);

    a.lastCtx!.onBusyChange(false);
    expect(container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.disabled).toBe(false);
  });
});
```

- [ ] **Step 5: Run it to verify it fails, then run the full suite to verify it now passes**

Run: `npx jest __tests__/components/step-flow.test.ts -v`
Expected: first run (before Step 3's implementation) FAILs with `onBusyChange is not a function`; after Step 3's implementation, PASS.

(If executing this plan strictly TDD-by-task rather than TDD-by-file, write this test immediately before Step 3's implementation instead — either ordering is fine as long as the test is proven to fail against the pre-Step-3 code once.)

- [ ] **Step 6: Write the failing tests for `InputsStep`/`PromptStep` calling `onBusyChange`**

Add to `__tests__/panels/guided/inputs-step.test.ts`, as a new top-level `describe` block:

```ts
describe("InputsStep — onBusyChange", () => {
  it("reports busy true before the Drive-folder request and false after it resolves", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue(undefined);
    const container = makeContainer();
    const step = new InputsStep(["col_a"]);
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value =
      "https://drive.google.com/x";

    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    expect(ctx.onBusyChange).toHaveBeenNthCalledWith(1, true);

    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.onBusyChange).toHaveBeenNthCalledWith(2, false);
  });

  it("reports busy false after a failed request", async () => {
    (services.prepRecipe as jest.Mock).mockRejectedValue(new Error("boom"));
    globalThis.alert = jest.fn();
    const container = makeContainer();
    const step = new InputsStep(["col_a"]);
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value =
      "https://drive.google.com/x";

    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(ctx.onError).toHaveBeenCalled();
  });

  it("never reports busy when there are no Drive-folder rows (no RPC needed)", () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a"]);
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="col_a"]')!.click();

    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();

    expect(ctx.onBusyChange).not.toHaveBeenCalled();
    expect(ctx.onComplete).toHaveBeenCalled();
  });
});
```

Add to `__tests__/panels/guided/prompt-step.test.ts`, as a new top-level `describe` block:

```ts
describe("PromptStep — onBusyChange", () => {
  it("reports busy true before the request and false after it resolves", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue(undefined);
    const container = makeContainer();
    const step = new PromptStep();
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "Summarize this.";

    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    expect(ctx.onBusyChange).toHaveBeenNthCalledWith(1, true);

    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.onBusyChange).toHaveBeenNthCalledWith(2, false);
  });

  it("reports busy false after a failed request", async () => {
    (services.prepRecipe as jest.Mock).mockRejectedValue(new Error("boom"));
    const container = makeContainer();
    const step = new PromptStep();
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "Summarize this.";

    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(ctx.onBusyChange).toHaveBeenLastCalledWith(false);
    expect(ctx.onError).toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run the new tests to verify they fail**

Run: `npx jest __tests__/panels/guided/inputs-step.test.ts __tests__/panels/guided/prompt-step.test.ts -t "onBusyChange"`
Expected: FAIL — neither step calls `ctx.onBusyChange` anywhere yet.

- [ ] **Step 8: Implement `onBusyChange` calls in `InputsStep.handleContinue`**

In `src/client/panels/guided/inputs-step.ts`, replace the `handleContinue` method:

```ts
  private handleContinue(ctx: StepContext): void {
    const rows = this.currentRows().filter((r) =>
      r.kind === "column" ? r.colTitle !== "" : r.url !== "",
    );
    const folderRows = rows.filter(
      (r): r is { kind: "drive-folder"; url: string; colTitle: string } =>
        r.kind === "drive-folder",
    );

    const finish = (): void => {
      this.continueButton!.setIdle();
      this.result = { promptCols: rows.map((r) => ({ col: r.colTitle, kind: "auto" as const })) };
      ctx.onComplete();
    };

    if (folderRows.length === 0) {
      finish();
      return;
    }

    const cols: PrepColSpec[] = folderRows.map((r, i) => ({
      colTitle: r.colTitle,
      fillStrategy: { kind: "list-drive-folder", inputId: `driveFolder_${i}` },
    }));
    const inputValues: Record<string, string> = {};
    folderRows.forEach((r, i) => (inputValues[`driveFolder_${i}`] = r.url));

    this.continueButton!.setLoading();
    prepRecipe({ cols, inputValues }).then(finish, (err: Error) => {
      globalThis.alert("Error importing Drive folder: " + err.message);
      ctx.onError();
      this.continueButton!.setIdle();
    });
  }
```

with:

```ts
  private handleContinue(ctx: StepContext): void {
    const rows = this.currentRows().filter((r) =>
      r.kind === "column" ? r.colTitle !== "" : r.url !== "",
    );
    const folderRows = rows.filter(
      (r): r is { kind: "drive-folder"; url: string; colTitle: string } =>
        r.kind === "drive-folder",
    );

    const finish = (): void => {
      this.continueButton!.setIdle();
      this.result = { promptCols: rows.map((r) => ({ col: r.colTitle, kind: "auto" as const })) };
      ctx.onComplete();
    };

    if (folderRows.length === 0) {
      finish();
      return;
    }

    const cols: PrepColSpec[] = folderRows.map((r, i) => ({
      colTitle: r.colTitle,
      fillStrategy: { kind: "list-drive-folder", inputId: `driveFolder_${i}` },
    }));
    const inputValues: Record<string, string> = {};
    folderRows.forEach((r, i) => (inputValues[`driveFolder_${i}`] = r.url));

    ctx.onBusyChange(true);
    this.continueButton!.setLoading();
    prepRecipe({ cols, inputValues }).then(
      () => {
        ctx.onBusyChange(false);
        finish();
      },
      (err: Error) => {
        ctx.onBusyChange(false);
        globalThis.alert("Error importing Drive folder: " + err.message);
        ctx.onError();
        this.continueButton!.setIdle();
      },
    );
  }
```

- [ ] **Step 9: Implement `onBusyChange` calls in `PromptStep.handleContinue`**

In `src/client/panels/guided/prompt-step.ts`, replace the `handleContinue` method:

```ts
  private handleContinue(ctx: StepContext): void {
    const promptText = this.textarea!.value.trim();
    if (!promptText) {
      globalThis.alert("Please describe what the AI should do.");
      return;
    }
    this.continueButton!.setLoading();
    prepRecipe({
      cols: [
        {
          colTitle: SYSTEM_PROMPT_COLUMN_TITLE,
          fillStrategy: { kind: "fill-value", value: promptText },
        },
      ],
      inputValues: {},
    }).then(
      () => {
        this.continueButton!.setIdle();
        this.result = { systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE };
        ctx.onComplete();
      },
      (err: Error) => {
        globalThis.alert("Error saving prompt: " + err.message);
        ctx.onError();
        this.continueButton!.setIdle();
      },
    );
  }
```

with:

```ts
  private handleContinue(ctx: StepContext): void {
    const promptText = this.textarea!.value.trim();
    if (!promptText) {
      globalThis.alert("Please describe what the AI should do.");
      return;
    }
    ctx.onBusyChange(true);
    this.continueButton!.setLoading();
    prepRecipe({
      cols: [
        {
          colTitle: SYSTEM_PROMPT_COLUMN_TITLE,
          fillStrategy: { kind: "fill-value", value: promptText },
        },
      ],
      inputValues: {},
    }).then(
      () => {
        ctx.onBusyChange(false);
        this.continueButton!.setIdle();
        this.result = { systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE };
        ctx.onComplete();
      },
      (err: Error) => {
        ctx.onBusyChange(false);
        globalThis.alert("Error saving prompt: " + err.message);
        ctx.onError();
        this.continueButton!.setIdle();
      },
    );
  }
```

- [ ] **Step 10: Run the new tests to verify they pass**

Run: `npx jest __tests__/panels/guided/inputs-step.test.ts __tests__/panels/guided/prompt-step.test.ts -v`
Expected: PASS.

- [ ] **Step 11: Add `:disabled` styling for `.step-cancel-btn`**

In `src/client/sidebar.css`, right after the existing `.step-cancel-btn:hover { text-decoration: underline; }` rule, add:

```css
.step-cancel-btn:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 12: Run the full suite (including typecheck) and commit**

Run: `npm run typecheck && npm test`
Expected: PASS (both).

```bash
git add src/client/types.ts src/client/components/step-flow.ts \
  src/client/panels/guided/inputs-step.ts src/client/panels/guided/prompt-step.ts \
  src/client/sidebar.css __tests__/components/step-flow.test.ts \
  __tests__/panels/guided/inputs-step.test.ts __tests__/panels/guided/prompt-step.test.ts \
  __tests__/panels/guided/run-step.test.ts
git commit -m "$(cat <<'EOF'
Disable Cancel while a recommit request is in flight

Closes a race where clicking Cancel reverts a step to its old complete
state while its in-flight request is still pending, and that request's
eventual onError() would otherwise flip the (already-good) row's icon to
an error state after the fact.
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Decision 1 (relock cascade) → Task 1. Decision 2 (exclusivity gate, including the `[Edit]`-disabling on other complete steps that the spec's "Continue/Test/Run/Edit" line calls for) → Task 2. The spec's "Refresh columns" implementation-surface note → Task 3. Decision 3 (Cancel/error handling, specifically "Cancel disabled while a recommit request is in flight") → Task 4. Decision 4 (decoupled row-display predicates) → Task 1. The "plain styling, no stale badge" non-goal is satisfied by Task 1 doing nothing beyond showing the plain cached summary string.
- **Type consistency:** `Step.setInteractive?` (Task 2) and `StepContext.onBusyChange` (Task 4) are used with identical signatures everywhere they appear — `RunControls`/`InputsStep`/`PromptStep`/`RunStep` all implement `setInteractive(enabled: boolean): void`; every `StepContext` construction site (real, in `step-flow.ts`, and test-fake, in the three step test files) includes `onBusyChange(isBusy: boolean): void`.
- **Task ordering:** Task 2 depends on Task 1's `applyRowDisplay`/`handleComplete` shape (it edits both again). Task 3 depends on Task 2's `editingIndex`/`releaseEditingGate`. Task 4 is independent of Tasks 2-3's mechanism (it only touches `StepContext`/`mountStep`/Cancel-button rendering) but is sequenced last per the spec's own ordering.
