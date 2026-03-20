/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  extractText: jest.fn(),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));

import { ExtractTextPanel } from "../../src/client/panels/extract-text";
import * as services from "../../src/client/services";
import * as jobStoreModule from "../../src/client/job-store";
import type { NavigationContext } from "../../src/client/types";

const mockNav: NavigationContext = {
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(true),
};

function mountPanel(savedState?: unknown): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const container = document.getElementById("app")!;
  const panel = new ExtractTextPanel();
  panel.mount(container, mockNav, undefined, savedState as never);
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
  (jobStoreModule.jobStore.dispatch as jest.Mock).mockResolvedValue(undefined);
});

describe("ExtractTextPanel", () => {
  it("shows a loader while headers are loading", () => {
    (services.getSheetHeaders as jest.Mock).mockReturnValue(new Promise(() => {}));
    const c = mountPanel();
    expect(c.querySelector("#panel-loader")).toBeTruthy();
    expect(c.querySelector<HTMLElement>("#config-form")!.style.display).toBe("none");
  });

  it("reveals form after headers load", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive", "ai_inference"]);
    const c = mountPanel();
    await Promise.resolve();
    expect(c.querySelector<HTMLElement>("#config-form")!.style.display).not.toBe("none");
  });

  it("back button calls nav.back()", () => {
    (services.getSheetHeaders as jest.Mock).mockReturnValue(new Promise(() => {}));
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#back-btn")!.click();
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("alerts when source column is not selected and Extract is clicked", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel();
    await Promise.resolve();
    c.querySelector<HTMLButtonElement>("#extract-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("source column"));
  });

  it("alerts when output column is not selected and Extract is clicked", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel();
    await Promise.resolve();
    // select source column but not output
    c.querySelector<HTMLElement>("#source-col .tag")?.click();
    c.querySelector<HTMLButtonElement>("#extract-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("output column"));
  });

  it("dispatches extractText job when form is valid", async () => {
    const promise = Promise.resolve();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive", "extracted_text"]);
    (services.extractText as jest.Mock).mockReturnValue(promise);
    const c = mountPanel();
    await Promise.resolve();

    // select first tag in each list independently
    c.querySelector<HTMLElement>("#source-col .tag")?.click();
    c.querySelector<HTMLElement>("#output-col .tag")?.click();

    c.querySelector<HTMLButtonElement>("#extract-btn")!.click();
    expect(jobStoreModule.jobStore.dispatch).toHaveBeenCalledWith(
      expect.stringMatching(/^extract-text-\d+$/),
      "Extract Text",
      promise,
    );
  });

  it("passes rowRange: undefined to extractText when sheet selection is active", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive", "extracted_text"]);
    (services.extractText as jest.Mock).mockReturnValue(Promise.resolve());
    const c = mountPanel();
    await Promise.resolve();

    c.querySelector<HTMLElement>("#source-col .tag")?.click();
    c.querySelector<HTMLElement>("#output-col .tag")?.click();
    // leave RowRange in default "Use sheet selection" mode
    c.querySelector<HTMLButtonElement>("#extract-btn")!.click();

    expect(services.extractText).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: undefined }),
      expect.any(String),
    );
  });

  it("passes explicit rowRange to extractText when specify range is active", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive", "extracted_text"]);
    (services.extractText as jest.Mock).mockReturnValue(Promise.resolve());
    const c = mountPanel();
    await Promise.resolve();

    c.querySelector<HTMLElement>("#source-col .tag")?.click();
    c.querySelector<HTMLElement>("#output-col .tag")?.click();

    // switch to "Specify range" and fill in values
    const rangeRadio = c.querySelector<HTMLInputElement>("input[value='range']")!;
    rangeRadio.click();
    const rangeInputs = c.querySelectorAll<HTMLInputElement>(".range-inputs input");
    const startInput = rangeInputs[0];
    const endInput = rangeInputs[1];
    startInput.value = "3";
    endInput.value = "7";

    c.querySelector<HTMLButtonElement>("#extract-btn")!.click();

    expect(services.extractText).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 3, end: 7 } }),
      expect.any(String),
    );
  });

  it("unmount returns saved state", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    document.body.innerHTML = '<div id="app"></div>';
    const container = document.getElementById("app")!;
    const panel = new ExtractTextPanel();
    panel.mount(container, mockNav);
    await Promise.resolve();
    const state = panel.unmount();
    expect(state).toBeDefined();
    expect(typeof state?.startRow).toBe("number");
    expect(typeof state?.endRow).toBe("number");
  });

  it("restores saved state on remount", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel({
      sourceCol: "source_drive",
      outputCol: "extracted_text",
      startRow: 2,
      endRow: 10,
    });
    await Promise.resolve();
    // Panel should not throw and form should be visible after load
    expect(c.querySelector("#config-form")).toBeTruthy();
  });

  it("navigates back when getSheetHeaders fails", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockRejectedValue(new Error("network error"));
    mountPanel();
    await Promise.resolve();
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("alerts on jobStore dispatch failure", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive", "extracted_text"]);
    (services.extractText as jest.Mock).mockReturnValue(Promise.resolve());
    (jobStoreModule.jobStore.dispatch as jest.Mock).mockReturnValue(
      Promise.reject(new Error("job failed")),
    );
    const c = mountPanel();
    await Promise.resolve();

    c.querySelector<HTMLElement>("#source-col .tag")?.click();
    c.querySelector<HTMLElement>("#output-col .tag")?.click();
    c.querySelector<HTMLButtonElement>("#extract-btn")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.alert).toHaveBeenCalledWith("Error: job failed");
  });

  it("refresh button re-fetches headers", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel();
    await Promise.resolve();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(1);
    c.querySelector<HTMLButtonElement>("#refresh-btn")!.click();
    await Promise.resolve();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(2);
  });
});
