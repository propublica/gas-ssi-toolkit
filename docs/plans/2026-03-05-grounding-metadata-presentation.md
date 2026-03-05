# Grounding Metadata Presentation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render Gemini grounding metadata into the spreadsheet — inline source hyperlinks in the output cell via `RichTextValue`, and an optional `{outputCol}_grounding` column with full provenance (search queries, clickable source list, unverified claims).

**Architecture:** Three pure helpers (`getCitations`, `getUngroundedSpans`, `getAllSources`) live in `api.ts` and are fully unit-tested. Two GAS renderers (`renderInference`, `renderGrounding`) live in `index.ts` and call those helpers to build `RichTextValue` objects. `runBatchAI` uses `setRichTextValue` instead of `setValue`. A checkbox in `ConfigureAIRunPanel` gates the grounding column via `RunConfig.includeGrounding`.

**Tech Stack:** TypeScript, Jest/jsdom, Google Apps Script (`SpreadsheetApp.newRichTextValue`)

---

## Reference: `GeminiResponse` shape (already exists in `src/server/types.ts`)

```typescript
interface GeminiGroundingChunk {
  web?: { uri: string; title: string };
  retrievedContext?: { uri: string; title: string };
}
interface GeminiGroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GeminiGroundingChunk[];
  // groundingSupports added in Task 1
}
interface GeminiResponse {
  text: string;
  groundingMetadata?: GeminiGroundingMetadata;
  codePairs?: GeminiCodePair[];
}
```

---

### Task 1: Add `GeminiGroundingSupport` type and `includeGrounding` to `RunConfig`

**Files:**
- Modify: `src/server/types.ts`
- Modify: `src/shared/types.ts`

No tests — pure type changes. TypeScript enforces correctness at compile time.

**Step 1: Add `GeminiGroundingSupport` to `src/server/types.ts`**

Add this interface after `GeminiGroundingChunk` (around line 39), then add `groundingSupports` to `GeminiGroundingMetadata`:

```typescript
export interface GeminiGroundingSupport {
  segment: {
    startIndex: number;
    endIndex: number;
    text: string;
  };
  groundingChunkIndices: number[];
  confidenceScores?: number[];
}
```

Update `GeminiGroundingMetadata`:

```typescript
export interface GeminiGroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GeminiGroundingChunk[];
  groundingSupports?: GeminiGroundingSupport[];
}
```

**Step 2: Add `includeGrounding` to `RunConfig` in `src/shared/types.ts`**

```typescript
export interface RunConfig {
  userPromptCols: string[];
  driveFileCols?: string[];
  systemPromptCol?: string;
  outputCol: string;
  rowRange?: { start: number; end: number };
  tools?: ToolId[];
  /** When true, runBatchAI writes a {outputCol}_grounding column with source attribution. */
  includeGrounding?: boolean;
}
```

**Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: passes. `callGeminiAPI` already spreads `groundingMetadata` from the raw JSON, so `groundingSupports` will be captured automatically — no parser change needed.

**Step 4: Commit**

```bash
git add src/server/types.ts src/shared/types.ts
git commit -m "feat: add GeminiGroundingSupport type and RunConfig.includeGrounding"
```

---

### Task 2: Add `getCitations` to `api.ts`

**Files:**
- Modify: `src/server/api.ts`
- Modify: `__tests__/api.test.ts`

**Step 1: Write the failing tests**

Add a new describe block at the end of `__tests__/api.test.ts`. Update the import line to include the new exports:

```typescript
import { buildGeminiPayload, callGeminiAPI, invokeGemini, getCitations } from "../src/server/api";
import type { GeminiResponse } from "../src/server/types";
```

