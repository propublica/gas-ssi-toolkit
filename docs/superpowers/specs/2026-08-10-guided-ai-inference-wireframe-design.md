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
- Step 3 is terminal: Test and Run AI are themselves the writes. Model/tool settings live inside this step too, but aren't a separate commit — just always-editable settings with no sheet write of their own (see Step 3 below for why folding them in here, rather than giving them their own step, tightens this principle rather than breaking it).

Steps display as a checklist: **✓** complete, **●** active/expanded, **○** not yet reached. Completing a step's commit action auto-collapses it and auto-expands the next step. A collapsed, completed step shows its header + an `[Edit]` affordance + a one-line summary of what was chosen, so the user has a reminder without needing to re-expand:

```
│ ✓ 1. Gather your inputs         [Edit]│
│   NoteCol, DriveLink                  │
```

**Editing a completed step never auto-clears or warns about downstream results.** If the user edits Step 1 or 2 after already running Test (which writes real output to the sheet), the stale output is simply left in place until the user hits Test again. No confirmation dialog, no automatic clearing — this keeps the interaction model simple, at the cost of the sheet briefly showing output that doesn't match the current config.

## Panel intro

Above Step 1, the panel opens with a short intro and a documentation link — matching the reference recipe prototype's framing rather than dropping the user straight into Step 1 with no context:

```
│ Guided AI Inference                   │
│ Walk through each stage of            │
│ Spreadsheet Inference. New here?      │
│ See examples ↗                        │
```

- Always visible, not tied to any step's expand/collapse state — it's framing for the whole flow, not part of Step 1.
- "See examples ↗" links out to documentation covering a few worked examples. The content and location of that documentation is a separate, unscoped task — not part of this design.

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

