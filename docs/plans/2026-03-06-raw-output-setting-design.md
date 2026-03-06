# Raw Output Setting Design

**Date:** 2026-03-06
**Status:** Validated

## Problem

The AI output pipeline now performs significant post-processing on the raw Gemini response before writing to the sheet:

- `parseMarkdown` strips `**bold**`, `*italic*`, `# heading` syntax and converts them to Sheets rich text formatting
- `buildInferenceCellContent` maps grounding citation positions onto the clean text as clickable hyperlinks
- (Planned) Inline `[text](url)` link stripping and conversion

This raises two concerns:
1. Users may want to see exactly what the model returned, without any transformation
2. Accumulated transformations risk hiding or corrupting model output in subtle ways

## Decision

Offer two output pathways, controlled by a global checkbox in the Configure AI Run panel:

- **Formatted (default):** Current rich text path — markdown stripped, grounding citations linked, inline links converted
- **Raw:** Plain `setValue(result.text)` — the model's text exactly as returned, no post-processing

The grounding column is unaffected by this setting. It always uses rich text when `includeGrounding` is true, since grounding metadata is never part of the raw model text — it is a separate structured artifact assembled by the toolkit.

## Scope

Three files only:

### 1. `src/shared/types.ts`

Add to `RunConfig`:

```ts
/**
 * When true, runBatchAI writes result.text directly with setValue, skipping all
 * markdown parsing and rich text formatting. The grounding column is unaffected.
 *
 * Future: recipes could pre-set this via PrepRecipeParams/PrepRecipeResult —
 * follow the tools echo pattern (PrepRecipeParams.tools → PrepRecipeResult.tools)
 * if that becomes needed.
 */
rawOutput?: boolean;
```

### 2. `src/client/panels/configure-ai-run.ts`

- Add `rawOutputCb: HTMLInputElement | null` field
- Add checkbox to template, directly below the output column selector:

```html
<label class="raw-output-hint">
  <input type="checkbox" id="raw-output-cb" />
  <span>Raw output (skip markdown formatting)</span>
</label>
```

- Add `rawOutput?: boolean` to `SavedState`
- On mount: `if (preset.rawOutput) this.rawOutputCb.checked = true`
- In `assembleRunConfig`: `rawOutput: this.rawOutputCb?.checked || undefined`
- In `unmount`: `rawOutput: this.rawOutputCb?.checked ?? false`

### 3. `src/server/index.ts` — `runBatchAI`

Replace the current unconditional rich text write with a branch:

```ts
if (config.rawOutput) {
  sheet.getRange(realRowIndex, outputIdx + 1).setValue(result.text);
} else {
  try {
    sheet
      .getRange(realRowIndex, outputIdx + 1)
      .setRichTextValue(toCellValue(buildInferenceCellContent(result)));

    if (config.includeGrounding && groundingIdx >= 0) {
      const groundingContent = buildGroundingCellContent(result);
      if (groundingContent !== null) {
        sheet
          .getRange(realRowIndex, groundingIdx + 1)
          .setRichTextValue(toCellValue(groundingContent));
      }
    }
  } catch (_e) {
    sheet.getRange(realRowIndex, outputIdx + 1).setValue(result.text);
  }
}
```

Note: the grounding column write remains inside the `else` branch — raw output means no grounding column either (since `includeGrounding` and `rawOutput` are independent user choices, but grounding without formatting is an odd combination the UI needn't encourage).

## What Does Not Change

- `PrepRecipeParams` and `PrepRecipeResult` — not needed. Recipes navigate to `ConfigureAIRunPanel` for the cook phase, where the user sets `rawOutput` directly before running, the same as `includeGrounding`.
- The grounding column rich text path — always formatted.
- The `startIndex ?? 0` fix for grounding citation indices — applies in the formatted path regardless of this setting.
- The inline `[text](url)` link parsing fix — applies in the formatted path regardless of this setting.

## UI Placement

```
Output column  [required]
[ output-col tag selector ]
[ ] Raw output (skip markdown formatting)

Tools  (optional)
...
```

The checkbox is always visible (not conditionally shown), since it is relevant to any run regardless of tool selection.
