/**
 * @jest-environment jsdom
 */

// Mock RECIPES before importing the panel
jest.mock("../../src/client/recipes", () => ({
  RECIPES: [
    {
      id: "doc-sum",
      name: "Document Summarization",
      icon: "📄",
      description: "Summarize files",
      panelId: "recipe",
      params: { driveFolder: { colTitle: "Drive Link" } },
    },
    {
      id: "custom",
      name: "Custom Recipe",
      icon: "🔧",
      description: "Custom",
      panelId: "recipe",
      params: {},
    },
  ],
}));

import { RecipesListPanel } from "../../src/client/panels/recipes-list";
import type { NavigationContext } from "../../src/client/types";

function makeNav(): jest.Mocked<NavigationContext> {
  return {
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  };
}

function mount() {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipesListPanel();
  panel.mount(container, nav);
  return { container, nav, panel };
}

describe("RecipesListPanel", () => {
  it("renders one button per RECIPES entry", () => {
    const { container } = mount();
    expect(container.querySelector("#btn-doc-sum")).not.toBeNull();
    expect(container.querySelector("#btn-custom")).not.toBeNull();
  });

  it("clicking a recipe button calls nav.navigate with correct panelId and params", () => {
    const { container, nav } = mount();
    container.querySelector<HTMLButtonElement>("#btn-doc-sum")!.click();
    expect(nav.navigate).toHaveBeenCalledWith("recipe", {
      driveFolder: { colTitle: "Drive Link" },
    });
  });

  it("clicking back calls nav.back()", () => {
    const { container, nav } = mount();
    container.querySelector<HTMLButtonElement>("#back-btn")!.click();
    expect(nav.back).toHaveBeenCalledTimes(1);
  });

  it("unmount returns undefined", () => {
    const { panel } = mount();
    expect(panel.unmount()).toBeUndefined();
  });
});
