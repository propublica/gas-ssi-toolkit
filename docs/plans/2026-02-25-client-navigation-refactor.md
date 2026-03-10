# Client Navigation Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the sidebar client into a panel-router architecture that supports multiple panels with push/pop history, serializable per-panel state, and self-contained components.

**Architecture:** A `Router` class manages a navigation stack of `{ panelId, params, savedState }` entries. Each panel is a class with `mount(container, nav, params?, savedState?)` and `unmount(): SavedState | undefined`. Components (TagList, SingleTagList, RowRange, LockableField) own all the DOM they touch and expose typed `getValue()` methods — no hardcoded global IDs inside components. A `services.ts` module wraps all `google.script.run` calls as Promises, with an in-memory header cache.

**Tech Stack:** TypeScript, Jest/jsdom, Rollup IIFE, Google Apps Script HtmlService

---

## Background: what changes and why

| Old | New |
|-----|-----|
| `sidebar.ts` — functions that imperatively manipulate global IDs | Deleted — replaced by components and panels |
| `sidebar-entry.ts` — exports `showAIPanel`, `hideAIPanel`, `dispatchTool`, `runAI` | Replaced by thin `init()` that creates Router |
| `Sidebar.html` — two static panels with hardcoded IDs | `<div id="app"></div>` shell only |
| `__tests__/sidebar.test.ts` | Deleted — replaced by component tests |
| `__tests__/sidebar-entry.test.ts` | Deleted — replaced by panel tests |
| `__tests__/helpers/sidebar-fixtures.ts` | Deleted — panels mount their own DOM |

The old tests continue to pass throughout this plan — old code is not deleted until Task 14.

---

## Task 1: Update tooling for new test directories

**Files:**
- Modify: `jest.config.cjs`
- Modify: `tsconfig.client.json`

**Step 1: Add transform patterns for new test subdirectories in `jest.config.cjs`**

The current transform block handles `sidebar.test.ts` and `sidebar-entry.test.ts` by exact path. Add patterns for the new directories and update coverage thresholds.

```js
// In the transform block, add after the helpers pattern:
"^.+/__tests__/components/.+\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
"^.+/__tests__/panels/.+\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
```

Coverage thresholds do not need new entries yet — add them in Task 14 once files exist.

**Step 2: Add new test paths to `tsconfig.client.json`**

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "lib": ["ES2019", "DOM"],
    "types": ["google-apps-script", "jest"],
    "rootDir": ".",
    "noUnusedLocals": false
  },
  "include": [
    "src/client/**/*.ts",
    "src/shared/**/*.ts",
    "__tests__/sidebar.test.ts",
    "__tests__/sidebar-entry.test.ts",
    "__tests__/helpers/*.ts",
    "__tests__/components/**/*.ts",
    "__tests__/panels/**/*.ts"
  ],
  "exclude": []
}
```

**Step 3: Verify existing tests still pass**

```bash
npm test
```
Expected: all existing tests pass.

**Step 4: Commit**

```bash
git add jest.config.cjs tsconfig.client.json
git commit -m "chore: add component and panel test directories to jest and tsconfig"
```

---

## Task 2: Client types

**Files:**
- Create: `src/client/types.ts`

No tests needed — pure type declarations.

**Step 1: Create `src/client/types.ts`**

```ts
import type { Panel as _Panel } from "./types"; // self-reference guard — not needed, just a note

/**
 * All registered panel identifiers. Add new panels here first.
 */
export type PanelId =
  | "tool-list"
  | "configure-ai-run"
  | "recipes-list"
  | "document-summarization";

/**
 * Passed to each panel's mount() so panels can trigger navigation
 * without importing the router directly.
 */
export interface NavigationContext {
  navigate(panelId: PanelId, params?: unknown): void;
  back(): void;
  canGoBack(): boolean;
}

/**
 * Contract every panel class must satisfy.
 * P = params type received on mount (from the calling panel).
 * S = saved state type returned by unmount (preserved on the stack).
 */
export interface Panel<P = unknown, S = unknown> {
  mount(
    container: HTMLElement,
    nav: NavigationContext,
    params?: P,
    savedState?: S,
  ): void;
  unmount(): S | undefined;
}
```

**Step 2: Run typecheck to confirm no errors**

```bash
npm run typecheck
```

**Step 3: Commit**

```bash
git add src/client/types.ts
git commit -m "feat: add client navigation types (PanelId, NavigationContext, Panel)"
```

---

## Task 3: Router

**Files:**
- Create: `src/client/router.ts`
- Create: `__tests__/router.test.ts`

### Step 1: Write the failing test

Create `__tests__/router.test.ts`:

```ts
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
      new Map([["tool-list", home], ["configure-ai-run", ai]]),
    );
    router.start("tool-list");
    router.navigate("configure-ai-run", { preset: "foo" });

    // ai panel mounted with the params
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
      new Map([["tool-list", home], ["configure-ai-run", ai]]),
    );
    router.start("tool-list");
    router.navigate("configure-ai-run");
    router.back();

    // home was mounted twice: once at start, once on back
    const calls = (home as ReturnType<typeof makePanel>).mountCalls;
    expect(calls).toHaveLength(2);
    const restoreCall = calls[1] as { savedState: unknown };
    expect(restoreCall.savedState).toEqual({ scroll: 42 });
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
      new Map([["tool-list", home], ["configure-ai-run", ai]]),
    );
    router.start("tool-list");
    expect(router.canGoBack()).toBe(false);
    router.navigate("configure-ai-run");
    expect(router.canGoBack()).toBe(true);
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
      new Map([["tool-list", home], ["configure-ai-run", ai], ["recipes-list", spy]]),
    );
    router.start("tool-list");
    router.navigate("recipes-list");
    expect(capturedNav).not.toBeNull();
    expect(typeof capturedNav!.navigate).toBe("function");
    expect(typeof capturedNav!.back).toBe("function");
    expect(typeof capturedNav!.canGoBack).toBe("function");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/router.test.ts
```
Expected: FAIL — `Router` not found.

**Step 3: Implement `src/client/router.ts`**

```ts
import type { Panel, PanelId, NavigationContext } from "./types";

interface StackEntry {
  panelId: PanelId;
  params?: unknown;
  savedState?: unknown;
}

