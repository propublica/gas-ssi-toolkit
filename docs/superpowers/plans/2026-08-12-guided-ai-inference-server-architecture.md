# Guided AI Inference — Server Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the server-side and RPC-boundary changes specified in `docs/superpowers/specs/2026-08-12-guided-ai-inference-server-architecture-design.md` — per-cell Drive-link auto-detection (`PromptColumnSpec.kind: "auto"`), unconditional XML-tag prompt wrapping (replacing `prefixWithColName`), and a new `getDefaultRowRange` RPC — so a future guided-flow client panel can be built entirely on top of existing `prepRecipe`/`runBatchAI` plumbing.

**Architecture:** Widen three existing pipeline pieces (`PromptColumnSpec`/`PromptInput`'s `kind` union, `RunConfig`'s label-style field, `buildUserParts`'s per-input classification) rather than building parallel structures. Add one new pure helper (`sanitizeTagName`) and one new small RPC (`getDefaultRowRange`). The one existing client consumer of the changed shared fields (`ConfigureAIRunPanel`) is updated in the *same task* as the shared-type rename — see the pre-commit-hook note in Global Constraints for why this can't be split into separate tasks.

**Tech Stack:** TypeScript (ES2019 target), Jest + ts-jest, Google Apps Script (`clasp`), Rollup.

## Global Constraints

- Named exports only — no default exports (Google TypeScript Style Guide, enforced by ESLint).
- `const` by default, no `var`, no `namespace`. `===` always. Avoid `any` — prefer `unknown`.
- Explicit return types on functions (ESLint warning).
- Double quotes, semicolons, trailing commas (Prettier-enforced — run `npm run format` if unsure).
- Prefix unused parameters with `_`.
- Server code (`src/server/**`, `src/shared/**`) must not reference DOM globals or Node.js built-ins. `google-apps-script` global types (`SpreadsheetApp`, `DriveApp`, etc.) are ambient.
- Mock GAS globals (`UrlFetchApp`, `PropertiesService`, `DriveApp`, `SpreadsheetApp`, etc.) on `globalThis` **before** importing the module under test — imports execute immediately in this codebase's test files.
- **This repo's pre-commit hook runs the full test suite (`npx jest --bail`) before every commit — never use `git commit --no-verify` to bypass a failing suite, and never touch files outside the ones a task's Files section names.** If a task's own commit would fail the hook through no fault of your changes, that means the task is scoped wrong — stop and report it (`NEEDS_CONTEXT`/`BLOCKED`) rather than working around it. This is exactly why the shared-type rename and its one client consumer are one task below, not two: splitting them would leave an intermediate commit that fails the hook.
- Run `npm test` after every task; run `npm run typecheck` and `npm run lint` at minimum after any task touching `src/shared/**` (the RPC boundary) since a type error there silently breaks both server and client compilation.
- Every commit in this plan must leave the full `npm test` suite green — no task depends on a later task's fix landing first.

---

## File Map

| File | Change |
| --- | --- |
| `src/shared/types.ts` | `PromptColumnSpec.kind` gains `"auto"`; `RunConfig.prefixWithColName` removed, `RunConfig.wrapPromptsInTags` added; `RunStatsConfigSnapshot` Pick list updated |
| `src/shared/run-stats.ts` | `buildConfigSnapshot` field rename + default flip (`false` → `true`) |
| `src/client/panels/configure-ai-run.ts` | Rename `prefixWithColName` → `wrapPromptsInTags` throughout, checkbox now defaults checked |
| `src/client/types.ts` | `RecipeSettings` Pick list updated |
| `src/client/components/prompt-col-list.ts` | Local `kind` type decoupled from the shared union (`PROMPT_KINDS` re-typed, one constructor-site guard) — no UI/behavior change |
| `src/server/utils.ts` | New `sanitizeTagName` pure helper |
| `src/server/inference.ts` | `buildUserParts` gains an `"auto"` classification branch and tag-wrapping; `buildInferenceRequest` gains a `wrapPromptsInTags` parameter |
| `src/server/index.ts` | `runBatchAI`'s `label` assignment (Task 1) and `buildInferenceRequest` call site (Task 3) updated to keep compiling; Wave-1 file-detection widened to treat `"auto"` like `"file"`, new `getDefaultRowRange` export (Task 4) |
| `src/client/services.ts` | New `getDefaultRowRange` RPC wrapper |
| `src/client/google.d.ts` | New `getDefaultRowRange` declaration |
| `rollup.config.js` | New `getDefaultRowRange` global stub in the footer |
| `__tests__/run-stats.test.ts`, `__tests__/panels/configure-ai-run.test.ts`, `__tests__/utils.test.ts`, `__tests__/services.test.ts`, `__tests__/inference.test.ts`, `__tests__/menu.test.ts` | Updated/new tests for the above |

---

### Task 1: Shared type changes — `wrapPromptsInTags` replaces `prefixWithColName`, `kind` gains `"auto"`, plus every consumer needed to keep the repo compiling

**Files:**
- Modify: `src/shared/types.ts:32-35` (`PromptColumnSpec`), `src/shared/types.ts:57-61` (`RunConfig.prefixWithColName`), `src/shared/types.ts:113-116` (`RunStatsConfigSnapshot`)
- Modify: `src/shared/run-stats.ts:22`
- Modify: `src/client/panels/configure-ai-run.ts` (lines 29-37, 52, 88, 109-112, 268, 321, 545, 555, 587-590)
- Modify: `src/client/types.ts:46-49` (`RecipeSettings`)
- Modify: `src/server/index.ts:392-398` (one hunk only — the `label` line; nothing else in this file)
- Modify: `src/client/components/prompt-col-list.ts:4` and `:33-35` (two small hunks only — a local type narrowing, not new behavior)
- Test: `__tests__/run-stats.test.ts`
- Test: `__tests__/panels/configure-ai-run.test.ts`
- Test: `__tests__/utils.test.ts:347` (one-line fixture rename)
- Test: `__tests__/services.test.ts:140,173` (two-line fixture rename)

**Interfaces:**
- Produces: `PromptColumnSpec.kind: "text" | "file" | "auto"`; `RunConfig.wrapPromptsInTags?: boolean` (absent = `true`); `RunStatsConfigSnapshot` picks `wrapPromptsInTags` instead of `prefixWithColName`; `buildConfigSnapshot(config).wrapPromptsInTags` defaults to `true`; `ConfigureAIRunPanel`'s checkbox element `#wrap-prompts-in-tags-cb` (was `#prefix-col-name-cb`), defaulting to checked.

This task is one atomic unit for a specific reason: the repo's pre-commit hook runs the whole test suite, so every file that would otherwise fail to compile because of this task's two type changes has to land in the same commit. That turned out to be **more than just `ConfigureAIRunPanel`** — a first attempt at this task scoped to only `ConfigureAIRunPanel` got `BLOCKED` when it discovered two more real consumers. This version's Files list above is the complete, verified set: `src/server/index.ts:396` reads `config.prefixWithColName` directly, and `src/client/components/prompt-col-list.ts` declares its own local `"text" | "file"` union that the widened `kind` type doesn't satisfy anymore (lines 34 and 86 in the original file, before this task's edit) — a real, mechanical type error, not a stray old-name reference, and not something you're expected to expose `"auto"` in the UI to fix (see Step 10 below for the actual fix, which keeps the UI exactly as it is today). Do all of the steps below before committing once at the end.

**Do not touch** `src/server/utils.ts` or `src/server/inference.ts` in this task — they belong to later tasks. Within `src/server/index.ts`, touch **only** the one hunk named in Step 7 below (the `label` line) — the rest of that file's `runBatchAI` changes belong to Tasks 3 and 4. Within `src/client/components/prompt-col-list.ts`, touch **only** the two hunks named in Step 10 below — do not add a UI toggle option, a third kind pill, or any other user-facing change; the freeform panel's column-kind picker stays a "text"/"file" toggle only, `"auto"` is never user-selectable there.

- [ ] **Step 1: Update the failing tests in `__tests__/run-stats.test.ts`**

Replace every `prefixWithColName` occurrence with `wrapPromptsInTags`, and flip the "absent" test's expected default from `false` to `true`:

```ts
// Line 14 — inside the "picks only the five cost-relevant fields" test's input config
      wrapPromptsInTags: true,

// Line 21 — inside that same test's expected output
      wrapPromptsInTags: true,

// Lines 31-34 — rename and flip the default
  it("normalizes an absent wrapPromptsInTags to true", () => {
    const config: Partial<RunConfig> = { promptCols: [], outputCol: "out" };
    expect(buildConfigSnapshot(config).wrapPromptsInTags).toBe(true);
  });

// Lines 104 and 111 — inside the "different top-level key order" test's `live` and `cached` objects
      wrapPromptsInTags: false,
```

- [ ] **Step 2: Update the failing tests in `__tests__/panels/configure-ai-run.test.ts`**

Rename the fixture field at line 54 (inside `TEST_STATS.config`):

```ts
    wrapPromptsInTags: false,
```

Replace the `describe("prefixWithColName checkbox", ...)` block (lines 733-782) with:

```ts
describe("wrapPromptsInTags checkbox", () => {
  it("renders the wrap-prompts-in-tags checkbox, checked by default", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector<HTMLInputElement>("#wrap-prompts-in-tags-cb")!.checked).toBe(
      true,
    );
  });

  it("assembleRunConfig omits wrapPromptsInTags when checkbox is checked (the default)", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    const config = (services.runBatchAI as jest.Mock).mock.calls[0]?.[0] as RunConfig | undefined;
    expect(config?.wrapPromptsInTags).toBeUndefined();
  });

  it("assembleRunConfig sends wrapPromptsInTags: false when checkbox is unchecked", async () => {
    (services.runBatchAI as jest.Mock).mockResolvedValue(undefined);
    const { container } = await mountAndLoad({
      promptCols: [{ col: "col_a", kind: "text" }],
      outputCol: "ai_inference",
    });
    container.querySelector<HTMLInputElement>("#wrap-prompts-in-tags-cb")!.checked = false;
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    const config = (services.runBatchAI as jest.Mock).mock.calls[0]?.[0] as RunConfig | undefined;
    expect(config?.wrapPromptsInTags).toBe(false);
  });

  it("unmount saves wrapPromptsInTags: false after unchecking", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLInputElement>("#wrap-prompts-in-tags-cb")!.checked = false;
    addPromptCol(container, "col_a");
    const saved = panel.unmount();
    expect(saved?.wrapPromptsInTags).toBe(false);
  });

  it("restores wrapPromptsInTags: false from savedState", async () => {
    const { container } = await mountAndLoad(undefined, {
      promptCols: [{ col: "col_a", kind: "text" as const }],
      systemPromptCol: "",
      outputCol: "ai_inference",
      wrapPromptsInTags: false,
    });
    expect(container.querySelector<HTMLInputElement>("#wrap-prompts-in-tags-cb")!.checked).toBe(
      false,
    );
  });
});
```

- [ ] **Step 3: Update the two stray fixture references**

These two files build `RunStats`/config fixtures that name the old field but aren't otherwise part of this task's main work. In `__tests__/utils.test.ts`, inside the `writeRunStats` describe block's `stats: RunStats` fixture (around line 347):

```ts
        wrapPromptsInTags: false,
```

In `__tests__/services.test.ts`, inside the `runBatchAI` describe block, there are two separate `stats`/response fixtures with this field (around lines 140 and 173) — rename both occurrences the same way:

```ts
        wrapPromptsInTags: false,
```

- [ ] **Step 4: Run all four test files to verify they fail**

Run: `npx jest __tests__/run-stats.test.ts __tests__/panels/configure-ai-run.test.ts __tests__/utils.test.ts __tests__/services.test.ts`
Expected: FAIL — TS compile errors (`RunConfig` has no `wrapPromptsInTags` yet, and/or `RunStatsConfigSnapshot` rejects the stray `prefixWithColName` key as an excess property) across these files.

- [ ] **Step 5: Update `src/shared/types.ts`**

Change `PromptColumnSpec` (around line 32-35):

```ts
export interface PromptColumnSpec {
  col: string;
  kind: "text" | "file" | "auto";
}
```

Replace the `prefixWithColName` field on `RunConfig` (around line 57-58):

```ts
  /**
   * When true (default), each prompt part is wrapped in an XML-style tag named
   * after its source column, e.g. <case_notes>...</case_notes>. Absent is
   * treated as true — set explicitly to false to disable tag wrapping.
   */
  wrapPromptsInTags?: boolean;
```

Update the `RunStatsConfigSnapshot` Pick list (around line 114-116):

```ts
export type RunStatsConfigSnapshot = Pick<
  RunConfig,
  "promptCols" | "systemPromptCol" | "tools" | "wrapPromptsInTags" | "model"
>;
```

- [ ] **Step 6: Update `src/shared/run-stats.ts`**

Change line 22:

```ts
    wrapPromptsInTags: config.wrapPromptsInTags ?? true,
```

- [ ] **Step 7: Fix the one other `prefixWithColName` consumer in `src/server/index.ts`**

Touch **only** this one hunk in this file — the rest of `runBatchAI` is out of scope for this task. Around lines 392-398, `runBatchAI` builds each row's `PromptInput[]` and conditionally attaches a `label` based on the now-removed field:

```ts
  const allPromptInputs: PromptInput[][] = dataValues.map((row) =>
    config.promptCols.map((pc, colIdx) => ({
      kind: pc.kind,
      value: row[promptIdxs[colIdx]],
      ...(config.prefixWithColName ? { label: pc.col } : {}),
    })),
  );
```

Change it to always set `label` unconditionally (this is also what the new tag-wrapping behavior needs later — Task 3 relies on `label` always being populated — so this isn't a throwaway change, it's the final form):

```ts
  const allPromptInputs: PromptInput[][] = dataValues.map((row) =>
    config.promptCols.map((pc, colIdx) => ({
      kind: pc.kind,
      value: row[promptIdxs[colIdx]],
      label: pc.col,
    })),
  );
```

- [ ] **Step 8: Update `src/client/panels/configure-ai-run.ts`**

Rename in the `SavedState` type (lines 29-37):

```ts
export type SavedState = Required<
  Omit<
    RunConfig,
    "rowRange" | "tools" | "includeGrounding" | "applyMarkdown" | "wrapPromptsInTags" | "model"
  >
> &
  Pick<
    RunConfig,
    "rowRange" | "tools" | "includeGrounding" | "applyMarkdown" | "wrapPromptsInTags" | "model"
  > & {
    toolsExpanded?: boolean;
    modelExpanded?: boolean;
    lastTest?: TestRunDisplay | undefined;
  };
```

Rename the private field (line 52):

```ts
  private wrapPromptsInTagsCb: HTMLInputElement | null = null;
```

Update the `preset` object built from `savedState` (line 88):

```ts
          wrapPromptsInTags: savedState.wrapPromptsInTags,
```

Replace the checkbox lookup/default logic (lines 109-112) — note the flipped default (checked unless explicitly `false`, not checked only if explicitly `true`):

```ts
    this.wrapPromptsInTagsCb = container.querySelector<HTMLInputElement>(
      "#wrap-prompts-in-tags-cb",
    );
    if (this.wrapPromptsInTagsCb) {
      this.wrapPromptsInTagsCb.checked = preset.wrapPromptsInTags ?? true;
    }
```

Update `unmount()` (line 268) — default `true`, not `false`:

```ts
      wrapPromptsInTags: this.wrapPromptsInTagsCb?.checked ?? true,
```

Update `currentPreset()` (line 321):

```ts
      wrapPromptsInTags: this.wrapPromptsInTagsCb?.checked,
```

Update `assembleRunConfig()` (lines 545, 555) — the omit-when-default convention inverts, since the default is now `true` instead of `false`:

```ts
    const wrapPromptsInTags = this.wrapPromptsInTagsCb?.checked ?? true;
```

```ts
      wrapPromptsInTags: wrapPromptsInTags ? undefined : false,
```

Update the template checkbox (lines 587-590) — add the `checked` attribute so it renders checked before any JS runs, and update the label copy:

```html
        <label class="checkbox-option">
          <input type="checkbox" id="wrap-prompts-in-tags-cb" checked />
          <span>Wrap prompts in tags</span>
        </label>
```

- [ ] **Step 9: Update `src/client/types.ts`**

Update the `RecipeSettings` Pick list (lines 46-49):

```ts
export type RecipeSettings = Pick<
  RunConfig,
  "tools" | "applyMarkdown" | "includeGrounding" | "wrapPromptsInTags" | "model"
>;
```

- [ ] **Step 10: Fix `src/client/components/prompt-col-list.ts`'s `kind`-widening fallout**

Touch **only** these two hunks — this file's freeform column-kind picker stays a two-option "text"/"file" toggle; nothing about its UI or behavior changes. The widened `PromptColumnSpec["kind"]` union (now `"text" | "file" | "auto"`) breaks two places that assume it's exactly `"text" | "file"`.

First, `PROMPT_KINDS` (line 4) was declared by aliasing the shared type, which is what actually breaks — this local constant only ever holds two values and shouldn't be coupled to the shared union at all:

```ts
const PROMPT_KINDS: Array<"text" | "file"> = ["text", "file"];
```

Second, the constructor loop (lines 33-35) receives `PromptColumnSpec[]` (the full, wider union) from its caller and passes each `spec.kind` straight into `addRow`, which only accepts `"text" | "file"`. Guard it — this is the one place an incoming `"auto"` value (which should never actually occur here today, but the type system can't know that) needs an explicit, sensible fallback:

```ts
    for (const spec of initialValue ?? []) {
      this.addRow(spec.kind === "file" ? "file" : "text", spec.col);
    }
```

- [ ] **Step 11: Run all four test files to verify they pass**

Run: `npx jest __tests__/run-stats.test.ts __tests__/panels/configure-ai-run.test.ts __tests__/utils.test.ts __tests__/services.test.ts`
Expected: PASS (all tests in all four files)

- [ ] **Step 12: Run the full test suite**

Run: `npm test`
Expected: PASS — every suite green, including `__tests__/components/prompt-col-list.test.ts`, `__tests__/menu.test.ts`, and `__tests__/get-job-progress.test.ts`, which don't directly test anything this task changes but transitively import files this task touches. This is the check that actually confirms the pre-commit hook will succeed.

- [ ] **Step 13: Typecheck**

Run: `npm run typecheck`
Expected: PASS with no errors anywhere.

- [ ] **Step 14: Commit**

```bash
git add src/shared/types.ts src/shared/run-stats.ts src/client/panels/configure-ai-run.ts src/client/types.ts src/server/index.ts src/client/components/prompt-col-list.ts __tests__/run-stats.test.ts __tests__/panels/configure-ai-run.test.ts __tests__/utils.test.ts __tests__/services.test.ts
git commit -m "feat: replace RunConfig.prefixWithColName with wrapPromptsInTags, add auto kind"
```

This commit should go through the pre-commit hook normally — do not add `--no-verify` or any other bypass flag. If the hook fails, Step 12 should already have told you why; go fix that, then retry the commit.

---

### Task 2: `sanitizeTagName` pure helper

**Files:**
- Modify: `src/server/utils.ts`
- Test: `__tests__/utils.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, no dependencies on Task 1).
- Produces: `sanitizeTagName(title: string, fallbackIndex: number): string`, exported from `src/server/utils.ts`.

- [ ] **Step 1: Write the failing tests**

Add to `__tests__/utils.test.ts` — add `sanitizeTagName` to the import list at the top of the file, then add this new `describe` block:

```ts
describe("sanitizeTagName", () => {
  it("returns the title unchanged when already a valid identifier", () => {
    expect(sanitizeTagName("case_notes", 0)).toBe("case_notes");
  });

  it("replaces spaces with underscores", () => {
    expect(sanitizeTagName("Drive Link", 0)).toBe("Drive_Link");
  });

  it("collapses a run of invalid characters into a single underscore", () => {
    expect(sanitizeTagName("Case #2/Notes", 0)).toBe("Case_2_Notes");
  });

  it("prefixes a leading digit with an underscore", () => {
    expect(sanitizeTagName("2024_report", 0)).toBe("_2024_report");
  });

  it("trims leading and trailing underscores produced by stripped characters", () => {
    expect(sanitizeTagName("  Notes  ", 0)).toBe("Notes");
  });

  it("falls back to input_<index> when the title sanitizes to empty", () => {
    expect(sanitizeTagName("###", 3)).toBe("input_3");
    expect(sanitizeTagName("", 2)).toBe("input_2");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/utils.test.ts -t sanitizeTagName`
Expected: FAIL with `sanitizeTagName is not defined` / import error.

- [ ] **Step 3: Implement `sanitizeTagName` in `src/server/utils.ts`**

Add this function (near the other pure string helpers, e.g. after `truncateText`):

```ts
/**
 * Deterministic column-title → XML-tag-name mapping. Column headers are not
 * valid tag names (spaces, #, /, leading digits, or empty titles are all
 * legal headers) — this is the single place that rule is applied.
 */
export function sanitizeTagName(title: string, fallbackIndex: number): string {
  const stripped = title.replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (stripped === "") return `input_${fallbackIndex}`;
  return /^[0-9]/.test(stripped) ? `_${stripped}` : stripped;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/utils.test.ts`
Expected: PASS (all tests in this file, including the pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/server/utils.ts __tests__/utils.test.ts
git commit -m "feat: add sanitizeTagName helper for XML-tag prompt wrapping"
```

---

### Task 3: `buildUserParts`/`buildInferenceRequest` — auto-kind classification and tag wrapping

**Files:**
- Modify: `src/server/inference.ts`
- Modify: `src/server/index.ts` (one hunk only — the `buildInferenceRequest` call site inside `runBatchAI`, around lines 508-513)
- Test: `__tests__/inference.test.ts`

**Interfaces:**
- Consumes: `sanitizeTagName` (Task 2), `PromptColumnSpec.kind`/`PromptInput.kind` including `"auto"` (Task 1).
- Produces: `buildInferenceRequest(promptInputs: PromptInput[], systemPrompt?: unknown, tools?: ToolId[], wrapPromptsInTags: boolean = true, fileUriMap?: Map<string, {uri: string; mimeType: string}>): GeminiRequest | null` — note the new 4th parameter; `fileUriMap` moved from 4th to 5th position. `runInference`'s public signature is unchanged.

**Why this task also touches `src/server/index.ts`:** `runBatchAI` is `buildInferenceRequest`'s only other caller, and it calls it positionally. The moment this task's signature change lands, that existing call site would silently pass a `Map | undefined` into the new `wrapPromptsInTags: boolean` parameter slot — a type error, and this repo's pre-commit hook runs the full suite, so that error would block the commit. Fixing the call site is one small hunk (Step 3a below), not the rest of `runBatchAI` — the Wave-1 file-detection widening and `getDefaultRowRange` are unrelated and stay in Task 4.

- [ ] **Step 1: Update existing tests for the new parameter position and tag-wrap behavior**

In `__tests__/inference.test.ts`, two existing tests in the `buildInferenceRequest` describe block pass `fileUriMap` as the 4th positional argument — that position is now `wrapPromptsInTags`. Update both call sites to insert `true` before `fileUriMap`:

```ts
  it("uses file URI from fileUriMap for file inputs", () => {
    // ...unchanged setup...
    const req = buildInferenceRequest(
      [{ kind: "file", value: `https://drive.google.com/file/d/${realFileId}/view` }],
      undefined,
      undefined,
      true,
      fileUriMap,
    );
    // ...unchanged assertions...
  });

  it("skips file inputs with no URI in fileUriMap", () => {
    // ...unchanged setup...
    const req = buildInferenceRequest(
      [
        {
          kind: "file",
          value: "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view",
        },
      ],
      undefined,
      undefined,
      true,
      fileUriMap,
    );
    // ...unchanged assertions...
  });
```

Replace the `describe("label prefix", ...)` block (colon-style prefixing) entirely with `describe("tag wrapping", ...)`:

```ts
  describe("tag wrapping", () => {
    it("wraps a text part in an XML tag named after the label", () => {
      mockOkResponse("ok");
      runInference([{ kind: "text", value: "hello", label: "Summary" }]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toEqual([
        { text: "<Summary>" },
        { text: "hello" },
        { text: "</Summary>" },
      ]);
    });

    it("wraps every flattened part of a labeled input as a single unit", () => {
      mockOkResponse("ok");
      runInference([{ kind: "text", value: [["first"], ["second"]], label: "Notes" }]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toEqual([
        { text: "<Notes>" },
        { text: "first" },
        { text: "second" },
        { text: "</Notes>" },
      ]);
    });

    it("does not wrap when label is absent", () => {
      mockOkResponse("ok");
      runInference([{ kind: "text", value: "hello" }]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toEqual([{ text: "hello" }]);
    });

    it("wraps file parts in a tag too when label is set", () => {
      mockOkResponse("ok");
      runInference([
        {
          kind: "file",
          value: "https://drive.google.com/file/d/abc123/view",
          label: "Attachment",
        },
      ]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts[0]).toEqual({ text: "<Attachment>" });
      expect(payload.contents[0].parts[1].inline_data).toBeDefined();
      expect(payload.contents[0].parts[2]).toEqual({ text: "</Attachment>" });
    });

    it("sanitizes the label into a valid tag name", () => {
      mockOkResponse("ok");
      runInference([{ kind: "text", value: "hello", label: "Drive Link" }]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts[0]).toEqual({ text: "<Drive_Link>" });
    });
  });
```

In the `buildInferenceRequest` describe block, replace the `"prefixes text parts with label when label is set"` test:

```ts
  it("wraps text parts in a tag when label is set", () => {
    const req = buildInferenceRequest([{ kind: "text", value: "content", label: "Article" }]);
    expect(req!.userParts).toEqual([
      { text: "<Article>" },
      { text: "content" },
      { text: "</Article>" },
    ]);
  });

  it("does not wrap when wrapPromptsInTags is explicitly false", () => {
    const req = buildInferenceRequest(
      [{ kind: "text", value: "content", label: "Article" }],
      undefined,
      undefined,
      false,
    );
    expect(req!.userParts).toEqual([{ text: "content" }]);
  });
```

Add a new top-level describe block for the `"auto"` kind, after the `buildInferenceRequest` describe block:

```ts
describe("auto kind classification", () => {
  it("treats a plain-text value as a text part", () => {
    const req = buildInferenceRequest([{ kind: "auto", value: "just some notes" }]);
    expect(req!.userParts).toEqual([{ text: "just some notes" }]);
  });

  it("treats a Drive-link value as a file part", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 1000,
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
      getName: () => "test.pdf",
    });
    (Utilities.base64Encode as jest.Mock).mockReturnValue("encoded==");
    const req = buildInferenceRequest([
      {
        kind: "auto",
        value: "https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view",
      },
    ]);
    expect(req!.userParts[0]).toHaveProperty("inline_data");
  });

  it("classifies each value of a mixed multi-value column independently, preserving order", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 1000,
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
      getName: () => "test.pdf",
    });
    (Utilities.base64Encode as jest.Mock).mockReturnValue("encoded==");
    const req = buildInferenceRequest([
      {
        kind: "auto",
        value: [
          ["plain text"],
          ["https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view"],
        ],
      },
    ]);
    expect(req!.userParts[0]).toEqual({ text: "plain text" });
    expect(req!.userParts[1]).toHaveProperty("inline_data");
  });

  it("wraps a mixed auto column's text and file parts in a single tag pair", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 1000,
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
      getName: () => "test.pdf",
    });
    (Utilities.base64Encode as jest.Mock).mockReturnValue("encoded==");
    const req = buildInferenceRequest([
      {
        kind: "auto",
        value: [
          ["plain text"],
          ["https://drive.google.com/file/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs/view"],
        ],
        label: "case_notes",
      },
    ]);
    expect(req!.userParts[0]).toEqual({ text: "<case_notes>" });
    expect(req!.userParts[1]).toEqual({ text: "plain text" });
    expect(req!.userParts[2]).toHaveProperty("inline_data");
    expect(req!.userParts[3]).toEqual({ text: "</case_notes>" });
  });

  it("returns null when an auto-kind input flattens to nothing", () => {
    expect(buildInferenceRequest([{ kind: "auto", value: "" }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest __tests__/inference.test.ts`
Expected: FAIL — assertion failures (e.g. actual `userParts` still shows colon-prefixed text instead of tag-wrapped text, and the `wrapPromptsInTags` positional argument being treated as `fileUriMap` causes the fileUriMap-dependent tests to behave incorrectly).

- [ ] **Step 3: Implement in `src/server/inference.ts`**

Add `sanitizeTagName` to the import from `./utils` (line 15):

```ts
import { flattenArg, isValidDriveLink, extractId, sanitizeTagName } from "./utils";
```

Replace the `buildUserParts` function (lines 19-53) with:

```ts
function resolveFileParts(
  fileIds: string[],
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiUserPart[] {
  if (fileIds.length === 0) return [];
  if (fileUriMap) {
    const parts: GeminiUserPart[] = [];
    for (const fileId of fileIds) {
      const fileInfo = fileUriMap.get(fileId);
      if (fileInfo) {
        parts.push({ file_data: { file_uri: fileInfo.uri, mime_type: fileInfo.mimeType } });
      }
    }
    return parts;
  }
  return prepareDriveAttachments(fileIds).map((inline_data) => ({ inline_data }));
}

function buildInputParts(
  input: PromptInput,
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiUserPart[] {
  if (input.kind === "text") {
    return flattenArg(input.value).map((text) => ({ text }));
  }

  if (input.kind === "file") {
    const fileIds = flattenArg(input.value).filter(isValidDriveLink).map(extractId);
    return resolveFileParts(fileIds, fileUriMap);
  }

  // "auto" — classify each flattened value individually; a column can mix
  // plain text and Drive links across rows, so the decision is per-value,
  // not per-column.
  const parts: GeminiUserPart[] = [];
  for (const raw of flattenArg(input.value)) {
    if (isValidDriveLink(raw)) {
      parts.push(...resolveFileParts([extractId(raw)], fileUriMap));
    } else {
      parts.push({ text: raw });
    }
  }
  return parts;
}

function buildUserParts(
  promptInputs: PromptInput[],
  wrapPromptsInTags: boolean,
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiUserPart[] {
  const userParts: GeminiUserPart[] = [];

  promptInputs.forEach((input, index) => {
    const parts = buildInputParts(input, fileUriMap);
    if (parts.length === 0) return;

    if (wrapPromptsInTags && input.label) {
      const tag = sanitizeTagName(input.label, index);
      userParts.push({ text: `<${tag}>` }, ...parts, { text: `</${tag}>` });
    } else {
      userParts.push(...parts);
    }
  });

  return userParts;
}
```

Update `buildInferenceRequest` (lines 69-83):

```ts
export function buildInferenceRequest(
  promptInputs: PromptInput[],
  systemPrompt?: unknown,
  tools?: ToolId[],
  wrapPromptsInTags: boolean = true,
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiRequest | null {
  const userParts = buildUserParts(promptInputs, wrapPromptsInTags, fileUriMap);
  if (userParts.length === 0) return null;

  return {
    systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
    userParts,
    tools: tools?.length ? tools : undefined,
  };
}
```

Update the JSDoc above `buildInferenceRequest` (and above `runInference`) that describes `promptInputs` — both currently read `each carrying a kind ("text" or "file")`; change to `each carrying a kind ("text", "file", or "auto")`.

- [ ] **Step 3a: Fix the `buildInferenceRequest` call site in `src/server/index.ts`**

Touch **only** this one hunk in this file. Around lines 508-513, `runBatchAI` calls `buildInferenceRequest` with `fileUriMap` positioned as the 4th argument:

```ts
    const req = buildInferenceRequest(
      allPromptInputs[i],
      systemPrompt,
      config.tools,
      hasFileInputs ? fileUriMap : undefined,
    );
```

Update it to pass `wrapPromptsInTags` in that slot, moving `fileUriMap` to 5th position:

```ts
    const req = buildInferenceRequest(
      allPromptInputs[i],
      systemPrompt,
      config.tools,
      config.wrapPromptsInTags ?? true,
      hasFileInputs ? fileUriMap : undefined,
    );
```

- [ ] **Step 4: Run `inference.test.ts`, then the full suite**

Run: `npx jest __tests__/inference.test.ts`
Expected: PASS (all tests in this file)

Then run: `npm test`
Expected: PASS — every suite green, confirming the `index.ts` call-site fix in Step 3a didn't break `menu.test.ts` or `get-job-progress.test.ts` (both import from `index.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/server/inference.ts src/server/index.ts __tests__/inference.test.ts
git commit -m "feat: auto-detect Drive links per cell, wrap prompts in XML tags"
```

---

### Task 4: `runBatchAI` wiring + `getDefaultRowRange`

**Files:**
- Modify: `src/server/index.ts:312-598` (`runBatchAI`), new export near `src/server/index.ts:685-689` (`getActiveRangeInfo`)
- Test: `__tests__/menu.test.ts`

**Interfaces:**
- Consumes: `RunConfig.wrapPromptsInTags` (Task 1), `buildInferenceRequest`'s new signature (Task 3).
- Produces: `getDefaultRowRange(): { start: number; end: number } | null`, exported from `src/server/index.ts`.

Two hunks that logically belong to this same area of `runBatchAI` — the unconditional `label` assignment and the `buildInferenceRequest` call-site's `wrapPromptsInTags` argument — already landed in Tasks 1 and 3 respectively (each was required there to keep the repo compiling at that point in the sequence). Don't redo them; if you diff `src/server/index.ts` against `main`/the branch start, you'll see those two hunks already present. This task's own work is purely additive from here: widen two `kind` checks and add one new export.

- [ ] **Step 1: Write the failing test for `getDefaultRowRange`**

Add `getDefaultRowRange` to the import from `../src/server/index` at the top of `__tests__/menu.test.ts` (line 71):

```ts
import { onOpen, showSidebar, runTool, importDriveLinks, getDefaultRowRange } from "../src/server/index";
```

Add this new describe block at the end of the file:

```ts
describe("getDefaultRowRange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns row 2 through the sheet's last row", () => {
    mockActiveSheet.getLastRow.mockReturnValue(11);
    expect(getDefaultRowRange()).toEqual({ start: 2, end: 11 });
  });

  it("returns null when the sheet has only a header row", () => {
    mockActiveSheet.getLastRow.mockReturnValue(1);
    expect(getDefaultRowRange()).toBeNull();
  });

  it("returns null for a completely empty sheet", () => {
    mockActiveSheet.getLastRow.mockReturnValue(0);
    expect(getDefaultRowRange()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/menu.test.ts -t getDefaultRowRange`
Expected: FAIL with `getDefaultRowRange is not a function` / import error.

- [ ] **Step 3: Implement in `src/server/index.ts`**

Widen the `hasFileInputs` check (line 389):

```ts
  const hasFileInputs = config.promptCols.some((pc) => pc.kind === "file" || pc.kind === "auto");
```

Widen the Wave-1 file-ID collection gate (line 411):

```ts
        if (input.kind === "file" || input.kind === "auto") {
```

Widen the file-error row filter (line 498):

```ts
        .filter((inp) => inp.kind === "file" || inp.kind === "auto")
```

Add the new export, next to `getActiveRangeInfo` (after line 689):

```ts
export function getDefaultRowRange(): { start: number; end: number } | null {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  return { start: 2, end: lastRow };
}
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — all suites green. This exercises `getDefaultRowRange` directly and re-validates the shared `buildInferenceRequest` pipeline (Task 3) through the existing `inference.test.ts` suite; `configure-ai-run.test.ts` and every other suite should already be green from Task 1 onward. `runBatchAI` itself has no direct unit tests in this codebase (it's excluded from coverage per `docs/plans/2026-02-18-testing-coverage-design.md` — it's deeply coupled to `SpreadsheetApp` UI globals), so its Wave-1/per-row changes are covered by this plan only through the shared `buildInferenceRequest` tests plus manual QA in Task 6.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts __tests__/menu.test.ts
git commit -m "feat: wire auto-kind + tag wrapping through runBatchAI, add getDefaultRowRange"
```

---

### Task 5: Expose `getDefaultRowRange` across the RPC boundary

**Files:**
- Modify: `rollup.config.js:104` (footer stub)
- Modify: `src/client/google.d.ts:21` (ambient declaration)
- Modify: `src/client/services.ts` (Promise wrapper)
- Test: `__tests__/services.test.ts`

**Interfaces:**
- Consumes: `getDefaultRowRange` server export (Task 4).
- Produces: `services.getDefaultRowRange(): Promise<{ start: number; end: number } | undefined>`, callable from any future client panel exactly like `services.getActiveRangeInfo()`.

- [ ] **Step 1: Write the failing test**

Add `getDefaultRowRange: jest.fn()` to the `mockRun` object in `__tests__/services.test.ts` (line 9, alongside `getActiveRangeInfo`):

```ts
  getDefaultRowRange: jest.fn(),
```

Add this describe block, mirroring the adjacent `getActiveRangeInfo` block exactly:

```ts
describe("getDefaultRowRange", () => {
  it("calls google.script.run.getDefaultRowRange and resolves with range", async () => {
    const handlers = captureHandlers();
    const range = { start: 2, end: 20 };
    const promise = services.getDefaultRowRange();
    handlers.resolve(range);
    await expect(promise).resolves.toEqual(range);
    expect(mockRun.getDefaultRowRange).toHaveBeenCalledTimes(1);
  });

  it("resolves with undefined when the sheet has no data rows", async () => {
    const handlers = captureHandlers();
    const promise = services.getDefaultRowRange();
    handlers.resolve(null);
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects on failure", async () => {
    const handlers = captureHandlers();
    const promise = services.getDefaultRowRange();
    handlers.reject(new Error("range error"));
    await expect(promise).rejects.toThrow("range error");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest __tests__/services.test.ts -t getDefaultRowRange`
Expected: FAIL — `services.getDefaultRowRange is not a function`.

- [ ] **Step 3: Implement the RPC boundary plumbing**

In `src/client/google.d.ts`, add to the `GoogleScriptRun` interface (after line 21, `getActiveRangeInfo(): void;`):

```ts
    getDefaultRowRange(): void;
```

In `src/client/services.ts`, add this wrapper (after `getActiveRangeInfo`):

```ts
export function getDefaultRowRange(): Promise<{ start: number; end: number } | undefined> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) =>
        resolve(normalizeNulls(result) as { start: number; end: number } | undefined),
      )
      .withFailureHandler((err: Error) => reject(err))
      .getDefaultRowRange();
  });
}
```

In `rollup.config.js`, add this stub to the footer (after line 104, `function getActiveRangeInfo() { return _GASEntry.getActiveRangeInfo(); }`):

```js
function getDefaultRowRange() { return _GASEntry.getDefaultRowRange(); }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest __tests__/services.test.ts`
Expected: PASS (all tests in this file)

- [ ] **Step 5: Commit**

```bash
git add rollup.config.js src/client/google.d.ts src/client/services.ts __tests__/services.test.ts
git commit -m "feat: expose getDefaultRowRange across the RPC boundary"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

**Interfaces:** none — this task confirms Tasks 1-5 integrate correctly.

- [ ] **Step 1: Run the full test suite with coverage**

Run: `npm run test:coverage`
Expected: PASS, all suites green, per-file coverage thresholds met for every file except `src/server/index.ts` and `src/client/sidebar-entry.ts` (excluded per `docs/plans/2026-02-18-testing-coverage-design.md`).

- [ ] **Step 2: Typecheck both tsconfigs**

Run: `npm run typecheck`
Expected: PASS with no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS with no errors. If auto-fixable issues appear, run `npm run lint:fix` and re-verify tests still pass.

- [ ] **Step 4: Format check**

Run: `npm run format:check`
Expected: PASS. If it fails, run `npm run format` and re-run the full test suite (formatting should never change behavior, but confirm before committing).

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: Succeeds, producing `dist/index.js` and `dist/Sidebar.html` with no Rollup errors — this confirms the new `getDefaultRowRange` footer stub is syntactically valid and the `appsscript.json` copy step still runs.

- [ ] **Step 6: Manual QA note for later deployment**

This plan does not include a `clasp push`/live-sheet verification step — there is no new UI surface for a human to click through yet (the guided-flow panel that will call `getDefaultRowRange` is a future session's work). The freeform panel's renamed, default-checked "Wrap prompts in tags" checkbox is the only end-to-end-visible change; if you do deploy to the dev sheet to sanity-check it, confirm: the checkbox renders checked on a fresh mount, a run with it checked produces `<ColumnName>...</ColumnName>`-wrapped content in the Gemini request (visible via `clasp:logs` or by inspecting `UrlFetchApp` payload in a temporary log line), and unchecking it removes the tags.

- [ ] **Step 7: Commit (only if Steps 3-4 required fixes)**

```bash
git add -A
git commit -m "chore: lint/format fixes from full verification pass"
```

If no fixes were needed, skip this step — there is nothing to commit.

---

## Self-Review Notes

- **Spec coverage:** Every change called for in the design doc's "Shared type changes," "Server-logic changes," and "Step-by-step RPC mapping" sections has a task (Tasks 1, 3, 4, 5). The "What this deliberately does not solve here" and "Seam for a future enhancement" sections are intentionally *not* implemented — they're out of scope by the design doc's own explicit deferral, not a gap in this plan.
- **Placeholder scan:** No TBD/TODO markers; every step includes literal code, not descriptions of code.
- **Type consistency:** `buildInferenceRequest`'s signature is defined once in Task 3 and its own call site (`src/server/index.ts`, updated in the same task, Step 3a) uses the identical parameter order and defaults. `wrapPromptsInTags` is spelled identically across `shared/types.ts`, `shared/run-stats.ts`, `server/index.ts`, `client/panels/configure-ai-run.ts`, and `client/types.ts`.
- **Scope check, revised twice during execution:** Task 1 originally split the shared-type rename from its client consumer; a first execution attempt got `BLOCKED` after discovering the rename actually has *two* consumers outside the shared layer (`ConfigureAIRunPanel` and one line in `server/index.ts`), plus a third file (`client/components/prompt-col-list.ts`) whose local `"text"|"file"` type breaks from the `kind` widening alone, independent of the rename. Since this repo's pre-commit hook runs the full suite on every commit, every one of these had to move into Task 1. The same coupling showed up once more between Tasks 3 and 4: `buildInferenceRequest`'s only other caller (`runBatchAI`) would have broken the moment its signature changed, so that one call-site hunk moved from Task 4 into Task 3 (as Step 3a) rather than waiting. Confirmed file-by-file that no further hidden couplings remain: Task 2 (`utils.ts`) is additive only with no importers to break; Task 4's remaining work (Wave-1 `kind` widening, `getDefaultRowRange`) is purely additive/behavioral, nothing it changes was previously relied upon by any passing test; Task 5 (RPC exposure) only adds new stubs/wrappers, never modifies existing ones.
