# Column Label Prefix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an opt-in `prefixWithColName` flag that prepends each text prompt part with its source column name in the format `"<label>: <value>"` before sending to Gemini.

**Architecture:** Two server-side type changes + one inference behavior change + one panel checkbox. Full detail in `docs/plans/2026-04-14-column-label-prefix-design.md`.

**Tech Stack:** TypeScript, Jest, DOM APIs

**Design spec:** `docs/plans/2026-04-14-column-label-prefix-design.md`

---

### Task 1: `PromptInput.label` + `runInference` prefixing

**Context:** `PromptInput` (`src/server/types.ts:134`) is the server-only type that carries a raw cell value plus its `kind` into `runInference`. Adding an optional `label?: string` field lets callers declare a prefix without `runInference` knowing where it came from. `runInference` (`src/server/inference.ts:36–49`) already iterates inputs and maps text values to `{ text }` parts via `flattenArg` — the prefix is applied there, producing `"${label}: ${text}"`. File inputs produce `{ inline_data }` parts and are unaffected.

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/server/inference.ts`
- Modify: `__tests__/inference.test.ts`

**Step 1: Run existing inference tests to confirm baseline**

```bash
npx jest __tests__/inference.test.ts --no-coverage
```

Expected: all pass.

**Step 2: Write failing tests**

Add a new `describe("label prefix", ...)` block inside the existing `describe("runInference", ...)` in `__tests__/inference.test.ts`, just before the closing `});`:

```ts
describe("label prefix", () => {
  it("prefixes a text part with the label and a colon-space separator", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "hello", label: "Summary" }]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts[0].text).toBe("Summary: hello");
  });

  it("prefixes every part when a labeled input flattens to multiple texts", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: [["first"], ["second"]], label: "Notes" }]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts[0].text).toBe("Notes: first");
    expect(payload.contents[0].parts[1].text).toBe("Notes: second");
  });

  it("does not prefix text parts when label is absent", () => {
    mockOkResponse("ok");
    runInference([{ kind: "text", value: "hello" }]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts[0].text).toBe("hello");
  });

  it("does not prefix file parts when label is set", () => {
    mockOkResponse("ok");
    runInference([
      { kind: "text", value: "prompt" },
      { kind: "file", value: "https://drive.google.com/file/d/abc123/view", label: "Attachment" },
    ]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts[1].inline_data).toBeDefined();
    expect(payload.contents[0].parts[1].text).toBeUndefined();
  });
});
```

**Step 3: Run new tests to confirm they fail**

```bash
npx jest __tests__/inference.test.ts --no-coverage -t "label prefix"
```

Expected: all 4 tests FAIL with a TypeScript compile error (unknown `label` property on `PromptInput`).

**Step 4: Add `label` to `PromptInput` in `server/types.ts`**

In `src/server/types.ts`, update the `PromptInput` type:

```ts
export type PromptInput = {
  kind: PromptColumnSpec["kind"];
  value: unknown;
  /** Optional label prepended to text parts as "<label>: <value>". Ignored for file inputs. */
  label?: string;
};
```

**Step 5: Run new tests again — confirm they still fail (now for the right reason)**

```bash
npx jest __tests__/inference.test.ts --no-coverage -t "label prefix"
```

Expected: tests now compile but fail because `runInference` does not yet apply the prefix.

**Step 6: Apply prefix in `runInference`**

In `src/server/inference.ts`, update the `kind === "text"` branch:

```ts
if (input.kind === "text") {
  const texts = flattenArg(input.value);
  const parts = input.label
    ? texts.map((text) => ({ text: `${input.label}: ${text}` }))
    : texts.map((text) => ({ text }));
  userParts.push(...parts);
}
```

**Step 7: Run new tests to confirm they pass**

```bash
npx jest __tests__/inference.test.ts --no-coverage
```

Expected: all pass, including the 4 new label prefix tests.

**Step 8: Commit**

```bash
git add src/server/types.ts src/server/inference.ts __tests__/inference.test.ts
git commit -m "feat: prepend label to text parts in runInference when PromptInput.label is set"
```

---

### Task 2: `RunConfig.prefixWithColName` + `runBatchAI` label forwarding

**Context:** `RunConfig` (`src/shared/types.ts`) is the RPC boundary. Adding `prefixWithColName?: boolean` here makes the flag available both client-side (for the checkbox) and server-side (for `runBatchAI`). In `runBatchAI` (`src/server/index.ts:345`), the `PromptInput[]` is assembled with `{ kind: pc.kind, value: row[promptIdxs[i]] }` — when `config.prefixWithColName` is true, `label: pc.col` is added to each entry. `index.ts` is excluded from unit test coverage, so no new tests are written for this task; typecheck is the verification gate.

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/index.ts`

**Step 1: Add `prefixWithColName` to `RunConfig`**

In `src/shared/types.ts`, add the field to `RunConfig`:

```ts
export interface RunConfig {
  promptCols: PromptColumnSpec[];
  systemPromptCol?: string;
  outputCol: string;
  rowRange?: { start: number; end: number };
  tools?: ToolId[];
  includeGrounding?: boolean;
  applyMarkdown?: boolean;
  /** When true, each text prompt part is prefixed with its source column name as "<col>: <value>". */
  prefixWithColName?: boolean;
}
```

**Step 2: Forward `label` in `runBatchAI`**

In `src/server/index.ts`, update the `promptInputs` assembly at line 345:

```ts
const promptInputs: PromptInput[] = config.promptCols.map((pc, i) => ({
  kind: pc.kind,
  value: row[promptIdxs[i]],
  ...(config.prefixWithColName ? { label: pc.col } : {}),
}));
```

**Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

**Step 4: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all pass.

**Step 5: Commit**

```bash
git add src/shared/types.ts src/server/index.ts
git commit -m "feat: add prefixWithColName to RunConfig and forward label in runBatchAI"
```

---

### Task 3: `ConfigureAIRunPanel` checkbox

**Context:** `ConfigureAIRunPanel` (`src/client/panels/configure-ai-run.ts`) has an established pattern for boolean run options: `applyMarkdown` and `includeGrounding` are each a private `HTMLInputElement | null` field, wired in `mount()`, read in `assembleRunConfig()`, saved in `unmount()`, and restored in `mount()` via `preset`. `SavedState` omits optional `RunConfig` booleans from `Required<>` and re-adds them via `Pick<>` to keep them optional. `prefixWithColName` follows the same pattern exactly.

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Modify: `__tests__/panels/configure-ai-run.test.ts`

**Step 1: Run existing panel tests to confirm baseline**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts --no-coverage
```

Expected: all pass.

**Step 2: Write failing tests**

Add a new `describe` block to `__tests__/panels/configure-ai-run.test.ts`:

```ts
describe("prefixWithColName checkbox", () => {
  it("renders the prefix-col-name checkbox", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector("#prefix-col-name-cb")).not.toBeNull();
  });

  it("assembleRunConfig includes prefixWithColName: true when checkbox is checked", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLInputElement>("#prefix-col-name-cb")!.checked = true;
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    const config = (services.runBatchAI as jest.Mock).mock.calls[0]?.[0] as RunConfig | undefined;
    expect(config?.prefixWithColName).toBe(true);
  });

  it("assembleRunConfig omits prefixWithColName when checkbox is unchecked", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLInputElement>("#prefix-col-name-cb")!.checked = false;
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    const config = (services.runBatchAI as jest.Mock).mock.calls[0]?.[0] as RunConfig | undefined;
    expect(config?.prefixWithColName).toBeUndefined();
  });

  it("unmount saves prefixWithColName state", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLInputElement>("#prefix-col-name-cb")!.checked = true;
    addPromptCol(container, "col_a");
    const saved = panel.unmount();
    expect(saved?.prefixWithColName).toBe(true);
  });

  it("restores prefixWithColName from savedState", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_a", kind: "text" as const }],
      systemPromptCol: "",
      outputCol: "ai_inference",
      prefixWithColName: true,
    });
    expect(container.querySelector<HTMLInputElement>("#prefix-col-name-cb")!.checked).toBe(true);
  });
});
```

**Step 3: Run new tests to confirm they fail**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts --no-coverage -t "prefixWithColName"
```

Expected: all 5 tests FAIL (`#prefix-col-name-cb` not found in DOM).

**Step 4: Add `prefixWithColNameCb` field to `ConfigureAIRunPanel`**

Add a private field alongside the other checkbox fields:

```ts
private prefixWithColNameCb: HTMLInputElement | null = null;
```

**Step 5: Update `SavedState` type**

Add `prefixWithColName` to the `Omit` and `Pick` lists so it stays optional in `SavedState` (same pattern as `applyMarkdown`):

```ts
export type SavedState = Required<
  Omit<RunConfig, "rowRange" | "tools" | "includeGrounding" | "applyMarkdown" | "prefixWithColName">
> &
  Pick<RunConfig, "rowRange" | "tools" | "includeGrounding" | "applyMarkdown" | "prefixWithColName"> & {
    toolsExpanded?: boolean;
  };
```

**Step 6: Wire checkbox in `mount()`**

After the `applyMarkdownCb` wiring block, add:

```ts
this.prefixWithColNameCb = container.querySelector<HTMLInputElement>("#prefix-col-name-cb");
if (this.prefixWithColNameCb && preset.prefixWithColName) {
  this.prefixWithColNameCb.checked = true;
}
```

**Step 7: Read checkbox in `assembleRunConfig()`**

After the `applyMarkdown` line, add:

```ts
const prefixWithColName = this.prefixWithColNameCb?.checked ?? false;
```

And include it in the returned object:

```ts
prefixWithColName: prefixWithColName || undefined,
```

**Step 8: Save in `unmount()`**

Add to the returned `SavedState` object alongside `applyMarkdown`:

```ts
prefixWithColName: this.prefixWithColNameCb?.checked ?? false,
```

**Step 9: Add to `currentPreset()`**

```ts
prefixWithColName: this.prefixWithColNameCb?.checked,
```

**Step 10: Add checkbox to `template()`**

Place it directly below the `apply-markdown-cb` label inside the Output Column field group:

```html
<label class="checkbox-option">
  <input type="checkbox" id="prefix-col-name-cb" />
  <span>Prefix parts with column name</span>
</label>
```

**Step 11: Run new tests to confirm they pass**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts --no-coverage -t "prefixWithColName"
```

Expected: all 5 pass.

**Step 12: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: all pass.

**Step 13: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "feat: add prefixWithColName checkbox to ConfigureAIRunPanel"
```

---

## Verification

After all three tasks are committed:

```bash
npm run build
npm run typecheck
npm test
```

Confirm:
1. `runInference` test suite includes 4 passing label prefix tests
2. `configure-ai-run` test suite includes 5 passing prefixWithColName tests
3. Build and typecheck clean