export class Router {
  private stack: StackEntry[] = [];
  private currentPanel: Panel | null = null;
  private readonly panels: Map<PanelId, Panel>;
  private readonly container: HTMLElement;

  constructor(container: HTMLElement, panels: Map<PanelId, Panel>) {
    this.container = container;
    this.panels = panels;
  }

  start(initialPanelId: PanelId): void {
    const panel = this.panels.get(initialPanelId);
    if (!panel) throw new Error(`Unknown panel: ${initialPanelId}`);
    this.stack = [{ panelId: initialPanelId }];
    this.currentPanel = panel;
    this.container.innerHTML = "";
    panel.mount(this.container, this.makeNav(), undefined, undefined);
  }

  navigate(panelId: PanelId, params?: unknown): void {
    const panel = this.panels.get(panelId);
    if (!panel) throw new Error(`Unknown panel: ${panelId}`);
    if (this.currentPanel && this.stack.length > 0) {
      this.stack[this.stack.length - 1].savedState = this.currentPanel.unmount();
    }
    this.stack.push({ panelId, params });
    this.currentPanel = panel;
    this.container.innerHTML = "";
    panel.mount(this.container, this.makeNav(), params, undefined);
  }

  back(): void {
    if (this.stack.length <= 1) return;
    this.currentPanel?.unmount(); // discard state — user is abandoning this panel
    this.stack.pop();
    const entry = this.stack[this.stack.length - 1];
    const panel = this.panels.get(entry.panelId)!;
    this.currentPanel = panel;
    this.container.innerHTML = "";
    panel.mount(this.container, this.makeNav(), entry.params, entry.savedState);
  }

  canGoBack(): boolean {
    return this.stack.length > 1;
  }

  private makeNav(): NavigationContext {
    return {
      navigate: (id, params) => this.navigate(id, params),
      back: () => this.back(),
      canGoBack: () => this.canGoBack(),
    };
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/router.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/client/router.ts __tests__/router.test.ts
git commit -m "feat: add Router with push/pop navigation stack and per-panel state serialization"
```

---

## Task 4: Services module

**Files:**
- Create: `src/client/services.ts`
- Create: `__tests__/services.test.ts`

### Step 1: Write the failing test

Create `__tests__/services.test.ts`:

```ts
/**
 * @jest-environment jsdom
 */

const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
  runTool: jest.fn(),
};
(globalThis as unknown as { google: unknown }).google = { script: { run: mockRun } };

// Must import AFTER setting up the mock, and re-import to reset module cache between tests.
let services: typeof import("../src/client/services");

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  mockRun.withSuccessHandler.mockReturnThis();
  mockRun.withFailureHandler.mockReturnThis();
  services = await import("../src/client/services");
});

function captureHandlers(): { resolve: (v: unknown) => void; reject: (e: Error) => void } {
  let resolve!: (v: unknown) => void;
  let reject!: (e: Error) => void;
  mockRun.withSuccessHandler.mockImplementation((fn: (v: unknown) => void) => {
    resolve = fn;
    return mockRun;
  });
  mockRun.withFailureHandler.mockImplementation((fn: (e: Error) => void) => {
    reject = fn;
    return mockRun;
  });
  return {
    get resolve() { return resolve; },
    get reject() { return reject; },
  };
}

describe("getSheetHeaders", () => {
  it("calls google.script.run.getSheetHeaders and resolves with headers", async () => {
    const handlers = captureHandlers();
    const promise = services.getSheetHeaders();
    handlers.resolve(["col_a", "col_b"]);
    const result = await promise;
    expect(result).toEqual(["col_a", "col_b"]);
    expect(mockRun.getSheetHeaders).toHaveBeenCalledTimes(1);
  });

  it("caches the result — second call does not hit GAS", async () => {
    const handlers = captureHandlers();
    const p1 = services.getSheetHeaders();
    handlers.resolve(["col_a"]);
    await p1;
    await services.getSheetHeaders();
    expect(mockRun.getSheetHeaders).toHaveBeenCalledTimes(1);
  });

  it("rejects with the error on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.getSheetHeaders();
    handlers.reject(new Error("sheet error"));
    await expect(promise).rejects.toThrow("sheet error");
  });
});

describe("invalidateHeaderCache", () => {
  it("clears cache so next getSheetHeaders re-fetches", async () => {
    const handlers = captureHandlers();
    const p1 = services.getSheetHeaders();
    handlers.resolve(["col_a"]);
    await p1;
    services.invalidateHeaderCache();
    const handlers2 = captureHandlers();
    const p2 = services.getSheetHeaders();
    handlers2.resolve(["col_b"]);
    await p2;
    expect(mockRun.getSheetHeaders).toHaveBeenCalledTimes(2);
  });
});

describe("runBatchAI", () => {
  it("calls google.script.run.runBatchAI with config and resolves", async () => {
    const handlers = captureHandlers();
    const config = { userPromptCols: ["col_a"], outputCol: "out" };
    const promise = services.runBatchAI(config as import("../src/shared/types").RunConfig);
    handlers.resolve(undefined);
    await expect(promise).resolves.toBeUndefined();
    expect(mockRun.runBatchAI).toHaveBeenCalledWith(config);
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.runBatchAI({
      userPromptCols: [],
      outputCol: "out",
    });
    handlers.reject(new Error("api error"));
    await expect(promise).rejects.toThrow("api error");
  });
});

describe("runTool", () => {
  it("calls google.script.run.runTool with the function name and resolves", async () => {
    const handlers = captureHandlers();
    const promise = services.runTool("importDriveLinks");
    handlers.resolve(undefined);
    await expect(promise).resolves.toBeUndefined();
    expect(mockRun.runTool).toHaveBeenCalledWith("importDriveLinks");
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/services.test.ts
```
Expected: FAIL.

**Step 3: Implement `src/client/services.ts`**

```ts
import type { RunConfig } from "../shared/types";

let cachedHeaders: string[] | null = null;

export function getSheetHeaders(): Promise<string[]> {
  if (cachedHeaders !== null) return Promise.resolve(cachedHeaders);
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((headers: unknown) => {
        cachedHeaders = headers as string[];
        resolve(cachedHeaders);
      })
      .withFailureHandler((err: Error) => reject(err))
      .getSheetHeaders();
  });
}

export function invalidateHeaderCache(): void {
  cachedHeaders = null;
}

export function runBatchAI(config: RunConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .runBatchAI(config);
  });
}

