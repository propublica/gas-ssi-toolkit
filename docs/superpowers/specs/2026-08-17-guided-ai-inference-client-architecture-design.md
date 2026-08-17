# Guided AI Inference — Client Architecture Design

**Session 3 of 3** in the planned arc: (1) [wireframe](2026-08-10-guided-ai-inference-wireframe-design.md), (2) [server architecture & RPC boundary](2026-08-12-guided-ai-inference-server-architecture-design.md), (3) client architecture [this doc]. This session designs the client-side step framework, panel structure, and persistence for `AI-101`. All server-side work (Session 2) is already merged — `prepRecipe`, `runBatchAI`, `getDefaultRowRange`, `"auto"` prompt-column kind, and `wrapPromptsInTags` are live today with no further server changes needed here.

## Relationship to prior recipe-system work

A separate, stalled effort (`feature/recipe-v2`, "Recipe Step System Redesign") independently explored step-based recipes around new server-side write primitives ("row-determining" vs. "row-receiving"). Only Layer 1 of a planned 5-layer redesign was ever spec'd; it never touched merged code and isn't reflected in the current architecture. **This design treats that effort as a dead end** — it builds fresh against the server surface Session 2 already committed to, not against recipe-v2's primitives.

## Scope

This step framework is built **specifically for Guided AI Inference**, not as a replacement for `RecipePanel`/`RecipePrepCook`/the `RECIPES` registry. Those are untouched by this work. The design is intentionally shaped so the underlying approach *could* extend to future recipes (see "Generalization notes" throughout), but no other recipe is ported or changed as part of this session.

## The `Step` / `StepContext` contract

A single, uniform interface serves every step — there is no `CommitStep`/`OpenStep` split. The distinguishing behavior (does completing this step collapse it and unlock a next step, or does it stay expanded forever) is **positional**, decided by the shell based on where a step sits in the array, not by anything the step itself declares:

```ts
interface StepContext {
  /** Called by the step, at its own discretion, when it considers its own
   * designated action to have succeeded. May be called from multiple
   * internal call sites (e.g. a future "Skip" and "Continue" both completing
   * a step) — the shell's handling of this must be idempotent, since nothing
   * prevents a step from calling it more than once. */
  onComplete(): void;
}

interface Step<S = unknown> {
  title: string;
  flavorText: string;
  /** Renders this step's own UI into container, including whichever of its
   * own buttons/async actions it wants. The step owns and self-manages all
   * loading/error UI for its own internal actions (e.g. via AsyncActionButton,
   * exactly as ConfigureAIRunPanel does today) — the shell never sees a
   * "committing" or "error" state for any step. */
  mount(container: HTMLElement, ctx: StepContext, savedState?: S): void;
  /** Called when this step stops being the visibly-mounted one — either
   * because it just completed (collapsing it), or because the whole panel
   * is being torn down (nav away). Captures serializable field state AND a
   * pre-computed one-line summary in the same call, since this is the one
   * moment the step has live data to compute both from. Returns undefined
   * only if the step was never actually mounted. */
  unmount(): { savedState: S; summary: string } | undefined;
}
```

### Why not `commit(): Promise<void>` awaited by the shell

An earlier iteration of this design gave the shell a generic `commit()` method it would call and await, rendering its own generic "Continue" button and generic committing/error chrome around whatever `mount()` produced. This breaks down for a step with more than one internal async action (e.g. `RunStep`'s Test *and* Run AI) — there's no single slot to put two buttons in, and Test explicitly must never trigger the shell's collapse/unlock behavior. Once each step owns and fully self-manages its own button(s) — matching how `AsyncActionButton`/`RecipePrepCook` already work elsewhere in this codebase — the shell doesn't need to award, catch rejections from, or render anything around a per-step action at all. It only needs one bit of information, volunteered by the step itself: **"I'm done."**

This also means the shell's own error/loading state machinery collapses to almost nothing — see below.

### Why not a separate `error` `StepStatus`

Considered and rejected once the shell stopped owning any button: a discriminated `"error"` status (mirroring `LoadingStatus` in `client/types.ts:21`) would still be the right shape *if* the shell were awaiting a promise and needed to react to its rejection. Since it no longer does, loading/error states are entirely private to each step's own `mount()` implementation, exactly as `ConfigureAIRunPanel.handleTest` already manages its own via `AsyncActionButton` today. The shell has nothing to model here.

### Shell-level step status

Each step has exactly three shell-visible states: `"locked" | "active" | "complete"`. Collapse behavior is a function of `(status === "complete") && (this is not the last step in the array)` — not a property stored on the step or declared by its kind. For the last step, reaching `"complete"` only flips its checklist icon to ✓ (confirmed decision) while it stays fully expanded and interactive, since there's nothing downstream to unlock and its actions (Test/Run AI) remain repeatable indefinitely.

**Generalization note:** this positional rule is what lets a future recipe put a Run-AI-shaped step in the *middle* of a flow with zero code changes to the step itself — only its position changes what `onComplete()` does.

## Step lifecycle and the `[Edit]` path

1. Step reached → shell calls `mount(container, ctx)` (no `savedState` the first time).
2. Step calls `ctx.onComplete()` from wherever its own logic decides is "done" (e.g. `PromptStep`'s `prepRecipe` write resolving, `RunStep`'s Run AI job resolving).
3. Shell calls `step.unmount()`, capturing `{savedState, summary}`. If not the last step: collapse this step (render icon ✓, title, `[Edit]`, and the cached `summary` string — shell-owned chrome, `mount()` is not called again while collapsed), mount the next step. If it is the last step: keep it mounted/expanded, just flip the icon.
4. Clicking `[Edit]` on a collapsed step calls `step.mount(container, ctx, cachedSavedState)` again — the user sees their prior values, not a blank form. No other step's status changes; downstream results are left in place untouched (per the wireframe's explicit "never cascades" rule).
5. Re-committing an edited step repeats step 2–3. The "unlock next step" half of step 3 is a no-op if it was already unlocked (idempotency guard); the "collapse this step with a refreshed summary" half is not.

