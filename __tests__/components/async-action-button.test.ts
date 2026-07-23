/**
 * @jest-environment jsdom
 */

import { AsyncActionButton } from "../../src/client/components/async-action-button";

function makeButton(): HTMLButtonElement {
  const btn = document.createElement("button");
  document.body.appendChild(btn);
  return btn;
}

describe("AsyncActionButton", () => {
  let btn: HTMLButtonElement;
  let asyncBtn: AsyncActionButton;

  beforeEach(() => {
    document.body.innerHTML = "";
    btn = makeButton();
    asyncBtn = new AsyncActionButton(btn, {
      idleLabel: "Test",
      loadingLabel: "Testing...",
      doneLabel: "Tested ✓",
    });
  });

  it("renders the idle label and is enabled on construction", () => {
    expect(btn.textContent).toBe("Test");
    expect(btn.disabled).toBe(false);
  });

  it("getState() returns 'idle' initially", () => {
    expect(asyncBtn.getState()).toBe("idle");
  });

  describe("setLoading()", () => {
    it("disables the button", () => {
      asyncBtn.setLoading();
      expect(btn.disabled).toBe(true);
    });

    it("shows the loading label alongside a spinner", () => {
      asyncBtn.setLoading();
      expect(btn.querySelector(".btn-spinner")).not.toBeNull();
      expect(btn.textContent).toContain("Testing...");
    });

    it("updates getState() to 'loading'", () => {
      asyncBtn.setLoading();
      expect(asyncBtn.getState()).toBe("loading");
    });
  });

  describe("setDone()", () => {
    it("re-enables the button and shows the done label", () => {
      asyncBtn.setLoading();
      asyncBtn.setDone();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("Tested ✓");
    });

    it("updates getState() to 'done'", () => {
      asyncBtn.setDone();
      expect(asyncBtn.getState()).toBe("done");
    });

    it("persists the done label — no timer reverts it", () => {
      jest.useFakeTimers();
      asyncBtn.setDone();
      jest.advanceTimersByTime(60_000);
      expect(btn.textContent).toBe("Tested ✓");
      expect(asyncBtn.getState()).toBe("done");
      jest.useRealTimers();
    });

    it("can be called directly without a prior setLoading() (e.g. restoring an already-done state)", () => {
      expect(() => asyncBtn.setDone()).not.toThrow();
      expect(btn.textContent).toBe("Tested ✓");
    });
  });

  describe("setIdle()", () => {
    it("re-enables the button and shows the idle label", () => {
      asyncBtn.setLoading();
      asyncBtn.setIdle();
      expect(btn.disabled).toBe(false);
      expect(btn.textContent).toBe("Test");
    });

    it("updates getState() to 'idle'", () => {
      asyncBtn.setDone();
      asyncBtn.setIdle();
      expect(asyncBtn.getState()).toBe("idle");
    });

    it("resets from done back to idle (e.g. a stale/mismatched restore)", () => {
      asyncBtn.setDone();
      asyncBtn.setIdle();
      expect(btn.textContent).toBe("Test");
      expect(btn.disabled).toBe(false);
    });
  });
});
