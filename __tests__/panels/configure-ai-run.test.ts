/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
  getActiveRangeInfo: jest.fn().mockResolvedValue(null),
  getJobProgress: jest.fn().mockResolvedValue(null),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: {
    dispatch: jest.fn().mockImplementation((_id, _label, fn: Promise<void>) => fn),
  },
}));

import { ConfigureAIRunPanel } from "../../src/client/panels/configure-ai-run";
import type { SavedState } from "../../src/client/panels/configure-ai-run";
import * as services from "../../src/client/services";
import type { NavigationContext } from "../../src/client/types";
import type { RunConfig } from "../../src/shared/types";

const mockNav: NavigationContext = {
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(true),
};

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

const DEFAULT_HEADERS = ["col_a", "col_b", "system_prompt", "ai_inference"];

async function mountAndLoad(
  params?: Partial<RunConfig>,
  savedState?: Partial<SavedState>,
  headers = DEFAULT_HEADERS,
): Promise<{ container: HTMLElement; panel: ConfigureAIRunPanel }> {
  (services.getSheetHeaders as jest.Mock).mockResolvedValue(headers);
  const container = makeContainer();
  const panel = new ConfigureAIRunPanel();
  panel.mount(container, mockNav, params, savedState as SavedState);
  await Promise.resolve(); // flush the getSheetHeaders promise
  return { container, panel };
}

/** Clicks "+ Add column" and selects value in the newly appended PromptColList row. */
function addPromptCol(container: HTMLElement, value: string, kind: "text" | "file" = "text"): void {
  container.querySelector<HTMLElement>(".pcol-add-btn")!.click();
  const rows = container.querySelectorAll(".pcol-row");
  const row = rows[rows.length - 1] as HTMLElement;
  row.querySelector<HTMLElement>(".token-add-btn")!.click();
  row.querySelector<HTMLElement>(`.token-option[data-value="${value}"]`)!.click();
  if (kind === "file") {
    const pills = row.querySelectorAll<HTMLElement>(".pcol-kind-pills .tag");
    pills[1].click();
  }
}

/** Returns column chip values from all filled rows in the PromptColList. */
function getPromptColValues(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll(".pcol-row"))
    .map(
      (row) =>
        row.querySelector<HTMLElement>(".token-chip[data-value]")?.getAttribute("data-value") ?? "",
    )
    .filter(Boolean);
}

/** Selects a column in a non-PromptColList TokenInput field (e.g. system-prompt-col, output-col). */
function selectColumn(container: HTMLElement, fieldId: string, value: string): void {
  container.querySelector<HTMLElement>(`#${fieldId} .token-add-btn`)!.click();
  container.querySelector<HTMLElement>(`#${fieldId} .token-option[data-value="${value}"]`)!.click();
}

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.alert = jest.fn();
});

describe("ConfigureAIRunPanel — mount", () => {
  it("calls getSheetHeaders on mount", async () => {
    await mountAndLoad();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(1);
  });

  it("shows config-form after headers load", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector<HTMLElement>("#config-form")!.style.display).toBe("block");
  });

  it("shows no-headers-msg when headers list is empty", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue([]);
    const container = makeContainer();
    const panel = new ConfigureAIRunPanel();
    panel.mount(container, mockNav);
    await Promise.resolve();
    expect(container.querySelector<HTMLElement>("#no-headers-msg")!.style.display).toBe("block");
    expect(container.querySelector<HTMLElement>("#config-form")!.style.display).not.toBe("block");
  });

  it("calls nav.back() on getSheetHeaders failure and alerts", async () => {
    (services.getSheetHeaders as jest.Mock).mockRejectedValue(new Error("Network error"));
    const container = makeContainer();
    const panel = new ConfigureAIRunPanel();
    panel.mount(container, mockNav);
    await Promise.resolve();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("Network error"));
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("pre-selects params on mount", async () => {
    const { container } = await mountAndLoad({ promptCols: [{ col: "col_a", kind: "text" }] });
    expect(getPromptColValues(container)).toContain("col_a");
  });

  it("restores savedState over params", async () => {
    const savedState = {
      promptCols: [{ col: "col_b", kind: "text" as const }],
      systemPromptCol: "",
      outputCol: "ai_inference",
    };
    const { container } = await mountAndLoad(
      { promptCols: [{ col: "col_a", kind: "text" }] },
      savedState,
    );
    expect(getPromptColValues(container)).toContain("col_b");
  });
});