The shell must guard `onComplete()` handling against being invoked more than once for the same step (see `StepContext` doc comment above).

## The three concrete steps

### `InputsStep` ("Gather your inputs")

Rows are `{kind: "column", colTitle}` (no RPC — a plain column picker) or `{kind: "drive-folder", url, colTitle}` (`colTitle` auto-assigned distinct titles — "Drive Link", "Drive Link 2", ... — since `prepRecipe` has no opinion of its own on naming, per the Session 2 spec's noted consequence). On its commit action, builds **one** `prepRecipe` call covering every drive-folder row as its own `PrepColSpec` (`fillStrategy: {kind: "list-drive-folder", inputId}`), synthesizing `inputId`s (`driveFolder_0`, ...) directly — this step does not use `RecipeDefinition`/`RecipeInput`/`RecipeColumn` (`client/types.ts`), since those assume a recipe author declared static inputs ahead of time, which doesn't fit dynamically-added folder rows. Zero drive-folder rows means zero RPC calls; `onComplete()` fires immediately. Every row becomes a `PromptColumnSpec {col: colTitle, kind: "auto"}` — no kind decision anywhere, matching the wireframe.

### `PromptStep` ("Tell the AI what to do")

One textarea (with an `[Expand ⤢]` modal, autosaving into the inline textarea per the wireframe). Commit action: one `prepRecipe` call, one `PrepColSpec {colTitle: "System Prompt", fillStrategy: {kind: "fill-value", value: promptText}}`. Contributes `RunConfig.systemPromptCol = "System Prompt"`.

**Assumption flagged for implementation:** unlike the freeform panel's optional system-prompt column, this step's prompt is treated as required (non-empty) — the wireframe shows no "(optional)" marker here, and "tell the AI what to do" is the flow's core value proposition. Confirm before implementing if this reads differently.

### `RunStep` ("Run") — the terminal, `"open"`-by-position step

Renders the shared run-controls component described below (Model, Tools + grounding checkbox, `RowRange` defaulted via `getDefaultRowRange()`, Test, Run AI, test results). Test never calls `ctx.onComplete()` — it's a private, repeatable, self-managed action, identical in shape to today's `ConfigureAIRunPanel.handleTest`. Run AI's job succeeding calls `ctx.onComplete()`, which — because this is the last step — only flips the checklist icon; the step itself stays mounted and interactive so the user can Test/Run again with different settings.

**Generalization note:** nothing in `RunStep`'s own implementation encodes "I am terminal." If a future recipe placed an equivalent step mid-flow, the same code would collapse-and-unlock on `onComplete()` automatically, driven entirely by array position.

## Shared run-controls component (with `ConfigureAIRunPanel`)

`ConfigureAIRunPanel` (`src/client/panels/configure-ai-run.ts:150-527`) already implements everything `RunStep` needs — Model section, Tools section, `RowRange`, `handleTest`/`renderTestStats`/`checkTestStatsFreshness`, `handleRun`/`confirmUntestedRun`/`runChunks`/`jobStore` dispatch — depending on nothing from `ConfigureAIRunPanel`'s own column pickers beyond `promptCols`/`systemPromptCol`/`outputCol`.

This logic is extracted into a new, self-contained component (mounts into an empty container, matching how `TagList`/`RowRange`/`TokenInput` already work) parameterized by `getPromptConfig: () => Pick<RunConfig, "promptCols" | "systemPromptCol" | "outputCol">`:

- `ConfigureAIRunPanel` supplies this from its own `PromptColList`/`TokenInput` pickers (unchanged behavior for end users).
- `RunStep` supplies it by reading `InputsStep`/`PromptStep`'s cached results plus a fixed output column name, and wires the component's "Run AI succeeded" signal to `ctx.onComplete()`.

Both panels end up driving the *same class* for Model/Tools/Test/Run — this, not a shared type alone, is the actual mechanism behind retaining in-progress choices when moving between the two panels. **Real cost:** this is a refactor of a working, tested 655-line panel — `ConfigureAIRunPanel`'s existing tests split along the new boundary. Exact component name/location is an implementation detail.

**Generalization note:** this component becoming reusable for `RunStep` is exactly what makes it reusable for a hypothetical future recipe's own AI-inference step, without more design work.

## Panel-level persistence

`GuidedAIInferencePanel implements Panel<undefined, GuidedSavedState>`. Its own `unmount()` calls `unmount()` on whichever step is currently mounted, folds that into the `{savedState, summary}` pairs already cached from earlier collapses, and returns those plus `activeStepIndex`:

```ts
interface GuidedSavedState {
  activeStepIndex: number;
  /** `saved` is present for any step mounted at least once (active or complete);
   * absent for a step never reached ("locked"). The active step's `saved.summary`
   * is simply unused while it stays active — unmount() always returns both fields
   * together, so there's no state where one is present without the other. */
  steps: Array<{
    status: "locked" | "active" | "complete";
    saved?: { savedState: unknown; summary: string };
  }>;
}
```

No new persistence mechanism is needed: the router's existing `lastState` map (`router.ts:22`, populated by `leaveCurrentPanel()` at `router.ts:67-73`) already restores this on a bare `navigate()` back to the panel, and on an explicit `back()` the still-on-the-stack entry's `savedState` is used directly (`router.ts:55-59`) — this is exactly how "Switch to Freeform, then hit Back" already returns to Guided exactly as it was left, verified by tracing the existing router code rather than by adding anything new.

## Switching to the freeform panel

One direction only, and deliberately so:

- **Guided → Freeform**: clean. Steps 1 & 2's results are always a valid `Partial<RunConfig>` — `PromptStep` wrote its text into a real column, so `systemPromptCol: "System Prompt"` means exactly what the freeform panel expects. A "Switch to Freeform" action (placement TBD at implementation time — likely within `RunStep`) assembles the same config the shared run-controls component already builds internally and calls `nav.navigate("configure-ai-run", config)`.
- **Freeform → Guided**: out of scope, not just unbuilt. Freeform allows multiple prompt columns of mixed kind and a system-prompt-*column* reference whose value can vary per row; Guided's Step 2 is a single literal value authored once. There is no faithful reduction from the former to the latter without silently picking one row's value or dropping information, so no "Switch to Guided" affordance is added from the freeform panel.

## Wiring changes

- **`src/client/types.ts`** — add `"guided-ai-inference"` to `PanelId`; add `Step`/`StepContext`/`GuidedSavedState` types.
- **`src/client/sidebar-entry.ts:34`** — register `["guided-ai-inference", new GuidedAIInferencePanel()]`.
- **`src/client/panels/tool-list.ts`** — add a button navigating to `"guided-ai-inference"`; reorder so Guided AI Inference, Freeform AI Inference ("Run AI Inference"), Recipes appear first, in that order, per the approved wireframe.
- **New files**: `panels/guided-ai-inference.ts`, `components/step-flow.ts` (the shell), the three step classes, and the extracted shared run-controls component from the section above.

## Deferred / explicitly out of scope

- Porting `RecipePanel`/`RecipePrepCook`/`RECIPES` (Document Summarization, etc.) onto this step framework — explicitly deferred to a future session, per the confirmed scope decision.
- "Switch to Guided" from the freeform panel (see above).
- Everything already deferred by Sessions 1 and 2: AI-suggested MODEL/TOOLS defaults, Gemini Gem context prefill, "AI output unraveled into columns," tag-name collision handling, `prepRecipe` progress reporting.

## Open items for implementation

- Confirm whether `PromptStep`'s prompt is truly required (non-empty) before allowing commit.
- Exact placement of the "Switch to Freeform" affordance within `RunStep`'s rendered UI.
- Naming/file location for the extracted shared run-controls component.
- How `ConfigureAIRunPanel`'s existing test suite splits once the extraction happens.