export function runTool(fn: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .runTool(fn);
  });
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/services.test.ts
```
Expected: PASS.

**Step 5: Commit**

```bash
git add src/client/services.ts __tests__/services.test.ts
git commit -m "feat: add services module wrapping google.script.run as Promises with header cache"
```

---

## Task 5: TagList component

**Files:**
- Create: `src/client/components/tag-list.ts`
- Create: `__tests__/components/tag-list.test.ts`

### Step 1: Write the failing test

```ts
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
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/components/tag-list.test.ts
```

**Step 3: Implement `src/client/components/tag-list.ts`**

```ts
export class TagList {
  private readonly container: HTMLElement;

  constructor(container: HTMLElement, headers: string[], selected: string[] = []) {
    this.container = container;
    this.render(headers, selected);
  }

  private render(headers: string[], selected: string[]): void {
    this.container.innerHTML = "";
    headers.forEach((h) => {
      const btn = document.createElement("button");
      btn.className = "tag";
      btn.type = "button";
      btn.textContent = h;
      btn.setAttribute("data-value", h);
      if (selected.includes(h)) btn.classList.add("selected");
      btn.addEventListener("click", () => btn.classList.toggle("selected"));
      this.container.appendChild(btn);
    });
  }

  getValue(): string[] {
    return Array.from(this.container.querySelectorAll<HTMLButtonElement>(".tag.selected"))
      .map((t) => t.getAttribute("data-value") ?? "")
      .filter(Boolean);
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/components/tag-list.test.ts
```

**Step 5: Commit**

```bash
git add src/client/components/tag-list.ts __tests__/components/tag-list.test.ts
git commit -m "feat: add TagList component — multi-select, self-contained DOM, getValue()"
```

---

## Task 6: SingleTagList component

**Files:**
- Create: `src/client/components/single-tag-list.ts`
- Create: `__tests__/components/single-tag-list.test.ts`

### Key design note

`SingleTagList` owns its "new column" text input internally — no global `#new-col-input` dependency. For saved state restoration: if `opts.selected` does not match any header and `includeNew` is true, the component auto-selects `__new__` and pre-populates the input with the value.

### Step 1: Write the failing test

```ts
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
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/components/single-tag-list.test.ts
```

**Step 3: Implement `src/client/components/single-tag-list.ts`**

```ts
export interface SingleTagListOpts {
  includeNew?: boolean;
  selected?: string;
}

export class SingleTagList {
  private readonly container: HTMLElement;
  private newInput: HTMLInputElement | null = null;

  constructor(container: HTMLElement, headers: string[], opts: SingleTagListOpts) {
    this.container = container;
    this.render(headers, opts);
  }

  private selectOnly(clicked: HTMLButtonElement): void {
    this.container.querySelectorAll<HTMLButtonElement>(".tag").forEach((t) => {
      t.classList.remove("selected");
    });
    clicked.classList.add("selected");
  }

  private render(headers: string[], opts: SingleTagListOpts): void {
    this.container.innerHTML = "";

    // If selected is set but not a known header, treat as a custom "__new__" value.
    const selectedIsCustom =
      opts.selected !== undefined &&
      opts.includeNew === true &&
      !headers.includes(opts.selected);

    headers.forEach((h) => {
      const btn = document.createElement("button");
      btn.className = "tag";
      btn.type = "button";
      btn.textContent = h;
      btn.setAttribute("data-value", h);
      if (!selectedIsCustom && opts.selected === h) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        this.selectOnly(btn);
        if (this.newInput) this.newInput.style.display = "none";
      });
      this.container.appendChild(btn);
    });

    if (opts.includeNew) {
      const newBtn = document.createElement("button");
      newBtn.className = "tag";
      newBtn.type = "button";
      newBtn.textContent = "+ New column";
      newBtn.setAttribute("data-value", "__new__");

      this.newInput = document.createElement("input");
      this.newInput.type = "text";
      this.newInput.className = "text-input";
      this.newInput.placeholder = "ai_column_name";
      this.newInput.value = "ai_";
      this.newInput.style.display = "none";

      if (selectedIsCustom) {
        newBtn.classList.add("selected");
        this.newInput.value = opts.selected!;
        this.newInput.style.display = "block";
      }

      newBtn.addEventListener("click", () => {
        this.selectOnly(newBtn);
        if (this.newInput) {
          this.newInput.style.display = "block";
          this.newInput.focus();
        }
      });

      this.container.appendChild(newBtn);
      this.container.appendChild(this.newInput);
    }
  }

  getValue(): string {
    const selected = this.container.querySelector<HTMLButtonElement>(".tag.selected");
    if (!selected) return "";
    const val = selected.getAttribute("data-value") ?? "";
    if (val === "__new__" && this.newInput) return this.newInput.value.trim();
    return val;
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/components/single-tag-list.test.ts
```

**Step 5: Commit**

```bash
git add src/client/components/single-tag-list.ts __tests__/components/single-tag-list.test.ts
git commit -m "feat: add SingleTagList component — single-select, owns new-column input, handles custom savedState values"
```

---

## Task 7: RowRange component

**Files:**
- Create: `src/client/components/row-range.ts`
- Create: `__tests__/components/row-range.test.ts`

### Step 1: Write the failing test

```ts
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
    const start = c.querySelectorAll<HTMLInputElement>('input[type="number"]')[0];
    const end = c.querySelectorAll<HTMLInputElement>('input[type="number"]')[1];
    expect(rangeRadio?.checked).toBe(true);
    expect(start.value).toBe("3");
    expect(end.value).toBe("9");
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

  it("getValue() returns undefined when range inputs are empty", () => {
    const c = makeContainer();
    new RowRange(c);
    const rangeRadio = c.querySelector<HTMLInputElement>('input[value="range"]')!;
    rangeRadio.checked = true;
    rangeRadio.dispatchEvent(new Event("change"));
    const r = new RowRange(c);
    // No values entered
    expect(r.getValue()).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/components/row-range.test.ts
```

**Step 3: Implement `src/client/components/row-range.ts`**

```ts
export interface RowRangeValue {
  start: number;
  end: number;
}

export class RowRange {
  private readonly container: HTMLElement;
  private startInput: HTMLInputElement;
  private endInput: HTMLInputElement;
  private rangeRadio: HTMLInputElement;

  constructor(container: HTMLElement, selected?: RowRangeValue) {
    this.container = container;
    const refs = this.render(selected);
    this.startInput = refs.startInput;
    this.endInput = refs.endInput;
    this.rangeRadio = refs.rangeRadio;
  }

  private render(selected?: RowRangeValue): {
    startInput: HTMLInputElement;
    endInput: HTMLInputElement;
    rangeRadio: HTMLInputElement;
  } {
    this.container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "row-range-options";

    const selLabel = document.createElement("label");
    const selRadio = document.createElement("input");
    selRadio.type = "radio";
    selRadio.name = "row-range";
    selRadio.value = "selection";
    selRadio.checked = !selected;
    selLabel.append(selRadio, " Use sheet selection");

    const rangeLabel = document.createElement("label");
    const rangeRadio = document.createElement("input");
    rangeRadio.type = "radio";
    rangeRadio.name = "row-range";
    rangeRadio.value = "range";
    rangeRadio.checked = !!selected;
    rangeLabel.append(rangeRadio, " Specify range");

    const rangeInputs = document.createElement("div");
    rangeInputs.className = "range-inputs";
    rangeInputs.style.display = selected ? "flex" : "none";

    const startInput = document.createElement("input");
    startInput.type = "number";
    startInput.placeholder = "Start row";
    startInput.min = "2";
    if (selected) startInput.value = String(selected.start);

    const endInput = document.createElement("input");
    endInput.type = "number";
    endInput.placeholder = "End row";
    endInput.min = "2";
    if (selected) endInput.value = String(selected.end);

    rangeInputs.append(startInput, endInput);
    wrapper.append(selLabel, rangeLabel, rangeInputs);
    this.container.appendChild(wrapper);

    const toggle = (): void => {
      rangeInputs.style.display = rangeRadio.checked ? "flex" : "none";
    };
    selRadio.addEventListener("change", toggle);
    rangeRadio.addEventListener("change", toggle);

    return { startInput, endInput, rangeRadio };
  }

  getValue(): RowRangeValue | undefined {
    if (!this.rangeRadio.checked) return undefined;
    const start = parseInt(this.startInput.value, 10);
    const end = parseInt(this.endInput.value, 10);
    if (isNaN(start) || isNaN(end)) return undefined;
    return { start, end };
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/components/row-range.test.ts
```

**Step 5: Commit**

```bash
git add src/client/components/row-range.ts __tests__/components/row-range.test.ts
git commit -m "feat: add RowRange component — radio + range inputs, self-contained, getValue()"
```

---

## Task 8: LockableField component

**Files:**
- Create: `src/client/components/lockable-field.ts`
- Create: `__tests__/components/lockable-field.test.ts`

### Step 1: Write the failing test

```ts
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
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/components/lockable-field.test.ts
```

**Step 3: Implement `src/client/components/lockable-field.ts`**

```ts
export interface LockableFieldConfig {
  label: string;
  defaultValue: string;
  locked?: boolean; // defaults to true
  placeholder?: string;
  multiline?: boolean;
}

export class LockableField {
  private locked: boolean;
  private readonly input: HTMLInputElement | HTMLTextAreaElement;

  constructor(container: HTMLElement, config: LockableFieldConfig) {
    this.locked = config.locked ?? true;
    this.input = this.render(container, config);
  }

  private render(
    container: HTMLElement,
    config: LockableFieldConfig,
  ): HTMLInputElement | HTMLTextAreaElement {
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "lockable-field-header";

    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = config.label;

    const unlockBtn = document.createElement("button");
    unlockBtn.type = "button";
    unlockBtn.className = "unlock-btn";
    unlockBtn.textContent = this.locked ? "🔒 Edit" : "🔓 Lock";

    header.append(label, unlockBtn);

    const input: HTMLInputElement | HTMLTextAreaElement = config.multiline
      ? document.createElement("textarea")
      : document.createElement("input");

    if (input instanceof HTMLInputElement) input.type = "text";
    input.className = "text-input";
    input.value = config.defaultValue;
    if (config.placeholder) input.placeholder = config.placeholder;
    input.disabled = this.locked;

    unlockBtn.addEventListener("click", () => {
      this.locked = !this.locked;
      input.disabled = this.locked;
      unlockBtn.textContent = this.locked ? "🔒 Edit" : "🔓 Lock";
    });

    container.append(header, input);
    return input;
  }

  getValue(): string {
    return this.input.value;
  }

  isLocked(): boolean {
    return this.locked;
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/components/lockable-field.test.ts
```

**Step 5: Commit**

```bash
git add src/client/components/lockable-field.ts __tests__/components/lockable-field.test.ts
git commit -m "feat: add LockableField component — locked-by-default input/textarea with unlock toggle"
```

---

## Task 9: ToolList panel

**Files:**
- Create: `src/client/panels/tool-list.ts`
- Create: `__tests__/panels/tool-list.test.ts`

### Step 1: Write the failing test

```ts
/**
 * @jest-environment jsdom
 */

// Mock services before import
jest.mock("../../src/client/services", () => ({
  runTool: jest.fn(),
}));

import { ToolListPanel } from "../../src/client/panels/tool-list";
import * as services from "../../src/client/services";
import type { NavigationContext } from "../../src/client/types";

const mockNav: NavigationContext = {
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(false),
};

function mountPanel(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  const container = document.getElementById("app")!;
  const panel = new ToolListPanel();
  panel.mount(container, mockNav);
  return container;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ToolListPanel", () => {
  it("clicking Run AI navigates to configure-ai-run", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-run-ai")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("configure-ai-run");
  });

  it("clicking Recipes navigates to recipes-list", () => {
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-recipes")!.click();
    expect(mockNav.navigate).toHaveBeenCalledWith("recipes-list");
  });

  it("clicking a tool button calls runTool with the correct function name", async () => {
    (services.runTool as jest.Mock).mockResolvedValue(undefined);
    const c = mountPanel();
    c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!.click();
    expect(services.runTool).toHaveBeenCalledWith("importDriveLinks");
  });

  it("tool button shows loading state while runTool is in flight", () => {
    let resolveRunTool!: () => void;
    (services.runTool as jest.Mock).mockReturnValue(new Promise<void>((r) => { resolveRunTool = r; }));
    const c = mountPanel();
    const btn = c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!;
    btn.click();
    expect(btn.classList.contains("loading")).toBe(true);
    expect(btn.textContent).toContain("Working...");
    resolveRunTool();
  });

  it("on runTool success: removes loading class and restores button text", async () => {
    (services.runTool as jest.Mock).mockResolvedValue(undefined);
    const c = mountPanel();
    const btn = c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!;
    const orig = btn.innerHTML;
    btn.click();
    await Promise.resolve();
    expect(btn.classList.contains("loading")).toBe(false);
    expect(btn.innerHTML).toBe(orig);
  });

  it("on runTool failure: alerts, removes loading class, restores button text", async () => {
    globalThis.alert = jest.fn();
    (services.runTool as jest.Mock).mockRejectedValue(new Error("Drive error"));
    const c = mountPanel();
    const btn = c.querySelector<HTMLButtonElement>("#btn-import-drive-links")!;
    const orig = btn.innerHTML;
    btn.click();
    await Promise.resolve();
    expect(globalThis.alert).toHaveBeenCalledWith("Error: Drive error");
    expect(btn.classList.contains("loading")).toBe(false);
    expect(btn.innerHTML).toBe(orig);
  });

  it("unmount() returns undefined", () => {
    document.body.innerHTML = '<div id="app"></div>';
    const panel = new ToolListPanel();
    panel.mount(document.getElementById("app")!, mockNav);
    expect(panel.unmount()).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/panels/tool-list.test.ts
```

**Step 3: Implement `src/client/panels/tool-list.ts`**

```ts
import type { NavigationContext, Panel } from "../types";
import { runTool } from "../services";

export class ToolListPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = this.template();
    this.wireEvents(container, nav);
  }

  unmount(): undefined {
    return undefined;
  }

  private wireEvents(container: HTMLElement, nav: NavigationContext): void {
    container.querySelector("#btn-run-ai")?.addEventListener("click", () => {
      nav.navigate("configure-ai-run");
    });
    container.querySelector("#btn-recipes")?.addEventListener("click", () => {
      nav.navigate("recipes-list");
    });
    container.querySelector("#btn-import-drive-links")?.addEventListener("click", (e) => {
      this.dispatchTool(e as MouseEvent, "importDriveLinks");
    });
    container.querySelector("#btn-sample-rows")?.addEventListener("click", (e) => {
      this.dispatchTool(e as MouseEvent, "sampleRowsToEvaluation");
    });
    container.querySelector("#btn-extract-text")?.addEventListener("click", (e) => {
      this.dispatchTool(e as MouseEvent, "extractTextFromSelection");
    });
  }

  private dispatchTool(e: MouseEvent, fn: string): void {
    const btn = e.currentTarget as HTMLButtonElement;
    const orig = btn.innerHTML;
    btn.classList.add("loading");
    btn.innerHTML = '<span class="icon">⏳</span> Working...';
    runTool(fn)
      .then(() => {
        btn.classList.remove("loading");
        btn.innerHTML = orig;
      })
      .catch((err: Error) => {
        alert("Error: " + err.message);
        btn.classList.remove("loading");
        btn.innerHTML = orig;
      });
  }

  private template(): string {
    return `
      <div class="guide-card">
        <a href="https://docs.google.com/document/d/1BQJzBHiE6L0hvU6NMD0jaQE71VWRpWH-vNQu3UtGjBA/edit?tab=t.66jobsqlduah#heading=h.h5k0s81xpiiq"
            target="_blank" class="guide-link">
          <span>📖</span> View User Guide ↗
        </a>
      </div>
      <div class="section">
        <h3>Main Tools</h3>
        <button id="btn-import-drive-links" class="tool-btn">
          <span class="icon">📂</span> Import Drive Links
        </button>
        <button id="btn-run-ai" class="tool-btn">
          <span class="icon">▶️</span> Run AI Inference
        </button>
        <button id="btn-recipes" class="tool-btn">
          <span class="icon">🥞</span> Recipes
        </button>
      </div>
      <div class="section">
        <h3>Extras</h3>
        <button id="btn-sample-rows" class="tool-btn">
          <span class="icon">🎲</span> Sample Rows
        </button>
        <button id="btn-extract-text" class="tool-btn">
          <span class="icon">📜</span> Extract Text
        </button>
      </div>
      <div class="status-footer">
        <strong>SSI Tools v2.0</strong><br>
        Powered by Gemini 2.0 Flash<br>
        Evaluation Unrestricted Mode
      </div>
    `;
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/panels/tool-list.test.ts
```

**Step 5: Commit**

```bash
git add src/client/panels/tool-list.ts __tests__/panels/tool-list.test.ts
git commit -m "feat: add ToolListPanel with navigate callbacks and tool dispatch"
```

---

## Task 10: ConfigureAIRun panel

**Files:**
- Create: `src/client/panels/configure-ai-run.ts`
- Create: `__tests__/panels/configure-ai-run.test.ts`

This is the most complex migration. The panel replaces `showAIPanel`, `runAI`, and `assembleRunConfig` from the old code.

### Saved state shape

```ts
// Used internally by ConfigureAIRunPanel
interface SavedState {
  userPromptCols: string[];
  driveFileCols: string[];
  systemPromptCol: string;  // "" = none selected
  outputCol: string;        // header name, "__new__" value (e.g. "my_col"), or ""
  rowRange?: { start: number; end: number };
}
```

`outputCol` stores the actual value: if the user typed "my_col" in the new column input, `outputCol` is `"my_col"` (not `"__new__"`). On restore, `SingleTagList` detects that `"my_col"` is not a known header and auto-selects `__new__` with the input pre-filled (see Task 6 design note).

### Step 1: Write the failing test

```ts
/**
 * @jest-environment jsdom
 */

jest.mock("../../src/client/services", () => ({
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
}));

import { ConfigureAIRunPanel } from "../../src/client/panels/configure-ai-run";
import * as services from "../../src/client/services";
import type { NavigationContext } from "../../src/client/types";
import type { RunConfig } from "../../src/shared/types";

const mockNav: NavigationContext = {
  navigate: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn().mockReturnValue(true),
};

function makeContainer(): HTMLElement {
  document.body.innerHTML = '<div id="app"></div>';
  return document.getElementById("app")!;
}

const DEFAULT_HEADERS = ["col_a", "col_b", "system_prompt", "ai_inference"];

async function mountAndLoad(
  params?: Partial<RunConfig>,
  savedState?: unknown,
  headers = DEFAULT_HEADERS,
): Promise<{ container: HTMLElement; panel: ConfigureAIRunPanel }> {
  (services.getSheetHeaders as jest.Mock).mockResolvedValue(headers);
  const container = makeContainer();
  const panel = new ConfigureAIRunPanel();
  panel.mount(container, mockNav, params, savedState as never);
  await Promise.resolve(); // flush the getSheetHeaders promise
  return { container, panel };
}

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.alert = jest.fn();
});

describe("ConfigureAIRunPanel — mount", () => {
  it("calls getSheetHeaders on mount", async () => {
    await mountAndLoad();
    expect(services.getSheetHeaders).toHaveBeenCalledTimes(1);
  });

  it("shows config-form after headers load", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector<HTMLElement>("#config-form")!.style.display).toBe("block");
  });

  it("shows no-headers-msg when headers list is empty", async () => {
    (services.getSheetHeaders as jest.Mock).mockResolvedValue([]);
    const container = makeContainer();
    const panel = new ConfigureAIRunPanel();
    panel.mount(container, mockNav);
    await Promise.resolve();
    expect(container.querySelector<HTMLElement>("#no-headers-msg")!.style.display).toBe("block");
    expect(container.querySelector<HTMLElement>("#config-form")!.style.display).not.toBe("block");
  });

  it("calls nav.back() on getSheetHeaders failure and alerts", async () => {
    (services.getSheetHeaders as jest.Mock).mockRejectedValue(new Error("Network error"));
    const container = makeContainer();
    const panel = new ConfigureAIRunPanel();
    panel.mount(container, mockNav);
    await Promise.resolve();
    expect(globalThis.alert).toHaveBeenCalledWith(expect.stringContaining("Network error"));
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("pre-selects params on mount", async () => {
    const { container } = await mountAndLoad({ userPromptCols: ["col_a"] });
    const selected = container.querySelectorAll("#user-prompt-cols .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("col_a");
  });

  it("restores savedState over params", async () => {
    const savedState = {
      userPromptCols: ["col_b"],
      driveFileCols: [],
      systemPromptCol: "",
      outputCol: "ai_inference",
    };
    const { container } = await mountAndLoad({ userPromptCols: ["col_a"] }, savedState);
    const selected = container.querySelectorAll("#user-prompt-cols .tag.selected");
    expect(selected[0].getAttribute("data-value")).toBe("col_b");
  });
});

describe("ConfigureAIRunPanel — Run AI", () => {
  it("alerts and does not call runBatchAI when no user prompt cols selected", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith(
      "Please select at least one User prompt column.",
    );
    expect(services.runBatchAI).not.toHaveBeenCalled();
  });

  it("alerts when no output column selected", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>('[data-value="col_a"]')!.click();
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    expect(globalThis.alert).toHaveBeenCalledWith("Please select an output column.");
  });

  it("disables run-btn and sets 'Running...' while in flight", async () => {
    (services.runBatchAI as jest.Mock).mockReturnValue(new Promise(() => {}));
    const { container } = await mountAndLoad({
      userPromptCols: ["col_a"],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    const btn = container.querySelector<HTMLButtonElement>("#run-btn")!;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe("Running...");
  });

  it("calls runBatchAI with correctly assembled RunConfig", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      userPromptCols: ["col_a"],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    expect(services.runBatchAI).toHaveBeenCalledWith(
      expect.objectContaining({ userPromptCols: ["col_a"], outputCol: "ai_inference" }),
    );
  });

  it("calls nav.back() on success", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      userPromptCols: ["col_a"],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("alerts and re-enables button on failure", async () => {
    (services.runBatchAI as jest.Mock).mockRejectedValue(new Error("API error"));
    const { container } = await mountAndLoad({
      userPromptCols: ["col_a"],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    expect(globalThis.alert).toHaveBeenCalledWith("Error: API error");
    const btn = container.querySelector<HTMLButtonElement>("#run-btn")!;
    expect(btn.disabled).toBe(false);
  });
});

describe("ConfigureAIRunPanel — back/cancel", () => {
  it("back-btn calls nav.back()", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#back-btn")!.click();
    expect(mockNav.back).toHaveBeenCalled();
  });

  it("cancel-btn calls nav.back()", async () => {
    const { container } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>("#cancel-btn")!.click();
    expect(mockNav.back).toHaveBeenCalled();
  });
});

describe("ConfigureAIRunPanel — unmount", () => {
  it("unmount() returns current form state as SavedState", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLButtonElement>('[data-value="col_a"]')!.click(); // user-prompt
    container
      .querySelectorAll<HTMLButtonElement>("#output-col .tag")[1]! // ai_inference
      .click();
    const state = panel.unmount();
    expect(state).not.toBeUndefined();
    expect((state as { userPromptCols: string[] }).userPromptCols).toContain("col_a");
  });

  it("unmount() before headers load returns undefined", () => {
    (services.getSheetHeaders as jest.Mock).mockReturnValue(new Promise(() => {}));
    const container = makeContainer();
    const panel = new ConfigureAIRunPanel();
    panel.mount(container, mockNav);
    expect(panel.unmount()).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts
```

**Step 3: Implement `src/client/panels/configure-ai-run.ts`**

```ts
import type { NavigationContext, Panel } from "../types";
import type { RunConfig } from "../../shared/types";
import { TagList } from "../components/tag-list";
import { SingleTagList } from "../components/single-tag-list";
import { RowRange } from "../components/row-range";
import { getSheetHeaders, runBatchAI } from "../services";

interface SavedState {
  userPromptCols: string[];
  driveFileCols: string[];
  systemPromptCol: string;
  outputCol: string;
  rowRange?: { start: number; end: number };
}

export class ConfigureAIRunPanel implements Panel<Partial<RunConfig>, SavedState> {
  private userPromptList: TagList | null = null;
  private driveFileList: TagList | null = null;
  private systemPromptList: SingleTagList | null = null;
  private outputColList: SingleTagList | null = null;
  private rowRangeComp: RowRange | null = null;
  private nav: NavigationContext | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    params?: Partial<RunConfig>,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.userPromptList = null; // reset so unmount() guards correctly before load
    container.innerHTML = this.template();
    this.wireNavButtons(container);

    const preset: Partial<RunConfig> = savedState
      ? {
          userPromptCols: savedState.userPromptCols,
          driveFileCols: savedState.driveFileCols.length ? savedState.driveFileCols : undefined,
          systemPromptCol: savedState.systemPromptCol || undefined,
          outputCol: savedState.outputCol || undefined,
          rowRange: savedState.rowRange,
        }
      : (params ?? {});

    getSheetHeaders()
      .then((headers) => {
        if (headers.length === 0) {
          container.querySelector<HTMLElement>("#no-headers-msg")!.style.display = "block";
          return;
        }

        this.userPromptList = new TagList(
          container.querySelector("#user-prompt-cols")!,
          headers,
          preset.userPromptCols ?? [],
        );
        this.driveFileList = new TagList(
          container.querySelector("#drive-file-cols")!,
          headers,
          preset.driveFileCols ?? [],
        );
        this.systemPromptList = new SingleTagList(
          container.querySelector("#system-prompt-col")!,
          headers,
          { selected: preset.systemPromptCol },
        );
        this.outputColList = new SingleTagList(
          container.querySelector("#output-col")!,
          headers,
          { includeNew: true, selected: preset.outputCol },
        );
        this.rowRangeComp = new RowRange(
          container.querySelector("#row-range-container")!,
          preset.rowRange,
        );

        container.querySelector<HTMLElement>("#config-form")!.style.display = "block";
        container
          .querySelector<HTMLButtonElement>("#run-btn")!
          .addEventListener("click", () => this.handleRun(container));
      })
      .catch((err: Error) => {
        alert("Error loading headers: " + err.message);
        nav.back();
      });
  }

  unmount(): SavedState | undefined {
    if (!this.userPromptList) return undefined;
    return {
      userPromptCols: this.userPromptList.getValue(),
      driveFileCols: this.driveFileList?.getValue() ?? [],
      systemPromptCol: this.systemPromptList?.getValue() ?? "",
      outputCol: this.outputColList?.getValue() ?? "",
      rowRange: this.rowRangeComp?.getValue(),
    };
  }

  private wireNavButtons(container: HTMLElement): void {
    container.querySelector("#back-btn")?.addEventListener("click", () => this.nav?.back());
    container.querySelector("#cancel-btn")?.addEventListener("click", () => this.nav?.back());
  }

  private handleRun(container: HTMLElement): void {
    const config = this.assembleRunConfig();
    if (!config) return;

    const btn = container.querySelector<HTMLButtonElement>("#run-btn")!;
    btn.disabled = true;
    btn.textContent = "Running...";

    runBatchAI(config)
      .then(() => {
        btn.disabled = false;
        btn.textContent = "Run AI";
        this.nav?.back();
      })
      .catch((err: Error) => {
        alert("Error: " + err.message);
        btn.disabled = false;
        btn.textContent = "Run AI";
      });
  }

  private assembleRunConfig(): RunConfig | null {
    const userPromptCols = this.userPromptList?.getValue() ?? [];
    if (userPromptCols.length === 0) {
      alert("Please select at least one User prompt column.");
      return null;
    }

    const driveFileCols = this.driveFileList?.getValue() ?? [];
    const systemPromptCol = this.systemPromptList?.getValue() || undefined;
    const outputCol = this.outputColList?.getValue() ?? "";

    if (!outputCol) {
      alert("Please select an output column.");
      return null;
    }

    const rowRange = this.rowRangeComp?.getValue();

    return {
      userPromptCols,
      driveFileCols: driveFileCols.length > 0 ? driveFileCols : undefined,
      systemPromptCol,
      outputCol,
      rowRange,
    };
  }

  private template(): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">Configure AI Run</span>
      </div>
      <div id="no-headers-msg" class="no-headers-msg" style="display:none">
        No columns found — add headers to your sheet first.
      </div>
      <div id="config-form" style="display:none">
        <div class="field-group">
          <span class="field-label">User prompt columns <span class="required">*</span></span>
          <div id="user-prompt-cols" class="tag-list"></div>
        </div>
        <div class="field-group">
          <span class="field-label">Drive file columns <span class="optional">(optional)</span></span>
          <div id="drive-file-cols" class="tag-list"></div>
        </div>
        <div class="field-group">
          <span class="field-label">System prompt column <span class="optional">(optional)</span></span>
          <div id="system-prompt-col" class="tag-list"></div>
        </div>
        <div class="field-group">
          <span class="field-label">Output column <span class="required">*</span></span>
          <div id="output-col" class="tag-list"></div>
        </div>
        <div class="field-group">
          <span class="field-label">Rows to process</span>
          <div id="row-range-container"></div>
        </div>
        <div class="panel-buttons">
          <button id="cancel-btn" class="btn-cancel">Cancel</button>
          <button id="run-btn" class="btn-run">Run AI</button>
        </div>
      </div>
    `;
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts
```

**Step 5: Run all tests to ensure nothing broke**

```bash
npm test
```

**Step 6: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "feat: add ConfigureAIRunPanel with component-based form, savedState, and Promise-based GAS calls"
```

---

## Task 11: RecipesList stub panel

**Files:**
- Create: `src/client/panels/recipes-list.ts`

No tests for a stub. The panel renders a list of recipe buttons and navigates directly to the recipe panel on click.

```ts
import type { NavigationContext, Panel } from "../types";

export class RecipesListPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = this.template();
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    container
      .querySelector("#btn-document-summarization")
      ?.addEventListener("click", () => nav.navigate("document-summarization"));
  }

  unmount(): undefined {
    return undefined;
  }

  private template(): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">🥞 Recipes</span>
      </div>
      <div class="section">
        <button id="btn-document-summarization" class="tool-btn">
          <span class="icon">📄</span> Document Summarization
          <span class="tool-btn-sub">Summarize each file in a Google Drive folder</span>
        </button>
      </div>
    `;
  }
}
```

**Commit:**

```bash
git add src/client/panels/recipes-list.ts
git commit -m "feat: add RecipesListPanel stub navigating to document-summarization"
```

---

## Task 12: DocumentSummarization stub panel

**Files:**
- Create: `src/client/panels/recipes/document-summarization.ts`

```ts
import type { NavigationContext, Panel } from "../../types";

