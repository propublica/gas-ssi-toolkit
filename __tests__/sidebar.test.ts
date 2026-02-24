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

import { buildTagList, buildSingleTagList } from "../src/client/sidebar";

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
