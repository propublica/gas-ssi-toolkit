/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  runBatchAI: jest.fn(),
  getActiveRangeInfo: jest.fn().mockResolvedValue(undefined),
  getDefaultRowRange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: {
    dispatch: jest.fn().mockImplementation((_id, _label, fn: Promise<void>) => fn),
    isCancelled: jest.fn().mockReturnValue(false),
    setProgress: jest.fn(),
  },
}));

import {
  RunControls,
  computeChunks,
  type RunControlsConfig,
} from "../../src/client/components/run-controls";
import * as services from "../../src/client/services";
import type { RunStats } from "../../src/shared/types";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

const TEST_STATS: RunStats = {
  rowCount: 10,
  totalTimeMs: 4200,
  totalInputTokens: 500,
  totalOutputTokens: 300,
  totalTokenCost: 0.002,
  totalGroundingQueries: 0,
  totalGroundingCost: 0,
  testedAt: 1234567890,
  config: {
    promptCols: [{ col: "col_a", kind: "text" }],
    systemPromptCol: undefined,
    tools: [],
    wrapPromptsInTags: true,
    model: "gemini-3.1-flash-lite",
  },
};

function basicPromptConfig(): ReturnType<RunControlsConfig["getPromptConfig"]> {
  return {
    promptCols: [{ col: "col_a", kind: "auto" as const }],
    systemPromptCol: undefined,
    outputCol: "ai_output",
    wrapPromptsInTags: undefined,
    applyMarkdown: undefined,
  };
}

async function mountAndSettle(
  configOverrides: Partial<RunControlsConfig> = {},
): Promise<{ container: HTMLElement; rc: RunControls }> {
  const container = makeContainer();
  const rc = new RunControls(container, {
    getPromptConfig: basicPromptConfig,
    ...configOverrides,
  });
  await rc.ready;
  return { container, rc };
}

describe("computeChunks", () => {
  it("returns a single chunk when row count equals chunk size", () => {
    expect(computeChunks({ start: 2, end: 51 }, 50)).toEqual([{ start: 2, end: 51 }]);
  });

  it("returns multiple full chunks", () => {
    expect(computeChunks({ start: 2, end: 101 }, 50)).toEqual([
      { start: 2, end: 51 },
      { start: 52, end: 101 },
    ]);
  });

  it("trims the last chunk to the actual end row", () => {
    expect(computeChunks({ start: 2, end: 75 }, 50)).toEqual([
      { start: 2, end: 51 },
      { start: 52, end: 75 },
    ]);
  });

  it("returns a single chunk for exactly one row", () => {
    expect(computeChunks({ start: 5, end: 5 }, 50)).toEqual([{ start: 5, end: 5 }]);
  });

  it("returns a single chunk when row count is less than chunk size", () => {
    expect(computeChunks({ start: 2, end: 11 }, 50)).toEqual([{ start: 2, end: 11 }]);
  });

  it("handles a start row other than 2", () => {
    expect(computeChunks({ start: 10, end: 69 }, 50)).toEqual([
      { start: 10, end: 59 },
      { start: 60, end: 69 },
    ]);
  });
});

describe("RunControls — mount", () => {
  it("populates tools from TOOL_CATALOG synchronously, before ready resolves", () => {
    (services.getDefaultRowRange as jest.Mock).mockReturnValue(new Promise(() => {}));
    const container = makeContainer();
    new RunControls(container, { getPromptConfig: basicPromptConfig });
    expect(container.querySelectorAll("#tools-list .tag").length).toBeGreaterThan(0);
    (services.getDefaultRowRange as jest.Mock).mockResolvedValue(undefined);
  });

  it("renders a model row for each MODEL_CATALOG entry", async () => {
    const { container } = await mountAndSettle();
    expect(container.querySelectorAll("#model-list .model-option")).toHaveLength(2);
  });

  it("selects gemini-3.1-flash-lite by default", async () => {
    const { container } = await mountAndSettle();
    const selected = container.querySelector<HTMLButtonElement>(
      "#model-list .model-option.selected",
    );
    expect(selected?.getAttribute("data-value")).toBe("gemini-3.1-flash-lite");
  });

  it("restores model/tools/rowRange from savedState", async () => {
    const { container } = await mountAndSettle({
      savedState: {
        model: "gemini-3.1-pro-preview",
        tools: ["google_search"],
        rowRange: { start: 2, end: 20 },
      },
    });
    expect(
      container.querySelector<HTMLButtonElement>("#model-list .model-option.selected"),
    ).not.toBeNull();
    const modelBtn = container.querySelector<HTMLButtonElement>(
      '#model-list .model-option[data-value="gemini-3.1-pro-preview"]',
    );
    expect(modelBtn?.classList.contains("selected")).toBe(true);
    const toolEl = container.querySelector<HTMLElement>('[data-value="google_search"]');
    expect(toolEl?.classList.contains("selected")).toBe(true);
  });

  it("seeds the grounding column label from the initial output column", async () => {
    const { container } = await mountAndSettle({
      getPromptConfig: () => ({ ...basicPromptConfig(), outputCol: "summary" }),
    });
    expect(container.querySelector("#grounding-col-name")?.textContent).toBe("summary_grounding");
  });
});

