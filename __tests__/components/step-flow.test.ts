/**
 * @jest-environment jsdom
 */

import { StepFlow } from "../../src/client/components/step-flow";
import type { Step, StepContext, StepFlowSavedState } from "../../src/client/types";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

class FakeStep implements Step<{ value: string }> {
  title: string;
  flavorText: string;
  mounted = false;
  mountCallCount = 0;
  unmountCallCount = 0;
  lastCtx: StepContext | null = null;
  private value = "";

  constructor(title: string, flavorText = "flavor") {
    this.title = title;
    this.flavorText = flavorText;
  }

  mount(container: HTMLElement, ctx: StepContext, savedState?: { value: string }): void {
    this.mounted = true;
    this.mountCallCount++;
    this.lastCtx = ctx;
    this.value = savedState?.value ?? "";
    container.innerHTML = `<input class="fake-step-input" value="${this.value}" />`;
  }

  unmount(): { savedState: { value: string }; summary: string } | undefined {
    if (!this.mounted) return undefined;
    this.unmountCallCount++;
    this.mounted = false;
    return { savedState: { value: this.value }, summary: this.value || "empty" };
  }

  setValue(v: string): void {
    this.value = v;
  }
}

class FakeStepWithDestroy extends FakeStep {
  destroyCallCount = 0;
  destroy(): void {
    this.destroyCallCount++;
  }
}

class FakeStepWithInteractive extends FakeStep {
  interactiveCalls: boolean[] = [];
  setInteractive(enabled: boolean): void {
    this.interactiveCalls.push(enabled);
  }
}

describe("StepFlow — initial render", () => {
  it("mounts only step 0, others locked", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    expect(a.mounted).toBe(true);
    expect(b.mounted).toBe(false);
    expect(container.querySelectorAll(".step-row")).toHaveLength(2);
  });

  it("shows ○ for locked steps and ● for the active one", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    const icons = container.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("●");
    expect(icons[1].textContent).toBe("○");
  });
});

describe("StepFlow — onComplete for a non-terminal step", () => {
  it("collapses the step, shows its cached summary and [Edit], and mounts the next step", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.setValue("col_x");
    a.lastCtx!.onComplete();

    expect(a.mounted).toBe(false);
    expect(b.mounted).toBe(true);
    const icons = container.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("✓");
    expect(icons[1].textContent).toBe("●");
    expect(container.querySelector(".step-summary")!.textContent).toBe("col_x");
    expect(container.querySelector<HTMLButtonElement>(".step-edit-btn")!.hidden).toBe(false);
  });

  it("calling onComplete again on an already-complete non-terminal step is a no-op", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete();
    // Simulate user typing in B's input
    const input = container.querySelector<HTMLInputElement>(".fake-step-input")!;
    input.value = "live-state";
    // Call onComplete on A again — should not remount B or affect its state
    a.lastCtx!.onComplete();

    expect(b.mounted).toBe(true);
    expect(container.querySelector<HTMLInputElement>(".fake-step-input")!.value).toBe("live-state");
  });
});

describe("StepFlow — onComplete for the terminal (last) step", () => {
  it("flips the icon to ✓ but keeps the step mounted and expanded, with no [Edit]", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete();

    expect(b.mounted).toBe(true);
    const rows = container.querySelectorAll(".step-row");
    const lastIcon = rows[1].querySelector(".step-icon")!;
    expect(lastIcon.textContent).toBe("✓");
    expect(rows[1].querySelector<HTMLElement>(".step-body")!.hidden).toBe(false);
    expect(rows[1].querySelector<HTMLButtonElement>(".step-edit-btn")!.hidden).toBe(true);
  });

  it("calling onComplete again on an already-complete terminal step is a no-op", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete();
    expect(() => b.lastCtx!.onComplete()).not.toThrow();
    expect(b.mounted).toBe(true);
  });
});