export class DocumentSummarizationPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">Document Summarization</span>
      </div>
      <div class="section">
        <p>Coming soon.</p>
      </div>
    `;
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
  }

  unmount(): undefined {
    return undefined;
  }
}
```

**Commit:**

```bash
git add src/client/panels/recipes/document-summarization.ts
git commit -m "feat: add DocumentSummarizationPanel stub"
```

---

## Task 13: Integration — Sidebar.html + sidebar-entry.ts

**Files:**
- Modify: `src/Sidebar.html`
- Modify: `src/client/sidebar-entry.ts`

### Step 1: Simplify `src/Sidebar.html`

Replace the entire file with the minimal shell:

```html
<!DOCTYPE html>
<html>

<head>
    <base target="_top">
    {{STYLES}}
</head>

<body>
    <div id="app" class="container"></div>
    {{SCRIPTS}}
</body>

</html>
```

### Step 2: Replace `src/client/sidebar-entry.ts`

```ts
/**
 * GAS-coupled entry point for the sidebar.
 *
 * Instantiates all panels, creates the Router, and starts on tool-list.
 * All google.script.run calls are in services.ts.
 * All DOM manipulation is in panel and component classes.
 */

import { Router } from "./router";
import { ToolListPanel } from "./panels/tool-list";
import { ConfigureAIRunPanel } from "./panels/configure-ai-run";
import { RecipesListPanel } from "./panels/recipes-list";
import { DocumentSummarizationPanel } from "./panels/recipes/document-summarization";
import type { Panel, PanelId } from "./types";

function init(): void {
  const app = document.getElementById("app");
  if (!app) return;

  const panels = new Map<PanelId, Panel>([
    ["tool-list", new ToolListPanel()],
    ["configure-ai-run", new ConfigureAIRunPanel()],
    ["recipes-list", new RecipesListPanel()],
    ["document-summarization", new DocumentSummarizationPanel()],
  ]);

  const router = new Router(app, panels);
  router.start("tool-list");
}

init();
```

