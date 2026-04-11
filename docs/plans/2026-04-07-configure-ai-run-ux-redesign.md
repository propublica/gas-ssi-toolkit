# ConfigureAIRunPanel UX Redesign

**Date:** 2026-04-07
**Status:** Design complete, ready for implementation

## Problem

The current Run AI Inference panel presents its fields as a feature checklist — no hierarchy, no narrative, no sense of how they compose into an AI request. Users are expected to know what "prompt columns" vs "system prompt column" means without guidance, and optional/advanced options sit at the same visual weight as required ones.

## Goals

- Establish a top-to-bottom workflow narrative: set the AI's behavior → give it data → capture the result
- Add plain-English helper text that explains conceptual roles, not mechanical mechanics
- Condense the prompt column row layout to reduce vertical footprint
- Progressively disclose optional/advanced sections (Tools, future Model selection)
- Retain full flexibility — this panel is the power tool; recipes are where strong rails go

## Section Order

| # | Section | Required | Default state |
|---|---------|----------|---------------|
| 1 | System Prompt Column | Optional | Expanded |
| 2 | User Prompt Columns | Required | Expanded |
| 3 | Output Column | Required | Expanded |
| 4 | Rows to Process | Required | Expanded |
| 5 | Tools | Optional | Collapsed |
| 6 | Model _(future)_ | Optional | Collapsed |

## Helper Text

Each section shows one sentence of helper text below the label in a lighter gray, smaller font.

**System Prompt Column** `(optional)`
> "Sets the AI's role and behavior — what it should do and how it should respond — before it sees any data."

**User Prompt Columns** `*`
> "The content the AI acts on — what it reads, summarizes, classifies, or answers, one row at a time."

**Output Column** `*`
> "Where the AI's response will be written. Select an existing column or create a new one."

**Tools** `(optional)` — shown in expanded state only
> "Give the AI extra capabilities. Google Search lets it look up current information; URL Context lets it read web pages you provide; Code Execution lets it run and verify calculations."

**Model** `(optional, future)` — shown in expanded state only
> "The Gemini model to use. Faster models are better for simple tasks; more capable models handle complex reasoning."

## Prompt Column Row Layout

Each prompt column entry collapses from two stacked lines to a single inline row:

```
[ Column chip / picker  ]  [ Text ]  [ File ]  [ ↑ ]  [ ↓ ]  [ × ]
```

- Column picker (TokenInput) occupies ~55% of row width — wide enough for a column name chip, usable for search input
- Kind pills (`Text` / `File`) sit immediately right of the picker, always visible
- Up/down/remove controls are right-aligned
- `+ Add column` button stays below the list

The picker-open/empty state stays on a single line. The 55% width allocation is sufficient to display a column name chip and provides adequate search input room in a ~300px sidebar.

## Collapsible Sections

Tools and Model use a consistent toggle pattern.

**Collapsed:**
```
TOOLS (optional)  ▶  No tools selected
TOOLS (optional)  ▶  Google Search, URL Context
```

**Expanded:**
```
TOOLS (optional)  ▼
[helper text]
[TagList]
[grounding sub-option if applicable]
```

- Clicking anywhere on the header row toggles the section
- Chevron rotates `▶ → ▼` on expand
- Summary line shows active selection count/names when collapsed, "No [x] selected" when empty
- Expand state is preserved during the panel session (survives navigation back/forward)
- Default on mount: collapsed

## Implementation Scope

### Files to modify

- `src/client/panels/configure-ai-run.ts` — reorder sections, add helper text markup, wire collapsible toggle
- `src/client/components/prompt-col-list.ts` — collapse two-line row to one-line layout
- `src/client/sidebar.css` — new styles: helper text, collapsible header, one-line prompt row

### No server changes required

All changes are purely presentational. `RunConfig`, `PromptColumnSpec`, and the server-side inference path are untouched.

### Out of scope

- Model selection (future feature — collapsible shell can be stubbed or left out until ready)
- Recipe panels (separate UX surface)
- Any changes to field validation logic or run dispatch
