/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  runTool: jest.fn(),
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
  it("clicking Run AI navigates to configure-ai-run", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-run-ai")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("configure-ai-run");
  });

  it("clicking Recipes navigates to recipes-list", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-recipes")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("recipes-list");
  });

  it("clicking a tool button calls runTool with the function name and a jobId", () => {
    (services.runTool as jest.Mock).mockResolvedValue(undefined);
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!.click();
    expect(services.runTool).toHaveBeenCalledWith(
      "importDriveLinks",
      expect.stringMatching(/^importDriveLinks-\d+$/),
    );
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

  it("clicking Extract Text calls runTool with 'extractTextFromSelection' and a jobId", () => {
    (services.runTool as jest.Mock).mockResolvedValue(undefined);
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-extract-text")!.click();
    expect(services.runTool).toHaveBeenCalledWith(
      "extractTextFromSelection",
      expect.stringMatching(/^extractTextFromSelection-\d+$/),
    );
  });

  it("clicking a tool button dispatches to jobStore with matching jobId, label, and promise", () => {
    const promise = Promise.resolve();
    (services.runTool as jest.Mock).mockReturnValue(promise);
    const c = mountPanel();
    const btn = c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!;
    btn.click();
    expect(jobStoreModule.jobStore.dispatch).toHaveBeenCalledWith(
      expect.stringMatching(/^importDriveLinks-\d+$/),
      expect.any(String),
      promise,
    );
  });

  it("on runTool failure: alerts with error message", async () => {
    globalThis.alert = jest.fn();
    const err = new Error("Drive error");
    (services.runTool as jest.Mock).mockResolvedValue(undefined);
    // Use mockImplementation so the rejection is created at call time (handlers attach before rejection fires)
    (jobStoreModule.jobStore.dispatch as jest.Mock).mockImplementation(() =>
      Promise.reject(err),
    );
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.alert).toHaveBeenCalledWith("Error: Drive error");
  });

  it("unmount() returns undefined", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const panel = new ToolListPanel();
    panel.mount(document.getElementById("app")!, mockNav);
    expect(panel.unmount()).toBeUndefined();
  });
});
