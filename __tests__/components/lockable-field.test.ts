/**
 * @jest-environment jsdom
 */
import { LockableField } from "../../src/client/components/lockable-field";

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="c"></div>';
  return document.getElementById("c")!;
}

describe("LockableField", () => {
  it("renders with input disabled by default (locked=true)", () => {
    const c = makeContainer();
    new LockableField(c, { label: "System Prompt", defaultValue: "You are helpful." });
    const input = c.querySelector<HTMLInputElement>(".text-input");
    expect(input?.disabled).toBe(true);
  });

  it("renders with input enabled when locked is false", () => {
    const c = makeContainer();
    new LockableField(c, { label: "Test", defaultValue: "val", locked: false });
    expect(c.querySelector<HTMLInputElement>(".text-input")?.disabled).toBe(false);
  });

  it("renders the label text", () => {
    const c = makeContainer();
    new LockableField(c, { label: "My Label", defaultValue: "" });
    expect(c.querySelector(".field-label")?.textContent).toBe("My Label");
  });

  it("clicking unlock button enables the input", () => {
    const c = makeContainer();
    new LockableField(c, { label: "L", defaultValue: "v" });
    c.querySelector<HTMLButtonElement>(".unlock-btn")!.click();
    expect(c.querySelector<HTMLInputElement>(".text-input")?.disabled).toBe(false);
  });

  it("clicking unlock button again re-disables the input (toggle)", () => {
    const c = makeContainer();
    new LockableField(c, { label: "L", defaultValue: "v" });
    const btn = c.querySelector<HTMLButtonElement>(".unlock-btn")!;
    btn.click();
    btn.click();
    expect(c.querySelector<HTMLInputElement>(".text-input")?.disabled).toBe(true);
  });

  it("getValue() returns the current input value", () => {
    const c = makeContainer();
    const field = new LockableField(c, { label: "L", defaultValue: "initial" });
    expect(field.getValue()).toBe("initial");
  });

  it("isLocked() reflects current lock state", () => {
    const c = makeContainer();
    const field = new LockableField(c, { label: "L", defaultValue: "" });
    expect(field.isLocked()).toBe(true);
    c.querySelector<HTMLButtonElement>(".unlock-btn")!.click();
    expect(field.isLocked()).toBe(false);
  });

  it("renders a textarea when multiline is true", () => {
    const c = makeContainer();
    new LockableField(c, { label: "L", defaultValue: "long text", multiline: true });
    expect(c.querySelector("textarea")).not.toBeNull();
    expect(c.querySelector("input")).toBeNull();
  });
});
