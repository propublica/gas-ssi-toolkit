# Guided AI Inference — Wireframe Design

**Session 1 of 3** in a planned arc: (1) wireframe [this doc], (2) supporting code architecture, (3) development steps. This doc covers UX/wireframe only — no implementation architecture.

## Purpose

Re-imagine the freeform "Run AI Inference" experience as a guided, step-by-step flow, generalizing the strongest parts of an earlier document-summarization recipe prototype: clear blocking steps that focus the user on one part of the task at a time, and steps whose completion visibly *does something on the spreadsheet* rather than just filling out a form that gets submitted all at once at the end.

## Relationship to existing tools

This is a **new, third entry point** alongside what already exists — it does not replace either:

- **Guided AI Inference** (new) — a general-purpose, step-by-step onramp for any AI inference task.
- **Freeform AI Inference** (currently "Run AI Inference," a rename to this name is being considered separately) — `ConfigureAIRunPanel`, unchanged. Stays for power users who want full control in one form.
- **Recipes** — named presets (Document Summarization, etc.) via `RecipePanel`. Stays for specific, opinionated use cases.

In `ToolListPanel`, these three appear first and in this order — **Guided AI Inference, Freeform AI Inference, Recipes** — ahead of the other existing tools (Import Drive Links, Extract Text, Sample Rows).

The name **Guided AI Inference** was chosen to pair with the anticipated "Freeform AI Inference" rename — same noun, different modifier, signaling two paths into the same underlying capability.

## Core design principle

Each step's commit action should, wherever the step's content has a natural spreadsheet representation, perform a **real write to the sheet** — not just advance internal UI state. This is what made the reference recipe prototype feel concrete rather than form-like. Concretely:

- Step 1's commit fires the Drive import (if used) and locks in column selection.
- Step 2's commit writes the system prompt text into the appropriate column across every row.
- Step 3's commit is plain "Continue" — model/tool choices are run settings, not cell content, so there's nothing to write.
- Step 4 is terminal: Test and Run AI are themselves the writes.

Steps display as a checklist: **✓** complete, **●** active/expanded, **○** not yet reached. Completing a step's commit action auto-collapses it and auto-expands the next step. A collapsed, completed step shows its header + an `[Edit]` affordance + a one-line summary of what was chosen, so the user has a reminder without needing to re-expand:

```
│ ✓ 1. Gather your inputs         [Edit]│
│   NoteCol, DriveLink                  │
```

**Editing a completed step never auto-clears or warns about downstream results.** If the user edits Step 1 or 2 after already running Test (which writes real output to the sheet), the stale output is simply left in place until the user hits Test again. No confirmation dialog, no automatic clearing — this keeps the interaction model simple, at the cost of the sheet briefly showing output that doesn't match the current config.

## Step 1 — "Gather your inputs"

Selects the row-varying data that feeds the AI — existing columns, an imported Drive folder, or both.

```
│ ● 1. Gather your inputs               │
│   The content the AI works on, one    │
│   row at a time.                      │
│                                        │
│   ┌───────────────────────────────┐   │
│   │ NoteCol ▾                   ✕ │   │
│   ├───────────────────────────────┤   │
│   │ [ Drive folder URL______ ]  ✕ │   │
│   └───────────────────────────────┘   │
│   [ + Existing column ] [ + Import folder ] │
│                                        │
│   [ Import & Continue ]               │
```