### Step 3: Build and verify no compile errors

```bash
npm run build
```
Expected: clean build, `dist/Sidebar.html` generated with inlined script/CSS.

### Step 4: Run all tests

```bash
npm test
```

Old tests (`sidebar.test.ts`, `sidebar-entry.test.ts`) will now fail because the functions they import no longer exist. That is expected — they are removed in Task 14.

### Step 5: Commit (even with old test failures — they're being cleaned up next)

```bash
git add src/Sidebar.html src/client/sidebar-entry.ts
git commit -m "feat: integrate router into sidebar-entry.ts; simplify Sidebar.html to app shell"
```

---

## Task 14: Cleanup — delete old files and update coverage config

**Files:**
- Delete: `src/client/sidebar.ts`
- Delete: `__tests__/sidebar.test.ts`
- Delete: `__tests__/sidebar-entry.test.ts`
- Delete: `__tests__/helpers/sidebar-fixtures.ts`
- Modify: `jest.config.cjs`
- Modify: `tsconfig.client.json`

### Step 1: Delete obsolete source and test files

```bash
rm src/client/sidebar.ts
rm __tests__/sidebar.test.ts
rm __tests__/sidebar-entry.test.ts
rm __tests__/helpers/sidebar-fixtures.ts
```

### Step 2: Update `jest.config.cjs`