describe("ConfigureAIRunPanel — Run AI", () => {
  it("alerts and does not call runBatchAI when no user prompt cols selected", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith("Please select at least one User prompt column.");
    expect(services.runBatchAI).not.toHaveBeenCalled();
  });

  it("alerts when no output column selected", async () => {
    const { container } = await mountAndLoad();
    addPromptCol(container, "col_a");
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith("Please select an output column.");
  });

  it("shows PanelLoader while headers are loading", async () => {
    let resolveHeaders!: (headers: string[]) => void;
    (services.getSheetHeaders as jest.Mock).mockReturnValue(
      new Promise<string[]>((res) => {
        resolveHeaders = res;
      }),
    );
    const container = makeContainer();
    const panel = new ConfigureAIRunPanel();
    panel.mount(container, mockNav);
    // Before headers resolve, the panel-loader should be visible
    expect(container.querySelector<HTMLElement>("#panel-loader")!.hidden).toBe(false);
    // After headers resolve, the panel-loader should be hidden
    resolveHeaders(DEFAULT_HEADERS);
    await Promise.resolve();
    await Promise.resolve(); // flush finally()
    expect(container.querySelector<HTMLElement>("#panel-loader")!.hidden).toBe(true);
  });

  it("calls runBatchAI with correctly assembled RunConfig and a jobId", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCols: [{ col: "col_a", kind: "text" }],
        outputCol: "ai_inference",
      }),
      expect.stringMatching(/^batch-ai-\d+$/),
    );
  });

  it("stays on panel after run is dispatched without reloading headers", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    expect(mockNav.back).not.toHaveBeenCalled();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(1); // initial load only, no reload
  });

  it("alerts on failure via jobStore catch handler", async () => {
    (services.runBatchAI as jest.Mock).mockRejectedValue(new Error("API error"));
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    // Extra ticks: getActiveRangeInfo adds an async hop before runBatchAI, so
    // the catch handler fires one tick later than in the single-dispatch path.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(globalThis.alert).toHaveBeenCalledWith("Error: API error");
  });

  it("assembleRunConfig includes drive file cols as file entries in promptCols", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [
        { col: "col_a", kind: "text" },
        { col: "col_b", kind: "file" },
      ],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCols: expect.arrayContaining([
          { col: "col_a", kind: "text" },
          { col: "col_b", kind: "file" },
        ]),
      }),
      expect.stringMatching(/^batch-ai-\d+$/),
    );
  });
});

describe("ConfigureAIRunPanel — back", () => {
  it("back-btn calls nav.back()", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#back-btn")!.click();
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("browse-recipes-link navigates to recipes-list when no headers present", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue([]);
    const container = makeContainer();
    const panel = new ConfigureAIRunPanel();
    panel.mount(container, mockNav);
    await Promise.resolve();
    container.querySelector<HTMLAnchorElement>("#browse-recipes-link")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("recipes-list");
  });
});

describe("ConfigureAIRunPanel — refresh", () => {
  it("refresh-btn refetches headers preserving current selections", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["col_a", "col_b"]);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "col_b",
    });
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(1);
    container.querySelector<HTMLButtonElement>("#refresh-btn")!.click();
    await Promise.resolve();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(2);
    // selections preserved after refresh
    expect(getPromptColValues(container)).toContain("col_a");
  });
});

