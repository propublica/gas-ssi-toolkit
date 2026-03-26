/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import { RecipePanel } from "../../src/client/panels/recipe";
import * as services from "../../src/client/services";
import type { PrepRecipeResult } from "../../src/shared/types";
import type { RecipeParams } from "../../src/client/types";
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
  it("renders drive folder input when driveFolder param present", () => {
    const { container } = mount({ driveFolder: { colTitle: "Drive Link" } });
    expect(container.querySelector("#drive-folder-input")).not.toBeNull();
  });

  it("does not render drive folder input when driveFolder absent", () => {
    const { container } = mount({});
    expect(container.querySelector("#drive-folder-input")).toBeNull();
  });

  it("renders system prompt fields when systemPrompt param present", () => {
    const { container } = mount({
      systemPrompt: {
        colTitle: { value: "System Prompt", locked: true },
        prompt: { value: "You are helpful.", locked: true },
      },
    });
    expect(container.querySelector("#system-prompt-title-container")).not.toBeNull();
    expect(container.querySelector("#system-prompt-value-container")).not.toBeNull();
  });

  it("renders one user prompt section per userPrompts entry", () => {
    const { container } = mount({
      userPrompts: [
        {
          colTitle: { value: "User Prompt", locked: true },
          prompt: { value: "Summarize.", locked: true },
        },
        {
          colTitle: { value: "User Prompt 2", locked: true },
          prompt: { value: "Also this.", locked: true },
        },
      ],
    });
    expect(container.querySelector("#user-prompt-title-0-container")).not.toBeNull();
    expect(container.querySelector("#user-prompt-title-1-container")).not.toBeNull();
  });
});

// ── LockableField defaults ────────────────────────────────────────

describe("LockableField defaults", () => {
  it("initialises fields with locked: true values from params", () => {
    const { container } = mount({
      outputCol: { colTitle: { value: "AI_Summarization", locked: true } },
    });
    const input = container.querySelector<HTMLInputElement>("#output-col-title-container input")!;
    expect(input.value).toBe("AI_Summarization");
    expect(input.disabled).toBe(true);
  });

  it("initialises fields with locked: false as unlocked", () => {
    const { container } = mount({
      outputCol: { colTitle: { value: "AI_Output", locked: false } },
    });
    const input = container.querySelector<HTMLInputElement>("#output-col-title-container input")!;
    expect(input.disabled).toBe(false);
  });
});

// ── prep flow ──────────────────────────────────────────────────

describe("Prep flow", () => {
  beforeEach(() => {
    mockPrepRecipe.mockClear();
  });
  const fullParams: RecipeParams = {
    driveFolder: { colTitle: "Drive Link", helperText: "Check access" },
    systemPrompt: {
      colTitle: { value: "System Prompt", locked: true },
      prompt: { value: "You are helpful.", locked: true },
    },
    userPrompts: [
      {
        colTitle: { value: "User Prompt", locked: true },
        prompt: { value: "Summarize.", locked: true },
      },
    ],
    outputCol: { colTitle: { value: "AI_Out", locked: true } },
  };

  const mockResult: PrepRecipeResult = {
    rowRange: { start: 2, end: 11 },
    colNames: {
      driveLink: "Drive Link",
      systemPrompt: "System Prompt",
      userPrompts: ["User Prompt"],
      outputCol: "AI_Out",
    },
  };

  it("calls services.prepRecipe with resolved form values", async () => {
    mockPrepRecipe.mockResolvedValue(mockResult);
    const { container } = mount(fullParams);
    container.querySelector<HTMLInputElement>("#drive-folder-input")!.value =
      "https://drive.google.com/drive/folders/abc123";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith(
      expect.objectContaining({
        driveFolder: expect.objectContaining({ colTitle: "Drive Link" }),
        systemPrompt: { colTitle: "System Prompt", value: "You are helpful." },
        userPrompts: [{ colTitle: "User Prompt", value: "Summarize." }],
        outputCol: { colTitle: "AI_Out" },
      }),
    );
  });

  it("shows alert and does not proceed if drive folder is empty", async () => {
    const alertMock = jest.fn();
    globalThis.alert = alertMock;
    const { container } = mount(fullParams);
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("folder"));
    expect(mockPrepRecipe).not.toHaveBeenCalled();
  });
});

// ── Cook flow ──────────────────────────────────────────────────

describe("Cook flow", () => {
  it("navigates to configure-ai-run with preppedRunConfig assembled from PrepRecipeResult", async () => {
    const result: PrepRecipeResult = {
      rowRange: { start: 2, end: 5 },
      colNames: {
        driveLink: "Drive Link",
        systemPrompt: "Sys",
        userPrompts: ["User"],
        outputCol: "Out",
      },
    };
    mockPrepRecipe.mockResolvedValue(result);
    const { container, nav } = mount({
      driveFolder: { colTitle: "Drive Link" },
      systemPrompt: {
        colTitle: { value: "Sys", locked: true },
        prompt: { value: "p", locked: true },
      },
      userPrompts: [
        { colTitle: { value: "User", locked: true }, prompt: { value: "q", locked: true } },
      ],
      outputCol: { colTitle: { value: "Out", locked: true } },
    });
    container.querySelector<HTMLInputElement>("#drive-folder-input")!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith("configure-ai-run", {
      promptCols: [
        { col: "User", kind: "text" },
        { col: "Drive Link", kind: "file" },
      ],
      systemPromptCol: "Sys",
      outputCol: "Out",
      rowRange: { start: 2, end: 5 },
      tools: undefined,
    });
  });
});

// ── saved state ────────────────────────────────────────────────

describe("unmount / saved state", () => {
  it("unmount returns form values and prepComplete: false when not prepped", () => {
    const { container, panel } = mount({
      driveFolder: { colTitle: "Drive Link" },
      outputCol: { colTitle: { value: "AI_Out", locked: true } },
    });
    container.querySelector<HTMLInputElement>("#drive-folder-input")!.value = "my-folder";
    const state = panel.unmount();
    expect(state).toMatchObject({
      driveFolderValue: "my-folder",
      prepComplete: false,
    });
  });

  it("mounts with savedState — restores form values", () => {
    const savedState = {
      driveFolderValue: "restored-folder",
      outputColTitle: "MyOutput",
      prepComplete: false,
    };
    const { container } = mount(
      {
        driveFolder: { colTitle: "Drive Link" },
        outputCol: { colTitle: { value: "AI_Out", locked: true } },
      },
      savedState,
    );
    expect(container.querySelector<HTMLInputElement>("#drive-folder-input")!.value).toBe(
      "restored-folder",
    );
  });

  it("mounts with savedState prepComplete: true — Cook is enabled", () => {
    const savedState = {
      prepComplete: true,
      preppedRunConfig: { outputCol: "Out", promptCols: [{ col: "User", kind: "text" as const }] },
    };
    const { container } = mount(
      { outputCol: { colTitle: { value: "Out", locked: true } } },
      savedState,
    );
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});
