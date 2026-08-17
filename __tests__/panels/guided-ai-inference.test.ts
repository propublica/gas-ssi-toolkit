/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
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
});
