/**
 * @jest-environment jsdom
 */

import { PanelLoader } from "../../src/client/components/panel-loader";
import type { LoadingState } from "../../src/client/types";

function makeContainer(): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = `
    <div id="panel-loader" class="panel-loader" hidden>
      <div class="panel-loader__bar-wrap" hidden>
        <div class="panel-loader__bar-fill"></div>
      </div>
      <div class="panel-loader__spinner" hidden></div>
      <p class="panel-loader__message"></p>
    </div>
  `;
  return div;
}

describe("PanelLoader", () => {
  let container: HTMLElement;
  let loader: PanelLoader;

  beforeEach(() => {
    container = makeContainer();
    loader = new PanelLoader(container);
  });

  it("hides the loader element when status is idle", () => {
    loader.setState({ status: "idle" });
    const el = container.querySelector<HTMLElement>("#panel-loader")!;
    expect(el.hidden).toBe(true);
  });

  it("shows spinner and hides bar when status is loading (no current/total)", () => {
    loader.setState({ status: "loading", message: "Loading..." });
    const el = container.querySelector<HTMLElement>("#panel-loader")!;
    const spinner = container.querySelector<HTMLElement>(".panel-loader__spinner")!;
    const barWrap = container.querySelector<HTMLElement>(".panel-loader__bar-wrap")!;
    expect(el.hidden).toBe(false);
    expect(spinner.hidden).toBe(false);
    expect(barWrap.hidden).toBe(true);
  });

  it("shows progress bar and hides spinner when current and total are set", () => {
    loader.setState({ status: "progress", current: 3, total: 10, message: "Row 3 of 10" });
    const spinner = container.querySelector<HTMLElement>(".panel-loader__spinner")!;
    const barWrap = container.querySelector<HTMLElement>(".panel-loader__bar-wrap")!;
    const barFill = container.querySelector<HTMLElement>(".panel-loader__bar-fill")!;
    expect(spinner.hidden).toBe(true);
    expect(barWrap.hidden).toBe(false);
    expect(barFill.style.width).toBe("30%");
  });

  it("sets message text when message is provided", () => {
    loader.setState({ status: "loading", message: "Scanning folder..." });
    const msg = container.querySelector<HTMLElement>(".panel-loader__message")!;
    expect(msg.textContent).toBe("Scanning folder...");
  });

  it("clears message text when no message provided", () => {
    loader.setState({ status: "loading", message: "first" });
    loader.setState({ status: "loading" });
    const msg = container.querySelector<HTMLElement>(".panel-loader__message")!;
    expect(msg.textContent).toBe("");
  });

  it("shows spinner for progress status with no current/total", () => {
    loader.setState({ status: "progress", message: "Working..." });
    const spinner = container.querySelector<HTMLElement>(".panel-loader__spinner")!;
    const barWrap = container.querySelector<HTMLElement>(".panel-loader__bar-wrap")!;
    expect(spinner.hidden).toBe(false);
    expect(barWrap.hidden).toBe(true);
  });

  it("caps bar fill at 100%", () => {
    loader.setState({ status: "progress", current: 10, total: 10 });
    const barFill = container.querySelector<HTMLElement>(".panel-loader__bar-fill")!;
    expect(barFill.style.width).toBe("100%");
  });
});
