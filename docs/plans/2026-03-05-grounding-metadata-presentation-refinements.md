# Grounding Metadata Presentation Refinements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Polish the grounding column and sources-column checkbox UX based on four user-requested changes: remove the "Unverified" section, hyperlink search queries to Google, move the checkbox into the Tools field-group with conditional visibility, and fix the code execution format in the grounding column.

**Architecture:** Three focused tasks — (1) strip `getUngroundedSpans`/`Span` from `api.ts` and `index.ts`; (2) update `renderGrounding` in `index.ts` with query hyperlinks and a plain-text code format; (3) rework the checkbox placement and show/hide logic in `configure-ai-run.ts` + one CSS addition. No new pure helpers needed; no new types needed.

**Tech Stack:** TypeScript, Jest/jsdom, Google Apps Script (`SpreadsheetApp.newRichTextValue`)

---

## Reference: current files

Key locations:
- `src/server/api.ts` — `getUngroundedSpans` (lines ~147-190), `Span` interface (lines ~31-35), `getAllSources` (lines ~197-201)
- `src/server/index.ts` — `renderGrounding` (lines ~256-314), import of `getUngroundedSpans` at line ~13
- `src/client/panels/configure-ai-run.ts` — `template()` (lines ~185-230), `mount()` (lines ~22-111), tools list initialized synchronously (lines ~45-49), checkbox initialized in async callback (lines ~82-88)
- `src/client/sidebar.css` — no existing `.grounding-hint` rule
- `__tests__/api.test.ts` — `getUngroundedSpans` describe block (lines ~364-511)
- `__tests__/panels/configure-ai-run.test.ts` — `includeGrounding checkbox` describe block (last describe)

---

## Task 1: Remove `getUngroundedSpans` and `Span`

**Files:**
- Modify: `src/server/api.ts`
- Modify: `src/server/index.ts`
- Modify: `__tests__/api.test.ts`

### Step 1: Remove `Span` interface and `getUngroundedSpans` from `src/server/api.ts`

Delete the `Span` interface (lines ~31-35):
```typescript
// DELETE THIS:
export interface Span {
  startIndex: number;
  endIndex: number;
  text: string;
}
```

Delete the entire `getUngroundedSpans` function (lines ~143-190, including its JSDoc).

Leave `Citation` interface and `getCitations`/`getAllSources` intact. `GeminiGroundingSupport` in `types.ts` stays — it is still used by `getCitations`.

### Step 2: Update imports and `renderGrounding` in `src/server/index.ts`

**a)** Remove `getUngroundedSpans` from the api import line:
```typescript
// BEFORE:
import { getCitations, getUngroundedSpans, getAllSources } from "./api";

// AFTER:
import { getCitations, getAllSources } from "./api";
```

**b)** In `renderGrounding`, remove the `unverified` variable, remove it from the null guard, and remove the Unverified section builder:

```typescript
// BEFORE (lines ~259-288):
function renderGrounding(
  response: GeminiResponse,
): GoogleAppsScript.Spreadsheet.RichTextValue | null {
  const sources = getAllSources(response);
  const queries = response.groundingMetadata?.webSearchQueries ?? [];
  const unverified = getUngroundedSpans(response);
  const codePairs = response.codePairs ?? [];

  if (!sources.length && !queries.length && !unverified.length && !codePairs.length) {
    return null;
  }

  const sections: string[] = [];

  if (codePairs.length > 0) {
    codePairs.forEach(({ code, result }) => {
      sections.push(
        `Code:\n\`\`\`${code.language.toLowerCase()}\n${code.code}\n\`\`\`\n\nOutput:\n${result.output}`,
      );
    });
  } else {
    if (queries.length) {
      sections.push(`Search queries: ${queries.map((q) => `"${q}"`).join(", ")}`);
    }
    if (sources.length) {
      sections.push(
        `Sources (${sources.length}):\n${sources.map((s) => `• ${s.title}`).join("\n")}`,
      );
    }
    if (unverified.length) {
      sections.push(`Unverified:\n${unverified.map((s) => `• "${s.text}"`).join("\n")}`);
    }
  }
  // ... rest unchanged
