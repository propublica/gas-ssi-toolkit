/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import { RecipePanel } from "../../src/client/panels/recipe";
import * as services from "../../src/client/services";
import type { PrepRecipeResult, RunConfig } from "../../src/shared/types";
import type { RecipeDefinition, NavigationContext } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return {
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  };
}

const baseDefinition: RecipeDefinition = {
  id: "test-recipe",
  name: "Test Recipe",
  icon: "🧪",
  description: "A test recipe",
  inputs: [
    { id: "folder", label: "Drive Folder", required: true, placeholder: "Paste folder URL" },
    { id: "question", label: "What are you looking for?" },
  ],
  prepTemplate: [
    { colTitle: "Drive Link", fillStrategy: { kind: "list-drive-folder", inputId: "folder" } },
    {
      colTitle: "User Prompt",
      fillStrategy: { kind: "template", template: "Summarize. Focus on: {{question}}" },
    },
    { colTitle: "Output", fillStrategy: { kind: "create-empty" } },
  ],
  runTemplate: {
    promptCols: [
      { col: "Drive Link", kind: "file" },
      { col: "User Prompt", kind: "text" },
    ],
    outputCol: "Output",
    tools: ["google_search"],
  },
};

const mockResult: PrepRecipeResult = { rowRange: { start: 2, end: 11 } };

function mount(definition = baseDefinition, savedState?: unknown) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipePanel();
  panel.mount(container, nav, definition, savedState as never);
  return { container, nav, panel };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

// ── rendering ──────────────────────────────────────────────────

describe("rendering", () => {
  it("renders one input field per UserInput", () => {
    const { container } = mount();
    expect(container.querySelectorAll(".recipe-input-field")).toHaveLength(2);
  });

  it("renders the label for each input", () => {
    const { container } = mount();
    const labels = Array.from(container.querySelectorAll(".recipe-input-label")).map(
      (el) => el.textContent,
    );
    expect(labels).toContain("Drive Folder");
    expect(labels).toContain("What are you looking for?");
  });

  it("renders placeholder on the input element", () => {
    const { container } = mount();
    const input = container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!;
    expect(input.placeholder).toBe("Paste folder URL");
  });

  it("does not render column section cards", () => {
    const { container } = mount();
    expect(container.querySelector(".recipe-section-card")).toBeNull();
  });
});

// ── prep flow ──────────────────────────────────────────────────

describe("Prep flow", () => {
  beforeEach(() => mockPrepRecipe.mockClear());

  it("calls prepRecipe with prepTemplate and collected inputValues", async () => {
    mockPrepRecipe.mockResolvedValue(mockResult);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/drive/folders/abc";
    container.querySelector<HTMLInputElement>('[data-input-id="question"]')!.value =
      "fraud patterns";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith({
      cols: baseDefinition.prepTemplate,
      inputValues: {
        folder: "https://drive.google.com/drive/folders/abc",
        question: "fraud patterns",
      },
    });
  });

  it("shows alert and does not call prepRecipe when required input is empty", async () => {
    const alertMock = jest.fn();
    globalThis.alert = alertMock;
    const { container } = mount();
    // leave 'folder' empty
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(mockPrepRecipe).not.toHaveBeenCalled();
  });
});

// ── cook flow ──────────────────────────────────────────────────

describe("Cook flow", () => {
  it("navigates to configure-ai-run with runTemplate merged with rowRange", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const { container, nav } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/drive/folders/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith("configure-ai-run", {
      ...baseDefinition.runTemplate,
      rowRange: { start: 2, end: 5 },
    });
  });
});

// ── saved state ────────────────────────────────────────────────

describe("unmount / saved state", () => {
  it("unmount returns inputValues and prepComplete: false when not prepped", () => {
    const { container, panel } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value = "my-url";
    const state = panel.unmount();
    expect(state).toMatchObject({
      inputValues: { folder: "my-url", question: "" },
      prepComplete: false,
    });
  });

  it("restores input values from savedState", () => {
    const savedState = {
      inputValues: { folder: "restored-url", question: "restored-question" },
      prepComplete: false,
    };
    const { container } = mount(baseDefinition, savedState);
    expect(container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value).toBe(
      "restored-url",
    );
  });

  it("mounts with savedState prepComplete: true — Cook is enabled", () => {
    const savedState = {
      inputValues: {},
      prepComplete: true,
      preppedRunConfig: { outputCol: "Output", promptCols: [] } as Partial<RunConfig>,
    };
    const { container } = mount(baseDefinition, savedState);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});
