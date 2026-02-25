# Sidebar Refactor Design

**Date:** 2026-02-24
**Status:** Approved

## Goals

1. Split `src/Sidebar.html` (~508 lines) into maintainable `.ts` and `.css` source files.
2. Enable TypeScript on the client side so `RunConfig` is shared end-to-end.
3. Accept an optional `Partial<RunConfig>` preset on panel open to autopopulate field selections.
4. Improve first-paint performance by eliminating the Google Fonts external fetch.
5. Make core client logic unit-testable under Jest + jsdom.

## Out of Scope (deferred)

- Named recipe presets and recipe picker UI — the `Partial<RunConfig>` parameter is the right
  primitive for recipes, but the user flow has not been fully designed yet.

---

## File Structure

### New source files

```
src/
  Sidebar.html              ← HTML structure only; {{STYLES}} and {{SCRIPTS}} placeholders
  client/
    sidebar.ts              ← named exports: DOM logic, tag builders, config assembly
    sidebar.css             ← all CSS (moved from Sidebar.html)
    google.d.ts             ← compile-time type stub for google.script.run
```

### New test file

```
__tests__/
  sidebar.test.ts           ← Jest + jsdom; mocks google.script.run on globalThis
```

### Modified files

```
rollup.config.js            ← export array of two configs; client config adds inlineSidebarHtml plugin
```

### What is removed

- The `<style>` block inside `src/Sidebar.html` → moves to `src/client/sidebar.css`
- The `<script>` block inside `src/Sidebar.html` → moves to `src/client/sidebar.ts`
- The Google Fonts `<link>` tag → replaced by system font stack in `sidebar.css`

---

## Build Pipeline

```
npm run build
  └─ Rollup (array of two configs, run in sequence)
       │
       ├─ Config 1 — Server (unchanged)
       │    input:  src/server/index.ts
       │    output: dist/index.js  (GAS IIFE, assigned to _GASEntry)
       │
       └─ Config 2 — Client
            input:  src/client/sidebar.ts
            plugins:
              - @rollup/plugin-typescript  (browser target)
              - inlineSidebarHtml (custom plugin, see below)
```

### `inlineSidebarHtml` plugin

A small inline Rollup plugin attached to the client config. In its `generateBundle` hook it:

1. Reads the compiled JS from the bundle chunk.
2. Reads `src/Sidebar.html` (template with `{{STYLES}}` / `{{SCRIPTS}}` markers).
3. Reads `src/client/sidebar.css`.
4. Replaces `{{STYLES}}` with the CSS string and `{{SCRIPTS}}` with the compiled JS string.
5. Emits `dist/Sidebar.html` via `this.emitFile`.
6. Deletes the intermediate `.js` chunk so only the assembled HTML lands in `dist/`.

No extra tooling required — the plugin lives directly in `rollup.config.js`.

---

## `src/Sidebar.html` (template)

After refactor the file contains only:

- `<!DOCTYPE html>` boilerplate and `<base target="_top">`
- The `{{STYLES}}` placeholder (replaced by inlined CSS at build time)
- The static HTML structure (tool list panel + AI config panel, unchanged)
- The `{{SCRIPTS}}` placeholder (replaced by inlined compiled JS at build time)

No `<style>` block, no `<script>` block, no external `<link>` tags.

---

## `src/client/sidebar.css`

Identical CSS to what currently lives in the `<style>` block, with one change:

```css
/* Before */
font-family: 'Google Sans', Roboto, Arial, sans-serif;

/* After */
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
```

All occurrences of the Google Sans font reference are replaced. The external
`fonts.googleapis.com` fetch is eliminated entirely.

---

## `src/client/google.d.ts`

Compile-time only. Declares `google.script.run` as a typed global so `sidebar.ts` can
call it without `any` casts.

```typescript
import type { RunConfig } from "../../shared/types";

interface GoogleScriptRun {
  withSuccessHandler(fn: (result: unknown) => void): this;
  withFailureHandler(fn: (error: Error | string) => void): this;
  runTool(functionName: string): void;
  getSheetHeaders(): void;
  runBatchAI(config: RunConfig): void;
}

declare const google: {
  script: { run: GoogleScriptRun };
};
```

---

## `src/client/sidebar.ts`

All functions are **named exports** so Jest can import them directly. Rollup compiles to a
browser IIFE for production — the exports are not visible to the browser global scope, but
the HTML `onclick` attributes call the functions as globals because the IIFE name exposes
them (or they are attached to `window` explicitly — see note below).

> **Note on onclick wiring:** The HTML template uses `onclick="showAIPanel()"` style
> attributes. Since Rollup wraps in an IIFE, these globals won't exist unless we either
> (a) assign them to `window` inside the IIFE, or (b) use event listeners attached in
> an `init()` function called at the bottom of the script. **Option (b) is preferred** —
> remove inline `onclick` attributes from the HTML template and wire all handlers in
> `init()`. This avoids polluting the global scope and makes the code fully testable.