```typescript
describe("getCitations", () => {
  it("returns empty array when no groundingMetadata", () => {
    expect(getCitations({ text: "hello" })).toEqual([]);
  });

  it("returns empty array when groundingSupports is absent", () => {
    expect(
      getCitations({
        text: "hello",
        groundingMetadata: {
          groundingChunks: [{ web: { uri: "https://a.com", title: "A" } }],
        },
      }),
    ).toEqual([]);
  });

  it("maps a single support entry to a citation with resolved sources", () => {
    const response: GeminiResponse = {
      text: "The sky is blue.",
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "Source A" } },
          { web: { uri: "https://b.com", title: "Source B" } },
        ],
        groundingSupports: [
          {
            segment: { startIndex: 4, endIndex: 10, text: "sky is" },
            groundingChunkIndices: [0, 1],
          },
        ],
      },
    };
    const citations = getCitations(response);
    expect(citations).toHaveLength(1);
    expect(citations[0].startIndex).toBe(4);
    expect(citations[0].endIndex).toBe(10);
    expect(citations[0].sources).toEqual([
      { uri: "https://a.com", title: "Source A" },
      { uri: "https://b.com", title: "Source B" },
    ]);
  });

  it("resolves retrievedContext chunks (url_context) the same way", () => {
    const response: GeminiResponse = {
      text: "Some claim.",
      groundingMetadata: {
        groundingChunks: [
          { retrievedContext: { uri: "https://c.com", title: "Source C" } },
        ],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 4, text: "Some" },
            groundingChunkIndices: [0],
          },
        ],
      },
    };
    expect(getCitations(response)[0].sources[0]).toEqual({
      uri: "https://c.com",
      title: "Source C",
    });
  });

  it("skips chunk indices that point to chunks with neither web nor retrievedContext", () => {
    const response: GeminiResponse = {
      text: "text",
      groundingMetadata: {
        groundingChunks: [{}],
        groundingSupports: [
          {
            segment: { startIndex: 0, endIndex: 4, text: "text" },
            groundingChunkIndices: [0],
          },
        ],
      },
    };
    expect(getCitations(response)[0].sources).toEqual([]);
  });
});
```

**Step 2: Run to confirm failures**

```bash
npx jest __tests__/api.test.ts -t "getCitations"
```
Expected: FAIL — `getCitations` not exported.

**Step 3: Add `Citation` interface and `getCitations` to `src/server/api.ts`**

Add the `Citation` interface and type import before `buildGeminiPayload`. Update the import at the top to include the new types:

```typescript
import type {
  GeminiInlineData,
  GeminiRequest,
  GeminiResponse,
  GeminiCodePair,
  GeminiGroundingSupport,
} from "./types";

export interface Citation {
  startIndex: number;
  endIndex: number;
  sources: Array<{ uri: string; title: string }>;
}
```

Add after `invokeGemini`:

```typescript
/**
 * Resolve groundingSupports entries into Citation objects with sources
 * joined from groundingChunks by index. Pure — no GAS globals.
 */
export function getCitations(response: GeminiResponse): Citation[] {
  const supports = response.groundingMetadata?.groundingSupports ?? [];
  const chunks = response.groundingMetadata?.groundingChunks ?? [];
  return supports.map((s: GeminiGroundingSupport) => ({
    startIndex: s.segment.startIndex,
    endIndex: s.segment.endIndex,
    sources: s.groundingChunkIndices
      .map((i) => {
        const chunk = chunks[i];
        return chunk?.web ?? chunk?.retrievedContext ?? null;
      })
      .filter((src): src is { uri: string; title: string } => src !== null),
  }));
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/api.test.ts -t "getCitations"
```
Expected: all pass.

**Step 5: Commit**

```bash
git add src/server/api.ts __tests__/api.test.ts
git commit -m "feat: add getCitations pure helper to api.ts"
```

---

### Task 3: Add `getUngroundedSpans` to `api.ts`

**Files:**
- Modify: `src/server/api.ts`
- Modify: `__tests__/api.test.ts`

**Step 1: Write the failing tests**

Update the import line:

```typescript
import { buildGeminiPayload, callGeminiAPI, invokeGemini, getCitations, getUngroundedSpans } from "../src/server/api";
```

