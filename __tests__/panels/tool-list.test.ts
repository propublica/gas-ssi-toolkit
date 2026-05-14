/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  runTool: jest.fn(),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../../src/client/recipes", () => ({
  RECIPES: [
    {
      id: "document-summarization",
      name: "Document Summarization",
      icon: "📄",
      description: "Summarize files in a Google Drive folder",
      inputs: [],
      prepTemplate: [],
    },
  ],
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
  it("renders the 'I want to...' sentence stem", () => {
    const c = mountPanel();
    expect(c.querySelector(".home-prompt")?.textContent?.trim()).toBe("I want to...");
  });

  it("clicking Summarize a Drive folder navigates to recipe panel with document-summarization definition", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-document-summarization")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith(
      "recipe",
      expect.objectContaining({ id: "document-summarization" }),
    );
  });

  it("does not render a Recipes submenu button", () => {
    const c = mountPanel();
    expect(c.querySelector("#btn-recipes")).toBeNull();
  });

  it("clicking Run AI navigates to configure-ai-run", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-run-ai")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("configure-ai-run");
  });

  it("clicking Import Drive Links navigates to import-drive-links panel", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("import-drive-links");
  });

  it("clicking Extract Text navigates to extract-text panel", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-extract-text")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("extract-text");
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

  it("unmount() returns undefined", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const panel = new ToolListPanel();
    panel.mount(document.getElementById("app")!, mockNav);
    expect(panel.unmount()).toBeUndefined();
  });
});
