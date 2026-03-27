/**
 * @jest-environment jsdom
 */
jest.mock("../../src/client/services", () => ({
  prepRecipe: jest.fn(),
}));

import { RecipePanel } from "../../src/client/panels/recipe";
import * as services from "../../src/client/services";
import type { PrepRecipeResult } from "../../src/shared/types";
import type { ColumnDef, RecipeDefinition, RecipeParams, NavigationContext } from "../../src/client/types";

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
  return { container, nav, panel, definition };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

// helper: a minimal column set covering all roles
const fullColumns: ColumnDef[] = [
  {
    label: "Drive Folder",
    role: "driveLink",
    strategyKind: "list-drive-folder",
    colTitle: { value: "Drive Link", locked: true },
    url: { value: "", locked: false, placeholder: "Paste folder URL" },
    required: true,
  },
  {
    label: "System Prompt",
    role: "systemPrompt",
    strategyKind: "fill-value",
    colTitle: { value: "System Prompt", locked: true },
    prompt: { value: "You are helpful.", locked: true },
  },
  {
    label: "User Prompt",
    role: "userPrompt",
    strategyKind: "fill-value",
    colTitle: { value: "User Prompt", locked: true },
    prompt: { value: "Summarize.", locked: true },
  },
  {
    label: "Output Column",
    role: "output",
    strategyKind: "create-empty",
    colTitle: { value: "AI_Out", locked: true },
  },
];

const mockResult: PrepRecipeResult = {
  rowRange: { start: 2, end: 11 },
};

// ── rendering ───────────────────────────────────────────────────

describe("rendering", () => {
  it("renders a url input for list-drive-folder columns", () => {
    const { container } = mount({ columns: [fullColumns[0]] });
    expect(container.querySelector("#col-0-url-input")).not.toBeNull();
  });

  it("does not render url input for fill-value columns", () => {
    const { container } = mount({ columns: [fullColumns[2]] });
    expect(container.querySelector("#col-0-url-input")).toBeNull();
  });

  it("renders a prompt container for fill-value columns", () => {
    const { container } = mount({ columns: [fullColumns[1]] });
    expect(container.querySelector("#col-0-prompt-container")).not.toBeNull();
  });

  it("does not render prompt container for create-empty columns", () => {
    const { container } = mount({ columns: [fullColumns[3]] });
    expect(container.querySelector("#col-0-prompt-container")).toBeNull();
  });

  it("renders one section per ColumnDef", () => {
    const { container } = mount({ columns: fullColumns });
    expect(container.querySelectorAll(".recipe-section-card")).toHaveLength(fullColumns.length);
  });

  it("renders append field inputs when appendFields present", () => {
    const colWithAppend: ColumnDef = {
      ...fullColumns[2],
      appendFields: [{ id: "search", label: "What are you looking for?" }],
    };
    const { container } = mount({ columns: [colWithAppend] });
    expect(container.querySelector("#col-0-append-search")).not.toBeNull();
  });
});

// ── LockableField defaults ────────────────────────────────────────

describe("LockableField defaults", () => {
  it("initialises locked colTitle field as disabled", () => {
    const { container } = mount({ columns: [fullColumns[3]] });
    const input = container.querySelector<HTMLInputElement>("#col-0-title-container input")!;
    expect(input.value).toBe("AI_Out");
    expect(input.disabled).toBe(true);
  });

  it("initialises unlocked url field as enabled", () => {
    const { container } = mount({ columns: [fullColumns[0]] });
    const input = container.querySelector<HTMLInputElement>("#col-0-url-input")!;
    expect(input.disabled).toBe(false);
  });
});

// ── prep flow ──────────────────────────────────────────────────