```typescript
describe("getUngroundedSpans", () => {
  it("returns empty array when no groundingMetadata", () => {
    expect(getUngroundedSpans({ text: "hello" })).toEqual([]);
  });

  it("returns empty array when groundingSupports is absent", () => {
    expect(
      getUngroundedSpans({
        text: "hello",
        groundingMetadata: { groundingChunks: [] },
      }),
    ).toEqual([]);
  });

  it("returns the full text as ungrounded when groundingSupports is empty array", () => {
    const spans = getUngroundedSpans({
      text: "Nothing is grounded.",
      groundingMetadata: { groundingSupports: [] },
    });
    expect(spans).toEqual([]);
  });

  it("finds a gap before the first support", () => {
    const spans = getUngroundedSpans({
      text: "Preamble. Cited claim.",
      groundingMetadata: {
        groundingSupports: [
          { segment: { startIndex: 10, endIndex: 22, text: "Cited claim." }, groundingChunkIndices: [0] },
        ],
      },
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("Preamble.");
    expect(spans[0].startIndex).toBe(0);
    expect(spans[0].endIndex).toBe(10);
  });

  it("finds a gap after the last support", () => {
    const spans = getUngroundedSpans({
      text: "Cited claim. Trailing remark.",
      groundingMetadata: {
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 12, text: "Cited claim." }, groundingChunkIndices: [0] },
        ],
      },
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("Trailing remark.");
  });

  it("finds a gap between two non-overlapping supports", () => {
    const spans = getUngroundedSpans({
      text: "First. Gap text. Second.",
      groundingMetadata: {
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 6, text: "First." }, groundingChunkIndices: [0] },
          { segment: { startIndex: 17, endIndex: 24, text: "Second." }, groundingChunkIndices: [1] },
        ],
      },
    });
    expect(spans).toHaveLength(1);
    expect(spans[0].text).toBe("Gap text.");
  });

  it("merges overlapping supports before finding gaps", () => {
    // Two supports that overlap — should produce one merged covered region
    const spans = getUngroundedSpans({
      text: "AAAABBBBCCCC",
      groundingMetadata: {
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 8, text: "AAAABBBB" }, groundingChunkIndices: [0] },
          { segment: { startIndex: 4, endIndex: 12, text: "BBBBCCCC" }, groundingChunkIndices: [1] },
        ],
      },
    });
    expect(spans).toEqual([]); // fully covered
  });

  it("skips whitespace-only gaps", () => {
    const spans = getUngroundedSpans({
      text: "First.   Second.",
      groundingMetadata: {
        groundingSupports: [
          { segment: { startIndex: 0, endIndex: 6, text: "First." }, groundingChunkIndices: [0] },
          { segment: { startIndex: 9, endIndex: 16, text: "Second." }, groundingChunkIndices: [1] },
        ],
      },
    });
    expect(spans).toEqual([]); // gap is only whitespace
  });
});
```

**Step 2: Run to confirm failures**

```bash
npx jest __tests__/api.test.ts -t "getUngroundedSpans"
```
Expected: FAIL.

**Step 3: Add `Span` interface and `getUngroundedSpans` to `src/server/api.ts`**

Add `Span` interface alongside `Citation`:

```typescript
export interface Span {
  startIndex: number;
  endIndex: number;
  text: string;
}
```

Add after `getCitations`:

```typescript
/**
 * Find regions of response.text NOT covered by any groundingSupports segment.
 * These are claims the model made without citation evidence. Pure — no GAS globals.
 */
export function getUngroundedSpans(response: GeminiResponse): Span[] {
  const supports = response.groundingMetadata?.groundingSupports;
  if (!supports || supports.length === 0) return [];

  // Sort by startIndex, then merge overlapping/adjacent intervals
  const sorted = [...supports].sort(
    (a, b) => a.segment.startIndex - b.segment.startIndex,
  );
  const merged: Array<{ start: number; end: number }> = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    if (last && s.segment.startIndex <= last.end) {
      last.end = Math.max(last.end, s.segment.endIndex);
    } else {
      merged.push({ start: s.segment.startIndex, end: s.segment.endIndex });
    }
  }

  // Find gaps between merged covered intervals
  const gaps: Span[] = [];
  let cursor = 0;
  for (const { start, end } of merged) {
    if (cursor < start) {
      const gapText = response.text.slice(cursor, start).trim();
      if (gapText) gaps.push({ startIndex: cursor, endIndex: start, text: gapText });
    }
    cursor = end;
  }
  if (cursor < response.text.length) {
    const tail = response.text.slice(cursor).trim();
    if (tail) gaps.push({ startIndex: cursor, endIndex: response.text.length, text: tail });
  }
  return gaps;
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/api.test.ts -t "getUngroundedSpans"
```
Expected: all pass.