- Each row is one input source. No kind tag (Text/File) and no reorder controls — both were judged not worth the complexity this flow is trying to remove (reordering matters more in the freeform panel, where inputs are woven into a hand-written prompt; here they're just concatenated). There's no user-facing kind toggle because there's no backend concept of column "kind" in this flow at all — see **Backend implementation notes** below.
- `NoteCol ▾` — the whole pill is clickable and reopens the column picker to swap which existing column this row points to. `✕` removes the row entirely.
- The Drive-folder row is a plain text input with "Drive folder URL" as placeholder text (no persistent label).
- Two dedicated buttons make the two input types discoverable up front, rather than hiding the choice behind a single "+ Add" menu: `+ Existing column` (opens the column picker) and `+ Import folder` (adds a folder-URL row).
- Order doesn't matter — all selected inputs get concatenated for each row's inference call, each wrapped in an XML-style tag named after its column (e.g. `<NoteCol>...</NoteCol><DriveLink>...</DriveLink>`) to delineate inputs to the model. This is now a committed decision, not a future consideration — see **Backend implementation notes** below.
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
│   ┌────────────────────────────────┐  │
│   │ Role: You are a specialized... │  │ (2–3 lines default height)
│   └────────────────────────────────┘  │
│   [ Expand ⤢ ]                        │
│                                        │
│   [ Import & Continue ]               │
```

Expanded modal (opened by `[ Expand ⤢ ]`):

```
┌──────────────────────────────────────┐
│ System prompt              [ Close ] │
│ Need help? Try our Gemini Gem         │
│ prompt assistant ↗                    │
│ ┌────────────────────────────────┐    │
│ │ Role: You are a specialized... │    │
│ │ ...                             │    │
│ └────────────────────────────────┘    │
└──────────────────────────────────────┘
```

- No standalone "System prompt" field label above the inline textarea — the step header ("Tell the AI what to do") already establishes context, so a repeated label was redundant.
- The Gemini Gem link-out appears in two places: as flavor text under the step header (only while expanded/active, omitted from the collapsed summary), and again inside the expanded modal — the modal is the more likely place someone actually wants it, mid-composition.
- The Gem itself already exists. Dynamically prefilling it with sidebar context (e.g. the task or selected data type) is a nice-to-have if feasible, but the Gem's internal behavior is explicitly **out of scope** for this design.
- The textarea defaults to a short 2–3 line height (not full-size) to avoid overwhelming the user; `[Expand ⤢]` opens the modal above for comfortable editing of longer prompts.
- **The modal autosaves.** There's no explicit "Save" action inside it — edits flow back into the inline textarea continuously, and `[ Close ]` just dismisses the overlay. Nothing is lost by closing it at any point.
- Commit button: **Import & Continue** — writes the system prompt text into the appropriate column across every row in scope, then auto-advances to Step 3.

## Step 3 — "Run"

Terminal step — no further "continue." Folds model/tool selection (previously its own "Configure AI" step) into the same step as Test/Run AI, since Configure AI never performed a sheet write of its own — its commit was just "Continue." Merging it here means every remaining step either writes to the sheet or *is* the run action, tightening the core design principle above rather than working against it.

```
│ ○ 3. Run                              │  (collapsed)
│   Gemini 3.1 Flash Lite · No tools    │
│                                        │
│ ● 3. Run                              │  (expanded)
│   MODEL              Flash Lite ▶     │
│   TOOLS         No tools selected ▶   │
│                                        │
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

- **MODEL/TOOLS sit above the row range/Test/Run block**, matching the order the freeform panel already uses, and are collapsed to a one-line summary by default (e.g. "Flash Lite ▶") so they don't compete with the primary Test/Run actions. Reuses the existing collapsible MODEL and TOOLS sections from `ConfigureAIRunPanel` (`src/client/panels/configure-ai-run.ts`) verbatim, including their existing static defaults (`gemini-3.1-flash-lite`, no tools selected). No spreadsheet write happens for these settings — they're run settings, not cell content, and there's no separate commit for them; they're just live, editable state until Test/Run AI fires.
- **Explicitly deferred:** AI-suggested MODEL/TOOLS defaults, where an AI call analyzes the Step 2 system prompt and recommends settings. Static defaults only for this design; the AI-suggestion idea is a clearly-scoped future enhancement, not part of this flow.
- **Output column is fixed, not user-selectable** — a simplification versus the freeform panel's `TokenInput` picker. Flavor text explains where output lands. If that fixed column already contains data (from a prior run of this flow, or anything else), Test/Run simply **overwrite it** — no auto-suffixing, no collision warning. Consistent with the "leave stale results, let the user re-test" principle above: this flow favors simplicity over guarding against self-inflicted overwrites.
- **Row range defaults to row 2 through the highest populated row** on the sheet (auto-computed — row 1 is always the header and is never included), rather than requiring the user to specify it — editable if they want a narrower range.
- Test and Run AI behave exactly as they do today in `ConfigureAIRunPanel`: Test processes the first 10 rows and writes real results to the sheet; Run AI always processes the *entire* selected range, including rows Test already covered (no skip-already-tested logic — full run re-processes everything, chosen for simplicity over cost savings).

## Backend implementation notes (for Session 2)

Two behavioral decisions that don't show up directly in the wireframe (nothing in the UI changes because of them) but that Session 2's code architecture needs to account for:

- **XML-tag wrapping replaces "Prefix with column name."** The freeform panel's optional "Prefix with column name" checkbox has no equivalent here — there's no toggle at all. Every input selected in Step 1 always gets wrapped in an XML-style tag named after its column when assembled into the request (e.g. `<DriveLinks>...</DriveLinks><case_notes>...</case_notes>`), unconditionally.
- **No explicit File/Text kind — the backend auto-detects Drive links instead.** The freeform panel's `PromptColList` requires the user to declare each column's kind (Text vs. File) up front. This flow has no equivalent concept anywhere, including server-side: instead, cell content is inspected at run time and any Drive link found (via the same detection `isValidDriveLink`/`extractId` already use) is treated as a file automatically — fetched and encoded like a File-kind column would be today. This applies uniformly to existing columns picked in Step 1 and to the auto-imported Drive-folder column; there's no per-column flag driving it.

## Deferred / explicitly out of scope for this design

- AI-suggested MODEL/TOOLS defaults (Step 3)
- Gemini Gem dynamic context prefill and any Gem-side behavior (Step 2)
- "AI output unraveled into columns" — a later phase per the original outline, not part of this flow
- Any implementation/architecture decisions (new `PanelId`, RPCs, whether to generalize `RecipePrepCook`'s state machine, how the three steps' data reassembles into a `RunConfig`) — reserved for Session 2 of this arc