describe("ConfigureAIRunPanel — tools TagList", () => {
  it("renders a tools field group in the template", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector("#tools-list")).not.toBeNull();
  });

  it("populates tools from TOOL_CATALOG synchronously (before headers load)", () => {
    (services.getSheetHeaders as jest.Mock).mockReturnValue(new Promise(() => {})); // never resolves
    const container = makeContainer();
    const panel = new ConfigureAIRunPanel();
    panel.mount(container, mockNav);
    // Tools must be present immediately — no await
    const tags = container.querySelectorAll("#tools-list .tag");
    expect(tags.length).toBeGreaterThan(0);
    const googleSearchTag = container.querySelector<HTMLElement>(
      '#tools-list .tag[data-value="google_search"]',
    );
    expect(googleSearchTag).not.toBeNull();
    expect(googleSearchTag!.textContent).toBe("Google Search");
  });

  it("includes selected tool IDs in runBatchAI call", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>('[data-value="google_search"]')!.click();
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ tools: ["google_search"] }),
      expect.stringMatching(/^batch-ai-\d+$/),
    );
  });
});

describe("includeGrounding checkbox", () => {
  it("renders the include-grounding checkbox", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector("#include-grounding-cb")).not.toBeNull();
  });

  it("assembleRunConfig includes includeGrounding: true when checkbox is checked", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    const cb = container.querySelector<HTMLInputElement>("#include-grounding-cb")!;
    cb.checked = true;
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    const config = (services.runBatchAI as jest.Mock).mock.calls[0]?.[0] as RunConfig | undefined;
    expect(config?.includeGrounding).toBe(true);
  });

  it("assembleRunConfig omits includeGrounding when checkbox is unchecked", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLInputElement>("#include-grounding-cb")!.checked = false;
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    const config = (services.runBatchAI as jest.Mock).mock.calls[0]?.[0] as RunConfig | undefined;
    expect(config?.includeGrounding).toBeUndefined();
  });

  it("unmount saves includeGrounding state", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLInputElement>("#include-grounding-cb")!.checked = true;
    addPromptCol(container, "col_a");
    const saved = panel.unmount();
    expect(saved?.includeGrounding).toBe(true);
  });

  it("updates grounding column label when output column selection changes", async () => {
    const { container } = await mountAndLoad();
    selectColumn(container, "output-col", "col_a");
    await Promise.resolve(); // flush MutationObserver microtask
    const label = container.querySelector<HTMLElement>("#grounding-col-name");
    expect(label?.textContent).toBe("col_a_grounding");
  });

  it("restores includeGrounding from savedState", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_a", kind: "text" as const }],
      systemPromptCol: "",
      outputCol: "ai_inference",
      tools: ["google_search"] as import("../../src/shared/types").ToolId[],
      includeGrounding: true,
    });
    const cb = container.querySelector<HTMLInputElement>("#include-grounding-cb")!;
    expect(cb.checked).toBe(true);
  });

  it("hides the grounding group when no tools are selected", async () => {
    const { container } = await mountAndLoad();
    const group = container.querySelector<HTMLElement>("#include-grounding-group");
    expect(group?.style.display).toBe("none");
  });

  it("shows the grounding group when a tool is selected", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLElement>("#tools-list .tag")?.click();
    const group = container.querySelector<HTMLElement>("#include-grounding-group");
    expect(group?.style.display).toBe("block");
  });

  it("shows the grounding group on mount when tools are pre-selected in savedState", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_a", kind: "text" as const }],
      systemPromptCol: "",
      outputCol: "ai_inference",
      tools: ["google_search"] as import("../../src/shared/types").ToolId[],
      includeGrounding: false,
    });
    const group = container.querySelector<HTMLElement>("#include-grounding-group");
    expect(group?.style.display).toBe("block");
  });

  it("hides the grounding group again when all tools are deselected", async () => {
    const { container } = await mountAndLoad();
    const tag = container.querySelector<HTMLElement>("#tools-list .tag")!;
    tag.click(); // select
    tag.click(); // deselect
    const group = container.querySelector<HTMLElement>("#include-grounding-group");
    expect(group?.style.display).toBe("none");
  });
});