### Public API

```typescript
// Entry point — called at bottom of script after DOM is ready
export function init(): void;

// Panel navigation — called by init() event listeners
export function showAIPanel(preset?: Partial<RunConfig>): void;
export function hideAIPanel(): void;

// Pure helpers — exported for testing
export function buildTagList(
  container: HTMLElement,
  headers: string[],
  selected?: string[]
): void;

export function buildSingleTagList(
  container: HTMLElement,
  headers: string[],
  includeNew: boolean,
  selected?: string
): void;

export function applyPreset(preset: Partial<RunConfig>): void;

export function assembleRunConfig(): RunConfig | null;  // null = validation failed

export function handleRowRangeChange(): void;
```

### `showAIPanel(preset?: Partial<RunConfig>)`

- Hides the tool list, shows the AI panel.
- Calls `google.script.run.getSheetHeaders()`.
- On success: calls `loadHeaders(headers, preset)` which builds tag lists and, if `preset`
  is provided, immediately calls `applyPreset(preset)` to pre-select matching tags.

### `applyPreset(preset: Partial<RunConfig>)`

Iterates all rendered tags in each container and adds/removes the `.selected` class based
on whether the tag's `data-value` appears in the corresponding preset field. Handles:
- `preset.userPromptCols` → multi-select tag list
- `preset.driveFileCols` → multi-select tag list
- `preset.systemPromptCol` → single-select tag list
- `preset.outputCol` → single-select tag list (also handles `__new__` token)
- `preset.rowRange` → sets radio + reveals range inputs with start/end values

### `assembleRunConfig(): RunConfig | null`

Reads current DOM state and returns a validated `RunConfig` object, or `null` if required
fields are missing (triggering an inline validation message rather than `alert()`). This is
the function passed to `google.script.run.runBatchAI`.

---

## Testing

### Environment

Jest with ts-jest, jsdom test environment (already configured). No new dependencies needed.

### Mock pattern

Same as existing server tests — set globals on `globalThis` before import:

```typescript
// __tests__/sidebar.test.ts
globalThis.google = {
  script: {
    run: {
      withSuccessHandler: jest.fn().mockReturnThis(),
      withFailureHandler: jest.fn().mockReturnThis(),
      getSheetHeaders: jest.fn(),
      runBatchAI: jest.fn(),
      runTool: jest.fn(),
    },
  },
};

import { buildTagList, applyPreset, assembleRunConfig } from "../src/client/sidebar";
```

### Coverage targets (per-file)

`src/client/sidebar.ts` will have per-file thresholds in `jest.config.cjs` consistent with
other modules. The `init()` function and `showAIPanel()`/`dispatchTool()` wrappers that
call `google.script.run` are excluded from unit testing for the same reason the server
tool orchestrators are excluded — they are coupled to the GAS sandbox runtime.

### What is tested

| Function | Test focus |
|---|---|
| `buildTagList` | Correct number of tags rendered; `data-value` attributes set |
| `buildSingleTagList` | Single-select behavior; `+ New column` tag present when `includeNew=true` |
| `applyPreset` | Correct tags marked `.selected` for each RunConfig field |
| `assembleRunConfig` | Returns valid `RunConfig` from selected DOM state; returns `null` on missing required fields |
| `handleRowRangeChange` | Range inputs shown/hidden based on radio selection |

---

## Performance Impact

| Before | After |
|---|---|
| External DNS + fetch: `fonts.googleapis.com` | Eliminated |
| CSS: inline in HTML | Inline in HTML (unchanged — inlined at build time) |
| JS: inline in HTML | Inline in HTML (unchanged — inlined at build time) |

First-paint improvement comes entirely from removing the cross-origin font fetch. No other
external requests exist.

---

## Rollup Config Sketch

```javascript
// rollup.config.js (array export)
export default [
  // ── Config 1: Server (unchanged) ──────────────────────────────
  {
    input: "src/server/index.ts",
    output: { dir: "dist", format: "iife", name: "_GASEntry", /* ... */ },
    plugins: [nodeResolve(), typescript()],
  },

  // ── Config 2: Client → dist/Sidebar.html ──────────────────────
  {
    input: "src/client/sidebar.ts",
    output: { file: "dist/_sidebar.js", format: "iife", name: "_Sidebar" },
    plugins: [
      nodeResolve(),
      typescript(),
      inlineSidebarHtml({
        template: "src/Sidebar.html",
        css: "src/client/sidebar.css",
        out: "dist/Sidebar.html",
      }),
    ],
  },
];
```

The `inlineSidebarHtml` plugin is defined inline in `rollup.config.js` (~30 lines).
