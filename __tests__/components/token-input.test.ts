/**
 * @jest-environment jsdom
 */
import { TokenInput } from "../../src/client/components/token-input";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="c"></div>';
  return document.getElementById("c")!;
}

const ITEMS = ["col_a", "col_b", "col_c"];

function openDropdown(c: HTMLElement): void {
  c.querySelector<HTMLElement>(".token-add-btn")!.click();
}

function selectOption(c: HTMLElement, value: string): void {
  c.querySelector<HTMLElement>(`.token-option[data-value="${value}"]`)!.click();
}

// ─── Initial render ──────────────────────────────────────────────────────────

describe("TokenInput — initial render", () => {
  it("renders a .token-field container", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    expect(c.querySelector(".token-field")).not.toBeNull();
  });

  it("shows no chips when nothing is pre-selected", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    expect(c.querySelectorAll(".token-chip")).toHaveLength(0);
  });

  it("shows one chip per pre-selected item", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { selected: ["col_a", "col_c"] });
    expect(c.querySelectorAll(".token-chip")).toHaveLength(2);
  });

  it("dropdown is hidden initially", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    expect(c.querySelector<HTMLElement>(".token-dropdown")!.style.display).toBe("none");
  });
});

// ─── Dropdown open / close ────────────────────────────────────────────────────

describe("TokenInput — dropdown open/close", () => {
  it("clicking the field opens the dropdown", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    openDropdown(c);
    expect(c.querySelector<HTMLElement>(".token-dropdown")!.style.display).not.toBe("none");
  });

  it("dropdown shows only unselected items", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { selected: ["col_a"] });
    openDropdown(c);
    const options = c.querySelectorAll(".token-option");
    expect(options).toHaveLength(2);
    const values = Array.from(options).map((o) => o.getAttribute("data-value"));
    expect(values).not.toContain("col_a");
  });

  it("pressing Escape closes the dropdown", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    openDropdown(c);
    c.querySelector<HTMLInputElement>(".token-search")!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(c.querySelector<HTMLElement>(".token-dropdown")!.style.display).toBe("none");
  });

  it("clicking outside the field closes the dropdown", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    openDropdown(c);
    document.body.click();
    expect(c.querySelector<HTMLElement>(".token-dropdown")!.style.display).toBe("none");
  });
});

// ─── Filtering ────────────────────────────────────────────────────────────────

describe("TokenInput — filtering", () => {
  it("typing filters visible dropdown options", () => {
    const c = makeContainer();
    new TokenInput(c, ["alpha", "beta", "algebra"], {});
    openDropdown(c);
    const input = c.querySelector<HTMLInputElement>(".token-search")!;
    input.value = "alp";
    input.dispatchEvent(new Event("input"));
    const visible = Array.from(c.querySelectorAll<HTMLElement>(".token-option")).filter(
      (o) => o.style.display !== "none",
    );
    expect(visible).toHaveLength(1);
    expect(visible[0].getAttribute("data-value")).toBe("alpha");
  });

  it("shows a no-match message when filter has no results", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    openDropdown(c);
    const input = c.querySelector<HTMLInputElement>(".token-search")!;
    input.value = "zzz";
    input.dispatchEvent(new Event("input"));
    expect(c.querySelector(".token-no-match")).not.toBeNull();
  });

  it("clearing the filter restores all unselected options", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    openDropdown(c);
    const input = c.querySelector<HTMLInputElement>(".token-search")!;
    input.value = "col_a";
    input.dispatchEvent(new Event("input"));
    input.value = "";
    input.dispatchEvent(new Event("input"));
    const visible = Array.from(c.querySelectorAll<HTMLElement>(".token-option")).filter(
      (o) => o.style.display !== "none",
    );
    expect(visible).toHaveLength(3);
  });
});

// ─── Selection — multi (default) ──────────────────────────────────────────────

describe("TokenInput — selection (multi)", () => {
  it("clicking a dropdown option adds a chip", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    openDropdown(c);
    selectOption(c, "col_b");
    expect(c.querySelectorAll(".token-chip")).toHaveLength(1);
  });

  it("selecting an option removes it from the dropdown", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    openDropdown(c);
    selectOption(c, "col_b");
    const values = Array.from(c.querySelectorAll(".token-option")).map((o) =>
      o.getAttribute("data-value"),
    );
    expect(values).not.toContain("col_b");
  });

  it("dropdown closes after selecting in multi mode", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    openDropdown(c);
    selectOption(c, "col_b");
    expect(c.querySelector<HTMLElement>(".token-dropdown")!.style.display).toBe("none");
  });

  it("getValue() returns all selected values", () => {
    const c = makeContainer();
    const ti = new TokenInput(c, ITEMS, {});
    openDropdown(c);
    selectOption(c, "col_a");
    selectOption(c, "col_c");
    expect(ti.getValue()).toEqual(["col_a", "col_c"]);
  });

  it("getValue() returns empty array when nothing is selected", () => {
    const c = makeContainer();
    const ti = new TokenInput(c, ITEMS, {});
    expect(ti.getValue()).toEqual([]);
  });

  it("getValue() includes pre-selected items", () => {
    const c = makeContainer();
    const ti = new TokenInput(c, ITEMS, { selected: ["col_b"] });
    expect(ti.getValue()).toEqual(["col_b"]);
  });
});

// ─── Chip removal ─────────────────────────────────────────────────────────────

