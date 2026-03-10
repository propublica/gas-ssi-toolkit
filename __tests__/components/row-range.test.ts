/**
 * @jest-environment jsdom
 */
import { RowRange } from "../../src/client/components/row-range";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="c"></div>';
  return document.getElementById("c")!;
}

describe("RowRange", () => {
  it("renders with 'selection' checked and range inputs hidden by default", () => {
    const c = makeContainer();
    new RowRange(c);
    const selRadio = c.querySelector<HTMLInputElement>('input[value="selection"]');
    const rangeInputs = c.querySelector<HTMLElement>(".range-inputs");
    expect(selRadio?.checked).toBe(true);
    expect(rangeInputs?.style.display).toBe("none");
  });

  it("when initialized with a rowRange, 'range' is checked and inputs are pre-filled", () => {
    const c = makeContainer();
    new RowRange(c, { start: 3, end: 9 });
    const rangeRadio = c.querySelector<HTMLInputElement>('input[value="range"]');
    const numbers = c.querySelectorAll<HTMLInputElement>('input[type="number"]');
    expect(rangeRadio?.checked).toBe(true);
    expect(numbers[0].value).toBe("3");
    expect(numbers[1].value).toBe("9");
  });

  it("selecting 'range' radio shows range inputs", () => {
    const c = makeContainer();
    new RowRange(c);
    const rangeRadio = c.querySelector<HTMLInputElement>('input[value="range"]')!;
    rangeRadio.checked = true;
    rangeRadio.dispatchEvent(new Event("change"));
    expect(c.querySelector<HTMLElement>(".range-inputs")?.style.display).toBe("flex");
  });

  it("getValue() returns undefined when 'selection' is checked", () => {
    const c = makeContainer();
    const r = new RowRange(c);
    expect(r.getValue()).toBeUndefined();
  });

  it("getValue() returns { start, end } when 'range' is checked and inputs are valid", () => {
    const c = makeContainer();
    const r = new RowRange(c, { start: 2, end: 10 });
    expect(r.getValue()).toEqual({ start: 2, end: 10 });
  });

  it("selecting 'selection' radio hides range inputs", () => {
    const c = makeContainer();
    new RowRange(c, { start: 2, end: 5 }); // starts with range checked
    const selRadio = c.querySelector<HTMLInputElement>('input[value="selection"]')!;
    selRadio.checked = true;
    selRadio.dispatchEvent(new Event("change"));
    expect(c.querySelector<HTMLElement>(".range-inputs")?.style.display).toBe("none");
  });

  it("getValue() returns undefined when range is checked but inputs are empty", () => {
    const c = makeContainer();
    const r = new RowRange(c);
    const rangeRadio = c.querySelector<HTMLInputElement>('input[value="range"]')!;
    rangeRadio.checked = true;
    rangeRadio.dispatchEvent(new Event("change"));
    // inputs left empty — parseInt("", 10) is NaN
    expect(r.getValue()).toBeUndefined();
  });
});
