/**
 * @jest-environment jsdom
 */

// Mock google.script.run before importing the module.
const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  runTool: jest.fn(),
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
};
(globalThis as unknown as { google: unknown }).google = { script: { run: mockRun } };

import {
  buildTagList,
  buildSingleTagList,
  applyPreset,
  assembleRunConfig,
  handleRowRangeChange,
} from "../src/client/sidebar";

// ── buildTagList ──────────────────────────────────────────────────────────────

describe("buildTagList", () => {
  function makeContainer(): HTMLElement {
    document.body.innerHTML = '<div id="c"></div>';
    return document.getElementById("c")!;
  }

  it("renders one .tag button per header", () => {
    const c = makeContainer();
    buildTagList(c, ["col_a", "col_b"]);
    const tags = c.querySelectorAll(".tag");
    expect(tags).toHaveLength(2);
    expect(tags[0].textContent).toBe("col_a");
    expect(tags[1].getAttribute("data-value")).toBe("col_b");
  });

  it("pre-selects headers listed in selected", () => {
    const c = makeContainer();
    buildTagList(c, ["col_a", "col_b", "col_c"], ["col_b"]);
    const selected = c.querySelectorAll(".tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("col_b");
  });

  it("toggles .selected on click", () => {
    const c = makeContainer();
    buildTagList(c, ["col_a"]);
    const tag = c.querySelector(".tag") as HTMLButtonElement;
    tag.click();
    expect(tag.classList.contains("selected")).toBe(true);
    tag.click();
    expect(tag.classList.contains("selected")).toBe(false);
  });

  it("clears container before rendering", () => {
    const c = makeContainer();
    buildTagList(c, ["a"]);
    buildTagList(c, ["b", "c"]);
    expect(c.querySelectorAll(".tag")).toHaveLength(2);
  });
});

// ── buildSingleTagList ────────────────────────────────────────────────────────

describe("buildSingleTagList", () => {
  function makeContainer(): HTMLElement {
    document.body.innerHTML =
      '<div id="c"></div><input id="new-col-input" type="text" style="display:none">';
    return document.getElementById("c")!;
  }

  it("renders one .tag button per header", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a", "b"], false);
    expect(c.querySelectorAll(".tag")).toHaveLength(2);
  });

  it("appends a '+ New column' tag when includeNew is true", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a"], true);
    const tags = c.querySelectorAll(".tag");
    expect(tags).toHaveLength(2);
    expect(tags[1].getAttribute("data-value")).toBe("__new__");
    expect(tags[1].textContent).toBe("+ New column");
  });

  it("pre-selects the specified column", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a", "b"], false, "b");
    const selected = c.querySelectorAll(".tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("b");
  });

  it("clicking a tag deselects all others (single-select)", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a", "b", "c"], false);
    const tags = c.querySelectorAll<HTMLButtonElement>(".tag");
    tags[0].click();
    expect(tags[0].classList.contains("selected")).toBe(true);
    tags[1].click();
    expect(tags[0].classList.contains("selected")).toBe(false);
    expect(tags[1].classList.contains("selected")).toBe(true);
  });

  it("clicking __new__ shows new-col-input", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a"], true);
    const newBtn = c.querySelector<HTMLButtonElement>('[data-value="__new__"]')!;
    newBtn.click();
    expect(document.getElementById("new-col-input")!.style.display).toBe("block");
  });

  it("clicking a regular tag hides new-col-input", () => {
    const c = makeContainer();
    buildSingleTagList(c, ["a"], true);
    c.querySelector<HTMLButtonElement>('[data-value="__new__"]')!.click();
    c.querySelector<HTMLButtonElement>('[data-value="a"]')!.click();
    expect(document.getElementById("new-col-input")!.style.display).toBe("none");
  });
});

// ── handleRowRangeChange ──────────────────────────────────────────────────────

describe("handleRowRangeChange", () => {
  function makeRowRangeDom(checkedValue: "selection" | "range"): void {
    document.body.innerHTML = `
      <input type="radio" name="row-range" value="selection" ${checkedValue === "selection" ? "checked" : ""}>
      <input type="radio" name="row-range" value="range" ${checkedValue === "range" ? "checked" : ""}>
      <div id="range-inputs" style="display:none"></div>
    `;
  }

  it("shows range-inputs when 'range' radio is checked", () => {
    makeRowRangeDom("range");
    handleRowRangeChange();
    expect(document.getElementById("range-inputs")!.style.display).toBe("flex");
  });

  it("hides range-inputs when 'selection' radio is checked", () => {
    makeRowRangeDom("selection");
    handleRowRangeChange();
    expect(document.getElementById("range-inputs")!.style.display).toBe("none");
  });
});

