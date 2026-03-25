/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import { RecipePanel } from "../../src/client/panels/recipe";
import * as services from "../../src/client/services";
import type { PrepRecipeResult } from "../../src/shared/types";
import type { RecipeParams, ColumnSpec } from "../../src/client/types";
import type { NavigationContext, RecipeDefinition } from "../../src/client/types";

const mockPrepRecipe = services.prepRecipe as jest.Mock;

function makeNav(): jest.Mocked<NavigationContext> {
  return {
    navigate: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn().mockReturnValue(true),
  };
}

function mount(params: RecipeParams, savedState?: unknown) {
  const container = document.createElement("div");
  const nav = makeNav();
  const panel = new RecipePanel();
  const definition: RecipeDefinition = {
    id: "test",
    name: "Test Recipe",
    icon: "🧪",
    description: "Test",
    panelId: "recipe",
    params,
  };
  panel.mount(container, nav, definition, savedState as never);
  return { container, nav, panel };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

// ── rendering ───────────────────────────────────────────────────

describe("rendering", () => {
  it("renders a section card for each column in params.columns", () => {
    const columns: ColumnSpec[] = [
      { kind: "drive-file-folder", colTitle: { value: "Drive Link" }, url: { value: "" } },
      {
        kind: "system-prompt",
        colTitle: { value: "System Prompt", locked: true },
        prompt: { value: "You are helpful.", locked: true },
      },
      { kind: "output", colTitle: { value: "AI_Out", locked: true } },
    ];
    const { container } = mount({ columns });
    const cards = container.querySelectorAll(".recipe-section-card");
    expect(cards.length).toBe(3);
  });

  it("renders col-title container for each column", () => {
    const columns: ColumnSpec[] = [
      { kind: "drive-file-folder", colTitle: { value: "Drive Link" }, url: { value: "" } },
      { kind: "output", colTitle: { value: "AI_Out", locked: true } },
    ];
    const { container } = mount({ columns });
    expect(container.querySelector("#col-title-0-container")).not.toBeNull();
    expect(container.querySelector("#col-title-1-container")).not.toBeNull();
  });

  it("renders url container for drive columns", () => {
    const columns: ColumnSpec[] = [
      { kind: "drive-file-folder", colTitle: { value: "Drive Link" }, url: { value: "" } },
    ];
    const { container } = mount({ columns });
    expect(container.querySelector("#col-url-0-container")).not.toBeNull();
  });

  it("renders prompt container for prompt columns", () => {
    const columns: ColumnSpec[] = [
      {
        kind: "user-prompt",
        colTitle: { value: "User Prompt", locked: true },
        prompt: { value: "Summarize.", locked: true },
      },
    ];
    const { container } = mount({ columns });
    expect(container.querySelector("#col-prompt-0-container")).not.toBeNull();
  });

  it("renders appendField textareas for prompt columns", () => {
    const columns: ColumnSpec[] = [
      {
        kind: "system-prompt",
        colTitle: { value: "System Prompt", locked: true },
        prompt: { value: "You are an expert.", locked: true },
        appendFields: [
          { id: "types", label: "Document types", prefix: "\n\nYou are looking for:\n\n" },
        ],
      },
    ];
    const { container } = mount({ columns });
    expect(container.querySelector("#append-field-0-types")).not.toBeNull();
  });

  it("does not render url container for non-drive columns", () => {
    const columns: ColumnSpec[] = [
      { kind: "output", colTitle: { value: "AI_Out", locked: true } },
    ];
    const { container } = mount({ columns });
    expect(container.querySelector("#col-url-0-container")).toBeNull();
  });

  it("renders helper text when helperText is present", () => {
    const columns: ColumnSpec[] = [
      {
        kind: "drive-file-folder",
        colTitle: { value: "Drive Link" },
        url: { value: "" },
        helperText: "Make sure you have access",
      },
    ];
    const { container } = mount({ columns });
    expect(container.querySelector(".field-helper")?.textContent).toContain(
      "Make sure you have access",
    );
  });
});

// ── LockableField defaults ────────────────────────────────────────

describe("LockableField defaults", () => {
  it("initialises colTitle field with locked: true value from params", () => {
    const columns: ColumnSpec[] = [
      { kind: "output", colTitle: { value: "AI_Summarization", locked: true } },
    ];
    const { container } = mount({ columns });
    const input = container.querySelector<HTMLInputElement>("#col-title-0-container input")!;
    expect(input.value).toBe("AI_Summarization");
    expect(input.disabled).toBe(true);
  });

  it("initialises colTitle field with locked: false as unlocked", () => {
    const columns: ColumnSpec[] = [
      { kind: "output", colTitle: { value: "AI_Output", locked: false } },
    ];
    const { container } = mount({ columns });
    const input = container.querySelector<HTMLInputElement>("#col-title-0-container input")!;
    expect(input.disabled).toBe(false);
  });
});

// ── prep flow ──────────────────────────────────────────────────

describe("Prep flow", () => {
  beforeEach(() => {
    mockPrepRecipe.mockClear();
  });

  const fullColumns: ColumnSpec[] = [
    {
      kind: "drive-file-folder",
      colTitle: { value: "Drive Link", locked: true },
      url: { value: "", locked: false },
      helperText: "Check access",
    },
    {
      kind: "system-prompt",
      colTitle: { value: "System Prompt", locked: true },
      prompt: { value: "You are helpful.", locked: true },
    },
    {
      kind: "user-prompt",
      colTitle: { value: "User Prompt", locked: true },
      prompt: { value: "Summarize.", locked: true },
    },
    { kind: "output", colTitle: { value: "AI_Out", locked: true } },
  ];

  const mockResult: PrepRecipeResult = {
    rowRange: { start: 2, end: 11 },
    columns: [
      { kind: "drive-file-folder", colTitle: "Drive Link" },
      { kind: "system-prompt", colTitle: "System Prompt" },
      { kind: "user-prompt", colTitle: "User Prompt" },
      { kind: "output", colTitle: "AI_Out" },
    ],
  };

  it("calls services.prepRecipe with resolved form values", async () => {
    mockPrepRecipe.mockResolvedValue(mockResult);
    const { container } = mount({ columns: fullColumns });
    // Fill in the url LockableField for the drive-file-folder column
    const urlInput = container.querySelector<HTMLInputElement>("#col-url-0-container input")!;
    urlInput.disabled = false;
    urlInput.value = "https://drive.google.com/drive/folders/abc123";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.arrayContaining([
          expect.objectContaining({
            kind: "drive-file-folder",
            url: "https://drive.google.com/drive/folders/abc123",
          }),
          expect.objectContaining({ kind: "system-prompt", colTitle: "System Prompt" }),
          expect.objectContaining({ kind: "user-prompt", colTitle: "User Prompt" }),
          expect.objectContaining({ kind: "output", colTitle: "AI_Out" }),
        ]),
      }),
    );
  });

  it("shows alert and does not proceed if drive-file-folder url is empty", async () => {
    const alertMock = jest.fn();
    globalThis.alert = alertMock;
    const { container } = mount({ columns: fullColumns });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("folder"));
    expect(mockPrepRecipe).not.toHaveBeenCalled();
  });

  it("omits drive-file-constant from PrepRecipeParams when url is empty", async () => {
    const columns: ColumnSpec[] = [
      {
        kind: "drive-file-constant",
        colTitle: { value: "Constant File", locked: true },
        url: { value: "", locked: false },
      },
      { kind: "output", colTitle: { value: "AI_Out", locked: true } },
    ];
    const result: PrepRecipeResult = {
      rowRange: { start: 2, end: 5 },
      columns: [{ kind: "output", colTitle: "AI_Out" }],
    };
    mockPrepRecipe.mockResolvedValue(result);
    const { container } = mount({ columns });
    // Leave url empty — should not alert, should skip that column
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: [expect.objectContaining({ kind: "output", colTitle: "AI_Out" })],
      }),
    );
  });

  it("concatenates appendFields onto prompt text with prefix", async () => {
    const columns: ColumnSpec[] = [
      {
        kind: "system-prompt",
        colTitle: { value: "System Prompt", locked: true },
        prompt: { value: "You are an expert.", locked: true },
        appendFields: [
          {
            id: "types",
            label: "Document types",
            prefix: "\n\nYou are specifically looking for:\n\n",
          },
        ],
      },
      { kind: "output", colTitle: { value: "AI_Out", locked: true } },
    ];
    const result: PrepRecipeResult = {
      rowRange: { start: 2, end: 5 },
      columns: [
        { kind: "system-prompt", colTitle: "System Prompt" },
        { kind: "output", colTitle: "AI_Out" },
      ],
    };
    mockPrepRecipe.mockResolvedValue(result);
    const { container } = mount({ columns });
    const textarea = container.querySelector<HTMLTextAreaElement>("#append-field-0-types")!;
    textarea.value = "photographs and drawings";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.arrayContaining([
          expect.objectContaining({
            kind: "system-prompt",
            text: "You are an expert.\n\nYou are specifically looking for:\n\nphotographs and drawings",
          }),
        ]),
      }),
    );
  });

  it("alerts and returns null when required appendField is empty", async () => {
    const alertMock = jest.fn();
    globalThis.alert = alertMock;
    const columns: ColumnSpec[] = [
      {
        kind: "user-prompt",
        colTitle: { value: "User Prompt", locked: true },
        prompt: { value: "Analyze this.", locked: true },
        appendFields: [
          { id: "focus", label: "Focus area", prefix: "\n\nFocus on:\n\n" },
        ],
      },
      { kind: "output", colTitle: { value: "AI_Out", locked: true } },
    ];
    const { container } = mount({ columns });
    // Leave appendField empty
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("Focus area"));
    expect(mockPrepRecipe).not.toHaveBeenCalled();
  });
});

