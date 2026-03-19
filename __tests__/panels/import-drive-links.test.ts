/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  importDriveLinks: jest.fn(),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));

import { ImportDriveLinksPanel } from "../../src/client/panels/import-drive-links";
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
  const panel = new ImportDriveLinksPanel();
  panel.mount(container, mockNav, undefined, savedState as never);
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
  (jobStoreModule.jobStore.dispatch as jest.Mock).mockResolvedValue(undefined);
});

describe("ImportDriveLinksPanel", () => {
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

  it("alerts when folder URL is empty and Import is clicked", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel();
    await Promise.resolve();
    c.querySelector<HTMLButtonElement>("#import-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("folder"));
  });

  it("dispatches importDriveLinks job when form is valid", async () => {
    const promise = Promise.resolve();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    (services.importDriveLinks as jest.Mock).mockReturnValue(promise);
    const c = mountPanel();
    await Promise.resolve();

    c.querySelector<HTMLInputElement>("#folder-url-input")!.value =
      "https://drive.google.com/drive/folders/abc123";
    // select the output column tag
    c.querySelector<HTMLElement>("#output-col .tag")?.click();

    c.querySelector<HTMLButtonElement>("#import-btn")!.click();
    expect(jobStoreModule.jobStore.dispatch).toHaveBeenCalledWith(
      expect.stringMatching(/^import-drive-links-\d+$/),
      "Import Drive Links",
      promise,
    );
  });

  it("unmount returns saved state with folderUrl and mimeTypes array", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    document.body.innerHTML = '<div id="app"></div>';
    const container = document.getElementById("app")!;
    const panel = new ImportDriveLinksPanel();
    panel.mount(container, mockNav);
    await Promise.resolve();
    container.querySelector<HTMLInputElement>("#folder-url-input")!.value =
      "https://drive.google.com/drive/folders/xyz";
    const state = panel.unmount();
    expect(state?.folderUrl).toBe("https://drive.google.com/drive/folders/xyz");
    expect(Array.isArray(state?.mimeTypes)).toBe(true);
  });

  it("restores saved folder URL on mount", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel({
      folderUrl: "https://drive.google.com/drive/folders/saved",
      outputCol: "",
      mimeTypes: [],
    });
    await Promise.resolve();
    expect(c.querySelector<HTMLInputElement>("#folder-url-input")!.value).toBe(
      "https://drive.google.com/drive/folders/saved",
    );
  });

  it("navigates back when getSheetHeaders fails", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockRejectedValue(new Error("network error"));
    mountPanel();
    await Promise.resolve();
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("alerts when output column is not selected and Import is clicked", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    const c = mountPanel();
    await Promise.resolve();
    c.querySelector<HTMLInputElement>("#folder-url-input")!.value =
      "https://drive.google.com/drive/folders/abc123";
    // do NOT click any output column tag — leave it unselected
    c.querySelector<HTMLButtonElement>("#import-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("output column"));
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

  it("refresh button disables during load and re-enables after", async () => {
    let resolveHeaders!: (v: string[]) => void;
    (services.getSheetHeaders as jest.Mock)
      .mockResolvedValueOnce(["source_drive"])
      .mockReturnValueOnce(new Promise((r) => (resolveHeaders = r)));
    const c = mountPanel();
    await Promise.resolve();
    const btn = c.querySelector<HTMLButtonElement>("#refresh-btn")!;
    btn.click();
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains("spinning")).toBe(true);
    resolveHeaders(["source_drive", "new_col"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains("spinning")).toBe(false);
  });

  it("alerts on jobStore dispatch failure", async () => {
    globalThis.alert = jest.fn();
    (services.getSheetHeaders as jest.Mock).mockResolvedValue(["source_drive"]);
    (services.importDriveLinks as jest.Mock).mockReturnValue(Promise.resolve());
    (jobStoreModule.jobStore.dispatch as jest.Mock).mockReturnValue(
      Promise.reject(new Error("job failed")),
    );
    const c = mountPanel();
    await Promise.resolve();
    c.querySelector<HTMLInputElement>("#folder-url-input")!.value =
      "https://drive.google.com/drive/folders/abc123";
    c.querySelector<HTMLElement>("#output-col .tag")?.click();
    c.querySelector<HTMLButtonElement>("#import-btn")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(globalThis.alert).toHaveBeenCalledWith("Error: job failed");
  });
});