// ── applyPreset ───────────────────────────────────────────────────────────────

describe("applyPreset", () => {
  function setupPanel(headers: string[]): void {
    document.body.innerHTML = `
      <div id="user-prompt-cols"></div>
      <div id="drive-file-cols"></div>
      <div id="system-prompt-col"></div>
      <div id="output-col"></div>
      <input id="new-col-input" type="text" style="display:none">
      <input type="radio" name="row-range" value="selection" checked>
      <input type="radio" name="row-range" value="range">
      <div id="range-inputs" style="display:none">
        <input type="number" id="row-start">
        <input type="number" id="row-end">
      </div>
    `;
    buildTagList(document.getElementById("user-prompt-cols")!, headers);
    buildTagList(document.getElementById("drive-file-cols")!, headers);
    buildSingleTagList(document.getElementById("system-prompt-col")!, headers, false);
    buildSingleTagList(document.getElementById("output-col")!, headers, true);
  }

  it("pre-selects userPromptCols", () => {
    setupPanel(["col_a", "col_b", "col_c"]);
    applyPreset({ userPromptCols: ["col_a", "col_c"] });
    const selected = document.querySelectorAll("#user-prompt-cols .tag.selected");
    expect(selected).toHaveLength(2);
    expect(selected[0].getAttribute("data-value")).toBe("col_a");
    expect(selected[1].getAttribute("data-value")).toBe("col_c");
  });

  it("pre-selects driveFileCols", () => {
    setupPanel(["source_drive", "source_text"]);
    applyPreset({ driveFileCols: ["source_drive"] });
    const selected = document.querySelectorAll("#drive-file-cols .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("source_drive");
  });

  it("pre-selects systemPromptCol (single-select)", () => {
    setupPanel(["system_prompt", "user_prompt"]);
    applyPreset({ systemPromptCol: "system_prompt" });
    const selected = document.querySelectorAll("#system-prompt-col .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("system_prompt");
  });

  it("pre-selects outputCol (single-select)", () => {
    setupPanel(["ai_inference", "col_b"]);
    applyPreset({ outputCol: "ai_inference" });
    const selected = document.querySelectorAll("#output-col .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("ai_inference");
  });

  it("sets rowRange radio and populates inputs", () => {
    setupPanel(["col_a"]);
    applyPreset({ rowRange: { start: 2, end: 10 } });
    const rangeRadio = document.querySelector<HTMLInputElement>(
      'input[name="row-range"][value="range"]',
    )!;
    expect(rangeRadio.checked).toBe(true);
    expect((document.getElementById("row-start") as HTMLInputElement).value).toBe("2");
    expect((document.getElementById("row-end") as HTMLInputElement).value).toBe("10");
    expect(document.getElementById("range-inputs")!.style.display).toBe("flex");
  });

  it("ignores fields absent from the preset", () => {
    setupPanel(["col_a", "col_b"]);
    applyPreset({ userPromptCols: ["col_a"] });
    expect(document.querySelectorAll("#drive-file-cols .tag.selected")).toHaveLength(0);
  });

  it("pre-selects __new__ and reveals new-col-input", () => {
    setupPanel(["ai_inference"]);
    applyPreset({ outputCol: "__new__" });
    const selected = document.querySelectorAll("#output-col .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("__new__");
    expect(document.getElementById("new-col-input")!.style.display).toBe("block");
  });
});

// ── assembleRunConfig ─────────────────────────────────────────────────────────

describe("assembleRunConfig", () => {
  beforeAll(() => {
    globalThis.alert = jest.fn();
  });

  afterEach(() => {
    (globalThis.alert as jest.Mock).mockClear();
  });

  const PANEL_HTML = `
    <div id="user-prompt-cols"></div>
    <div id="drive-file-cols"></div>
    <div id="system-prompt-col"></div>
    <div id="output-col"></div>
    <input id="new-col-input" type="text" style="display:none">
    <input type="radio" name="row-range" value="selection" checked>
    <input type="radio" name="row-range" value="range">
    <div id="range-inputs" style="display:none">
      <input type="number" id="row-start">
      <input type="number" id="row-end">
    </div>
  `;

  function setupWithSelections({
    userPrompt = [] as string[],
    drive = [] as string[],
    system = undefined as string | undefined,
    output = undefined as string | undefined,
    newOutputName = undefined as string | undefined,
    rowRange = undefined as { start: number; end: number } | undefined,
  } = {}): void {
    document.body.innerHTML = PANEL_HTML;
    buildTagList(document.getElementById("user-prompt-cols")!, ["col_a", "col_b", "col_c"]);
    buildTagList(document.getElementById("drive-file-cols")!, ["source_drive"]);
    buildSingleTagList(document.getElementById("system-prompt-col")!, ["system_prompt"], false);
    buildSingleTagList(document.getElementById("output-col")!, ["ai_inference"], true);

    if (userPrompt.length) applyPreset({ userPromptCols: userPrompt });
    if (drive.length) applyPreset({ driveFileCols: drive });
    if (system) applyPreset({ systemPromptCol: system });
    if (output) applyPreset({ outputCol: output });
    if (rowRange) applyPreset({ rowRange });

    if (newOutputName !== undefined) {
      const newBtn = document.querySelector<HTMLButtonElement>(
        '#output-col [data-value="__new__"]',
      )!;
      newBtn.click();
      (document.getElementById("new-col-input") as HTMLInputElement).value = newOutputName;
    }
  }

  it("returns a valid RunConfig when all required fields are selected", () => {
    setupWithSelections({ userPrompt: ["col_a"], output: "ai_inference" });
    const config = assembleRunConfig();
    expect(config).not.toBeNull();
    expect(config!.userPromptCols).toEqual(["col_a"]);
    expect(config!.outputCol).toBe("ai_inference");
    expect(config!.driveFileCols).toBeUndefined();
    expect(config!.systemPromptCol).toBeUndefined();
    expect(config!.rowRange).toBeUndefined();
  });

  it("includes driveFileCols when selected", () => {
    setupWithSelections({ userPrompt: ["col_a"], drive: ["source_drive"], output: "ai_inference" });
    const config = assembleRunConfig();
    expect(config!.driveFileCols).toEqual(["source_drive"]);
  });

  it("includes systemPromptCol when selected", () => {
    setupWithSelections({ userPrompt: ["col_a"], system: "system_prompt", output: "ai_inference" });
    const config = assembleRunConfig();
    expect(config!.systemPromptCol).toBe("system_prompt");
  });

  it("uses new-col-input value as outputCol when __new__ is selected", () => {
    setupWithSelections({ userPrompt: ["col_a"], newOutputName: "my_output" });
    const config = assembleRunConfig();
    expect(config).not.toBeNull();
    expect(config!.outputCol).toBe("my_output");
  });

  it("includes rowRange when 'range' radio is selected", () => {
    setupWithSelections({
      userPrompt: ["col_a"],
      output: "ai_inference",
      rowRange: { start: 3, end: 7 },
    });
    const config = assembleRunConfig();
    expect(config!.rowRange).toEqual({ start: 3, end: 7 });
  });

  it("returns null and alerts when no userPromptCols selected", () => {
    setupWithSelections({ output: "ai_inference" });
    const config = assembleRunConfig();
    expect(config).toBeNull();
    expect(globalThis.alert).toHaveBeenCalledWith("Please select at least one User prompt column.");
  });

  it("returns null and alerts when no output column selected", () => {
    setupWithSelections({ userPrompt: ["col_a"] });
    const config = assembleRunConfig();
    expect(config).toBeNull();
    expect(globalThis.alert).toHaveBeenCalledWith("Please select an output column.");
  });

  it("returns null and alerts when __new__ selected but input is blank", () => {
    setupWithSelections({ userPrompt: ["col_a"], newOutputName: "  " });
    const config = assembleRunConfig();
    expect(config).toBeNull();
    expect(globalThis.alert).toHaveBeenCalledWith("Please enter a name for the new output column.");
  });

  it("returns null and alerts when row range values are invalid", () => {
    setupWithSelections({ userPrompt: ["col_a"], output: "ai_inference" });
    document.querySelector<HTMLInputElement>('input[name="row-range"][value="range"]')!.checked =
      true;
    (document.getElementById("row-start") as HTMLInputElement).value = "5";
    (document.getElementById("row-end") as HTMLInputElement).value = "3";
    const config = assembleRunConfig();
    expect(config).toBeNull();
    expect(globalThis.alert).toHaveBeenCalledWith(
      "Please enter a valid row range (start ≥ 2, end ≥ start).",
    );
  });
});
