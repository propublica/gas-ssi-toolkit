/**
 * @jest-environment jsdom
 */
import { TagList } from "../../src/client/components/tag-list";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="c"></div>';
  return document.getElementById("c")!;
}

describe("TagList", () => {
  it("renders one .tag button per header", () => {
    const c = makeContainer();
    new TagList(c, ["col_a", "col_b"]);
    const tags = c.querySelectorAll(".tag");
    expect(tags).toHaveLength(2);
    expect(tags[0].textContent).toBe("col_a");
    expect(tags[1].getAttribute("data-value")).toBe("col_b");
  });

  it("pre-selects headers in the selected array", () => {
    const c = makeContainer();
    new TagList(c, ["col_a", "col_b", "col_c"], ["col_b"]);
    const selected = c.querySelectorAll(".tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("col_b");
  });

  it("toggles .selected on click", () => {
    const c = makeContainer();
    new TagList(c, ["col_a"]);
    const tag = c.querySelector<HTMLButtonElement>(".tag")!;
    tag.click();
    expect(tag.classList.contains("selected")).toBe(true);
    tag.click();
    expect(tag.classList.contains("selected")).toBe(false);
  });

  it("getValue() returns currently selected values", () => {
    const c = makeContainer();
    const list = new TagList(c, ["col_a", "col_b", "col_c"]);
    c.querySelector<HTMLButtonElement>('[data-value="col_a"]')!.click();
    c.querySelector<HTMLButtonElement>('[data-value="col_c"]')!.click();
    expect(list.getValue()).toEqual(["col_a", "col_c"]);
  });

  it("getValue() returns empty array when nothing is selected", () => {
    const c = makeContainer();
    const list = new TagList(c, ["col_a"]);
    expect(list.getValue()).toEqual([]);
  });

  describe("label/value items", () => {
    it("displays label as textContent but stores value in data-value", () => {
      const c = makeContainer();
      new TagList(c, [{ label: "Google Search", value: "google_search" }]);
      const tag = c.querySelector<HTMLButtonElement>(".tag")!;
      expect(tag.textContent).toBe("Google Search");
      expect(tag.getAttribute("data-value")).toBe("google_search");
    });

    it("getValue() returns value (not label) for label/value items", () => {
      const c = makeContainer();
      const list = new TagList(c, [{ label: "Google Search", value: "google_search" }]);
      c.querySelector<HTMLButtonElement>('[data-value="google_search"]')!.click();
      expect(list.getValue()).toEqual(["google_search"]);
    });

    it("pre-selects by value when using label/value items", () => {
      const c = makeContainer();
      new TagList(c, [{ label: "Google Search", value: "google_search" }], ["google_search"]);
      const selected = c.querySelectorAll(".tag.selected");
      expect(selected).toHaveLength(1);
      expect(selected[0].getAttribute("data-value")).toBe("google_search");
    });

    it("mixed string and label/value items render correctly", () => {
      const c = makeContainer();
      const list = new TagList(
        c,
        ["col_a", { label: "Google Search", value: "google_search" }],
        ["col_a", "google_search"],
      );
      expect(list.getValue()).toEqual(["col_a", "google_search"]);
    });
  });
});
