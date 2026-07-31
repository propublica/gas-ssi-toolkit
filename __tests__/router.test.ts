/**
 * @jest-environment jsdom
 */

import { Router } from "../src/client/router";
import type { Panel, NavigationContext } from "../src/client/types";

function makePanel(id: string): Panel & { mountCalls: unknown[]; unmountReturn: unknown } {
  return {
    mountCalls: [],
    unmountReturn: undefined as unknown,
    mount(container, nav, params, savedState) {
      this.mountCalls.push({ container, nav, params, savedState });
      container.innerHTML = `<div data-panel="${id}"></div>`;
    },
    unmount() {
      return this.unmountReturn;
    },
  };
}

describe("Router", () => {
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    container = document.getElementById("app")!;
  });

  it("start() mounts the initial panel", () => {
    const home = makePanel("home");
    const router = new Router(container, new Map([["tool-list", home]]));
    router.start("tool-list");
    expect(home.mountCalls).toHaveLength(1);
    expect(container.querySelector("[data-panel='home']")).not.toBeNull();
  });

  it("navigate() saves current panel state into stack then mounts new panel", () => {
    const home = makePanel("home");
    const ai = makePanel("ai");
    (home as ReturnType<typeof makePanel>).unmountReturn = { saved: true };
    const router = new Router(
      container,
      new Map([
        ["tool-list", home],
        ["configure-ai-run", ai],
      ]),
    );
    router.start("tool-list");
    router.navigate("configure-ai-run", { preset: "foo" });

    const aiCall = (ai as ReturnType<typeof makePanel>).mountCalls[0] as {
      params: unknown;
      savedState: unknown;
    };
    expect(aiCall.params).toEqual({ preset: "foo" });
    expect(aiCall.savedState).toBeUndefined();
    expect(container.querySelector("[data-panel='ai']")).not.toBeNull();
  });

  it("back() restores the previous panel with its savedState", () => {
    const home = makePanel("home");
    const ai = makePanel("ai");
    (home as ReturnType<typeof makePanel>).unmountReturn = { scroll: 42 };
    const router = new Router(
      container,
      new Map([
        ["tool-list", home],
        ["configure-ai-run", ai],
      ]),
    );
    router.start("tool-list");
    router.navigate("configure-ai-run");
    router.back();

    const calls = (home as ReturnType<typeof makePanel>).mountCalls;
    expect(calls).toHaveLength(2);
    const restoreCall = calls[1] as { savedState: unknown };
    expect(restoreCall.savedState).toEqual({ scroll: 42 });
  });

  it("start() throws for unknown panel ID", () => {
    const router = new Router(container, new Map([["tool-list", makePanel("home")]]));
    expect(() => router.start("configure-ai-run" as never)).toThrow(
      "Unknown panel: configure-ai-run",
    );
  });

  it("navigate() throws for unknown panel ID", () => {
    const home = makePanel("home");
    const router = new Router(container, new Map([["tool-list", home]]));
    router.start("tool-list");
    expect(() => router.navigate("configure-ai-run")).toThrow("Unknown panel: configure-ai-run");
  });

  it("back() does nothing when stack has only one entry", () => {
    const home = makePanel("home");
    const router = new Router(container, new Map([["tool-list", home]]));
    router.start("tool-list");
    router.back();
    expect((home as ReturnType<typeof makePanel>).mountCalls).toHaveLength(1);
  });

  it("canGoBack() returns false for single entry, true after navigate", () => {
    const home = makePanel("home");
    const ai = makePanel("ai");
    const router = new Router(
      container,
      new Map([
        ["tool-list", home],
        ["configure-ai-run", ai],
      ]),
    );
    router.start("tool-list");
    expect(router.canGoBack()).toBe(false);
    router.navigate("configure-ai-run");
    expect(router.canGoBack()).toBe(true);
  });

  it("navigate() with no params restores a panel's last state from an earlier visit via back()", () => {
    const home = makePanel("home");
    const ai = makePanel("ai");
    const router = new Router(
      container,
      new Map([
        ["tool-list", home],
        ["configure-ai-run", ai],
      ]),
    );
    router.start("tool-list");
    router.navigate("configure-ai-run");
    (ai as ReturnType<typeof makePanel>).unmountReturn = { promptCols: ["a"] };
    router.back(); // leaves "ai" via back() — previously this discarded ai's state entirely
    router.navigate("configure-ai-run"); // bare navigate — should restore

    const calls = (ai as ReturnType<typeof makePanel>).mountCalls;
    expect(calls).toHaveLength(2);
    const secondMount = calls[1] as { savedState: unknown };
    expect(secondMount.savedState).toEqual({ promptCols: ["a"] });
  });

  it("restores a panel's state even after visiting an unrelated panel in between", () => {
    const home = makePanel("home");
    const ai = makePanel("ai");
    const importPanel = makePanel("import");
    const router = new Router(
      container,
      new Map([
        ["tool-list", home],
        ["configure-ai-run", ai],
        ["import-drive-links", importPanel],
      ]),
    );
    router.start("tool-list");
    router.navigate("configure-ai-run");
    (ai as ReturnType<typeof makePanel>).unmountReturn = { promptCols: ["a"] };
    router.back(); // -> home
    router.navigate("import-drive-links"); // unrelated hop
    router.back(); // -> home
    router.navigate("configure-ai-run"); // bare navigate, should still restore "ai"'s state

    const calls = (ai as ReturnType<typeof makePanel>).mountCalls;
    const secondMount = calls[1] as { savedState: unknown };
    expect(secondMount.savedState).toEqual({ promptCols: ["a"] });
  });

  it("navigate() with explicit params ignores any cached state for that panel", () => {
    const home = makePanel("home");
    const ai = makePanel("ai");
    const router = new Router(
      container,
      new Map([
        ["tool-list", home],
        ["configure-ai-run", ai],
      ]),
    );
    router.start("tool-list");
    router.navigate("configure-ai-run");
    (ai as ReturnType<typeof makePanel>).unmountReturn = { promptCols: ["a"] };
    router.back();
    router.navigate("configure-ai-run", { promptCols: ["fresh"] }); // explicit params

    const calls = (ai as ReturnType<typeof makePanel>).mountCalls;
    const secondMount = calls[1] as { params: unknown; savedState: unknown };
    expect(secondMount.params).toEqual({ promptCols: ["fresh"] });
    expect(secondMount.savedState).toBeUndefined(); // cache bypassed entirely
  });

  it("navigate() provides a NavigationContext whose navigate/back/canGoBack delegate to router", () => {
    const home = makePanel("home");
    const ai = makePanel("ai");
    let capturedNav: NavigationContext | null = null;
    const spy = makePanel("spy");
    spy.mount = function (container, nav) {
      capturedNav = nav;
      container.innerHTML = "<div data-panel='spy'></div>";
    };
    const router = new Router(
      container,
      new Map([
        ["tool-list", home],
        ["configure-ai-run", ai],
        ["recipes-list", spy],
      ]),
    );
    router.start("tool-list");
    router.navigate("recipes-list");
    expect(capturedNav).not.toBeNull();

    // Verify delegates actually invoke router methods.
    expect(capturedNav!.canGoBack()).toBe(true); // stack has 2 entries
    capturedNav!.navigate("configure-ai-run"); // delegates to router.navigate
    expect(container.querySelector("[data-panel='ai']")).not.toBeNull();
    capturedNav!.back(); // delegates to router.back
    expect(container.querySelector("[data-panel='spy']")).not.toBeNull();
  });
});
