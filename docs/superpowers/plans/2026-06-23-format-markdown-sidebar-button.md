# Format Markdown Sidebar Button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Format Markdown entry point from the SSI Toolkit menu to a button in the sidebar's existing Extras section.

**Architecture:** Remove the `addItem` call from `onOpen()`, add a `formatMarkdownSelection` service wrapper in `services.ts` and type declaration in `google.d.ts`, and add the button + click handler to `tool-list.ts`. The server function itself is untouched. The rollup stub stays — `google.script.run` needs it to resolve the function.

**Tech Stack:** TypeScript, Google Apps Script (`google.script.run`), Jest + jsdom

## Global Constraints

- Client-side code only calls `google.script.run` from `services.ts` — never directly from panels
- Named exports only; no default exports
- `npm test` must pass (496 tests)
- `npm run typecheck` must pass

---

## File Map

| File | Change |
|---|---|
| `src/server/index.ts` | Remove `"📝 Format Markdown"` addItem from `onOpen()` |
| `src/client/google.d.ts` | Add `formatMarkdownSelection(): void` to `GoogleScriptRun` |
| `src/client/services.ts` | Add `formatMarkdownSelection(): Promise<void>` |
| `src/client/panels/tool-list.ts` | Add button to Extras section; import + wire click handler |
| `__tests__/menu.test.ts` | Revert to 1 addItem assertion; remove Format Markdown assertion |
| `__tests__/services.test.ts` | Add `formatMarkdownSelection` to mockRun; add 2 new tests |
| `__tests__/panels/tool-list.test.ts` | Add `formatMarkdownSelection` to services mock; add 1 new test |

---

## Task 1: Move entry point from menu to sidebar button

All changes land in one commit — they are a single deliverable.

**Files:**
- Modify: `src/server/index.ts`
- Modify: `src/client/google.d.ts`
- Modify: `src/client/services.ts`
- Modify: `src/client/panels/tool-list.ts`
- Test: `__tests__/menu.test.ts`
- Test: `__tests__/services.test.ts`
- Test: `__tests__/panels/tool-list.test.ts`

**Interfaces:**
- Produces: `formatMarkdownSelection(): Promise<void>` in `src/client/services.ts`
- Produces: `#btn-format-markdown` button in tool-list Extras section

---

- [ ] **Step 1: Write failing test for the new service function**

In `__tests__/services.test.ts`, add `formatMarkdownSelection` to the `mockRun` object (around line 8):

```typescript
const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  getSheetHeaders: jest.fn(),
  getActiveRangeInfo: jest.fn(),
  runBatchAI: jest.fn(),
  runTool: jest.fn(),
  prepRecipe: jest.fn(),
  getJobProgress: jest.fn(),
  importDriveLinks: jest.fn(),
  extractText: jest.fn(),
  formatMarkdownSelection: jest.fn(),
};
```

Then add a new `describe` block at the bottom of `__tests__/services.test.ts`:

```typescript
describe("formatMarkdownSelection", () => {
  it("calls google.script.run.formatMarkdownSelection and resolves", async () => {
    const handlers = captureHandlers();
    const promise = services.formatMarkdownSelection();
    handlers.resolve(undefined);
    await expect(promise).resolves.toBeUndefined();
    expect(mockRun.formatMarkdownSelection).toHaveBeenCalledTimes(1);
  });

  it("rejects when the RPC fails", async () => {
    const handlers = captureHandlers();
    const promise = services.formatMarkdownSelection();
    handlers.reject(new Error("GAS error"));
    await expect(promise).rejects.toThrow("GAS error");
  });
});
```

- [ ] **Step 2: Write failing test for the tool-list button**

In `__tests__/panels/tool-list.test.ts`, update the services mock at line 5 to include `formatMarkdownSelection`:

```typescript
jest.mock("../../src/client/services", () => ({
  runTool: jest.fn(),
  formatMarkdownSelection: jest.fn(),
}));
```

Add a new test inside the existing `describe("ToolListPanel", ...)` block, after the Extract Text test:

```typescript
it("clicking Format Markdown calls services.formatMarkdownSelection", () => {
  (services.formatMarkdownSelection as jest.Mock).mockResolvedValue(undefined);
  const c = mountPanel();
  c.querySelector<HTMLButtonElement>("#btn-format-markdown")!.click();
  expect(services.formatMarkdownSelection).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 3: Run tests to confirm the 3 new tests fail**

```bash
npx jest __tests__/services.test.ts __tests__/panels/tool-list.test.ts --no-coverage
```

Expected: 3 failures — the 2 service tests and 1 tool-list test (functions not yet implemented).

- [ ] **Step 4: Update the menu test to expect 1 item (not 2)**

In `__tests__/menu.test.ts`, find and replace the test that currently asserts 2 items:

```typescript
it("adds menu items for Open Toolkit and Format Markdown", () => {
  onOpen();
  expect(mockAddItem).toHaveBeenCalledTimes(2);
  expect(mockAddItem).toHaveBeenCalledWith("📐 Open SSI Toolkit", "showSidebar");
  expect(mockAddItem).toHaveBeenCalledWith("📝 Format Markdown", "formatMarkdownSelection");
});
```

Replace with:

```typescript
it("adds a single item that opens the sidebar", () => {
  onOpen();
  expect(mockAddItem).toHaveBeenCalledTimes(1);
  expect(mockAddItem).toHaveBeenCalledWith("📐 Open SSI Toolkit", "showSidebar");
});
```

- [ ] **Step 5: Remove the menu item from `onOpen()` in `index.ts`**

Find `onOpen` in `src/server/index.ts`:

```typescript
export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("📐 SSI Toolkit")
    .addItem("📐 Open SSI Toolkit", "showSidebar")
    .addItem("📝 Format Markdown", "formatMarkdownSelection")
    .addToUi();
}
```

Replace with:

```typescript
export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("📐 SSI Toolkit")
    .addItem("📐 Open SSI Toolkit", "showSidebar")
    .addToUi();
}
```

- [ ] **Step 6: Add `formatMarkdownSelection` to `google.d.ts`**

In `src/client/google.d.ts`, add one line to `GoogleScriptRun` after `getActiveRangeInfo(): void;`:

```typescript
formatMarkdownSelection(): void;
```

The interface should now end with:

```typescript
    getJobProgress(jobId: string): void;
    getActiveRangeInfo(): void;
    formatMarkdownSelection(): void;
  }
```

- [ ] **Step 7: Add the service function to `services.ts`**

In `src/client/services.ts`, add at the end of the file:

```typescript
export function formatMarkdownSelection(): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .formatMarkdownSelection();
  });
}
```

- [ ] **Step 8: Add the button and wire the click handler in `tool-list.ts`**

In `src/client/panels/tool-list.ts`, update the import to include `formatMarkdownSelection`:

```typescript
import { runTool, formatMarkdownSelection } from "../services";
```

In `wireEvents`, add after the Extract Text handler:

```typescript
container.querySelector("#btn-format-markdown")?.addEventListener("click", () => {
  formatMarkdownSelection().catch((err: Error) => globalThis.alert("Error: " + err.message));
});
```

In `template()`, add the button after `#btn-extract-text` inside the Extras `<div class="section">`:

```html
<button id="btn-format-markdown" class="tool-btn">
  <span class="icon">📝</span> Format Markdown
</button>
```

The full Extras section should read:

```typescript
      <div class="section">
        <h3>Extras</h3>
        <button id="btn-import-drive-links" class="tool-btn">
          <span class="icon">📂</span> Import Drive Links
        </button>
        <button id="btn-sample-rows" class="tool-btn">
          <span class="icon">🎲</span> Sample Rows
        </button>
        <button id="btn-extract-text" class="tool-btn">
          <span class="icon">📜</span> Extract Text
        </button>
        <button id="btn-format-markdown" class="tool-btn">
          <span class="icon">📝</span> Format Markdown
        </button>
      </div>
```

- [ ] **Step 9: Run targeted tests to confirm all pass**

```bash
npx jest __tests__/services.test.ts __tests__/panels/tool-list.test.ts __tests__/menu.test.ts --no-coverage
```

Expected: all tests pass including the 3 new ones.

- [ ] **Step 10: Run typecheck**

```bash
npm run typecheck
```

Expected: clean output, no errors.

- [ ] **Step 11: Run full test suite**

```bash
npm test
```

Expected: 499 tests pass across 31 suites.

- [ ] **Step 12: Commit**

```bash
git add src/server/index.ts src/client/google.d.ts src/client/services.ts src/client/panels/tool-list.ts __tests__/menu.test.ts __tests__/services.test.ts __tests__/panels/tool-list.test.ts
git commit -m "feat: move Format Markdown from menu item to sidebar Extras button"
```