Remove the now-obsolete transform entries for deleted files and update coverage thresholds. Remove the old `sidebar.ts` and `sidebar-entry.ts` thresholds; add thresholds for the new files:

```js
// Remove these two transform entries:
// "^.+/__tests__/sidebar\\.test\\.ts$": ...
// "^.+/__tests__/sidebar-entry\\.test\\.ts$": ...

// Update collectCoverageFrom — sidebar-entry.ts is now nearly empty (init() only),
// so exclude it along with index.ts:
collectCoverageFrom: [
  "src/**/*.ts",
  "!src/server/index.ts",
  "!src/client/sidebar-entry.ts",
],

// Replace old client thresholds with new ones:
"./src/client/router.ts": { statements: 90, branches: 85, functions: 100 },
"./src/client/services.ts": { statements: 90, branches: 80, functions: 100 },
"./src/client/components/tag-list.ts": { statements: 95, branches: 90, functions: 100 },
"./src/client/components/single-tag-list.ts": { statements: 90, branches: 85, functions: 95 },
"./src/client/components/row-range.ts": { statements: 90, branches: 85, functions: 100 },
"./src/client/components/lockable-field.ts": { statements: 95, branches: 90, functions: 100 },
"./src/client/panels/tool-list.ts": { statements: 85, branches: 75, functions: 90 },
"./src/client/panels/configure-ai-run.ts": { statements: 85, branches: 75, functions: 90 },
```

### Step 3: Update `tsconfig.client.json`

Remove the deleted test file entries:

```json
"include": [
  "src/client/**/*.ts",
  "src/shared/**/*.ts",
  "__tests__/helpers/*.ts",
  "__tests__/components/**/*.ts",
  "__tests__/panels/**/*.ts"
]
```

Note: `__tests__/helpers/` still appears because the directory may hold future helpers. If it is now empty, you can remove that entry too.

### Step 4: Run all tests

```bash
npm test
```
Expected: all passing.

### Step 5: Run coverage

```bash
npm run test:coverage
```
Expected: all per-file thresholds met.

### Step 6: Run typecheck

```bash
npm run typecheck
```

### Step 7: Commit

```bash
git add -A
git commit -m "chore: remove sidebar.ts and old tests; update jest config and tsconfig for new client structure"
```

---

## Final checklist before PR

- [ ] `npm run build` — clean build
- [ ] `npm test` — all pass
- [ ] `npm run test:coverage` — all thresholds met
- [ ] `npm run typecheck` — no errors
- [ ] `npm run lint` — no warnings
- [ ] Manual smoke test: open sidebar, navigate to Configure AI Run, press Back, navigate to Recipes