describe("StepFlow — summary truncation", () => {
  it("truncates a long summary to 60 chars (with ellipsis) once the step completes", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    const longValue = "x".repeat(80);
    a.setValue(longValue);
    a.lastCtx!.onComplete();

    const rendered = container.querySelector(".step-summary")!.textContent;
    expect(rendered).toBe("x".repeat(60) + "…");
  });

  it("stores the already-truncated summary -- truncation happens once, at unmount time, not on every render", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const flow = new StepFlow(container, [a, b]);
    const longValue = "x".repeat(80);
    a.setValue(longValue);
    a.lastCtx!.onComplete();

    const saved = flow.getValue();
    expect(saved.steps[0].saved?.summary).toBe("x".repeat(60) + "…");
  });

  it("does not add an ellipsis when the summary is at or under the cap", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.setValue("short");
    a.lastCtx!.onComplete();

    expect(container.querySelector(".step-summary")!.textContent).toBe("short");
  });
});

describe("StepFlow — onError", () => {
  it("shows ✕ in place of the active step's icon without changing its status", () => {
    const [a] = [new FakeStep("A")];
    const container = makeContainer();
    new StepFlow(container, [a]);
    a.lastCtx!.onError();
    expect(container.querySelector(".step-icon")!.textContent).toBe("✕");
    expect(container.querySelector(".step-icon")!.classList.contains("step-icon--error")).toBe(
      true,
    );
    expect(a.mounted).toBe(true); // still active/mounted, not collapsed
  });

  it("clears on the next onComplete for that step", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onError();
    a.lastCtx!.onComplete();
    const icons = container.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("✓");
    expect(icons[0].classList.contains("step-icon--error")).toBe(false);
  });
});

describe("StepFlow — [Edit]", () => {
  it("re-expands a collapsed step with its cached savedState, leaving other steps untouched", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.setValue("col_x");
    a.lastCtx!.onComplete(); // a: complete/collapsed, b: active

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click();

    expect(a.mounted).toBe(true);
    expect(container.querySelector<HTMLInputElement>(".fake-step-input")!.value).toBe("col_x");
    expect(b.mounted).toBe(true); // b was already mounted (active) and stays so
  });

  it("editing an earlier step does not collapse an already-complete terminal step", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete(); // b: terminal, complete, expanded

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    expect(b.mounted).toBe(true);
    const rows = container.querySelectorAll(".step-row");
    expect(rows[1].querySelector<HTMLElement>(".step-body")!.hidden).toBe(false);
  });

  it("editing an earlier step while a later non-terminal step is active keeps both mounted", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStep("C")];
    const container = makeContainer();
    const flow = new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete(); // a: complete/collapsed, b: active
    b.setValue("in-progress-b");
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a
    expect(a.mounted).toBe(true);
    expect(b.mounted).toBe(true); // b must still be considered mounted
    const saved = flow.getValue();
    const bSaved = saved.steps[1].saved;
    expect(bSaved?.savedState).toEqual({ value: "in-progress-b" }); // b's live state must be captured, not lost
  });

  it("re-completing an edited earlier step does not remount an already-active later step", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete(); // a: complete, b: active
    expect(b.mountCallCount).toBe(1);
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a; b untouched
    a.lastCtx!.onComplete(); // re-complete a
    expect(b.mounted).toBe(true); // b should still be mounted, not remounted-then-hidden
    expect(b.mountCallCount).toBe(1); // and never remounted a second time
  });
});

describe("StepFlow — getValue()/restore round trip", () => {
  it("captures live state of every currently-mounted step", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const flow = new StepFlow(container, [a, b]);
    a.setValue("col_x");
    a.lastCtx!.onComplete();
    b.setValue("live-b-value");

    const state = flow.getValue();
    expect(state.activeStepIndex).toBe(1);
    expect(state.steps[0]).toEqual({
      status: "complete",
      saved: { savedState: { value: "col_x" }, summary: "col_x" },
    });
    expect(state.steps[1]).toEqual({
      status: "active",
      saved: { savedState: { value: "live-b-value" }, summary: "live-b-value" },
    });
  });

  it("a fresh StepFlow constructed from a prior getValue() restores status, activeIndex, and mounts correctly", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const flow1 = new StepFlow(container, [a, b]);
    a.setValue("col_x");
    a.lastCtx!.onComplete();
    b.setValue("draft");
    const saved = flow1.getValue();

    expect(saved.activeStepIndex).toBe(1);
    expect(saved.steps[0]).toEqual({
      status: "complete",
      saved: { savedState: { value: "col_x" }, summary: "col_x" },
    });

    const [a2, b2] = [new FakeStep("A"), new FakeStep("B")];
    new StepFlow(container, [a2, b2], saved);
    expect(a2.mounted).toBe(false); // collapsed, not re-mounted
    expect(b2.mounted).toBe(true);
    expect(container.querySelector<HTMLInputElement>(".fake-step-input")!.value).toBe("draft");
  });
});

