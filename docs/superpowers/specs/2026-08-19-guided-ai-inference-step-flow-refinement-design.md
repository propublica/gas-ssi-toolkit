# Guided AI Inference — Step Flow Refinement Design

Follows [wireframe](2026-08-10-guided-ai-inference-wireframe-design.md), [server architecture](2026-08-12-guided-ai-inference-server-architecture-design.md), and [client architecture](2026-08-17-guided-ai-inference-client-architecture-design.md) (Sessions 1-3). This session revisits one part of Session 3's design after live implementation experience: **what happens to other steps when a completed, non-terminal step is edited.**

## Why this reopens a "closed" decision

Session 3's spec (`2026-08-17`, "Step lifecycle and the `[Edit]` path", item 4) specified that editing a collapsed step "never cascades" — downstream results are left in place, untouched. That's what originally shipped (`0c78fe2`).

It didn't hold up in practice. `4173b4e` ("Flag stale Run results after editing an earlier step, add Cancel to the edit flow") introduced a cascade — `StepFlow.uncompleteDownstreamSteps()` — specifically because leaving downstream results in place let a user re-edit Step 1's inputs while a stale Test/Run result from the old inputs stayed visible and usable. `5b4d2b6` simplified the mechanism (a status flip instead of comparing configs) but kept the same shape: **every already-complete downstream step flips back to `"active"` simultaneously** the moment the edited step is recommitted.

That shipped shape has its own problem, which is what this document resolves: simultaneous reactivation can pop open two or three step bodies at once, and — separately — nothing stops a user from interacting with an already-active downstream step (in practice, the terminal `RunStep`, which never collapses) *while* an earlier step sits mid-edit, uncommitted. That second gap is the more serious one: it allows firing a real AI run against a config with an unresolved, half-edited upstream step.

This document supersedes Session 3 item 4 and the `4173b4e`/`5b4d2b6` cascade shape with the design below. Nothing else in the Session 3 spec changes.

## Decisions

### 1. Recommit cascade: relock sequentially, not reactivate simultaneously

Whenever a step calls `ctx.onComplete()` — first-time completion or a recommit after `[Edit]` — exactly one rule applies, regardless of which case it is:

- The immediate next step becomes `"active"`.
- Every step after that reverts to `"locked"`, retaining its cached `savedByIndex` entry as the resume point for when the user walks forward and reaches it again.

This replaces `StepFlow.handleComplete()`'s current branch (`nextWasLocked ? mount : uncompleteDownstreamSteps-to-active`) with one path: recommit and fresh completion become the same code. A user who edits Step 1 with Steps 2 and 3 already complete does not see both pop open — they see Step 2 become active (pre-filled with its old data), and Step 3 (including the terminal `RunStep`) collapse back to locked until they walk forward to it again.

**The terminal step is not exempt.** Today, no code path ever sets `RunStep`'s status back to `"locked"` once reached — it's the reason the "stale Run" bug was reachable in the first place. Under this design it can relock like any other downstream step. This costs nothing structurally: `unmount()` never destroys a step's DOM (only the separate `destroy()` method does, which `StepFlow` never calls), so hiding the terminal step is the same cheap CSS-attribute flip every other step already uses, not a new remount/rehydrate path. `RunStep.mount()`/`unmount()` already round-trip its full config (model, tools, row range, last test result) through `savedState`, so nothing new is needed there either.

### 2. Editing exclusivity gate

New concept, not present today. From the moment any step enters edit mode (`[Edit]` clicked) until it resolves — Cancel, or a successful recommit — every *other* currently-mounted step becomes non-interactive.

Under decision 1, at most one such step ever exists at a time: the current frontier (whichever step is `"active"` and isn't the one being edited — the same slot that's always exactly one step in normal, non-editing operation). The gate disables that one step's own action buttons (Continue/Test/Run) without touching its status, its mounted DOM, or its in-progress values.

This requires a new, optional capability on the `Step` interface, since `StepFlow` has no way today to reach into an already-mounted step and tell it to disable its own buttons:

```ts
interface Step<S = unknown> {
  // ...existing members unchanged...
  /** Optional. Called by the shell to enable/disable this step's own
   * action button(s) while a DIFFERENT step is mid-edit. A step with
   * nothing to disable (or that can't be mounted alongside an edit in
   * progress) may omit this entirely. Must not alter mounted state,
   * savedState, or in-progress form values — purely a button-disable. */
  setInteractive?(enabled: boolean): void;
}
```

`InputsStep`, `PromptStep`, and `RunStep` each implement a minimal version that disables their own Continue/Test/Run button(s) when called with `false`. This is additive and optional by design, consistent with the existing "positional, not kind-based" philosophy — a step that can't currently find itself in this situation doesn't need to implement it.