- Each row is one input source. No kind tag (Text/File) and no reorder controls — both were judged not worth the complexity this flow is trying to remove (reordering matters more in the freeform panel, where inputs are woven into a hand-written prompt; here they're just concatenated).
- `NoteCol ▾` — the whole pill is clickable and reopens the column picker to swap which existing column this row points to. `✕` removes the row entirely.
- The Drive-folder row is a plain text input with "Drive folder URL" as placeholder text (no persistent label).
- Two dedicated buttons make the two input types discoverable up front, rather than hiding the choice behind a single "+ Add" menu: `+ Existing column` (opens the column picker) and `+ Import folder` (adds a folder-URL row).
- Order doesn't matter — all selected inputs get concatenated for each row's inference call. (Future consideration, not scoped for implementation yet: wrapping each input in an XML-style tag, e.g. `<NoteCol>...</NoteCol><DriveLink>...</DriveLink>`, to clearly delineate inputs to the model.)
- Commit button: **Import & Continue** — locks in the column selection and, if a Drive folder was set, fires the import (creating/filling that column) in the same action. Then auto-advances to Step 2.

## Step 2 — "Tell the AI what to do"

Authors the system prompt — the single instruction governing the run. There is no separate "row-wise prompt" concept: each row is its own independent inference call, so the system prompt is mechanically copied into every row at run time. The row-varying content is exactly what Step 1 selected.

```
│ ● 2. Tell the AI what to do           │
│   Set the AI's role and behavior —    │
│   what it should do and how it        │
│   should respond.                     │
│   Need help writing this? Try our     │
│   Gemini Gem prompt assistant ↗       │
│                                        │
│   System prompt                       │
│   ┌────────────────────────────────┐  │
│   │ Role: You are a specialized... │  │ (2–3 lines default height)
│   └────────────────────────────────┘  │
│   [ Expand ⤢ ]                        │
│                                        │
│   [ Import & Continue ]               │
```

- The Gemini Gem link-out is treated as flavor text — same visual hierarchy as the helper copy above it — and only appears while this step is expanded/active. It's omitted from the collapsed summary.
- The Gem itself already exists. Dynamically prefilling it with sidebar context (e.g. the task or selected data type) is a nice-to-have if feasible, but the Gem's internal behavior is explicitly **out of scope** for this design.
- The textarea defaults to a short 2–3 line height (not full-size) to avoid overwhelming the user; `[Expand ⤢]` opens a modal for comfortable editing of longer prompts.
- Commit button: **Import & Continue** — writes the system prompt text into the appropriate column across every row in scope, then auto-advances to Step 3.

## Step 3 — "Configure AI"

Model and tool selection. Reuses the existing collapsible MODEL and TOOLS sections from `ConfigureAIRunPanel` (`src/client/panels/configure-ai-run.ts`) verbatim, including their existing static defaults (`gemini-3.1-flash-lite`, no tools selected).

```
│ ○ 3. Configure AI                     │
│   Gemini 3.1 Flash Lite · No tools    │  (collapsed)
│                                        │
│ ● 3. Configure AI                     │  (expanded)
│   MODEL              Flash Lite ▶     │
│   TOOLS         No tools selected ▶   │
│                                        │
│   [ Continue ]                        │
```

- No spreadsheet write happens in this step — model/tool choices are run settings, not cell content.
- **Explicitly deferred:** AI-suggested defaults, where an AI call analyzes the Step 2 system prompt and recommends a model/tools. Static defaults only for this design; the AI-suggestion idea is a clearly-scoped future enhancement, not part of this flow.
- Commit button: **Continue** (not "Import & Continue," since nothing is written). Auto-advances to Step 4.

## Step 4 — "Run"

Terminal step — no further "continue." Reuses the existing Test/Run AI mechanics from `ConfigureAIRunPanel` (10-row test with cost/time stats and full-run estimate; chunked full run with a warning before an untested run over `CHUNK_SIZE` rows).

```
│ ● 4. Run                              │
│   Results written to ai_output        │
│   Rows to process: [___]–[___]        │
│                                        │
│   Test your setup                     │
│   Try the first 10 rows before        │
│   committing to a full run.           │
│   [ Test ]                            │
│                                        │
│   [ Run AI ]                          │
```

- **Output column is fixed, not user-selectable** — a simplification versus the freeform panel's `TokenInput` picker. Flavor text explains where output lands. If that fixed column already contains data (from a prior run of this flow, or anything else), Test/Run simply **overwrite it** — no auto-suffixing, no collision warning. Consistent with the "leave stale results, let the user re-test" principle above: this flow favors simplicity over guarding against self-inflicted overwrites.
- **Row range defaults to row 2 through the highest populated row** on the sheet (auto-computed — row 1 is always the header and is never included), rather than requiring the user to specify it — editable if they want a narrower range.
- Test and Run AI behave exactly as they do today in `ConfigureAIRunPanel`: Test processes the first 10 rows and writes real results to the sheet; Run AI always processes the *entire* selected range, including rows Test already covered (no skip-already-tested logic — full run re-processes everything, chosen for simplicity over cost savings).

## Deferred / explicitly out of scope for this design

- AI-suggested Configure-AI defaults (Step 3)
- Gemini Gem dynamic context prefill and any Gem-side behavior (Step 2)
- XML-style tag wrapping of concatenated Step 1 inputs
- "AI output unraveled into columns" — a later phase per the original outline, not part of this flow
- Any implementation/architecture decisions (new `PanelId`, RPCs, whether to generalize `RecipePrepCook`'s state machine, how the four steps' data reassembles into a `RunConfig`) — reserved for Session 2 of this arc
