/**
 * @jest-environment jsdom
 */
import { PromptColList } from "../../src/client/components/prompt-col-list";
import type { PromptColumnSpec } from "../../src/shared/types";

const HEADERS = ["col_a", "col_b", "col_c"];

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

/** Clicks the column TokenInput add btn in the Nth row, then selects value from dropdown. */
function selectColInRow(container: HTMLElement, rowIndex: number, value: string): void {
  const rows = container.querySelectorAll(".pcol-row");
  const row = rows[rowIndex] as HTMLElement;
  row.querySelector<HTMLElement>(".token-add-btn")!.click();
  row.querySelector<HTMLElement>(`.token-option[data-value="${value}"]`)!.click();
}

/** Returns the selected column value chip in the Nth row, or "" if none. */
function getColInRow(container: HTMLElement, rowIndex: number): string {
  const rows = container.querySelectorAll(".pcol-row");
  const row = rows[rowIndex] as HTMLElement;
  return (
    row.querySelector<HTMLElement>(".token-chip[data-value]")?.getAttribute("data-value") ?? ""
  );
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PromptColList — construction", () => {
  it("renders no rows and an add button when constructed with no initialValue", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    expect(container.querySelectorAll(".pcol-row").length).toBe(0);
    expect(container.querySelector(".pcol-add-btn")).not.toBeNull();
    list.destroy();
  });

  it("renders one row per entry in initialValue", () => {
    const container = makeContainer();
    const initial: PromptColumnSpec[] = [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ];
    const list = new PromptColList(container, HEADERS, initial);
    expect(container.querySelectorAll(".pcol-row").length).toBe(2);
    list.destroy();
  });

  it("pre-selects the column chip for each initialValue entry", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [{ col: "col_a", kind: "text" }]);
    expect(getColInRow(container, 0)).toBe("col_a");
    list.destroy();
  });

  it("pre-selects the correct kind for each initialValue entry", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    const rows = container.querySelectorAll(".pcol-row");
    const toggleRow0 = rows[0].querySelector<HTMLElement>(".pcol-kind-toggle");
    const toggleRow1 = rows[1].querySelector<HTMLElement>(".pcol-kind-toggle");
    expect(toggleRow0?.textContent).toBe("Text ⇄");
    expect(toggleRow1?.textContent).toBe("File ⇄");
    list.destroy();
  });
});

describe("PromptColList — getValue()", () => {
  it("returns [] when there are no rows", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    expect(list.getValue()).toEqual([]);
    list.destroy();
  });

  it("returns [] when rows have no column selected", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    container.querySelector<HTMLElement>(".pcol-add-btn")!.click();
    expect(list.getValue()).toEqual([]);
    list.destroy();
  });

  it("returns spec for a row with a selected column", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    container.querySelector<HTMLElement>(".pcol-add-btn")!.click();
    selectColInRow(container, 0, "col_a");
    expect(list.getValue()).toEqual([{ col: "col_a", kind: "text" }]);
    list.destroy();
  });

  it("returns rows in display order", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    expect(list.getValue()).toEqual([
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    list.destroy();
  });

  it("skips rows with no column selected when mixed with filled rows", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [{ col: "col_a", kind: "text" }]);
    container.querySelector<HTMLElement>(".pcol-add-btn")!.click(); // empty row
    expect(list.getValue()).toEqual([{ col: "col_a", kind: "text" }]);
    list.destroy();
  });
});

describe("PromptColList — add row", () => {
  it("clicking add button appends a new empty row", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    container.querySelector<HTMLElement>(".pcol-add-btn")!.click();
    expect(container.querySelectorAll(".pcol-row").length).toBe(1);
    expect(getColInRow(container, 0)).toBe("");
    list.destroy();
  });

  it("new row defaults to text kind", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS);
    container.querySelector<HTMLElement>(".pcol-add-btn")!.click();
    const rows = container.querySelectorAll(".pcol-row");
    const toggle = rows[0].querySelector<HTMLElement>(".pcol-kind-toggle");
    expect(toggle?.textContent).toBe("Text ⇄");
    list.destroy();
  });
});

describe("PromptColList — remove row", () => {
  it("clicking remove on a row removes it from the DOM and getValue()", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    container.querySelector<HTMLElement>(".pcol-btn-remove")!.click();
    expect(container.querySelectorAll(".pcol-row").length).toBe(1);
    expect(list.getValue()).toEqual([{ col: "col_b", kind: "file" }]);
    list.destroy();
  });
});

describe("PromptColList — kind toggle", () => {
  it("clicking toggle changes kind to file in getValue()", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [{ col: "col_a", kind: "text" }]);
    const row = container.querySelector<HTMLElement>(".pcol-row")!;
    row.querySelector<HTMLElement>(".pcol-kind-toggle")!.click();
    expect(list.getValue()).toEqual([{ col: "col_a", kind: "file" }]);
    list.destroy();
  });

  it("clicking toggle twice cycles back to text kind", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [{ col: "col_a", kind: "text" }]);
    const row = container.querySelector<HTMLElement>(".pcol-row")!;
    const toggle = row.querySelector<HTMLElement>(".pcol-kind-toggle")!;
    toggle.click();
    toggle.click();
    expect(list.getValue()).toEqual([{ col: "col_a", kind: "text" }]);
    list.destroy();
  });
});

describe("PromptColList — reorder", () => {
  it("up button disabled on first row", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "text" },
    ]);
    const firstUpBtn = container.querySelector<HTMLButtonElement>(".pcol-btn-up");
    expect(firstUpBtn?.disabled).toBe(true);
    list.destroy();
  });

  it("down button disabled on last row", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "text" },
    ]);
    const downBtns = container.querySelectorAll<HTMLButtonElement>(".pcol-btn-down");
    expect(downBtns[downBtns.length - 1].disabled).toBe(true);
    list.destroy();
  });

  it("clicking up on second row moves it to first position in getValue()", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    const upBtns = container.querySelectorAll<HTMLButtonElement>(".pcol-btn-up");
    upBtns[1].click(); // up on second row
    expect(list.getValue()).toEqual([
      { col: "col_b", kind: "file" },
      { col: "col_a", kind: "text" },
    ]);
    list.destroy();
  });

  it("clicking down on first row moves it to second position in getValue()", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [
      { col: "col_a", kind: "text" },
      { col: "col_b", kind: "file" },
    ]);
    container.querySelector<HTMLButtonElement>(".pcol-btn-down")!.click(); // down on first row
    expect(list.getValue()).toEqual([
      { col: "col_b", kind: "file" },
      { col: "col_a", kind: "text" },
    ]);
    list.destroy();
  });
});

describe("PromptColList — destroy()", () => {
  it("removes all DOM elements from the container", () => {
    const container = makeContainer();
    const list = new PromptColList(container, HEADERS, [{ col: "col_a", kind: "text" }]);
    list.destroy();
    expect(container.querySelector(".pcol-list")).toBeNull();
    expect(container.querySelector(".pcol-add-btn")).toBeNull();
  });
});