describe("RunControls — Run AI", () => {
  it("calls runBatchAI and then onRunSucceeded once the chunked job resolves", async () => {
    (services.getActiveRangeInfo as jest.Mock).mockResolvedValue({ start: 2, end: 11 });
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const onRunSucceeded = jest.fn();
    const { container } = await mountAndSettle({ onRunSucceeded });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalled();
    expect(onRunSucceeded).toHaveBeenCalledTimes(1);
  });

  it("does not call onRunSucceeded when runBatchAI rejects", async () => {
    (services.getActiveRangeInfo as jest.Mock).mockResolvedValue({ start: 2, end: 11 });
    (services.runBatchAI as jest.Mock).mockRejectedValue(new Error("boom"));
    globalThis.alert = jest.fn();
    const onRunSucceeded = jest.fn();
    const { container } = await mountAndSettle({ onRunSucceeded });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(onRunSucceeded).not.toHaveBeenCalled();
  });

  it("does not require onRunSucceeded to be set", async () => {
    (services.getActiveRangeInfo as jest.Mock).mockResolvedValue({ start: 2, end: 11 });
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndSettle();
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalled();
  });
});

describe("RunControls — Test AI and getValue()", () => {
  it("shows test results and includes them in getValue().lastTest", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(TEST_STATS);
    const { container, rc } = await mountAndSettle();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(container.querySelector<HTMLElement>("#test-results")!.hidden).toBe(false);
    expect(rc.getValue().lastTest?.stats).toEqual(TEST_STATS);
  });

  it("flags the file-size caveat for kind: 'auto' prompt columns, not just 'file'", async () => {
    const autoStats = {
      ...TEST_STATS,
      config: { ...TEST_STATS.config, promptCols: [{ col: "col_a", kind: "auto" as const }] },
    };
    (services.runBatchAI as jest.Mock).mockResolvedValue(autoStats);
    const { container } = await mountAndSettle();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(container.querySelector("#test-results")!.textContent).toContain(
      "Unusually large files may throw off cost and time estimates.",
    );
  });

  it("getValue() reflects live tools/model/rowRange selections", async () => {
    const { container, rc } = await mountAndSettle();
    container.querySelector<HTMLElement>('[data-value="google_search"]')!.click();
    container
      .querySelector<HTMLButtonElement>(
        '#model-list .model-option[data-value="gemini-3.1-pro-preview"]',
      )!
      .click();
    const value = rc.getValue();
    expect(value.tools).toEqual(["google_search"]);
    expect(value.model).toBe("gemini-3.1-pro-preview");
  });
});

describe("RunControls — refreshRowRange", () => {
  it("re-fetches the default row range without disturbing test button state mid-flight", async () => {
    let resolveStats!: (v: RunStats) => void;
    (services.runBatchAI as jest.Mock).mockReturnValue(
      new Promise<RunStats>((res) => {
        resolveStats = res;
      }),
    );
    const { container, rc } = await mountAndSettle();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await Promise.resolve();

    await rc.refreshRowRange();

    const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;
    expect(testBtn.disabled).toBe(true);
    expect(testBtn.querySelector(".btn-spinner")).not.toBeNull();
    resolveStats(TEST_STATS);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
});
