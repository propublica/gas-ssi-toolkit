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

import { RecipeV2Panel } from "../../src/client/panels/recipe-v2";
import * as services from "../../src/client/services";
import type { RecipeDefinition, NavigationContext } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;
const mockRunBatchAI = services.runBatchAI as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return { navigate: jest.fn(), back: jest.fn(), canGoBack: jest.fn().mockReturnValue(true) };
}

const baseDefinition: RecipeDefinition = {
  id: "document-summarization-v2",
  name: "Document Summarization V2",
  icon: "📄",
  variant: "v2",
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

function mount(definition = baseDefinition) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipeV2Panel();
  panel.mount(container, nav, definition);
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
  it("renders Test and Cook both enabled", () => {
    const { container } = mount();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});

describe("Test flow", () => {
  it("calls prepRecipe then runBatchAI with first 10 data rows", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 50 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledTimes(1);
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 11 } }),
    );
  });

  it("clamps Test rowRange to actual end when fewer than 10 rows exist", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 5 } }),
    );
  });

  it("disables both buttons while testing", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 50 } });
    mockRunBatchAI.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
  });

  it("re-enables both buttons after Test completes", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 50 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });

  it("shows alert and re-enables on error", async () => {
    globalThis.alert = jest.fn();
    mockPrepRecipe.mockRejectedValue(new Error("server error"));
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(globalThis.alert).toHaveBeenCalledWith("Error: server error");
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
  });
});

describe("Cook flow", () => {
  it("calls prepRecipe then runBatchAI with the full rowRange", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 50 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 50 } }),
    );
  });

  it("excludes output column when calling prepRecipe", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 10 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    await flush();
    const calledCols = mockPrepRecipe.mock.calls[0][0].cols;
    expect(calledCols.every((c: { role?: string }) => c.role !== "output")).toBe(true);
  });

  it("disables both buttons while cooking", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 50 } });
    mockRunBatchAI.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
  });

  it("re-enables both buttons after Cook completes", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 50 } });
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});

describe("Validation", () => {
  it("shows alert and does not call prepRecipe when required input is empty", async () => {
    globalThis.alert = jest.fn();
    const { container } = mount();
    // Do NOT fill in the required "folder" input
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(globalThis.alert).toHaveBeenCalledTimes(1);
    expect(mockPrepRecipe).not.toHaveBeenCalled();
  });
});