```

```typescript
// AFTER:
function renderGrounding(
  response: GeminiResponse,
): GoogleAppsScript.Spreadsheet.RichTextValue | null {
  const sources = getAllSources(response);
  const queries = response.groundingMetadata?.webSearchQueries ?? [];
  const codePairs = response.codePairs ?? [];

  if (!sources.length && !queries.length && !codePairs.length) {
    return null;
  }

  const sections: string[] = [];

  if (codePairs.length > 0) {
    codePairs.forEach(({ code, result }) => {
      sections.push(
        `Code:\n\`\`\`${(code.language ?? "").toLowerCase()}\n${code.code}\n\`\`\`\n\nOutput:\n${result.output}`,
      );
    });
  } else {
    if (queries.length) {
      sections.push(`Search queries: ${queries.map((q) => `"${q}"`).join(", ")}`);
    }
    if (sources.length) {
      sections.push(
        `Sources (${sources.length}):\n${sources.map((s) => `• ${s.title}`).join("\n")}`,
      );
    }
  }
  // ... rest unchanged (source hyperlinking block stays as-is)
```

### Step 3: Remove `getUngroundedSpans` tests from `__tests__/api.test.ts`

**a)** Remove `getUngroundedSpans` from the import line:
```typescript
// BEFORE:
import {
  buildGeminiPayload,
  callGeminiAPI,
  invokeGemini,
  getCitations,
  getUngroundedSpans,
  getAllSources,
} from "../src/server/api";

// AFTER:
import {
  buildGeminiPayload,
  callGeminiAPI,
  invokeGemini,
  getCitations,
  getAllSources,
} from "../src/server/api";
```

**b)** Delete the entire `describe("getUngroundedSpans", ...)` block (~lines 364-511).

### Step 4: Run tests

```bash
npm test
```

Expected: all pass (fewer tests than before — the `getUngroundedSpans` suite is gone).

### Step 5: Typecheck

```bash
npm run typecheck
```

Expected: passes.

### Step 6: Commit

```bash
git add src/server/api.ts src/server/index.ts __tests__/api.test.ts
git commit -m "refactor: remove getUngroundedSpans — Unverified section dropped from grounding column"
```

---

## Task 2: Query hyperlinks and code execution format in `renderGrounding`

**Files:**
- Modify: `src/server/index.ts`

No unit tests — `index.ts` is excluded from coverage. Verified by typecheck + build.

### Step 1: Add query hyperlinks

In `renderGrounding`, the queries section currently pushes plain text. After building `fullText` and the `builder`, we need to add `setLinkUrl` calls for each query's quoted text.

**Replace the entire `renderGrounding` function** with the version below. Key changes:
1. Track the start index of the queries section in `fullText` so we can find the right character range for each quoted query.
2. For each query, construct the Google Search URL: `https://www.google.com/search?q=${encodeURIComponent(query)}`.
3. Improve the code execution format: replace markdown backtick fences with a clean plain-text layout that reads naturally in a spreadsheet cell.

```typescript
function renderGrounding(
  response: GeminiResponse,
): GoogleAppsScript.Spreadsheet.RichTextValue | null {
  const sources = getAllSources(response);
  const queries = response.groundingMetadata?.webSearchQueries ?? [];
  const codePairs = response.codePairs ?? [];

  if (!sources.length && !queries.length && !codePairs.length) {
    return null;
  }

  const sections: string[] = [];

  if (codePairs.length > 0) {
    // Plain-text format — markdown fences render literally in Sheets cells.
    codePairs.forEach(({ code, result }) => {
      const lang = code.language ? `(${code.language.toLowerCase()})` : "";
      sections.push(`Code ${lang}:\n${code.code}\n\nOutput:\n${result.output}`);
    });
  } else {
    if (queries.length) {
      sections.push(`Search queries: ${queries.map((q) => `"${q}"`).join(", ")}`);
    }
    if (sources.length) {
      sections.push(
        `Sources (${sources.length}):\n${sources.map((s) => `• ${s.title}`).join("\n")}`,
      );
    }
  }

  const fullText = sections.join("\n\n");
  const builder = SpreadsheetApp.newRichTextValue().setText(fullText);

  // Hyperlink each quoted query to a Google Search for that query.
  if (queries.length) {
    const queriesHeader = "Search queries: ";
    const queriesSectionStart = fullText.indexOf(queriesHeader);
    if (queriesSectionStart >= 0) {
      queries.forEach((q) => {
        const quoted = `"${q}"`;
        const idx = fullText.indexOf(quoted, queriesSectionStart);
        if (idx !== -1) {
          const url = `https://www.google.com/search?q=${encodeURIComponent(q)}`;
          builder.setLinkUrl(idx, idx + quoted.length, url);
        }
      });
    }
  }

  // Hyperlink source titles within the Sources section only.
  const sourcesHeader = sources.length > 0 ? `Sources (${sources.length}):` : null;
  const sourceSectionStart = sourcesHeader ? fullText.indexOf(sourcesHeader) : -1;
  const sourceSectionEnd =
    sourceSectionStart >= 0
      ? fullText.indexOf("\n\n", sourceSectionStart + sourcesHeader!.length) !== -1
        ? fullText.indexOf("\n\n", sourceSectionStart + sourcesHeader!.length)
        : fullText.length
      : -1;

  if (sourceSectionStart >= 0) {
    sources.forEach(({ uri, title }) => {
      const bullet = `• ${title}`;
      const idx = fullText.indexOf(bullet, sourceSectionStart);
      if (idx !== -1 && idx < sourceSectionEnd) {
        builder.setLinkUrl(idx + 2, idx + 2 + title.length, uri);
      }
    });
  }

  return builder.build();
}
```

### Step 2: Typecheck

```bash
npm run typecheck
```

Expected: passes.

### Step 3: Run full test suite

```bash
npm test
```

Expected: all pass (no test changes needed — `index.ts` is excluded from coverage).

### Step 4: Commit

```bash
git add src/server/index.ts
git commit -m "feat: hyperlink search queries to Google Search; plain-text code execution format"
```

---

## Task 3: Grounding checkbox UX — move into Tools group, conditional visibility

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Modify: `src/client/sidebar.css`
- Modify: `__tests__/panels/configure-ai-run.test.ts`

### Step 1: Write failing tests

Add these tests to the `"includeGrounding checkbox"` describe block in `__tests__/panels/configure-ai-run.test.ts`.

**Note:** read the existing test file first to understand `mountAndLoad` and `applyPreset`. The `mountAndLoad` helper likely accepts `params` (first arg) and `savedState` (second arg).

Add after the existing 6 tests in the `includeGrounding checkbox` describe block:

```typescript
it("hides the grounding group when no tools are selected", async () => {
  const { container } = await mountAndLoad();
  const group = container.querySelector<HTMLElement>("#include-grounding-group");
  expect(group?.style.display).toBe("none");
});