describe("Prep flow", () => {
  beforeEach(() => mockPrepRecipe.mockClear());

  it("calls services.prepRecipe with PrepColSpec[] built from resolved field values", async () => {
    mockPrepRecipe.mockResolvedValue(mockResult);
    const { container } = mount({ columns: fullColumns });
    container.querySelector<HTMLInputElement>("#col-0-url-input")!.value =
      "https://drive.google.com/drive/folders/abc123";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith({
      cols: [
        { colTitle: "Drive Link", strategy: { kind: "list-drive-folder", url: "https://drive.google.com/drive/folders/abc123" } },
        { colTitle: "System Prompt", strategy: { kind: "fill-value", value: "You are helpful." } },
        { colTitle: "User Prompt", strategy: { kind: "fill-value", value: "Summarize." } },
        { colTitle: "AI_Out", strategy: { kind: "create-empty" } },
      ],
    });
  });

  it("composes appendFields into the fill-value prompt string", async () => {
    mockPrepRecipe.mockResolvedValue(mockResult);
    const colWithAppend: ColumnDef = {
      ...fullColumns[2],
      appendFields: [{ id: "search", label: "What?", prefix: "\n\nLooking for:\n\n" }],
    };
    const { container } = mount({ columns: [colWithAppend] });
    container.querySelector<HTMLInputElement>("#col-0-append-search")!.value = "a signature";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(mockPrepRecipe).toHaveBeenCalledWith({
      cols: [
        {
          colTitle: "User Prompt",
          strategy: { kind: "fill-value", value: "Summarize.\n\nLooking for:\n\na signature" },
        },
      ],
    });
  });

  it("shows alert and does not call prepRecipe when url input is empty for list-drive-folder", async () => {
    const alertMock = jest.fn();
    globalThis.alert = alertMock;
    const { container } = mount({ columns: [fullColumns[0]] });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(mockPrepRecipe).not.toHaveBeenCalled();
  });
});

// ── Cook flow ──────────────────────────────────────────────────

describe("Cook flow", () => {
  it("navigates to configure-ai-run with RunConfig assembled from ColumnDef roles + rowRange", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 5 } });
    const { container, nav } = mount({ columns: fullColumns });
    container.querySelector<HTMLInputElement>("#col-0-url-input")!.value =
      "https://drive.google.com/abc";
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith("configure-ai-run", {
      promptCols: [
        { col: "Drive Link", kind: "file" },
        { col: "User Prompt", kind: "text" },
      ],
      systemPromptCol: "System Prompt",
      outputCol: "AI_Out",
      rowRange: { start: 2, end: 5 },
    });
  });

  it("spreads RecipeSettings into RunConfig", async () => {
    mockPrepRecipe.mockResolvedValue({ rowRange: { start: 2, end: 3 } });
    const outputOnly: ColumnDef = fullColumns[3];
    const { container, nav } = mount({
      columns: [outputOnly],
      settings: { tools: ["google_search"], applyMarkdown: true },
    });
    container.querySelector<HTMLButtonElement>("#prep-btn")!.click();
    await flush();
    container.querySelector<HTMLButtonElement>("#cook-btn")!.click();
    expect(nav.navigate).toHaveBeenCalledWith("configure-ai-run",
      expect.objectContaining({ tools: ["google_search"], applyMarkdown: true }),
    );
  });
});

// ── saved state ────────────────────────────────────────────────

describe("unmount / saved state", () => {
  it("unmount returns colValues array and prepComplete: false when not prepped", () => {
    const { container, panel } = mount({ columns: [fullColumns[0]] });
    container.querySelector<HTMLInputElement>("#col-0-url-input")!.value = "my-folder-url";
    const state = panel.unmount();
    expect(state).toMatchObject({
      colValues: [expect.objectContaining({ url: "my-folder-url" })],
      prepComplete: false,
    });
  });

  it("restores url value from savedState", () => {
    const savedState = {
      colValues: [{ url: "restored-url" }],
      prepComplete: false,
    };
    const { container } = mount({ columns: [fullColumns[0]] }, savedState);
    expect(container.querySelector<HTMLInputElement>("#col-0-url-input")!.value).toBe("restored-url");
  });

  it("mounts with savedState prepComplete: true — Cook is enabled", () => {
    const savedState = {
      colValues: [{}],
      prepComplete: true,
      preppedRunConfig: { outputCol: "Out", promptCols: [] },
    };
    const { container } = mount({ columns: [fullColumns[3]] }, savedState);
    expect(container.querySelector<HTMLButtonElement>("#cook-btn")!.disabled).toBe(false);
  });
});