// ── Cook flow ──────────────────────────────────────────────────

describe("Cook flow", () => {
  it("buildRunConfig assembles userPromptParts in column order", async () => {
    const columns: ColumnSpec[] = [
      {
        kind: "drive-file-folder",
        colTitle: { value: "Drive Link", locked: true },
        url: { value: "", locked: false },
      },
      {
        kind: "user-prompt",
        colTitle: { value: "User Prompt", locked: true },
        prompt: { value: "Summarize.", locked: true },
      },
      { kind: "output", colTitle: { value: "AI_Out", locked: true } },
    ];
    const result: PrepRecipeResult = {
      rowRange: { start: 2, end: 5 },
      columns: [
        { kind: "drive-file-folder", colTitle: "Drive Link" },
        { kind: "user-prompt", colTitle: "User Prompt" },
        { kind: "output", colTitle: "AI_Out" },
      ],
    };
    mockPrepRecipe.mockResolvedValue(result);
    const { container, nav } = mount({ columns });
    const urlInput = container.querySelector<HTMLInputElement>("#col-url-0-container input")!;
    urlInput.disabled = false;
    urlInput.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith(
      "configure-ai-run",
      expect.objectContaining({
        userPromptParts: [
          { kind: "file", col: "Drive Link" },
          { kind: "text", col: "User Prompt" },
        ],
        outputCol: "AI_Out",
        rowRange: { start: 2, end: 5 },
      }),
    );
  });

  it("navigates to configure-ai-run with full RunConfig assembled from PrepRecipeResult", async () => {
    const columns: ColumnSpec[] = [
      {
        kind: "drive-file-folder",
        colTitle: { value: "Drive Link", locked: true },
        url: { value: "", locked: false },
      },
      {
        kind: "system-prompt",
        colTitle: { value: "Sys", locked: true },
        prompt: { value: "p", locked: true },
      },
      {
        kind: "user-prompt",
        colTitle: { value: "User", locked: true },
        prompt: { value: "q", locked: true },
      },
      { kind: "output", colTitle: { value: "Out", locked: true } },
    ];
    const result: PrepRecipeResult = {
      rowRange: { start: 2, end: 5 },
      columns: [
        { kind: "drive-file-folder", colTitle: "Drive Link" },
        { kind: "system-prompt", colTitle: "Sys" },
        { kind: "user-prompt", colTitle: "User" },
        { kind: "output", colTitle: "Out" },
      ],
    };
    mockPrepRecipe.mockResolvedValue(result);
    const { container, nav } = mount({ columns });
    const urlInput = container.querySelector<HTMLInputElement>("#col-url-0-container input")!;
    urlInput.disabled = false;
    urlInput.value = "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith(
      "configure-ai-run",
      expect.objectContaining({
        userPromptParts: [
          { kind: "file", col: "Drive Link" },
          { kind: "text", col: "User" },
        ],
        systemPromptCol: "Sys",
        outputCol: "Out",
        rowRange: { start: 2, end: 5 },
      }),
    );
  });

  it("applies settings from PrepRecipeResult to RunConfig", async () => {
    const columns: ColumnSpec[] = [
      {
        kind: "user-prompt",
        colTitle: { value: "User Prompt", locked: true },
        prompt: { value: "Analyze.", locked: true },
      },
      { kind: "output", colTitle: { value: "AI_Out", locked: true } },
    ];
    const result: PrepRecipeResult = {
      rowRange: { start: 2, end: 5 },
      columns: [
        { kind: "user-prompt", colTitle: "User Prompt" },
        { kind: "output", colTitle: "AI_Out" },
      ],
      settings: { tools: ["google_search"] },
    };
    mockPrepRecipe.mockResolvedValue(result);
    const { container, nav } = mount({ columns });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith(
      "configure-ai-run",
      expect.objectContaining({
        tools: ["google_search"],
      }),
    );
  });
});

