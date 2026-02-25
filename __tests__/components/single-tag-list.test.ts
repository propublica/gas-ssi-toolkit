/**
 * @jest-environment jsdom
 */
import { SingleTagList } from "../../src/client/components/single-tag-list";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="c"></div>';
  return document.getElementById("c")!;
}

describe("SingleTagList", () => {
  it("renders one .tag per header", () => {
    const c = makeContainer();
    new SingleTagList(c, ["a", "b"], {});
    expect(c.querySelectorAll(".tag")).toHaveLength(2);
  });

  it("appends '+ New column' tag when includeNew is true", () => {
    const c = makeContainer();
    new SingleTagList(c, ["a"], { includeNew: true });
    const tags = c.querySelectorAll(".tag");
    expect(tags).toHaveLength(2);
    expect(tags[1].getAttribute("data-value")).toBe("__new__");
  });

  it("pre-selects the specified header", () => {
    const c = makeContainer();
    new SingleTagList(c, ["a", "b"], { selected: "b" });
    const sel = c.querySelectorAll(".tag.selected");
    expect(sel).toHaveLength(1);
    expect(sel[0].getAttribute("data-value")).toBe("b");
  });

  it("clicking a tag deselects all others", () => {
    const c = makeContainer();
    new SingleTagList(c, ["a", "b", "c"], {});
    const tags = c.querySelectorAll<HTMLButtonElement>(".tag");
    tags[0].click();
    tags[1].click();
    expect(tags[0].classList.contains("selected")).toBe(false);
    expect(tags[1].classList.contains("selected")).toBe(true);
  });

  it("clicking __new__ shows the internal text input", () => {
    const c = makeContainer();
    new SingleTagList(c, ["a"], { includeNew: true });
    c.querySelector<HTMLButtonElement>('[data-value="__new__"]')!.click();
    const input = c.querySelector<HTMLInputElement>(".text-input");
    expect(input).not.toBeNull();
    expect(input!.style.display).not.toBe("none");
  });

  it("clicking a regular tag hides the text input", () => {
    const c = makeContainer();
    new SingleTagList(c, ["a"], { includeNew: true });
    c.querySelector<HTMLButtonElement>('[data-value="__new__"]')!.click();
    c.querySelector<HTMLButtonElement>('[data-value="a"]')!.click();
    const input = c.querySelector<HTMLInputElement>(".text-input");
    expect(input!.style.display).toBe("none");
  });

  it("getValue() returns the selected header name", () => {
    const c = makeContainer();
    const list = new SingleTagList(c, ["a", "b"], {});
    c.querySelector<HTMLButtonElement>('[data-value="b"]')!.click();
    expect(list.getValue()).toBe("b");
  });

  it("getValue() returns the input text when __new__ is selected", () => {
    const c = makeContainer();
    const list = new SingleTagList(c, ["a"], { includeNew: true });
    c.querySelector<HTMLButtonElement>('[data-value="__new__"]')!.click();
    c.querySelector<HTMLInputElement>(".text-input")!.value = "my_col";
    expect(list.getValue()).toBe("my_col");
  });

  it("getValue() returns empty string when nothing is selected", () => {
    const c = makeContainer();
    const list = new SingleTagList(c, ["a"], {});
    expect(list.getValue()).toBe("");
  });

  it("auto-selects __new__ and pre-fills input when selected value is not a header", () => {
    const c = makeContainer();
    const list = new SingleTagList(c, ["a", "b"], { includeNew: true, selected: "custom_val" });
    const sel = c.querySelector<HTMLButtonElement>(".tag.selected");
    expect(sel?.getAttribute("data-value")).toBe("__new__");
    expect(list.getValue()).toBe("custom_val");
  });
});
