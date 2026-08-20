/**
 * @jest-environment jsdom
 */

jest.mock("../../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import {
  InputsStep,
  type InputsStepSavedState,
} from "../../../src/client/panels/guided/inputs-step";
import * as services from "../../../src/client/services";
import type { StepContext } from "../../../src/client/types";
import type { PrepColSpec } from "../../../src/shared/types";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

function makeCtx(): StepContext & {
  onComplete: jest.Mock;
  onError: jest.Mock;
  onBusyChange: jest.Mock;
} {
  return { onComplete: jest.fn(), onError: jest.fn(), onBusyChange: jest.fn() };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("InputsStep — updateHeaders", () => {
  it("updates a column row's available options while preserving its current selection", () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a", "col_b"]);
    step.mount(container, makeCtx());

    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="col_a"]')!.click();

    step.updateHeaders(["col_a", "col_c"]);

    const tokenInput = container.querySelector(".guided-input-col-picker")!;
    expect(tokenInput.querySelectorAll(".token-chip")).toHaveLength(1);
    expect(tokenInput.textContent).toContain("col_a");

    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    const optionValues = Array.from(container.querySelectorAll(".token-option")).map((el) =>
      el.getAttribute("data-value"),
    );
    expect(optionValues).toContain("col_c");
    expect(optionValues).not.toContain("col_b"); // no longer a real header
  });

  it("does not affect drive-folder rows", () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a"]);
    step.mount(container, makeCtx());
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value =
      "https://drive.google.com/x";

    expect(() => step.updateHeaders(["col_b"])).not.toThrow();
    expect(container.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value).toBe(
      "https://drive.google.com/x",
    );
  });
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

  it("reverts the continue button to idle on success too -- StepFlow can re-expand this step's DOM later without a mount(), so a leftover loading state would otherwise stay stuck", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const container = makeContainer();
    const step = new InputsStep([]);
    step.mount(container, makeCtx());

    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value =
      "https://drive.google.com/x";
    const continueBtn = container.querySelector<HTMLButtonElement>("#gi-continue")!;
    continueBtn.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(continueBtn.disabled).toBe(false);
    expect(continueBtn.textContent).toBe("Import & Continue");
  });

  it("shows a loading state on the continue button while prepRecipe is in flight, then reverts to idle on failure", async () => {
    let rejectPrepRecipe!: (err: Error) => void;
    (services.prepRecipe as jest.Mock).mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPrepRecipe = reject;
      }),
    );
    globalThis.alert = jest.fn();
    const container = makeContainer();
    const step = new InputsStep([]);
    step.mount(container, makeCtx());

    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLInputElement>(".guided-input-folder-url")!.value =
      "https://drive.google.com/x";
    const continueBtn = container.querySelector<HTMLButtonElement>("#gi-continue")!;
    continueBtn.click();
    await Promise.resolve();

    expect(continueBtn.disabled).toBe(true);
    expect(continueBtn.textContent).toContain("Importing...");

    rejectPrepRecipe(new Error("boom"));
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(continueBtn.disabled).toBe(false);
    expect(continueBtn.textContent).toBe("Import & Continue");
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

  it("avoids title collisions when removing and re-adding folder rows", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const container = makeContainer();
    const step = new InputsStep([]);
    const ctx = makeCtx();
    step.mount(container, ctx);

    // Add two folders: A ("Drive Link"), B ("Drive Link 2")
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();

    const urlInputs = container.querySelectorAll<HTMLInputElement>(".guided-input-folder-url");
    urlInputs[0]!.value = "https://drive.google.com/drive/folders/folderA";
    urlInputs[1]!.value = "https://drive.google.com/drive/folders/folderB";

    // Remove first folder (A)
    const removeButtons = container.querySelectorAll<HTMLButtonElement>(".guided-input-remove");
    removeButtons[0]!.click();

    // Add new folder C — should be "Drive Link 3", not "Drive Link 2"
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();

    const remainingUrlInputs = container.querySelectorAll<HTMLInputElement>(
      ".guided-input-folder-url",
    );
    remainingUrlInputs[1]!.value = "https://drive.google.com/drive/folders/folderC";

    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();
    await Promise.resolve();

    const call = (services.prepRecipe as jest.Mock).mock.calls[0][0];
    const colTitles = (call.cols as PrepColSpec[]).map((col) => col.colTitle);
    expect(colTitles).toEqual(["Drive Link 2", "Drive Link 3"]);
    // Ensure no duplicates
    expect(new Set(colTitles).size).toBe(colTitles.length);
  });

  it("restoring savedState with 'Drive Link 2' and adding new folder produces 'Drive Link 3'", () => {
    const container = makeContainer();
    const savedState: InputsStepSavedState = {
      rows: [{ kind: "drive-folder", url: "https://drive.google.com/x", colTitle: "Drive Link 2" }],
    };
    const step = new InputsStep([]);
    step.mount(container, makeCtx(), savedState);

    // Add a new folder — should be "Drive Link 3"
    container.querySelector<HTMLButtonElement>("#gi-add-folder")!.click();

    const urlInputs = container.querySelectorAll<HTMLInputElement>(".guided-input-folder-url");
    expect(urlInputs).toHaveLength(2);
    // The second input was just created; it should have the title "Drive Link 3" internally
    // We verify this by unmounting and checking the result
    const result = step.unmount();
    const titles = result?.savedState.rows.map((r) =>
      r.kind === "drive-folder" ? r.colTitle : null,
    );
    expect(titles).toEqual(["Drive Link 2", "Drive Link 3"]);
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
    expect(result?.summary).toBe("Columns: col_a");
    expect(result?.savedState.rows).toEqual([{ kind: "column", colTitle: "col_a" }]);

    const step2 = new InputsStep(["col_a"]);
    step2.mount(container, makeCtx(), result?.savedState);
    expect(container.querySelectorAll(".guided-input-row")).toHaveLength(1);
  });

  it("unmount() summary reads 'No inputs selected' (unprefixed) when no rows are filled in", () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a"]);
    step.mount(container, makeCtx());
    const result = step.unmount();
    expect(result?.summary).toBe("No inputs selected");
  });

  it("unmount() returns the full, untruncated 'Columns: ' summary -- truncation is StepFlow's job", () => {
    const longHeaders = [
      "a_very_long_column_name_one",
      "another_very_long_column_name_two",
      "yet_another_column_three",
    ];
    const container = makeContainer();
    const step = new InputsStep(longHeaders);
    step.mount(container, makeCtx());
    for (const header of longHeaders) {
      container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
      const rows = container.querySelectorAll(".guided-input-row");
      const row = rows[rows.length - 1]!;
      row.querySelector<HTMLElement>(".token-add-btn")!.click();
      row.querySelector<HTMLElement>(`.token-option[data-value="${header}"]`)!.click();
    }
    const result = step.unmount();
    expect(result?.summary).toBe(`Columns: ${longHeaders.join(", ")}`);
  });

  it("unmount() before mount returns undefined", () => {
    const step = new InputsStep([]);
    expect(step.unmount()).toBeUndefined();
  });
});

describe("InputsStep — destroy()", () => {
  it("tears down every row's TokenInput document-level click listener", () => {
    const container = makeContainer();
    const step = new InputsStep(["col_a", "col_b"]);
    step.mount(container, makeCtx());
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();

    const removeSpy = jest.spyOn(document, "removeEventListener");
    step.destroy();

    expect(removeSpy.mock.calls.filter((call) => call[0] === "click")).toHaveLength(2);
    removeSpy.mockRestore();
  });
});

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
