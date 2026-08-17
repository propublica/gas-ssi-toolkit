/**
 * @jest-environment jsdom
 */

jest.mock("../../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import { InputsStep } from "../../../src/client/panels/guided/inputs-step";
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
});

describe("InputsStep — column rows", () => {
  it("adding a column row and continuing calls onComplete with no RPC", async () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a", "col_b"]);
    const ctx = makeCtx();
    step.mount(container, ctx);

    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="col_a"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    expect(services.prepRecipe).not.toHaveBeenCalled();
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
    expect(step.getResult()?.promptCols).toEqual([{ col: "col_a", kind: "auto" }]);
  });

  it("removing a row before continuing excludes it", async () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a"]);
    const ctx = makeCtx();
    step.mount(container, ctx);

    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLButtonElement>(".guided-input-remove")!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    expect(step.getResult()?.promptCols).toEqual([]);
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("InputsStep — drive-folder rows", () => {
  it("assigns distinct auto-generated titles to multiple folder rows", () => {
    const container = makeContainer();
    const step = new InputsStep([]);
    step.mount(container, makeCtx());

    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();

    const urlInputs = container.querySelectorAll<HTMLInputElement>(".guided-input-folder-url");
    expect(urlInputs).toHaveLength(2);
  });

  it("calls prepRecipe with one PrepColSpec per folder row, then onComplete", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const container = makeContainer();
    const step = new InputsStep([]);
    const ctx = makeCtx();
    step.mount(container, ctx);

    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value =
      "https://drive.google.com/drive/folders/abc123";
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(services.prepRecipe).toHaveBeenCalledWith({
      cols: [
        {
          colTitle: "Drive Link",
          fillStrategy: { kind: "list-drive-folder", inputId: "driveFolder_0" },
        },
      ],
      inputValues: { driveFolder_0: "https://drive.google.com/drive/folders/abc123" },
    });
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
    expect(step.getResult()?.promptCols).toEqual([{ col: "Drive Link", kind: "auto" }]);
  });

  it("calls ctx.onError and alerts (does not call onComplete) when prepRecipe rejects", async () => {
    (services.prepRecipe as jest.Mock).mockRejectedValue(new Error("Drive down"));
    globalThis.alert = jest.fn();
    const container = makeContainer();
    const step = new InputsStep([]);
    const ctx = makeCtx();
    step.mount(container, ctx);

    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value =
      "https://drive.google.com/x";
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(ctx.onError).toHaveBeenCalledTimes(1);
    expect(ctx.onComplete).not.toHaveBeenCalled();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("Drive down"));
  });
});

describe("InputsStep — unmount/mount round trip", () => {
  it("unmount() returns rows and a summary; mount(savedState) restores them", () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a"]);
    step.mount(container, makeCtx());
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="col_a"]')!.click();

    const result = step.unmount();
    expect(result?.summary).toBe("col_a");
    expect(result?.savedState.rows).toEqual([{ kind: "column", colTitle: "col_a" }]);

    const step2 = new InputsStep(["col_a"]);
    step2.mount(container, makeCtx(), result?.savedState);
    expect(container.querySelectorAll(".guided-input-row")).toHaveLength(1);
  });

  it("unmount() before mount returns undefined", () => {
    const step = new InputsStep([]);
    expect(step.unmount()).toBeUndefined();
  });
});
