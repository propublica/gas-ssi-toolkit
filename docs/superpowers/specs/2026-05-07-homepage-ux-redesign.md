# Homepage UX Redesign

**Date:** 2026-05-07
**Status:** Approved

## Problem

The current `ToolListPanel` homepage organizes around feature names ("Recipes", "Run AI Inference", "Import Drive Links") and an arbitrary "Main Tools / Extras" hierarchy. Buttons give no signal about the journalist's underlying goal — what they're trying to accomplish — and the Recipes submenu adds an unnecessary navigation hop to the most guided entry point.

## Goal

Replace the current homepage with an intent-led, flat list of action buttons that:
- Complete the sentence stem "I want to…" grammatically
- Speak to the journalist's situation via a subtitle line
- List recipes directly on the homepage (no submenu)
- Order from most guided (recipes) to most freeform (manual tools)

## Final Copy

```
I want to...

📄 Summarize a Drive folder
   For FOIA drops, court filings, doc sets

▶  Run AI across my spreadsheet
   Prompts, data, tools — totally freeform

📂 Import files from a Drive folder
   Track progress through doc dumps

📜 Extract text from files
   Import text from PDFs, images, and Docs

🎲 Pull a random sample
   Get a sense of what you have
```

## Layout

- **Flat, unbroken list.** No section headers ("Main Tools", "Extras"). All buttons share the same `.tool-btn` style with the two-line `.tool-btn-text` / `.tool-btn-sub` variant.
- **Order:** recipes first, then manual tools in rough order of how guided/freeform they are.
- **Header:** A single `I want to...` prompt above the button list. Styled at `--font-size-300`, `--text-secondary`, italic. Not a section label — a conversational sentence stem.
- **Footer:** Unchanged (version/model info).

## Navigation Changes

- The `📄 Summarize a Drive folder` button navigates directly to the `recipe` panel, pre-loaded with the `document-summarization` recipe definition. This removes one navigation hop vs. the current Recipes → recipes-list → recipe path.
- The `Recipes` button is removed from the homepage.
- The `recipes-list` panel is no longer linked from the homepage. It stays in the codebase as dead code pending a future cleanup decision. No routes or panel registrations need to change — it simply won't be navigated to.
- Future recipes are added as additional buttons directly on the homepage, ordered above the manual tools.

## CSS Changes

One new rule needed: `.home-prompt` (or equivalent) for the "I want to…" header line:

```css
.home-prompt {
    font-size: var(--font-size-300);
    font-style: italic;
    color: var(--text-secondary);
    margin: 0 0 16px 4px;
}
```

All other required styles (`.tool-btn`, `.tool-btn-text`, `.tool-btn-sub`) already exist.

## Files to Change

| File | Change |
|------|--------|
| `src/client/panels/tool-list.ts` | Rewrite `template()` and `wireEvents()` — new copy, new order, direct recipe navigation, remove Recipes button |
| `src/client/sidebar.css` | Add `.home-prompt` style |

## Out of Scope

- Deleting `recipes-list` panel (deferred cleanup)
- Adding new recipes
- Any changes to the `recipe` panel itself or `RecipeDefinition` data
