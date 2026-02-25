/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  runTool: jest.fn(),
}));

import { ToolListPanel } from "../../src/client/panels/tool-list";
import * as services from "../../src/client/services";
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

  it("clicking a tool button calls runTool with the correct function name", async () => {
    (services.runTool as jest.Mock).mockResolvedValue(undefined);
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!.click();
    expect(services.runTool).toHaveBeenCalledWith("importDriveLinks");
  });

  it("tool button shows loading state while runTool is in flight", () => {
    let resolveRunTool!: () => void;
    (services.runTool as jest.Mock).mockReturnValue(
      new Promise<void>((r) => {
        resolveRunTool = r;
      }),
    );
    const c = mountPanel();
    const btn = c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!;
    btn.click();
    expect(btn.classList.contains("loading")).toBe(true);
    expect(btn.textContent).toContain("Working...");
    resolveRunTool();
  });

  it("on runTool success: removes loading class and restores button text", async () => {
    (services.runTool as jest.Mock).mockResolvedValue(undefined);
    const c = mountPanel();
    const btn = c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!;
    const orig = btn.innerHTML;
    btn.click();
    await Promise.resolve();
    expect(btn.classList.contains("loading")).toBe(false);
    expect(btn.innerHTML).toBe(orig);
  });

  it("on runTool failure: alerts, removes loading class, restores button text", async () => {
    globalThis.alert = jest.fn();
    (services.runTool as jest.Mock).mockRejectedValue(new Error("Drive error"));
    const c = mountPanel();
    const btn = c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!;
    const orig = btn.innerHTML;
    btn.click();
    await Promise.resolve();
    expect(globalThis.alert).toHaveBeenCalledWith("Error: Drive error");
    expect(btn.classList.contains("loading")).toBe(false);
    expect(btn.innerHTML).toBe(orig);
  });

  it("unmount() returns undefined", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const panel = new ToolListPanel();
    panel.mount(document.getElementById("app")!, mockNav);
    expect(panel.unmount()).toBeUndefined();
  });
});