describe("ConfigureAIRunPanel — unmount", () => {
  it("unmount() returns current form state as SavedState", async () => {
    const { container, panel } = await mountAndLoad();
    addPromptCol(container, "col_a");
    selectColumn(container, "output-col", "ai_inference");
    const state = panel.unmount();
    expect(state).not.toBeUndefined();
    const typedState = state as { promptCols: Array<{ col: string; kind: string }> };
    expect(typedState.promptCols.map((p) => p.col)).toContain("col_a");
    expect((state as { tools: string[] }).tools).toEqual([]); // no tools selected
  });

  it("unmount() before headers load returns undefined", () => {
    (services.getSheetHeaders as jest.Mock).mockReturnValue(new Promise(() => {}));
    const container = makeContainer();
    const panel = new ConfigureAIRunPanel();
    panel.mount(container, mockNav);
    expect(panel.unmount()).toBeUndefined();
  });

  it("unmount() saves drive file cols as kind: file entries in promptCols", async () => {
    const { panel } = await mountAndLoad({
      promptCols: [
        { col: "col_a", kind: "text" },
        { col: "col_b", kind: "file" },
      ],
    });
    const state = panel.unmount();
    expect(state).not.toBeUndefined();
    const typedState = state as { promptCols: Array<{ col: string; kind: string }> };
    expect(typedState.promptCols).toContainEqual({ col: "col_b", kind: "file" });
  });
});

describe("ConfigureAIRunPanel — collapsible Tools section", () => {
  it("tools content is hidden on mount by default", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector<HTMLElement>("#tools-content")!.hidden).toBe(true);
  });

  it("clicking tools toggle expands tools content", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#tools-toggle")!.click();
    expect(container.querySelector<HTMLElement>("#tools-content")!.hidden).toBe(false);
  });

  it("clicking tools toggle again collapses tools content", async () => {
    const { container } = await mountAndLoad();
    const toggle = container.querySelector<HTMLButtonElement>("#tools-toggle")!;
    toggle.click();
    toggle.click();
    expect(container.querySelector<HTMLElement>("#tools-content")!.hidden).toBe(true);
  });

  it("summary shows 'No tools selected' when no tools are active", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector<HTMLElement>("#tools-summary")!.textContent).toBe(
      "No tools selected",
    );
  });

  it("summary updates to tool names when a tool is selected", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>('[data-value="google_search"]')!.click();
    expect(container.querySelector<HTMLElement>("#tools-summary")!.textContent).toBe(
      "Google Search",
    );
  });

  it("summary reverts to 'No tools selected' when all tools deselected", async () => {
    const { container } = await mountAndLoad();
    const tag = container.querySelector<HTMLButtonElement>('[data-value="google_search"]')!;
    tag.click(); // select
    tag.click(); // deselect
    expect(container.querySelector<HTMLElement>("#tools-summary")!.textContent).toBe(
      "No tools selected",
    );
  });

  it("toolsExpanded: true in savedState expands section on mount", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [],
      systemPromptCol: "",
      outputCol: "",
      toolsExpanded: true,
    });
    expect(container.querySelector<HTMLElement>("#tools-content")!.hidden).toBe(false);
  });

  it("unmount() saves toolsExpanded: true when section is open", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#tools-toggle")!.click();
    const state = panel.unmount();
    expect((state as { toolsExpanded?: boolean })?.toolsExpanded).toBe(true);
  });

  it("unmount() saves toolsExpanded: false when section is closed", async () => {
    const { container, panel } = await mountAndLoad();
    // default is closed — add a prompt col so unmount() returns state
    addPromptCol(container, "col_a");
    const state = panel.unmount();
    expect((state as { toolsExpanded?: boolean })?.toolsExpanded).toBe(false);
  });
});

describe("prefixWithColName checkbox", () => {
  it("renders the prefix-col-name checkbox", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector("#prefix-col-name-cb")).not.toBeNull();
  });

  it("assembleRunConfig includes prefixWithColName: true when checkbox is checked", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLInputElement>("#prefix-col-name-cb")!.checked = true;
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    const config = (services.runBatchAI as jest.Mock).mock.calls[0]?.[0] as RunConfig | undefined;
    expect(config?.prefixWithColName).toBe(true);
  });

  it("assembleRunConfig omits prefixWithColName when checkbox is unchecked", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLInputElement>("#prefix-col-name-cb")!.checked = false;
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    const config = (services.runBatchAI as jest.Mock).mock.calls[0]?.[0] as RunConfig | undefined;
    expect(config?.prefixWithColName).toBeUndefined();
  });

  it("unmount saves prefixWithColName state", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLInputElement>("#prefix-col-name-cb")!.checked = true;
    addPromptCol(container, "col_a");
    const saved = panel.unmount();
    expect(saved?.prefixWithColName).toBe(true);
  });

  it("restores prefixWithColName from savedState", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_a", kind: "text" as const }],
      systemPromptCol: "",
      outputCol: "ai_inference",
      prefixWithColName: true,
    });
    expect(container.querySelector<HTMLInputElement>("#prefix-col-name-cb")!.checked).toBe(true);
  });
});

