/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
  runBatchAI: jest.fn(),
}));

jest.mock("../../src/client/panels/recipe", () => ({
  buildRunTemplate: jest.fn().mockReturnValue({
    promptCols: [{ col: "Drive Link", kind: "file" }],
    systemPromptCol: "System Prompt",
    outputCol: "AI_Summarization",
  }),
}));

import { RecipeV1Panel } from "../../src/client/panels/recipe-v1";
import * as services from "../../src/client/services";
import type { RecipeDefinition, NavigationContext } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;
const mockRunBatchAI = services.runBatchAI as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return {
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  };
}

const baseDefinition: RecipeDefinition = {
  id: "document-summarization-v1",
  name: "Document Summarization V1",
  icon: "📄",
  variant: "v1",
  description: "Test recipe",
  inputs: [
    { id: "folder", label: "Drive Folder", required: true, placeholder: "Paste URL" },
    { id: "focus", label: "Area of Interest" },
  ],
  prepTemplate: [
    {
      colTitle: "System Prompt",
      fillStrategy: { kind: "template", template: "Summarize." },
      role: "system-prompt",
    },
    {
      colTitle: "Drive Link",
      fillStrategy: { kind: "list-drive-folder", inputId: "folder" },
      role: "file-prompt",
    },
    { colTitle: "AI_Summarization", fillStrategy: { kind: "create-empty" }, role: "output" },
  ],
};

const mockPrepResult = { rowRange: { start: 2, end: 11 } };

function mount(definition = baseDefinition, savedState?: unknown) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipeV1Panel();
  panel.mount(container, nav, definition, savedState as never);
  return { container, nav, panel };
}

async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

beforeEach(() => {
  mockPrepRecipe.mockClear();
  mockRunBatchAI.mockClear();
});

describe("initial state", () => {
  it("renders Prep enabled, Test/Cook/Configure disabled", () => {
    const { container } = mount();
    expect(container.querySelector<HTMLButtonElement>("#prep-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(true);
  });

  it("renders one input per definition input", () => {
    const { container } = mount();
    expect(container.querySelectorAll("[data-input-id]")).toHaveLength(2);
  });
});

describe("Prep flow", () => {
  it("calls prepRecipe with cols excluding the output column", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith({
      cols: [
        expect.objectContaining({ colTitle: "System Prompt" }),
        expect.objectContaining({ colTitle: "Drive Link" }),
      ],
      inputValues: expect.objectContaining({ folder: "https://drive.google.com/abc" }),
    });
    const calledCols = mockPrepRecipe.mock.calls[0][0].cols;
    expect(calledCols.every((c: { role?: string }) => c.role !== "output")).toBe(true);
  });

  it("enables Test, Cook, Configure after Prep succeeds", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(false);
  });

  it("shows alert and stays idle when required input is empty", async () => {
    globalThis.alert = jest.fn();
    const { container } = mount();
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(globalThis.alert).toHaveBeenCalledTimes(1);
    expect(mockPrepRecipe).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
  });

  it("returns to idle if Prep fails", async () => {
    mockPrepRecipe.mockRejectedValue(new Error("server error"));
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
  });

  it("resets to idle when an input field changes after prep", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    container
      .querySelector<HTMLInputElement>('[data-input-id="folder"]')!
      .dispatchEvent(new Event("input"));
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
  });
});

describe("Test flow", () => {
  async function prepAndGetContainer() {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container, nav } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    return { container, nav };
  }

  it("calls runBatchAI with rowRange covering only the first data row", async () => {
    const { container } = await prepAndGetContainer();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 2 } }),
    );
  });

  it("disables all buttons while testing", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    mockRunBatchAI.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#prep-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(true);
  });

  it("returns to prepped state after Test completes", async () => {
    const { container } = await prepAndGetContainer();
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});

describe("Cook flow", () => {
  it("calls runBatchAI with the full rowRange", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 11 } }),
    );
  });
});

describe("Configure AI flow", () => {
  it("navigates to configure-ai-run with preppedRunConfig", async () => {
    mockPrepRecipe.mockResolvedValue(mockPrepResult);
    const { container, nav } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#configure-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith(
      "configure-ai-run",
      expect.objectContaining({ outputCol: "AI_Summarization", rowRange: { start: 2, end: 11 } }),
    );
  });
});
