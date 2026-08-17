/**
 * @jest-environment jsdom
 */

jest.mock("../../../src/client/services", () => ({
  runBatchAI: jest.fn().mockResolvedValue(undefined),
  getActiveRangeInfo: jest.fn().mockResolvedValue({ start: 2, end: 11 }),
  getDefaultRowRange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../../src/client/job-store", () => ({
  jobStore: {
    dispatch: jest.fn().mockImplementation((_id, _label, fn: Promise<void>) => fn),
    isCancelled: jest.fn().mockReturnValue(false),
    setProgress: jest.fn(),
  },
}));

import { RunStep, GUIDED_OUTPUT_COLUMN_TITLE } from "../../../src/client/panels/guided/run-step";
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

describe("RunStep — mount and Run AI", () => {
  it("assembles promptCols/systemPromptCol from the host callback plus a fixed output column", async () => {
    const getPromptFields = jest.fn().mockReturnValue({
      promptCols: [{ col: "NoteCol", kind: "auto" as const }],
      systemPromptCol: "System Prompt",
    });
    const container = makeContainer();
    const step = new RunStep(getPromptFields, jest.fn());
    step.mount(container, makeCtx());
    for (let i = 0; i < 5; i++) await Promise.resolve();

    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCols: [{ col: "NoteCol", kind: "auto" }],
        systemPromptCol: "System Prompt",
        outputCol: GUIDED_OUTPUT_COLUMN_TITLE,
      }),
      expect.any(String),
    );
  });

  it("calls ctx.onComplete after a successful Run AI, not after Test", async () => {
    const ctx = makeCtx();
    const container = makeContainer();
    const step = new RunStep(() => ({ promptCols: [{ col: "a", kind: "auto" }] }), jest.fn());
    step.mount(container, ctx);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ctx.onComplete).not.toHaveBeenCalled();

    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(ctx.onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("RunStep — Switch to Freeform", () => {
  it("navigates with the current promptCols/systemPromptCol/outputCol plus live run-controls settings", async () => {
    const onSwitchToFreeform = jest.fn();
    const container = makeContainer();
    const step = new RunStep(
      () => ({
        promptCols: [{ col: "a", kind: "auto" as const }],
        systemPromptCol: "System Prompt",
      }),
      onSwitchToFreeform,
    );
    step.mount(container, makeCtx());
    for (let i = 0; i < 5; i++) await Promise.resolve();

    container.querySelector<HTMLButtonElement>("#gr-switch-to-freeform")!.click();

    expect(onSwitchToFreeform).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCols: [{ col: "a", kind: "auto" }],
        systemPromptCol: "System Prompt",
        outputCol: GUIDED_OUTPUT_COLUMN_TITLE,
      }),
    );
  });
});

describe("RunStep — unmount/mount round trip", () => {
  it("unmount() returns RunControls' live state; mount(savedState) restores it", async () => {
    const container = makeContainer();
    const step = new RunStep(() => ({ promptCols: [] }), jest.fn());
    step.mount(container, makeCtx());
    for (let i = 0; i < 5; i++) await Promise.resolve();
    container.querySelector<HTMLElement>('[data-value="google_search"]')!.click();

    const result = step.unmount();
    expect(result?.savedState.runControls?.tools).toEqual(["google_search"]);

    const step2 = new RunStep(() => ({ promptCols: [] }), jest.fn());
    step2.mount(container, makeCtx(), result?.savedState);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(
      container
        .querySelector<HTMLElement>('[data-value="google_search"]')
        ?.classList.contains("selected"),
    ).toBe(true);
  });

  it("restores and re-validates a saved lastTest against the live config on mount", async () => {
    const matchingConfig = {
      promptCols: [{ col: "NoteCol", kind: "auto" as const }],
      systemPromptCol: undefined,
      tools: [],
      wrapPromptsInTags: true,
      model: "gemini-3.1-flash-lite" as const,
    };
    const savedState = {
      runControls: {
        lastTest: {
          stats: {
            rowCount: 10,
            totalTimeMs: 4200,
            totalInputTokens: 500,
            totalOutputTokens: 300,
            totalTokenCost: 0.002,
            totalGroundingQueries: 0,
            totalGroundingCost: 0,
            testedAt: 1234567890,
            config: matchingConfig,
          },
          fullRowCount: 10,
        },
      },
    };
    const container = makeContainer();
    const step = new RunStep(() => ({ promptCols: matchingConfig.promptCols }), jest.fn());
    step.mount(container, makeCtx(), savedState);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    const results = container.querySelector<HTMLElement>("#test-results")!;
    expect(results.hidden).toBe(false);
    expect(results.textContent).toContain("Test run:");
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.textContent).toBe("Tested ✓");
  });
});