// ── saved state ────────────────────────────────────────────────

describe("unmount / saved state", () => {
  it("unmount returns columnStates and prepComplete: false when not prepped", () => {
    const columns: ColumnSpec[] = [
      {
        kind: "drive-file-folder",
        colTitle: { value: "Drive Link", locked: true },
        url: { value: "", locked: false },
      },
      { kind: "output", colTitle: { value: "AI_Out", locked: true } },
    ];
    const { panel } = mount({ columns });
    const state = panel.unmount();
    expect(state).toMatchObject({
      columnStates: expect.any(Array),
      prepComplete: false,
    });
    expect(state!.columnStates.length).toBe(2);
  });

  it("mounts with savedState — restores colTitle values", () => {
    const columns: ColumnSpec[] = [
      { kind: "output", colTitle: { value: "AI_Out", locked: false } },
    ];
    const savedState = {
      columnStates: [{ colTitle: "MyOutput" }],
      prepComplete: false,
    };
    const { container } = mount({ columns }, savedState);
    const input = container.querySelector<HTMLInputElement>("#col-title-0-container input")!;
    expect(input.value).toBe("MyOutput");
  });

  it("mounts with savedState prepComplete: true — Cook is enabled", () => {
    const columns: ColumnSpec[] = [
      { kind: "output", colTitle: { value: "Out", locked: true } },
    ];
    const savedState = {
      columnStates: [{ colTitle: "Out" }],
      prepComplete: true,
      preppedRunConfig: {
        outputCol: "Out",
        userPromptParts: [{ kind: "text" as const, col: "User" }],
      },
    };
    const { container } = mount({ columns }, savedState);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });

  it("unmount preserves appendField values", () => {
    const columns: ColumnSpec[] = [
      {
        kind: "system-prompt",
        colTitle: { value: "System Prompt", locked: true },
        prompt: { value: "You are an expert.", locked: true },
        appendFields: [{ id: "types", label: "Types", prefix: "\n\n" }],
      },
    ];
    const { container, panel } = mount({ columns });
    const textarea = container.querySelector<HTMLTextAreaElement>("#append-field-0-types")!;
    textarea.value = "some value";
    const state = panel.unmount();
    expect(state!.columnStates[0].appendFieldValues?.["types"]).toBe("some value");
  });

  it("mounts with savedState — restores appendField values", () => {
    const columns: ColumnSpec[] = [
      {
        kind: "system-prompt",
        colTitle: { value: "System Prompt", locked: true },
        prompt: { value: "You are an expert.", locked: true },
        appendFields: [{ id: "types", label: "Types", prefix: "\n\n" }],
      },
    ];
    const savedState = {
      columnStates: [{ appendFieldValues: { types: "restored value" } }],
      prepComplete: false,
    };
    const { container } = mount({ columns }, savedState);
    const textarea = container.querySelector<HTMLTextAreaElement>("#append-field-0-types")!;
    expect(textarea.value).toBe("restored value");
  });
});