**Step 5: Commit**

```bash
git add src/server/api.ts __tests__/api.test.ts
git commit -m "feat: add getUngroundedSpans pure helper to api.ts"
```

---

### Task 4: Add `getAllSources` to `api.ts`

**Files:**
- Modify: `src/server/api.ts`
- Modify: `__tests__/api.test.ts`

**Step 1: Write the failing tests**

Update the import:

```typescript
import {
  buildGeminiPayload, callGeminiAPI, invokeGemini,
  getCitations, getUngroundedSpans, getAllSources,
} from "../src/server/api";
```

```typescript
describe("getAllSources", () => {
  it("returns empty array when no groundingMetadata", () => {
    expect(getAllSources({ text: "hello" })).toEqual([]);
  });

  it("returns empty array when groundingChunks is absent", () => {
    expect(getAllSources({ text: "hello", groundingMetadata: {} })).toEqual([]);
  });

  it("returns web sources", () => {
    const response: GeminiResponse = {
      text: "text",
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "A" } },
          { web: { uri: "https://b.com", title: "B" } },
        ],
      },
    };
    expect(getAllSources(response)).toEqual([
      { uri: "https://a.com", title: "A" },
      { uri: "https://b.com", title: "B" },
    ]);
  });

  it("returns retrievedContext sources", () => {
    const response: GeminiResponse = {
      text: "text",
      groundingMetadata: {
        groundingChunks: [
          { retrievedContext: { uri: "https://c.com", title: "C" } },
        ],
      },
    };
    expect(getAllSources(response)).toEqual([{ uri: "https://c.com", title: "C" }]);
  });

  it("skips chunks with neither web nor retrievedContext", () => {
    const response: GeminiResponse = {
      text: "text",
      groundingMetadata: {
        groundingChunks: [
          { web: { uri: "https://a.com", title: "A" } },
          {},
        ],
      },
    };
    expect(getAllSources(response)).toEqual([{ uri: "https://a.com", title: "A" }]);
  });
});
```

**Step 2: Run to confirm failures**

```bash
npx jest __tests__/api.test.ts -t "getAllSources"
```
Expected: FAIL.

**Step 3: Add `getAllSources` to `src/server/api.ts`**

Add after `getUngroundedSpans`:

```typescript
/**
 * Return all grounding sources as a flat { uri, title } array.
 * Covers both web (google_search) and retrievedContext (url_context) chunks.
 * Pure — no GAS globals.
 */
export function getAllSources(
  response: GeminiResponse,
): Array<{ uri: string; title: string }> {
  return (response.groundingMetadata?.groundingChunks ?? [])
    .map((chunk) => chunk.web ?? chunk.retrievedContext ?? null)
    .filter((src): src is { uri: string; title: string } => src !== null);
}
```

**Step 4: Run all api tests**

```bash
npx jest __tests__/api.test.ts
```
Expected: all pass.

**Step 5: Commit**

```bash
git add src/server/api.ts __tests__/api.test.ts
git commit -m "feat: add getAllSources pure helper to api.ts"
```

---