describe("StepFlow — uncompleting downstream steps on edit", () => {
  it("does not affect anything on a step's first-time completion", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete(); // a: complete, b: active (nothing downstream was ever complete)

    expect(container.querySelectorAll(".step-icon")[1].textContent).toBe("●");
  });

  it("reverts a downstream non-terminal step from complete back to active, re-expanding it", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStep("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete(); // a: complete, b: active
    b.setValue("b-value");
    b.lastCtx!.onComplete(); // b: complete, c: active (terminal)

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a
    a.lastCtx!.onComplete(); // re-complete a

    const rows = container.querySelectorAll(".step-row");
    expect(container.querySelectorAll(".step-icon")[1].textContent).toBe("●");
    expect(rows[1].querySelector<HTMLElement>(".step-body")!.hidden).toBe(false);
    expect(rows[1].querySelector<HTMLElement>(".step-summary")!.hidden).toBe(true);
  });

  it("flips the terminal step's icon back to in-progress without collapsing it", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete(); // a: complete, b: active (terminal)
    b.lastCtx!.onComplete(); // b: complete (terminal, stays expanded)
    expect(container.querySelectorAll(".step-icon")[1].textContent).toBe("✓");

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a
    a.lastCtx!.onComplete(); // re-complete a

    const rows = container.querySelectorAll(".step-row");
    expect(container.querySelectorAll(".step-icon")[1].textContent).toBe("●");
    expect(rows[1].querySelector<HTMLElement>(".step-body")!.hidden).toBe(false); // still expanded
  });
});

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

