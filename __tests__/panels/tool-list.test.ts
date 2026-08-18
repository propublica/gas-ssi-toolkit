/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  runTool: jest.fn(),
  formatMarkdownSelection: jest.fn(),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));

import { ToolListPanel } from "../../src/client/panels/tool-list";
import * as services from "../../src/client/services";
import * as jobStoreModule from "../../src/client/job-store";
import type { NavigationContext } from "../../src/client/types";

const mockNav: NavigationContext = {
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(false),
};

function mountPanel(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const container = document.getElementById("app")!;
  const panel = new ToolListPanel();
  panel.mount(container, mockNav);
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
  (jobStoreModule.jobStore.dispatch as jest.Mock).mockResolvedValue(undefined);
});

describe("ToolListPanel", () => {
  it("clicking Guided AI Inference navigates to guided-ai-inference", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-guided-ai")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("guided-ai-inference");
  });

  it("clicking Run AI navigates to configure-ai-run", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-run-ai")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("configure-ai-run");
  });

  it("renders Guided AI Inference, Freeform AI Inference, and Recipes first, in that order", () => {
    const c = mountPanel();
    const ids = Array.from(c.querySelectorAll(".tool-btn")).map((btn) => btn.id);
    expect(ids.slice(0, 3)).toEqual(["btn-guided-ai", "btn-run-ai", "btn-recipes"]);
  });

  it("renders the AI section header (not the old 'Main Tools' label)", () => {
    const c = mountPanel();
    const headers = Array.from(c.querySelectorAll("h3")).map((h) => h.textContent);
    expect(headers).toContain("AI");
    expect(headers).not.toContain("Main Tools");
  });

  it("renders short names with descriptive captions for the three AI buttons", () => {
    const c = mountPanel();
    const expectations: Array<[string, string, string]> = [
      ["#btn-guided-ai", "Guided", "Not sure where to begin? Start here."],
      ["#btn-run-ai", "Freeform", "Full control over inputs, prompts and settings"],
      ["#btn-recipes", "Recipes", "Ready-made presets for common tasks"],
    ];
    for (const [selector, name, caption] of expectations) {
      const btn = c.querySelector(selector)!;
      expect(btn.querySelector(".tool-btn-name")!.textContent).toBe(name);
      expect(btn.querySelector(".tool-btn-sub")!.textContent).toBe(caption);
    }
  });

  it("clicking Recipes navigates to recipes-list", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-recipes")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("recipes-list");
  });

  it("clicking Import Drive Links navigates to import-drive-links panel", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("import-drive-links");
  });

  it("clicking Sample Rows calls runTool with 'sampleRowsToEvaluation' and a jobId", () => {
    (services.runTool as jest.Mock).mockResolvedValue(undefined);
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-sample-rows")!.click();
    expect(services.runTool).toHaveBeenCalledWith(
      "sampleRowsToEvaluation",
      expect.stringMatching(/^sampleRowsToEvaluation-\d+$/),
    );
  });

  it("clicking Extract Text navigates to extract-text panel", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-extract-text")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("extract-text");
  });

  it("clicking Format Markdown calls services.formatMarkdownSelection", () => {
    (services.formatMarkdownSelection as jest.Mock).mockResolvedValue(undefined);
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-format-markdown")!.click();
    expect(services.formatMarkdownSelection).toHaveBeenCalledTimes(1);
  });

  it("disables Format Markdown button while in-flight and re-enables on success", async () => {
    let resolve!: () => void;
    (services.formatMarkdownSelection as jest.Mock).mockReturnValue(
      new Promise<void>((res) => {
        resolve = res;
      }),
    );
    const c = mountPanel();
    const btn = c.querySelector<HTMLButtonElement>("#btn-format-markdown")!;

    btn.click();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("Formatting...");

    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain("Format Markdown");
  });

  it("re-enables Format Markdown button and alerts on error", async () => {
    let reject!: (err: Error) => void;
    (services.formatMarkdownSelection as jest.Mock).mockReturnValue(
      new Promise<void>((_, rej) => {
        reject = rej;
      }),
    );
    const mockAlert = jest.fn();
    const origAlert = globalThis.alert;
    globalThis.alert = mockAlert;

    const c = mountPanel();
    const btn = c.querySelector<HTMLButtonElement>("#btn-format-markdown")!;

    btn.click();
    expect(btn.disabled).toBe(true);

    reject(new Error("GAS error"));
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.disabled).toBe(false);
    expect(mockAlert).toHaveBeenCalledWith("Error: GAS error");

    globalThis.alert = origAlert;
  });

  it("unmount() returns undefined", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const panel = new ToolListPanel();
    panel.mount(document.getElementById("app")!, mockNav);
    expect(panel.unmount()).toBeUndefined();
  });
});
