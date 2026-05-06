# Recipe UX Variants — Design Spec

**Date:** 2026-05-06
**Branch:** to be created from `develop`
**Status:** Approved, ready for implementation

---

## Purpose

Three A/B test UX variants of the Document Summarization recipe, implemented as throwaway prototypes on a dedicated git branch. The goal is to explore different interaction patterns before settling on an official recipe UX direction.

Each variant is guided by the recipe system's core tenets:
- Reduce setup work for journalists
- Provide an accessible onboarding experience
- Spur creativity and AI literacy
- Transition reporters from raw questions to structured, function/rule-based processing pipelines

---

## Shared Behavior Change (All Variants)

**Output column creation moves to inference time.**

The output column (e.g. `AI_Summarization`) is no longer created during `prepRecipe`. It is created by `runBatchAI` via `findOrCreateColumn` at inference time — this is already how `runBatchAI` works.

The output column entry remains in `prepTemplate` (with `role: "output"`) so `buildRunTemplate` can still derive `outputCol` from the recipe definition. The variant panels filter it out before calling `prepRecipe`.

**Cook bypasses ConfigureAIRunPanel.**

In all variants, Cook fires `runBatchAI` directly from the recipe panel. It does not navigate to `ConfigureAIRunPanel`. Configure AI (Variants 1 and 3) is the escape hatch for users who want to inspect or adjust settings before running.

---

## Architecture

### New files
- `src/client/panels/recipe-v1.ts` — 4-button variant
- `src/client/panels/recipe-v2.ts` — 2-button simplified variant
- `src/client/panels/recipe-v3.ts` — didactic step-by-step variant

### Changes to existing files

| File | Change |
|------|--------|
| `src/client/types.ts` | Add `variant?: "v1" \| "v2" \| "v3"` to `RecipeDefinition`; add `"recipe-v1" \| "recipe-v2" \| "recipe-v3"` to `PanelId` |
| `src/client/recipes.ts` | Add 3 new recipe entries (V1, V2, V3 copies of Document Summarization) |
| `src/client/sidebar-entry.ts` | Register the 3 new panel classes |
| `src/client/panels/recipes-list.ts` | Route to `"recipe-v1"`, `"recipe-v2"`, or `"recipe-v3"` based on `definition.variant`; fall back to `"recipe"` for originals |

**No changes to:** `RecipePrepCook`, `RecipePanel`, `ConfigureAIRunPanel`, `services.ts`, or any server code.

### Recipe entries

Three new entries are added to `RECIPES` in `recipes.ts`. They share the same `prepTemplate` as the original Document Summarization recipe (including the `role: "output"` column) but carry a `variant` field:

```ts
{ id: "document-summarization-v1", variant: "v1", ... }
{ id: "document-summarization-v2", variant: "v2", ... }
{ id: "document-summarization-v3", variant: "v3", ... }
```

The original `"document-summarization"` entry is unchanged.

---

## Variant 1 — 4-Button

### Concept
Same form as the current recipe panel. The action area gains two additional buttons (Test and Cook) so users can fire inference directly without going through ConfigureAIRunPanel.

### Button state machine

```
IDLE (before prep):
  [Prep Recipe]  [Test ▸ row 2]  [Cook ▸ All]  [Configure AI]
      enabled       disabled         disabled        disabled

PREPPING:
  [⏳ Prepping…]  [Test ▸ row 2]  [Cook ▸ All]  [Configure AI]
      disabled       disabled         disabled        disabled

PREPPED:
  [Re-prep]  [Test ▸ row 2]  [Cook ▸ All]  [Configure AI]
   enabled      enabled          enabled        enabled

TESTING:
  [Re-prep]  [⏳ Testing…]  [Cook ▸ All]  [Configure AI]
   disabled     disabled        disabled        disabled

COOKING:
  [Re-prep]  [Test ▸ row 2]  [⏳ Cooking…]  [Configure AI]
   disabled     disabled         disabled        disabled

Any input field change → reset to IDLE
After TESTING or COOKING completes → return to PREPPED
```

### Button behavior

- **Prep** — calls `prepRecipe(params)` (filtering out the output column); stores `preppedRunConfig` and `rowRange`
- **Test** — calls `runBatchAI` with `rowRange: { start: rowRange.start, end: rowRange.start }` (first data row only); result appears in the sheet; disables all buttons while running
- **Cook** — calls `runBatchAI` with the full `rowRange`; disables all buttons while running
- **Configure AI** — calls `nav.navigate("configure-ai-run", preppedRunConfig)` (same as current Cook)

Helper text under the button row explains each button's purpose in plain language.

---

## Variant 2 — Simplified 2-Button

