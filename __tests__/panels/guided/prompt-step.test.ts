/**
 * @jest-environment jsdom
 */

jest.mock("../../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import {
  PromptStep,
  SYSTEM_PROMPT_COLUMN_TITLE,
} from "../../../src/client/panels/guided/prompt-step";
import * as services from "../../../src/client/services";
import type { StepContext } from "../../../src/client/types";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

function makeCtx(): StepContext & { onComplete: jest.Mock; onError: jest.Mock } {
  return { onComplete: jest.fn(), onError: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.alert = jest.fn();
});

describe("PromptStep — required prompt", () => {
  it("alerts and does not call prepRecipe when the prompt is empty", () => {
    const container = makeContainer();
    const step = new PromptStep();
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith(
      expect.stringContaining("describe what the AI should do"),
    );
    expect(services.prepRecipe).not.toHaveBeenCalled();
    expect(ctx.onComplete).not.toHaveBeenCalled();
  });

  it("alerts on whitespace-only input", () => {
    const container = makeContainer();
    const step = new PromptStep();
    step.mount(container, makeCtx());
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "   ";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    expect(globalThis.alert).toHaveBeenCalled();
    expect(services.prepRecipe).not.toHaveBeenCalled();
  });
});

describe("PromptStep — commit", () => {
  it("writes a single fill-value PrepColSpec and calls onComplete", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const container = makeContainer();
    const step = new PromptStep();
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value =
      "You are a helpful assistant.";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.prepRecipe).toHaveBeenCalledWith({
      cols: [
        {
          colTitle: SYSTEM_PROMPT_COLUMN_TITLE,
          fillStrategy: { kind: "fill-value", value: "You are a helpful assistant." },
        },
      ],
      inputValues: {},
    });
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
    expect(step.getResult()).toEqual({ systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE });
  });

  it("shows a loading state on the continue button while prepRecipe is in flight, then reverts to idle on failure", async () => {
    let rejectPrepRecipe!: (err: Error) => void;
    (services.prepRecipe as jest.Mock).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPrepRecipe = reject;
      }),
    );
    const container = makeContainer();
    const step = new PromptStep();
    step.mount(container, makeCtx());
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "Do something.";
    const continueBtn = container.querySelector<HTMLButtonElement>("#gp-continue")!;
    continueBtn.click();
    await Promise.resolve();

    expect(continueBtn.disabled).toBe(true);
    expect(continueBtn.textContent).toContain("Importing...");

    rejectPrepRecipe(new Error("boom"));
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(continueBtn.disabled).toBe(false);
    expect(continueBtn.textContent).toBe("Import & Continue");
  });

  it("calls ctx.onError and alerts, not onComplete, when prepRecipe rejects", async () => {
    (services.prepRecipe as jest.Mock).mockRejectedValue(new Error("write failed"));
    const container = makeContainer();
    const step = new PromptStep();
    const ctx = makeCtx();
    step.mount(container, ctx);
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "Do something.";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(ctx.onError).toHaveBeenCalledTimes(1);
    expect(ctx.onComplete).not.toHaveBeenCalled();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("write failed"));
  });
});

describe("PromptStep — unmount/mount round trip", () => {
  it("unmount() returns the full, untruncated 'Prompt: ' summary -- truncation is StepFlow's job", () => {
    const container = makeContainer();
    const step = new PromptStep();
    step.mount(container, makeCtx());
    const long = "x".repeat(80);
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = long;
    const result = step.unmount();
    expect(result?.summary).toBe("Prompt: " + long);
    expect(result?.savedState.promptText).toBe(long);
  });

  it("mount(savedState) restores the prompt text", () => {
    const container = makeContainer();
    const step = new PromptStep();
    step.mount(container, makeCtx(), { promptText: "restored text" });
    expect(container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value).toBe(
      "restored text",
    );
  });

  it("unmount() before mount returns undefined", () => {
    expect(new PromptStep().unmount()).toBeUndefined();
  });
});
