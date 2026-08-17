/**
 * @jest-environment jsdom
 */

import { StepFlow } from "../../src/client/components/step-flow";
import type { Step, StepContext } from "../../src/client/types";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

class FakeStep implements Step<{ value: string }> {
  title: string;
  flavorText: string;
  mounted = false;
  lastCtx: StepContext | null = null;
  private value = "";

  constructor(title: string, flavorText = "flavor") {
    this.title = title;
    this.flavorText = flavorText;
  }

  mount(container: HTMLElement, ctx: StepContext, savedState?: { value: string }): void {
    this.mounted = true;
    this.lastCtx = ctx;
    this.value = savedState?.value ?? "";
    container.innerHTML = `<input class="fake-step-input" value="${this.value}" />`;
  }

  unmount(): { savedState: { value: string }; summary: string } | undefined {
    if (!this.mounted) return undefined;
    this.mounted = false;
    return { savedState: { value: this.value }, summary: this.value || "empty" };
  }

  setValue(v: string): void {
    this.value = v;
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

describe("StepFlow — onError", () => {
  it("shows ✕ in place of the active step's icon without changing its status", () => {
    const [a] = [new FakeStep("A")];
    const container = makeContainer();
    new StepFlow(container, [a]);
    a.lastCtx!.onError();
    expect(container.querySelector(".step-icon")!.textContent).toBe("✕");
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