### Concept
No explicit prep step. Test and Cook each silently prep and then run inference in one shot. Designed to feel like a true one-click pipeline.

### Button state machine

```
IDLE:
  [Test ▸ first 10 rows]   [Cook ▸ All rows]
          enabled                enabled

TESTING:
  [⏳ Testing…]   [Cook ▸ All rows]
     disabled         disabled

COOKING:
  [Test ▸ first 10 rows]   [⏳ Cooking…]
          disabled              disabled

After either completes → return to IDLE
```

### Button behavior

- **Test** — calls `prepRecipe(params)` silently, then `runBatchAI` with `rowRange: { start: rowRange.start, end: rowRange.start + 9 }` (first 10 data rows)
- **Cook** — calls `prepRecipe(params)`, then `runBatchAI` with the full `rowRange`

Input field changes require no state reset since there is no intermediate prep state.

---

## Variant 3 — Didactic Step-by-Step

### Concept
Each phase of recipe preparation is a named, explicitly-triggered step. The user sees exactly what is happening and controls each stage. Steps 2 and 3 are locked until prior steps are complete.

### Layout

```
STEP 1: Import your documents
──────────────────────────────────────────
Drive Folder *
[Helper text]
[paste Google Drive folder URL          ]
[Import Files]
→ success: "✓ N files imported to Drive Link column"

──────────────────────────────────────────
STEP 2: Set up your prompt           🔒
──────────────────────────────────────────
(grayed out until Step 1 complete)

Document Type (optional)
[e.g. court docket                      ]

Area of Interest (optional)
[e.g. specific people                   ]

[Import Prompt]
→ success: "✓ Prompt written to System Prompt column"

──────────────────────────────────────────
STEP 3: Run                          🔒
──────────────────────────────────────────
(grayed out until Step 2 complete)

[Test ▸ row 2]  [Cook ▸ All]  [Configure AI]
```

### Input and column split (inferred from recipe definition)

| Step | Inputs used | Columns sent to `prepRecipe` |
|------|-------------|------------------------------|
| Step 1 | Inputs whose `id` matches an `inputId` in any `list-drive-folder` fill strategy | Columns with `role: "file-prompt"` |
| Step 2 | All remaining inputs | Columns with `role: "system-prompt"` or `"text-prompt"` |

Output column (`role: "output"`) is excluded from both step calls to `prepRecipe`.

`rowRange` is captured from Step 1's `PrepRecipeResult` and held in panel state for use in Step 3.

### Reset behavior

- Editing the Step 1 input (folder URL) → re-locks Step 3 only; Step 2 remains complete
- Editing a Step 2 input → re-locks Step 3 only
- Step 2 state (prompt configuration) is treated as independent of which folder is selected
- Re-clicking Import Files (Step 1) when Step 2 is already complete → Step 3 auto-unlocks after the import succeeds (no need to redo Step 2)

### Button states during imports and runs

```
IMPORTING STEP 1:
  [⏳ Importing…]  (Step 2 locked or already complete — unchanged)

IMPORTING STEP 2:
  [⏳ Importing…]  (Step 3 locked until this succeeds)

TESTING (Step 3):
  [⏳ Testing…]  [Cook ▸ All]  [Configure AI]
     disabled       disabled       disabled
  → completes: all three buttons re-enable

COOKING (Step 3):
  [Test ▸ row 2]  [⏳ Cooking…]  [Configure AI]
     disabled        disabled        disabled
  → completes: all three buttons re-enable
```

### Step 3 button behavior

Identical to Variant 1's post-prep buttons:
- **Test** — `runBatchAI` with `rowRange: { start: rowRange.start, end: rowRange.start }` (first data row)
- **Cook** — `runBatchAI` with full `rowRange`
- **Configure AI** — `nav.navigate("configure-ai-run", preppedRunConfig)`

---

## Helper Text Guidelines

Every button and step should carry illustrative helper text explaining what it does and what the user should expect. Examples:

- Under **Prep**: "Sets up your spreadsheet columns and imports files from your Drive folder."
- Under **Test**: "Runs the AI on the first row only. Check the result before running everything."
- Under **Cook**: "Runs the AI on every imported file. Keep the sidebar open until it finishes."
- Under **Configure AI**: "Opens the full AI settings panel so you can review or adjust before running."
- Step headers in V3 should explain what the step accomplishes, not just label it.

---

## Removal Plan

All variant code is confined to:
- 3 new panel files
- 3 new recipe entries in `RECIPES`
- The `variant` field on `RecipeDefinition` and `PanelId`
- Registration lines in `sidebar-entry.ts`
- Routing logic in `recipes-list.ts`

Removing a variant requires deleting its panel file, its recipe entry, and its registration/routing lines. No server code is touched.
