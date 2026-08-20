/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  getGeminiGemUrl: jest.fn().mockResolvedValue(undefined),
  prepRecipe: jest.fn(),
  runBatchAI: jest.fn().mockResolvedValue(undefined),
  getActiveRangeInfo: jest.fn().mockResolvedValue({ start: 2, end: 11 }),
  getDefaultRowRange: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: {
    dispatch: jest.fn().mockImplementation((_id, _label, fn: Promise<void>) => fn),
    isCancelled: jest.fn().mockReturnValue(false),
    setProgress: jest.fn(),
  },
}));

import { GuidedAIInferencePanel } from "../../src/client/panels/guided-ai-inference";
import * as services from "../../src/client/services";
import type { NavigationContext } from "../../src/client/types";

const mockNav: NavigationContext = {
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(true),
};

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

async function mountAndLoad(headers = ["NoteCol", "OtherCol"]) {
  (services.getSheetHeaders as jest.Mock).mockResolvedValue(headers);
  const container = makeContainer();
  const panel = new GuidedAIInferencePanel();
  panel.mount(container, mockNav, undefined, undefined);
  for (let i = 0; i < 5; i++) await Promise.resolve();
  return { container, panel };
}

beforeEach(() => jest.clearAllMocks());

describe("GuidedAIInferencePanel — mount", () => {
  it("fetches headers and renders three steps, only the first active", async () => {
    const { container } = await mountAndLoad();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(1);
    const rows = container.querySelectorAll(".step-row");
    expect(rows).toHaveLength(3);
    const icons = container.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("●");
    expect(icons[1].textContent).toBe("○");
    expect(icons[2].textContent).toBe("○");
  });

  it("back-btn calls nav.back()", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#back-btn")!.click();
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("alerts and calls nav.back() when getSheetHeaders() rejects", async () => {
    (services.getSheetHeaders as jest.Mock).mockRejectedValue(new Error("Network error"));
    globalThis.alert = jest.fn();
    const container = makeContainer();
    const panel = new GuidedAIInferencePanel();
    panel.mount(container, mockNav, undefined, undefined);
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("Network error"));
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("passes the fetched Gemini Gem URL through to Step 2", async () => {
    (services.getGeminiGemUrl as jest.Mock).mockResolvedValue(
      "https://gemini.google.com/gem/abc123",
    );
    const { container } = await mountAndLoad();

    // Step 2 doesn't mount (and render the link) until Step 1 completes.
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="NoteCol"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    const link = container.querySelector<HTMLAnchorElement>(".guided-gem-link a");
    expect(link?.href).toBe("https://gemini.google.com/gem/abc123");
  });

  it("still loads the panel normally if getGeminiGemUrl() rejects (link just omitted)", async () => {
    (services.getGeminiGemUrl as jest.Mock).mockRejectedValue(new Error("props error"));
    const { container } = await mountAndLoad();

    expect(container.querySelectorAll(".step-row")).toHaveLength(3);
    expect(container.querySelector(".guided-gem-link")).toBeNull();
  });
});

describe("GuidedAIInferencePanel — refresh columns", () => {
  it("re-fetches headers and updates Step 1's column picker, spinning the button meanwhile", async () => {
    const { container } = await mountAndLoad(["NoteCol"]);

    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="NoteCol"]')!.click();

    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["NoteCol", "NewCol"]);
    const btn = container.querySelector<HTMLButtonElement>("#refresh-btn")!;
    btn.click();
    expect(btn.classList.contains("spinning")).toBe(true);
    expect(btn.disabled).toBe(true);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(services.getSheetHeaders).toHaveBeenCalledTimes(2);
    expect(btn.classList.contains("spinning")).toBe(false);
    expect(btn.disabled).toBe(false);
    // Selection survives the refresh.
    expect(container.querySelector(".guided-input-col-picker")!.textContent).toContain("NoteCol");
  });

  it("alerts (without crashing) when the refresh fetch fails", async () => {
    const { container } = await mountAndLoad();
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockRejectedValue(new Error("boom"));

    container.querySelector<HTMLButtonElement>("#refresh-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(container.querySelector<HTMLButtonElement>("#refresh-btn")!.disabled).toBe(false);
  });

  it("once Step 3 is reached, refresh also re-fetches its row-range default (mirrors ConfigureAIRunPanel)", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const { container } = await mountAndLoad();

    // Reach Step 3 so RunStep's RunControls actually mounts.
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="NoteCol"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "Summarize this.";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    const callsBefore = (services.getDefaultRowRange as jest.Mock).mock.calls.length;
    container.querySelector<HTMLButtonElement>("#refresh-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(services.getDefaultRowRange as jest.Mock).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it("refresh before Step 3 is reached does not throw (RunStep not yet mounted)", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#refresh-btn")!.click();
    await expect(
      (async () => {
        for (let i = 0; i < 5; i++) await Promise.resolve();
      })(),
    ).resolves.not.toThrow();
  });
});

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