describe("StepFlow — editing exclusivity", () => {
  it("disables the previously-active step's own interactivity when a different step enters edit mode", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStepWithInteractive("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete(); // a: complete, b: active
    b.lastCtx!.onComplete(); // b: complete, c: active (terminal)

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    // The leading `true` is c's own mount, which asserts the (then-closed)
    // gate as an invariant rather than waiting for an edit event.
    expect(c.interactiveCalls).toEqual([true, false]);
  });

  it("re-enables it when the edit is canceled", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStepWithInteractive("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete();
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.click();

    expect(c.interactiveCalls).toEqual([true, false, true]); // mount, gate opens, gate closes
  });

  it("does not re-enable a step the same recommit just relocked -- its next mount re-asserts the gate instead", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStepWithInteractive("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete();
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a

    a.lastCtx!.onComplete(); // re-complete a -- b reactivates, c relocks

    // c was unmounted by the relock cascade in this very call: re-enabling it
    // would only touch a discarded instance. (The leading `true` is c's own
    // original mount, before any edit began.)
    expect(c.interactiveCalls).toEqual([true, false]);

    b.lastCtx!.onComplete(); // walk forward -- c mounts afresh, gate now closed

    expect(c.interactiveCalls).toEqual([true, false, true]);
  });

  it("gates a step that mounts for the first time WHILE another step is mid-edit", () => {
    // Reachable sequence: Continue clicked on the middle step (RPC in flight),
    // [Edit] clicked on the first step before it resolves, then the RPC
    // resolves and advances the flow -- mounting the terminal step under an
    // already-open gate.
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStepWithInteractive("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete(); // a: complete, b: active, c: locked (never mounted)

    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a
    expect(c.interactiveCalls).toEqual([]); // nothing to gate yet -- c isn't mounted

    b.lastCtx!.onComplete(); // b's in-flight commit resolves under the open gate

    expect(c.mounted).toBe(true);
    expect(c.interactiveCalls).toEqual([false]); // mounted disabled, not enabled
    // The gate is still open on a -- b completing is not a's edit resolving.
    const rows = container.querySelectorAll(".step-row");
    expect(rows[0].querySelector<HTMLButtonElement>(".step-cancel-btn")!.hidden).toBe(false);

    rows[0].querySelector<HTMLButtonElement>(".step-cancel-btn")!.click(); // resolve the edit

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

describe("StepFlow — destroy()", () => {
  it("calls destroy() on every step that implements it, mounted or collapsed", () => {
    const [a, b] = [new FakeStepWithDestroy("A"), new FakeStepWithDestroy("B")];
    const container = makeContainer();
    const flow = new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete(); // a: complete/collapsed, b: active/mounted

    flow.destroy();

    expect(a.destroyCallCount).toBe(1);
    expect(b.destroyCallCount).toBe(1);
  });

  it("does not throw for steps that don't implement destroy()", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const flow = new StepFlow(container, [a, b]);
    expect(() => flow.destroy()).not.toThrow();
  });
});

describe("StepFlow — Cancel", () => {
  it("does not show Cancel on a step being completed for the first time", () => {
    const [a] = [new FakeStep("A")];
    const container = makeContainer();
    new StepFlow(container, [a]);
    expect(container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.hidden).toBe(true);
  });

  it("shows Cancel (and hides Edit) while re-editing a previously-completed step", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.setValue("col_x");
    a.lastCtx!.onComplete();
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click();

    const row = container.querySelectorAll(".step-row")[0];
    expect(row.querySelector<HTMLButtonElement>(".step-cancel-btn")!.hidden).toBe(false);
    expect(row.querySelector<HTMLButtonElement>(".step-edit-btn")!.hidden).toBe(true);
  });

  it("discards in-progress edits and collapses back to the old summary, without unmounting or affecting downstream", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const flow = new StepFlow(container, [a, b]);
    a.setValue("col_x");
    a.lastCtx!.onComplete();
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click();
    a.setValue("live-uncommitted-edit");

    container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.click();

    const row = container.querySelectorAll(".step-row")[0];
    expect(row.querySelector(".step-summary")!.textContent).toBe("col_x");
    expect(row.querySelector<HTMLElement>(".step-body")!.hidden).toBe(true);
    expect(container.querySelectorAll(".step-icon")[0].textContent).toBe("✓");
    // unmount() ran once, for the original completion -- cancel must not add a second call.
    expect(a.unmountCallCount).toBe(1);
    expect(flow.getValue().steps[1].status).toBe("active"); // b untouched by a's cancel
  });

  it("restores activeIndex to what it was before the edit began", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const flow = new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete(); // a: complete, b: active -> activeIndex 1
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click(); // edit a -> activeIndex 0
    container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.click();

    expect(flow.getValue().activeStepIndex).toBe(1);
  });

  it("leaves an existing error icon in place after cancel", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    new StepFlow(container, [a, b]);
    a.lastCtx!.onComplete();
    container.querySelector<HTMLButtonElement>(".step-edit-btn")!.click();
    a.lastCtx!.onError(); // simulate a failed commit attempt during this edit

    container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.click();

    expect(container.querySelectorAll(".step-icon")[0].textContent).toBe("✕");
  });

  it("still collapses correctly when constructed from a saved state with no recorded pre-edit index to restore", () => {
    const [a, b] = [new FakeStep("A"), new FakeStep("B")];
    const container = makeContainer();
    const restored: StepFlowSavedState = {
      activeStepIndex: 0,
      steps: [
        { status: "active", saved: { savedState: { value: "col_x" }, summary: "col_x" } },
        { status: "locked", saved: undefined },
      ],
    };
    new StepFlow(container, [a, b], restored);

    // No gate was opened this session, so no Cancel is offered -- the step is
    // expanded and usable, and a restored draft is committed by completing it,
    // not by cancelling out of it. Dispatched directly to keep covering
    // cancelEdit()'s "nothing to restore activeIndex to" path.
    expect(container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.hidden).toBe(true);
    container.querySelector<HTMLButtonElement>(".step-cancel-btn")!.click();

    const row = container.querySelectorAll(".step-row")[0];
    expect(row.querySelector(".step-summary")!.textContent).toBe("col_x");
    expect(row.querySelector<HTMLElement>(".step-body")!.hidden).toBe(true);
  });

  it("offers no Cancel on the frontier step a recommit's relock cascade re-activated", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStep("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.setValue("a-value");
    a.lastCtx!.onComplete(); // a: complete, b: active
    b.setValue("b-value");
    b.lastCtx!.onComplete(); // b: complete, c: active (terminal)

    container.querySelectorAll<HTMLButtonElement>(".step-edit-btn")[0].click(); // edit a
    a.lastCtx!.onComplete(); // recommit a -- b reactivates WITH cached data, c relocks

    // b is "active" with a cached summary but nobody clicked ITS [Edit], so it
    // must not offer Cancel: cancelEdit(1) there used to collapse b while
    // everything downstream stayed locked, leaving no step expanded at all.
    const cancelBtns = Array.from(
      container.querySelectorAll<HTMLButtonElement>(".step-cancel-btn"),
    );
    expect(cancelBtns.filter((btn) => !btn.hidden)).toHaveLength(0);
  });

  it("leaves a step expanded after the complete/complete/edit/recommit/cancel sequence", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStep("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete(); // 1. complete step 1
    b.lastCtx!.onComplete(); // 2. complete step 2 (terminal step 3 now active)
    container.querySelectorAll<HTMLButtonElement>(".step-edit-btn")[0].click(); // 3. edit step 1
    a.lastCtx!.onComplete(); // 4. recommit step 1

    // 5. click whatever Cancel the user can actually reach at this point.
    Array.from(container.querySelectorAll<HTMLButtonElement>(".step-cancel-btn"))
      .filter((btn) => !btn.hidden)
      .forEach((btn) => btn.click());

    const expandedBodies = Array.from(container.querySelectorAll<HTMLElement>(".step-body")).filter(
      (el) => !el.hidden,
    );
    expect(expandedBodies).toHaveLength(1);
    const rows = container.querySelectorAll(".step-row");
    expect(rows[1].querySelector<HTMLElement>(".step-body")!.hidden).toBe(false);
  });
});