it("shows the grounding group when a tool is selected", async () => {
  const { container } = await mountAndLoad();
  // Click the first tool tag to select it
  container.querySelector<HTMLElement>("#tools-list .tag")?.click();
  const group = container.querySelector<HTMLElement>("#include-grounding-group");
  expect(group?.style.display).toBe("block");
});

it("shows the grounding group on mount when tools are pre-selected in savedState", async () => {
  const { container } = await mountAndLoad(undefined, {
    userPromptCols: ["col_a"],
    driveFileCols: [],
    systemPromptCol: "",
    outputCol: "ai_inference",
    tools: ["google_search"],
    includeGrounding: false,
  });
  const group = container.querySelector<HTMLElement>("#include-grounding-group");
  expect(group?.style.display).toBe("block");
});

it("hides the grounding group again when all tools are deselected", async () => {
  const { container } = await mountAndLoad();
  // Select then deselect a tool
  const tag = container.querySelector<HTMLElement>("#tools-list .tag")!;
  tag.click(); // select
  tag.click(); // deselect
  const group = container.querySelector<HTMLElement>("#include-grounding-group");
  expect(group?.style.display).toBe("none");
});
```

Also update the existing `"restores includeGrounding from savedState"` test to include a tool so the checkbox group is visible:

```typescript
it("restores includeGrounding from savedState", async () => {
  const { container } = await mountAndLoad(undefined, {
    userPromptCols: ["col_a"],
    driveFileCols: [],
    systemPromptCol: "",
    outputCol: "ai_inference",
    tools: ["google_search"],     // ← add this so group is visible
    includeGrounding: true,
  });
  const cb = container.querySelector<HTMLInputElement>("#include-grounding-cb")!;
  expect(cb.checked).toBe(true);
});
```

### Step 2: Run to confirm failures

```bash
npx jest __tests__/panels/configure-ai-run.test.ts -t "includeGrounding"
```

Expected: 4 new tests FAIL (`#include-grounding-group` not found or always visible).