### Task 5: Add `includeGrounding` checkbox to `ConfigureAIRunPanel`

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`
- Modify: `__tests__/panels/configure-ai-run.test.ts`

**Step 1: Write the failing tests**

Add to `__tests__/panels/configure-ai-run.test.ts`. Find the existing `assembleRunConfig` describe block (or `handleRun`) and add:

```typescript
describe("includeGrounding checkbox", () => {
  it("renders the include-grounding checkbox", async () => {
    const { container } = await mountAndLoad();
    expect(container.querySelector("#include-grounding-cb")).not.toBeNull();
  });

  it("assembleRunConfig includes includeGrounding: true when checkbox is checked", async () => {
    const { container } = await mountAndLoad();
    const cb = container.querySelector<HTMLInputElement>("#include-grounding-cb")!;
    cb.checked = true;
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    const config = (services.runBatchAI as jest.Mock).mock.calls[0]?.[0] as RunConfig | undefined;
    expect(config?.includeGrounding).toBe(true);
  });

  it("assembleRunConfig omits includeGrounding when checkbox is unchecked", async () => {
    const { container } = await mountAndLoad({ userPromptCols: ["col_a"], outputCol: "ai_inference" });
    container.querySelector<HTMLInputElement>("#include-grounding-cb")!.checked = false;
    container.querySelector<HTMLButtonElement>("#run-btn")!.click();
    await Promise.resolve();
    const config = (services.runBatchAI as jest.Mock).mock.calls[0]?.[0] as RunConfig | undefined;
    expect(config?.includeGrounding).toBeFalsy();
  });

  it("unmount saves includeGrounding state", async () => {
    const { container, panel } = await mountAndLoad();
    container.querySelector<HTMLInputElement>("#include-grounding-cb")!.checked = true;
    // Select required fields so unmount() doesn't return undefined
    container.querySelectorAll<HTMLElement>("#user-prompt-cols .tag")[0]?.click();
    const saved = panel.unmount();
    expect(saved?.includeGrounding).toBe(true);
  });

  it("restores includeGrounding from savedState", async () => {
    const { container } = await mountAndLoad(undefined, {
      userPromptCols: ["col_a"],
      driveFileCols: [],
      systemPromptCol: "",
      outputCol: "ai_inference",
      includeGrounding: true,
    });
    const cb = container.querySelector<HTMLInputElement>("#include-grounding-cb")!;
    expect(cb.checked).toBe(true);
  });
});
```

Note: the `runBatchAI` mock is already set up in the test file. The `mountAndLoad` helper needs `userPromptCols` and `outputCol` set for `assembleRunConfig` to succeed — use params to pre-select them, or click tags in the test.

**Step 2: Run to confirm failures**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts -t "includeGrounding"
```
Expected: FAIL.

**Step 3: Update `configure-ai-run.ts`**

**a) Extend `SavedState` type** — add `includeGrounding` to the omit list so it stays optional:

```typescript
export type SavedState = Required<Omit<RunConfig, "rowRange" | "tools" | "includeGrounding">> &
  Pick<RunConfig, "rowRange" | "tools" | "includeGrounding">;
```

**b) Add private field:**

```typescript
private includeGroundingCb: HTMLInputElement | null = null;
```

**c) Wire it up in `mount()` — after the `toolsList` initialization:**

```typescript
this.includeGroundingCb = container.querySelector<HTMLInputElement>("#include-grounding-cb");
if (this.includeGroundingCb && preset.includeGrounding) {
  this.includeGroundingCb.checked = true;
}
```

**d) Add dynamic label update** — inside the `getSheetHeaders().then(...)` success callback, after `outputColList` is initialized:

```typescript
const updateGroundingLabel = (): void => {
  const val = this.outputColList?.getValue() ?? "";
  const label = container.querySelector<HTMLElement>("#grounding-col-name");
  if (label) label.textContent = val ? `${val}_grounding` : "_grounding";
};
updateGroundingLabel();
container.querySelector("#output-col")?.addEventListener("click", updateGroundingLabel);
```

**e) Update `unmount()`:**

```typescript
return {
  userPromptCols: this.userPromptList.getValue(),
  driveFileCols: this.driveFileList?.getValue() ?? [],
  systemPromptCol: this.systemPromptList?.getValue() ?? "",
  outputCol: this.outputColList?.getValue() ?? "",
  rowRange: this.rowRangeComp?.getValue(),
  tools: (this.toolsList?.getValue() ?? []) as ToolId[],
  includeGrounding: this.includeGroundingCb?.checked ?? false,
};
```

**f) Update `assembleRunConfig()`** — add after `tools` resolution:

```typescript
const includeGrounding = this.includeGroundingCb?.checked ?? false;

return {
  userPromptCols,
  driveFileCols: driveFileCols.length > 0 ? driveFileCols : undefined,
  systemPromptCol,
  outputCol,
  rowRange,
  tools: tools.length > 0 ? tools : undefined,
  includeGrounding: includeGrounding || undefined,
};
```

**g) Add to `template()`** — after the tools field-group, before row-range:

```html
<div class="field-group">
  <label class="checkbox-label">
    <input type="checkbox" id="include-grounding-cb" />
    Include sources column (<span id="grounding-col-name">_grounding</span>)
  </label>
</div>
```

**Step 4: Run tests**

```bash
npx jest __tests__/panels/configure-ai-run.test.ts
```
Expected: all pass.

**Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: passes.

**Step 6: Commit**

```bash
git add src/client/panels/configure-ai-run.ts __tests__/panels/configure-ai-run.test.ts
git commit -m "feat: add includeGrounding checkbox to ConfigureAIRunPanel"
```

---

### Task 6: Add renderers and update `runBatchAI` in `index.ts`

**Files:**
- Modify: `src/server/index.ts`

No unit tests — `index.ts` is excluded from coverage (deeply coupled to SpreadsheetApp). Verified manually against a live sheet.

**Step 1: Update imports in `src/server/index.ts`**

Add the three helpers to the api import:

```typescript
import { getCitations, getUngroundedSpans, getAllSources } from "./api";
```

**Step 2: Add `renderInference` above `runBatchAI`**

```typescript
function renderInference(
  response: import("./types").GeminiResponse,
): GoogleAppsScript.Spreadsheet.RichTextValue {
  const builder = SpreadsheetApp.newRichTextValue().setText(response.text);
  getCitations(response).forEach(({ startIndex, endIndex, sources }) => {
    if (sources[0]) builder.setLinkUrl(startIndex, endIndex, sources[0].uri);
  });
  return builder.build();
}
```

**Step 3: Add `renderGrounding` above `runBatchAI`**

```typescript
function renderGrounding(
  response: import("./types").GeminiResponse,
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
      sections.push(
        `Unverified:\n${unverified.map((s) => `• "${s.text}"`).join("\n")}`,
      );
    }
  }

  const fullText = sections.join("\n\n");
  const builder = SpreadsheetApp.newRichTextValue().setText(fullText);

  // Hyperlink each source title in the Sources section
  sources.forEach(({ uri, title }) => {
    const bullet = `• ${title}`;
    let searchFrom = 0;
    let idx = fullText.indexOf(bullet, searchFrom);
    while (idx !== -1) {
      builder.setLinkUrl(idx + 2, idx + 2 + title.length, uri); // +2 skips "• "
      searchFrom = idx + bullet.length;
      idx = fullText.indexOf(bullet, searchFrom);
    }
  });

  return builder.build();
}
```

**Step 4: Update the output column resolution block and row loop in `runBatchAI`**

After the existing output column resolution (around line 281), add the grounding column resolution:

```typescript
// Resolve grounding column — create if not found (only when opted in)
let groundingIdx = -1;
const groundingColName = config.outputCol + "_grounding";
if (config.includeGrounding) {
  groundingIdx = headers.indexOf(groundingColName);
  if (groundingIdx === -1) {
    const newColIdx = sheet.getLastColumn() + 1;
    sheet.getRange(1, newColIdx).setValue(groundingColName);
    groundingIdx = newColIdx - 1;
    headers.push(groundingColName); // keep in sync for subsequent rows
  }
}
```

Replace the row-writing block (currently lines 317–322):

```typescript
const result = runInference(userPrompts, driveLinks, systemPrompt, config.tools);
if (result === null) continue;

sheet.getRange(realRowIndex, outputIdx + 1).setRichTextValue(renderInference(result));

if (config.includeGrounding && groundingIdx >= 0) {
  const groundingValue = renderGrounding(result);
  if (groundingValue !== null) {
    sheet.getRange(realRowIndex, groundingIdx + 1).setRichTextValue(groundingValue);
  }
}

processed++;
SpreadsheetApp.flush();
```

**Step 5: Typecheck and full test run**

```bash
npm run typecheck && npm test
```
Expected: all pass.

**Step 6: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: renderInference/renderGrounding in runBatchAI; RichTextValue output"
```

---

### Task 7: Full verification

**Step 1: Coverage**

```bash
npm run test:coverage
```
Expected: all pass, per-file thresholds met.

**Step 2: Build**

```bash
npm run build
```
Expected: clean build.

**Step 3: Lint and format**

```bash
npm run lint && npm run format:check
```
Expected: no issues.