describe("StepFlow — a relocked step renders plain", () => {
  it("clears a relocked step's error icon", () => {
    const [a, b, c] = [new FakeStep("A"), new FakeStep("B"), new FakeStep("C")];
    const container = makeContainer();
    new StepFlow(container, [a, b, c]);
    a.lastCtx!.onComplete();
    b.lastCtx!.onComplete(); // c: active (terminal)
    c.lastCtx!.onError(); // c's own commit failed
    expect(container.querySelectorAll(".step-icon")[2].textContent).toBe("✕");

    container.querySelectorAll<HTMLButtonElement>(".step-edit-btn")[0].click(); // edit a
    a.lastCtx!.onComplete(); // recommit a -- c relocks

    const icon = container.querySelectorAll(".step-icon")[2];
    expect(icon.textContent).toBe("○");
    expect(icon.classList.contains("step-icon--error")).toBe(false);
  });

  it("clears a relocked step's busy flag, so a later re-edit's Cancel isn't stuck disabled", () => {
    const [a, b, c, d] = [
      new FakeStep("A"),
      new FakeStep("B"),
      new FakeStep("C"),
      new FakeStep("D"),
    ];
    const container = makeContainer();
    new StepFlow(container, [a, b, c, d]);
    a.lastCtx!.onComplete(); // b: active
    b.lastCtx!.onComplete(); // c: active
    c.lastCtx!.onBusyChange(true); // c's own commit is in flight

    container.querySelectorAll<HTMLButtonElement>(".step-edit-btn")[0].click(); // edit a
    a.lastCtx!.onComplete(); // recommit a -- b reactivates, c and d relock

    // Walk forward to c again and complete it, then re-edit it.
    b.lastCtx!.onComplete(); // c: active, mounted afresh
    c.lastCtx!.onComplete(); // c: complete, d: active
    container.querySelectorAll<HTMLButtonElement>(".step-edit-btn")[2].click(); // edit c

    const cCancel = container
      .querySelectorAll(".step-row")[2]
      .querySelector<HTMLButtonElement>(".step-cancel-btn")!;
    expect(cCancel.hidden).toBe(false);
    expect(cCancel.disabled).toBe(false);
  });
});

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