### Step 3: Update `template()` in `configure-ai-run.ts`

**Move the checkbox inside the Tools field-group and wrap it in `#include-grounding-group`:**

Replace the Tools + separate checkbox field-groups:
```html
<!-- REMOVE these two field-groups: -->
<div class="field-group">
  <span class="field-label">Tools <span class="optional">(optional)</span></span>
  <div id="tools-list" class="tag-list"></div>
</div>
<div class="field-group">
  <label class="checkbox-label">
    <input type="checkbox" id="include-grounding-cb" />
    Include sources column (<span id="grounding-col-name">_grounding</span>)
  </label>
</div>
```

With:
```html
<!-- REPLACE with: -->
<div class="field-group">
  <span class="field-label">Tools <span class="optional">(optional)</span></span>
  <div id="tools-list" class="tag-list"></div>
  <div id="include-grounding-group" style="display:none">
    <label class="grounding-hint">
      <input type="checkbox" id="include-grounding-cb" />
      Include sources column (<span id="grounding-col-name">_grounding</span>)
    </label>
  </div>
</div>
```

### Step 4: Move checkbox initialization to synchronous scope in `mount()`

The checkbox now lives outside the async headers callback — initialize it synchronously alongside `this.toolsList`:

**a)** Remove `this.includeGroundingCb` initialization from the async `getSheetHeaders().then()` callback (delete lines ~82-88).

**b)** After `this.toolsList = new TagList(...)`, add:

```typescript
this.includeGroundingCb =
  container.querySelector<HTMLInputElement>("#include-grounding-cb");
if (this.includeGroundingCb && preset.includeGrounding) {
  this.includeGroundingCb.checked = true;
}

// Show/hide the grounding group based on tool selection.
const updateGroundingVisibility = (): void => {
  const group = container.querySelector<HTMLElement>("#include-grounding-group");
  if (group) {
    group.style.display = (this.toolsList?.getValue().length ?? 0) > 0 ? "block" : "none";
  }
};
updateGroundingVisibility();
container.querySelector("#tools-list")?.addEventListener("click", updateGroundingVisibility);
```

**c)** Keep the `updateGroundingLabel` function in the async `getSheetHeaders().then()` callback exactly where it is — it still depends on `outputColList`.

### Step 5: Add `.grounding-hint` CSS rule to `src/client/sidebar.css`

Add after the `.field-group` rule (around line 114):

```css
.grounding-hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-secondary);
    margin-top: 8px;
    cursor: pointer;
}
```

### Step 6: Run tests

```bash
npx jest __tests__/panels/configure-ai-run.test.ts
```

Expected: all pass.

### Step 7: Typecheck

```bash
npm run typecheck
```

Expected: passes.

### Step 8: Run full suite

```bash
npm test
```

Expected: all pass.

### Step 9: Commit

```bash
git add src/client/panels/configure-ai-run.ts src/client/sidebar.css __tests__/panels/configure-ai-run.test.ts
git commit -m "feat: move grounding checkbox into Tools section with conditional visibility"
```

---

## Task 4: Full verification

### Step 1: Coverage

```bash
npm run test:coverage
```

Expected: all pass, per-file thresholds met.

### Step 2: Build

```bash
npm run build
```

Expected: clean build.

### Step 3: Lint and format

```bash
npm run lint && npm run format:check
```

Expected: no issues.
