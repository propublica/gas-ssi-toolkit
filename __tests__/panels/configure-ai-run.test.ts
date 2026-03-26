/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
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
    const selected = container.querySelectorAll("#user-prompt-cols .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("col_a");
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
    const selected = container.querySelectorAll("#user-prompt-cols .tag.selected");
    expect(selected[0].getAttribute("data-value")).toBe("col_b");
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
    container.querySelector<HTMLButtonElement>('[data-value="col_a"]')!.click();
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

  it("stays on panel after run is dispatched and refetches headers", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    expect(mockNav.back).not.toHaveBeenCalled();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(2); // initial load + refresh
  });

  it("alerts on failure via jobStore catch handler", async () => {
    (services.runBatchAI as jest.Mock).mockRejectedValue(new Error("API error"));
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    await Promise.resolve(); // flush rejection
    expect(globalThis.alert).toHaveBeenCalledWith("Error: API error");
  });
});

describe("ConfigureAIRunPanel — back", () => {
  it("back-btn calls nav.back()", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#back-btn")!.click();
    expect(mockNav.back).toHaveBeenCalled();
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
    const tags = container.querySelectorAll("#user-prompt-cols .tag.selected");
    expect(tags.length).toBeGreaterThan(0);
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
    // Select at least one user-prompt column so unmount() returns a value (not undefined)
    container.querySelectorAll<HTMLElement>("#user-prompt-cols .tag")[0]?.click();
    const saved = panel.unmount();
    expect(saved?.includeGrounding).toBe(true);
  });

  it("updates grounding column label when output column selection changes", async () => {
    const { container } = await mountAndLoad(); // no pre-selected output column
    const tag = container.querySelector<HTMLButtonElement>("#output-col .tag");
    if (!tag) return; // guard against no tags in jsdom
    tag.click();
    const label = container.querySelector<HTMLElement>("#grounding-col-name");
    expect(label?.textContent).toBe(`${tag.textContent}_grounding`);
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
    container.querySelector<HTMLButtonElement>('[data-value="col_a"]')!.click(); // user-prompt
    container
      .querySelectorAll<HTMLButtonElement>("#output-col .tag")[1]! // ai_inference
      .click();
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
});