describe("GuidedAIInferencePanel — unmount cleanup", () => {
  it("tears down Step 1's TokenInput document-level listeners on unmount", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();

    const removeSpy = jest.spyOn(document, "removeEventListener");
    panel.unmount();

    expect(removeSpy.mock.calls.filter((call) => call[0] === "click")).toHaveLength(2);
    removeSpy.mockRestore();
  });
});

describe("GuidedAIInferencePanel — end-to-end step progression", () => {
  it("completing Step 1 and Step 2 unlocks Step 3, which assembles a RunConfig from both", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const { container } = await mountAndLoad();

    // Step 1: pick an existing column, continue.
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="NoteCol"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    // Step 2: write a prompt, continue.
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "Summarize this.";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    // Step 3 should now be mounted and interactive.
    expect(container.querySelector("#run-btn")).not.toBeNull();
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCols: [{ col: "NoteCol", kind: "auto" }],
        systemPromptCol: "System Prompt",
        outputCol: "ai_output",
      }),
      expect.any(String),
    );
    const icons = container.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("✓");
    expect(icons[1].textContent).toBe("✓");
    expect(icons[2].textContent).toBe("✓");
  });
});

describe("GuidedAIInferencePanel — persistence", () => {
  it("unmount() then mount(savedState) restores step progress", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="NoteCol"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    const saved = panel.unmount();
    expect(saved?.activeStepIndex).toBe(1);

    const container2 = makeContainer();
    const panel2 = new GuidedAIInferencePanel();
    panel2.mount(container2, mockNav, undefined, saved);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    const icons = container2.querySelectorAll(".step-icon");
    expect(icons[0].textContent).toBe("✓");
    expect(icons[1].textContent).toBe("●");
  });

  it("restoring a fully-completed flow still allows Run AI to succeed (regression: step results must survive a remount)", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const { container, panel } = await mountAndLoad();

    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="NoteCol"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "Summarize this.";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    const saved = panel.unmount();

    const container2 = makeContainer();
    const panel2 = new GuidedAIInferencePanel();
    panel2.mount(container2, mockNav, undefined, saved);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    container2.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCols: [{ col: "NoteCol", kind: "auto" }],
        systemPromptCol: "System Prompt",
      }),
      expect.any(String),
    );
  });

  it("editing the Prompt step (without re-completing it) then restoring the flow still runs with systemPromptCol set (regression: hydrate() must run for a re-opened-but-not-remounted step)", async () => {
    (services.prepRecipe as jest.Mock).mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const { container, panel } = await mountAndLoad();

    // Step 1: pick a column, continue.
    container.querySelector<HTMLButtonElement>("#gi-add-column")!.click();
    container.querySelector<HTMLElement>(".token-add-btn")!.click();
    container.querySelector<HTMLElement>('.token-option[data-value="NoteCol"]')!.click();
    container.querySelector<HTMLButtonElement>("#gi-continue")!.click();
    await Promise.resolve();

    // Step 2: write a prompt, continue — reaches Step 3, all steps complete.
    container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!.value = "Summarize this.";
    container.querySelector<HTMLButtonElement>("#gp-continue")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    // Click [Edit] on Step 2 (the Prompt step) specifically, then navigate away
    // WITHOUT re-completing it.
    const promptRow = container.querySelector('.step-row[data-step-index="1"]')!;
    promptRow.querySelector<HTMLButtonElement>(".step-edit-btn")!.click();

    const saved = panel.unmount();

    // Simulate navigating back to a fresh panel instance restored from saved state.
    const container2 = makeContainer();
    const panel2 = new GuidedAIInferencePanel();
    panel2.mount(container2, mockNav, undefined, saved);
    for (let i = 0; i < 5; i++) await Promise.resolve();

    container2.querySelector<HTMLButtonElement>("#run-btn")!.click();
    for (let i = 0; i < 5; i++) await Promise.resolve();

    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({
        promptCols: [{ col: "NoteCol", kind: "auto" }],
        systemPromptCol: "System Prompt",
      }),
      expect.any(String),
    );
  });
});