describe("ConfigureAIRunPanel — model selector", () => {
  it("renders a row for each model in MODEL_CATALOG", async () => {
    const { container } = await mountAndLoad();
    const rows = container.querySelectorAll<HTMLButtonElement>("#model-list .model-option");
    expect(rows).toHaveLength(3);
    const ids = Array.from(rows).map((r) => r.getAttribute("data-value"));
    expect(ids).toContain("gemini-3.1-flash-lite");
    expect(ids).toContain("gemini-3.5-flash");
    expect(ids).toContain("gemini-3.1-pro-preview");
  });

  it("each row shows name and description inline", async () => {
    const { container } = await mountAndLoad();
    const firstRow = container.querySelector<HTMLButtonElement>("#model-list .model-option")!;
    expect(firstRow.querySelector(".model-option-name")?.textContent).toBe("Gemini 3.1 Flash Lite");
    expect(firstRow.querySelector(".model-option-desc")?.textContent?.length).toBeGreaterThan(0);
  });

  it("selects gemini-3.1-flash-lite by default", async () => {
    const { container } = await mountAndLoad();
    const selected = container.querySelector<HTMLButtonElement>(
      "#model-list .model-option.selected",
    );
    expect(selected?.getAttribute("data-value")).toBe("gemini-3.1-flash-lite");
  });

  it("updates selected row on click", async () => {
    const { container } = await mountAndLoad();
    const flashRow = container.querySelector<HTMLButtonElement>(
      '#model-list .model-option[data-value="gemini-3.5-flash"]',
    )!;
    flashRow.click();
    const selected = container.querySelector<HTMLButtonElement>(
      "#model-list .model-option.selected",
    );
    expect(selected?.getAttribute("data-value")).toBe("gemini-3.5-flash");
  });

  it("updates model summary on selection change", async () => {
    const { container } = await mountAndLoad();
    container
      .querySelector<HTMLButtonElement>(
        '#model-list .model-option[data-value="gemini-3.1-pro-preview"]',
      )!
      .click();
    const summary = container.querySelector<HTMLElement>("#model-summary");
    expect(summary?.textContent).toBe("Gemini 3.1 Pro Preview");
  });

  it("includes selected model in assembleRunConfig output", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container
      .querySelector<HTMLButtonElement>('#model-list .model-option[data-value="gemini-3.5-flash"]')!
      .click();
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve(); // flush getActiveRangeInfo promise
    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ model: "gemini-3.5-flash" }),
      expect.any(String),
    );
  });

  it("restores model from savedState", async () => {
    const { container } = await mountAndLoad({}, { model: "gemini-3.1-pro-preview" } as any);
    const selected = container.querySelector<HTMLButtonElement>(
      "#model-list .model-option.selected",
    );
    expect(selected?.getAttribute("data-value")).toBe("gemini-3.1-pro-preview");
  });

  it("restores model from params when no savedState", async () => {
    const { container } = await mountAndLoad({ model: "gemini-3.5-flash" });
    const selected = container.querySelector<HTMLButtonElement>(
      "#model-list .model-option.selected",
    );
    expect(selected?.getAttribute("data-value")).toBe("gemini-3.5-flash");
  });

  it("unmount saves model and modelExpanded to SavedState", async () => {
    const { container, panel } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container
      .querySelector<HTMLButtonElement>('#model-list .model-option[data-value="gemini-3.5-flash"]')!
      .click();
    container.querySelector<HTMLButtonElement>("#model-toggle")!.click();
    const state = panel.unmount();
    expect(state?.model).toBe("gemini-3.5-flash");
    expect(state?.modelExpanded).toBe(true);
  });
});
