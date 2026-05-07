/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
  runBatchAI: jest.fn(),
}));

jest.mock("../../src/client/job-store", () => ({
  jobStore: { dispatch: jest.fn() },
}));

jest.mock("../../src/client/panels/recipe", () => ({
  buildRunTemplate: jest.fn().mockReturnValue({
    promptCols: [{ col: "Drive Link", kind: "file" }],
    systemPromptCol: "System Prompt",
    outputCol: "AI_Summarization",
  }),
}));

import { RecipeV3Panel } from "../../src/client/panels/recipe-v3";
import * as services from "../../src/client/services";
import type { RecipeDefinition, NavigationContext } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;
const mockRunBatchAI = services.runBatchAI as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return { navigate: jest.fn(), back: jest.fn(), canGoBack: jest.fn().mockReturnValue(true) };
}

const baseDefinition: RecipeDefinition = {
  id: "document-summarization-v3",
  name: "Document Summarization V3",
  icon: "📄",
  variant: "v3",
  description: "Test recipe",
  inputs: [
    { id: "folder", label: "Drive Folder", required: true, placeholder: "Paste URL" },
    { id: "docType", label: "Document Type" },
    { id: "focus", label: "Area of Interest" },
  ],
  prepTemplate: [
    {
      colTitle: "System Prompt",
      fillStrategy: { kind: "template", template: "{{#docType}}Type: {{docType}}{{/docType}}" },
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

const step1Result = { rowRange: { start: 2, end: 11 } };

function mount(definition = baseDefinition) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipeV3Panel();
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
  it("step 2 inputs and button are disabled initially", () => {
    const { container } = mount();
    expect(container.querySelector<HTMLButtonElement>("#step2-btn")!.disabled).toBe(true);
    container.querySelectorAll<HTMLInputElement>("[data-step='2'] input").forEach((el) => {
      expect(el.disabled).toBe(true);
    });
  });

  it("step 3 buttons are disabled initially", () => {
    const { container } = mount();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(true);
  });

  it("step 1 folder input and button are enabled initially", () => {
    const { container } = mount();
    expect(container.querySelector<HTMLButtonElement>("#step1-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.disabled).toBe(
      false,
    );
  });
});

describe("Step 1 import", () => {
  it("calls prepRecipe with only file-prompt columns (no output col)", async () => {
    mockPrepRecipe.mockResolvedValue(step1Result);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith({
      cols: [expect.objectContaining({ colTitle: "Drive Link", role: "file-prompt" })],
      inputValues: { folder: "https://drive.google.com/abc" },
    });
    const calledCols = mockPrepRecipe.mock.calls[0][0].cols;
    expect(calledCols.every((c: { role?: string }) => c.role !== "output")).toBe(true);
    expect(calledCols.every((c: { role?: string }) => c.role !== "system-prompt")).toBe(true);
  });

  it("unlocks step 2 after step 1 import succeeds", async () => {
    mockPrepRecipe.mockResolvedValue(step1Result);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#step2-btn")!.disabled).toBe(false);
  });

  it("shows success status after step 1 import", async () => {
    mockPrepRecipe.mockResolvedValue(step1Result);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    const status = container.querySelector<HTMLElement>("#step1-status");
    expect(status?.hidden).toBe(false);
    expect(status?.textContent).toContain("10");
  });

  it("does not unlock step 3 after only step 1 completes", async () => {
    mockPrepRecipe.mockResolvedValue(step1Result);
    const { container } = mount();
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
  });
});

describe("Step 2 import", () => {
  async function completeStep1(container: HTMLElement): Promise<void> {
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
  }

  it("calls prepRecipe with only system-prompt and text-prompt columns", async () => {
    const { container } = mount();
    await completeStep1(container);
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLButtonElement>("#step2-btn")!.click();
    await flush();
    const calledCols = mockPrepRecipe.mock.calls[1][0].cols;
    expect(calledCols.every((c: { role?: string }) => c.role !== "file-prompt")).toBe(true);
    expect(calledCols.every((c: { role?: string }) => c.role !== "output")).toBe(true);
    expect(calledCols.some((c: { role?: string }) => c.role === "system-prompt")).toBe(true);
  });

  it("unlocks step 3 after step 2 import succeeds", async () => {
    const { container } = mount();
    await completeStep1(container);
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLButtonElement>("#step2-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(false);
  });

  it("passes step 2 input values to prepRecipe", async () => {
    const { container } = mount();
    await completeStep1(container);
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLInputElement>('[data-input-id="docType"]')!.value = "court filing";
    container.querySelector<HTMLButtonElement>("#step2-btn")!.click();
    await flush();
    expect(mockPrepRecipe.mock.calls[1][0].inputValues).toMatchObject({ docType: "court filing" });
  });
});

describe("reset behavior", () => {
  async function completeSteps1And2(container: HTMLElement): Promise<void> {
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLButtonElement>("#step2-btn")!.click();
    await flush();
  }

  it("editing step 1 input re-locks step 3 but not step 2", async () => {
    const { container } = mount();
    await completeSteps1And2(container);
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
    container
      .querySelector<HTMLInputElement>('[data-input-id="folder"]')!
      .dispatchEvent(new Event("input"));
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#step2-btn")!.disabled).toBe(false);
  });

  it("editing step 2 input re-locks step 3 only", async () => {
    const { container } = mount();
    await completeSteps1And2(container);
    container
      .querySelector<HTMLInputElement>('[data-input-id="docType"]')!
      .dispatchEvent(new Event("input"));
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#step2-btn")!.disabled).toBe(false);
  });

  it("re-running step 1 when step 2 is complete re-unlocks step 3", async () => {
    const { container } = mount();
    await completeSteps1And2(container);
    container
      .querySelector<HTMLInputElement>('[data-input-id="folder"]')!
      .dispatchEvent(new Event("input"));
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(false);
  });
});

describe("Step 3 buttons", () => {
  async function fullyPrepped(
    container: HTMLElement,
    nav: jest.Mocked<NavigationContext>,
  ): Promise<void> {
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLInputElement>('[data-input-id="folder"]')!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#step1-btn")!.click();
    await flush();
    mockPrepRecipe.mockResolvedValueOnce(step1Result);
    container.querySelector<HTMLButtonElement>("#step2-btn")!.click();
    await flush();
    void nav;
  }

  it("Test calls runBatchAI with the first 5 data rows", async () => {
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container, nav } = mount();
    await fullyPrepped(container, nav);
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 6 } }),
      expect.any(String),
    );
  });

  it("Cook calls runBatchAI with the full rowRange", async () => {
    mockRunBatchAI.mockResolvedValue(undefined);
    const { container, nav } = mount();
    await fullyPrepped(container, nav);
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    await flush();
    expect(mockRunBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ rowRange: { start: 2, end: 11 } }),
      expect.any(String),
    );
  });

  it("Configure AI navigates to configure-ai-run", async () => {
    const { container, nav } = mount();
    await fullyPrepped(container, nav);
    container.querySelector<HTMLButtonElement>("#configure-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith(
      "configure-ai-run",
      expect.objectContaining({ outputCol: "AI_Summarization" }),
    );
  });

  it("Test disables all step 3 buttons while running", async () => {
    mockRunBatchAI.mockReturnValue(new Promise(() => {}));
    const { container, nav } = mount();
    await fullyPrepped(container, nav);
    container.querySelector<HTMLButtonElement>("#test-btn")!.click();
    await flush();
    expect(container.querySelector<HTMLButtonElement>("#test-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>("#configure-btn")!.disabled).toBe(true);
  });
});