The panel-level "Refresh columns" button is gated by the same flag, for consistency — refreshing columns while an edit is unresolved elsewhere is disabled for the same reason. Back-navigation is *not* specially restricted: leaving the panel entirely while a step is mid-edit is already handled correctly by the existing `GuidedSavedState` persistence (the active, uncommitted step's `unmount()` captures its in-progress values with `status: "active"`, and re-entering the panel resumes it exactly as it was left — no new mechanism needed).

### 3. Cancel and error handling: unchanged

Both already do the right thing once paired with decision 2 — the gap was never in these two, it was in the missing gate:

- **Cancel** (`cancelEdit()`) reverts only the edited step to its last-good complete state and releases the exclusivity gate. It never touches downstream steps, because under decision 1 the relock only ever happens on a *successful* recommit — an edit that's merely opened and then canceled never triggered it in the first place.
- **Error on recommit** (`onError()`) stays purely cosmetic — icon flips to ✕, status unchanged. Since `onComplete()` was never called, the gate stays held and the relock never fires. Cancel remains the escape hatch out of an error state; hitting it clears the icon along with everything else, since it's a full revert.
- **Cancel is disabled while a recommit request is in flight** (matching the existing `AsyncActionButton` loading-state pattern already used for the Continue button itself), closing a stale-callback race where a request the user believes they canceled out of could still resolve successfully afterward.

### 4. Row-display predicates: decoupled

The bug surfaced while designing decision 1: `StepFlow.applyRowDisplay()` currently derives one compound flag, `collapsedNonTerminalComplete` (`status === "complete" && !isLastStep`), and reuses it for three unrelated purposes — whether the body is expanded, whether the summary shows, and whether `[Edit]` shows. A relocked step (status `"locked"`, but with real cached data from before) doesn't fit that flag cleanly under any single interpretation, so the three uses are split into three independently-scoped conditions:

- **Body expanded** → `isMountedState(index)` (the existing method, called directly instead of re-derived locally). Unaffected by this change in its logic, just no longer duplicated.
- **Summary shown** → `!isMountedState(index) && !isLastStep(index) && savedByIndex[index] !== undefined`. Collapsed, non-terminal, and there's cached data to show — true for both a normal complete-collapsed row and a relocked row. This is what makes relocked steps show their last-known summary (**plain styling, no "stale"/muted visual treatment** — confirmed as explicitly out of scope for this pass) instead of looking indistinguishable from a step that was never reached.
- **`[Edit]` shown** → `status === "complete" && !isLastStep(index)`, deliberately unchanged and *not* extended to relocked steps. A relocked step cannot be jump-edited — it must be reached by walking forward through the intervening locked steps, which is the entire point of decision 1. Only a genuinely `"complete"` step (not superseded by a later edit) offers `[Edit]`.

No new `StepFlowSavedState` fields or status values are needed anywhere in this document — the three-state model (`"locked" | "active" | "complete"`) is unchanged; only the transition rules and display predicates change.

## Non-goals / deferred

- Visually distinguishing a relocked step's summary from a confirmed one (e.g. muted styling, a "pending redo" badge) — plain styling for now, per explicit decision.
- Any change to `RecipePanel`/`RecipePrepCook`/`RECIPES` — untouched, as in Session 3.
- Restricting back-navigation or warning the user while an edit is unresolved — the existing panel-persistence mechanism already handles resuming correctly.

## Implementation surface

- **`src/client/components/step-flow.ts`** — the bulk of the change: cascade rewrite (decision 1), exclusivity gate state + wiring (decision 2), predicate decoupling in `applyRowDisplay()` (decision 4). `cancelEdit()`/`onError()` handling needs no logic change (decision 3), only to be exercised alongside the new gate.
- **`src/client/types.ts`** — add optional `setInteractive?(enabled: boolean): void` to the `Step` interface.
- **`src/client/panels/guided/inputs-step.ts`**, **`prompt-step.ts`**, **`run-step.ts`** — each implements `setInteractive()` to disable its own action button(s).
- **`src/client/panels/guided-ai-inference.ts`** (or wherever "Refresh columns" lives for this panel) — gate that button on the same exclusivity flag.

## Open items for implementation

- Confirm exact naming for the new internal tracking field (e.g. which index is currently being edited) — implementation detail, not a design fork.
- Confirm whether `PromptStep` and `InputsStep`'s `setInteractive(false)` should also visually gray out their button(s) (e.g. matching `:disabled` styling already used elsewhere) versus merely setting the `disabled` attribute with no visual change — likely the former, for consistency with existing disabled-button styling, but worth a quick look at `sidebar.css`'s existing `:disabled` rules during implementation rather than deciding here.