describe("TokenInput — chip removal", () => {
  it("clicking × on a chip removes it", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { selected: ["col_a"] });
    c.querySelector<HTMLButtonElement>(".token-chip-remove")!.click();
    expect(c.querySelectorAll(".token-chip")).toHaveLength(0);
  });

  it("removing a chip makes the item available in the dropdown again", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { selected: ["col_a"] });
    c.querySelector<HTMLButtonElement>(".token-chip-remove")!.click();
    openDropdown(c);
    const values = Array.from(c.querySelectorAll(".token-option")).map((o) =>
      o.getAttribute("data-value"),
    );
    expect(values).toContain("col_a");
  });

  it("getValue() excludes removed chips", () => {
    const c = makeContainer();
    const ti = new TokenInput(c, ITEMS, { selected: ["col_a", "col_b"] });
    c.querySelector<HTMLButtonElement>('[data-value="col_a"] .token-chip-remove')!.click();
    expect(ti.getValue()).toEqual(["col_b"]);
  });
});

// ─── Single-select mode ───────────────────────────────────────────────────────

describe("TokenInput — single-select mode", () => {
  it("selecting an option closes the dropdown", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { multi: false });
    openDropdown(c);
    selectOption(c, "col_a");
    expect(c.querySelector<HTMLElement>(".token-dropdown")!.style.display).toBe("none");
  });

  it("selecting a second option replaces the first chip", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { multi: false });
    openDropdown(c);
    selectOption(c, "col_a");
    openDropdown(c);
    selectOption(c, "col_b");
    expect(c.querySelectorAll(".token-chip")).toHaveLength(1);
    expect(c.querySelector<HTMLElement>(".token-chip")!.getAttribute("data-value")).toBe("col_b");
  });

  it("getValue() returns array with single selected value", () => {
    const c = makeContainer();
    const ti = new TokenInput(c, ITEMS, { multi: false });
    openDropdown(c);
    selectOption(c, "col_b");
    expect(ti.getValue()).toEqual(["col_b"]);
  });
});

// ─── includeNew (output column) ───────────────────────────────────────────────

describe("TokenInput — includeNew", () => {
  it("dropdown shows a '+ New column' option when includeNew is true", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { multi: false, includeNew: true });
    openDropdown(c);
    expect(c.querySelector('[data-value="__new__"]')).not.toBeNull();
  });

  it("selecting '+ New column' adds an editable text chip", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { multi: false, includeNew: true });
    openDropdown(c);
    selectOption(c, "__new__");
    expect(c.querySelector<HTMLInputElement>(".token-chip-input")).not.toBeNull();
  });

  it("getValue() returns the editable chip text when '+ New column' is selected", () => {
    const c = makeContainer();
    const ti = new TokenInput(c, ITEMS, { multi: false, includeNew: true });
    openDropdown(c);
    selectOption(c, "__new__");
    c.querySelector<HTMLInputElement>(".token-chip-input")!.value = "my_col";
    expect(ti.getValue()).toEqual(["my_col"]);
  });

  it("pre-selects '+ New column' and fills chip input when selected value is not a known item", () => {
    const c = makeContainer();
    const ti = new TokenInput(c, ITEMS, {
      multi: false,
      includeNew: true,
      selected: ["custom_val"],
    });
    expect(c.querySelector<HTMLInputElement>(".token-chip-input")).not.toBeNull();
    expect(ti.getValue()).toEqual(["custom_val"]);
  });

  it("removing the '+ New column' chip makes '+ Add' reappear", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { multi: false, includeNew: true });
    openDropdown(c);
    selectOption(c, "__new__");
    c.querySelector<HTMLButtonElement>('[data-value="__new__"].token-chip-remove')!.click();
    expect(c.querySelector<HTMLElement>(".token-add-btn")!.style.display).not.toBe("none");
  });

  it("getValue() returns the regular selection after replacing a new-column chip", () => {
    const c = makeContainer();
    const ti = new TokenInput(c, ITEMS, { multi: false, includeNew: true });
    openDropdown(c);
    selectOption(c, "__new__"); // select + New column
    openDropdown(c);
    selectOption(c, "col_b"); // replace with a regular column
    expect(ti.getValue()).toEqual(["col_b"]);
  });
});

// ─── Add/change button ────────────────────────────────────────────────────────

describe("TokenInput — add button visibility", () => {
  it("shows '+ Add' button initially", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    expect(c.querySelector<HTMLElement>(".token-add-btn")!.style.display).not.toBe("none");
  });

  it("multi-select always shows '+ Add' after selection", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, {});
    openDropdown(c);
    selectOption(c, "col_a");
    expect(c.querySelector<HTMLElement>(".token-add-btn")!.style.display).not.toBe("none");
  });

  it("single-select hides '+ Add' button after selection", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { multi: false });
    openDropdown(c);
    selectOption(c, "col_a");
    expect(c.querySelector<HTMLElement>(".token-add-btn")!.style.display).toBe("none");
  });

  it("single-select shows '+ Add' again after chip is removed", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { multi: false });
    openDropdown(c);
    selectOption(c, "col_a");
    c.querySelector<HTMLButtonElement>(".token-chip-remove")!.click();
    expect(c.querySelector<HTMLElement>(".token-add-btn")!.style.display).not.toBe("none");
  });

  it("single-select hides '+ Add' when pre-selected", () => {
    const c = makeContainer();
    new TokenInput(c, ITEMS, { multi: false, selected: ["col_a"] });
    expect(c.querySelector<HTMLElement>(".token-add-btn")!.style.display).toBe("none");
  });
});
