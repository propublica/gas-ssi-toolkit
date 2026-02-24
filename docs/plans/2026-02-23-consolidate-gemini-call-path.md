# Consolidate Gemini Call Path Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Introduce `invokeGemini` as the single Gemini entry point, add a `runInference` handler that owns the full input-normalization-to-output-cell pipeline, move `flattenArg` and `TOOL_REGISTRY` to their canonical modules, and simplify `runBatchAI`'s loop to a single `runInference` call per row.

**Architecture:** `invokeGemini` in `api.ts` owns auth resolution. `runInference` in `inference.ts` owns input normalization (text casting via `flattenArg`, Drive file encoding via `fetchAndEncodeFile`) and writes the result to a provided output cell. `SSI` stays as a thin `invokeGemini` wrapper that returns a string. `runBatchAI` extracts row values based on mode and delegates each row to `runInference`.

**Tech Stack:** TypeScript, Jest/ts-jest, Google Apps Script globals (mocked via `globalThis` before imports)

**Design doc:** `docs/plans/2026-02-23-consolidate-gemini-call-path-design.md`

---

### Task 1: Move `flattenArg` to `utils.ts`

**Files:**
- Modify: `src/server/utils.ts`
- Modify: `__tests__/utils.test.ts`

**Step 1: Write the failing tests**

Add `flattenArg` to the import at the top of `__tests__/utils.test.ts`:

```typescript
import {
  extractId,
  isValidDriveLink,
  createSeededRandom,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  flattenArg,
} from "../src/server/utils";
```

Add this describe block at the bottom of the file:

```typescript
describe("flattenArg", () => {
  it("wraps a scalar string in an array", () => {
    expect(flattenArg("hello")).toEqual(["hello"]);
  });

  it("flattens a vertical range (multiple rows, one column)", () => {
    expect(flattenArg([["row1"], ["row2"], ["row3"]])).toEqual(["row1", "row2", "row3"]);
  });

  it("flattens a horizontal range (one row, multiple columns)", () => {
    expect(flattenArg([["col1", "col2", "col3"]])).toEqual(["col1", "col2", "col3"]);
  });

  it("filters empty strings from ranges", () => {
    expect(flattenArg([["text", "", "more"]])).toEqual(["text", "more"]);
  });

  it("filters null values from ranges", () => {
    expect(flattenArg([["a", null, "b"]])).toEqual(["a", "b"]);
  });

  it("returns an empty array for null input", () => {
    expect(flattenArg(null)).toEqual([]);
  });

  it("converts non-string scalars to strings", () => {
    expect(flattenArg(42)).toEqual(["42"]);
  });
});
```

**Step 2: Run to verify failure**

```bash
npx jest __tests__/utils.test.ts --no-coverage
```

Expected: FAIL — `flattenArg` is not exported from `src/server/utils`

**Step 3: Implement in `utils.ts`**

Add at the bottom of `src/server/utils.ts`:

```typescript
/**
 * Normalize a custom function argument to a flat array of non-empty strings.
 * GAS passes single-cell references as raw scalars and ranges as 2D arrays.
 */
export function flattenArg(val: unknown): string[] {
  if (!Array.isArray(val)) return val != null ? [String(val)] : [];
  return (val as unknown[][])
    .flat()
    .filter((v) => v !== "" && v != null)
    .map(String);
}
```

**Step 4: Run to verify passage**

```bash
npx jest __tests__/utils.test.ts --no-coverage
```

Expected: PASS — all tests including the new `flattenArg` block

**Step 5: Commit**

```bash
git add src/server/utils.ts __tests__/utils.test.ts
git commit -m "refactor: move flattenArg to utils.ts"
```

---

### Task 2: Create `src/server/tools.ts`

**Files:**
- Create: `src/server/tools.ts`

This module is a pure constant export with no branching logic — no threshold entry needed in `jest.config.cjs` (same rationale as `config.ts` and `dialog.ts`).

**Step 1: Create the file**

```typescript
// src/server/tools.ts
import type { GeminiFunctionDeclaration } from "../shared/types";

export const TOOL_REGISTRY: Record<string, GeminiFunctionDeclaration> = {};
```

**Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

**Step 3: Commit**

```bash
git add src/server/tools.ts
git commit -m "refactor: extract TOOL_REGISTRY to tools.ts"
```

---

### Task 3: Add `invokeGemini` to `api.ts`

**Files:**
- Modify: `src/server/api.ts`
- Modify: `__tests__/api.test.ts`

**Step 1: Write the failing tests**

`api.test.ts` does not currently mock `PropertiesService`. Add it at the very top of the file alongside the existing `UrlFetchApp` mock (before any imports):

```typescript
(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue("test-api-key"),
  }),
};
```

Add `invokeGemini` to the import:

```typescript
import { buildGeminiPayload, callGeminiAPI, invokeGemini } from "../src/server/api";
```

Add this describe block at the bottom of `__tests__/api.test.ts`:

```typescript
describe("invokeGemini", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls callGeminiAPI with the resolved API key", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "result" }] } }] });
    const result = invokeGemini({ userTexts: ["hello"] });
    expect(result).toBe("result");
    const url = (UrlFetchApp.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain("test-api-key");
  });

  it("throws when the API key property is not set", () => {
    (PropertiesService.getScriptProperties().getProperty as jest.Mock).mockReturnValueOnce(null);
    expect(() => invokeGemini({ userTexts: ["hello"] })).toThrow(/GEMINI_API_KEY/);
  });

  it("passes systemPrompt through to the payload", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    invokeGemini({ systemPrompt: "Be concise", userTexts: ["hello"] });
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("Be concise");
  });

  it("passes inlineData through to the payload", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    invokeGemini({
      userTexts: ["describe this"],
      inlineData: [{ mime_type: "application/pdf", data: "base64==" }],
    });
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts[1].inline_data.mime_type).toBe("application/pdf");
  });
});
```

**Step 2: Run to verify failure**

```bash
npx jest __tests__/api.test.ts --no-coverage
```

Expected: FAIL — `invokeGemini` is not exported from `src/server/api`

**Step 3: Implement in `api.ts`**

Add at the bottom of `src/server/api.ts`, after `callGeminiAPI`:

```typescript
/**
 * Resolve the Gemini API key from Script Properties and call callGeminiAPI.
 * This is the preferred entry point for all production Gemini calls.
 * Throws if the API key property is not set.
 */
export function invokeGemini(params: Omit<GeminiRequest, "apiKey">): string {
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
  if (!apiKey) throw new Error(`${CONFIG.API_KEY_PROPERTY} script property not set`);
  return callGeminiAPI({ apiKey, ...params });
}
```

Note: `PropertiesService` is a GAS global — no import needed.

**Step 4: Run to verify passage**

```bash
npx jest __tests__/api.test.ts --no-coverage
```

Expected: PASS — all tests including the new `invokeGemini` block

**Step 5: Commit**

```bash
git add src/server/api.ts __tests__/api.test.ts
git commit -m "feat: add invokeGemini as single Gemini entry point"
```

---

### Task 4: Create `src/server/inference.ts`

**Files:**
- Create: `src/server/inference.ts`
- Create: `__tests__/inference.test.ts`

`runInference` has no SpreadsheetApp dependency — it returns `string | null` and the caller handles cell writes. `null` signals "no user prompts after flattening — skip this row". Error strings are returned (not thrown) so the caller can write them to the cell without its own try/catch.

**Step 1: Write the failing tests**

Create `__tests__/inference.test.ts`:

```typescript
/**
 * Tests for src/server/inference.ts
 */

// ── Mock globals BEFORE imports ────────────────────────────────

(globalThis as any).UrlFetchApp = {
  fetch: jest.fn(),
};

(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue("test-api-key"),
  }),
};

(globalThis as any).DriveApp = {
  getFileById: jest.fn().mockReturnValue({
    getMimeType: () => "application/pdf",
    getSize: () => 1000,
    getBlob: () => ({ getBytes: () => [1, 2, 3] }),
  }),
};

(globalThis as any).Utilities = {
  base64Encode: jest.fn().mockReturnValue("encoded=="),
};

// ── Import after mocks ─────────────────────────────────────────

import { runInference } from "../src/server/inference";

// ── Helpers ────────────────────────────────────────────────────

function mockFetchResponse(body: unknown): void {
  (UrlFetchApp.fetch as jest.Mock).mockReturnValue({
    getContentText: () => JSON.stringify(body),
  });
}

function mockOkResponse(text: string): void {
  mockFetchResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

// ── Tests ──────────────────────────────────────────────────────

describe("runInference", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the model response string for a scalar user prompt", () => {
    mockOkResponse("AI response");
    expect(runInference("Hello AI", null, null)).toBe("AI response");
  });

  it("returns null when userPrompts flattens to empty", () => {
    expect(runInference(null, null, null)).toBeNull();
    expect(runInference("", null, null)).toBeNull();
  });

  it("flattens a vertical range of user prompts", () => {
    mockOkResponse("ok");
    runInference([["p1"], ["p2"]], null, null);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts).toHaveLength(2);
    expect(payload.contents[0].parts[0].text).toBe("p1");
    expect(payload.contents[0].parts[1].text).toBe("p2");
  });

  it("encodes a valid drive link as inlineData", () => {
    mockOkResponse("ok");
    runInference("prompt", "https://drive.google.com/file/d/abc123/view", null);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts[1].inline_data).toEqual({
      mime_type: "application/pdf",
      data: "encoded==",
    });
  });

  it("filters out invalid drive links silently", () => {
    mockOkResponse("ok");
    runInference("prompt", "not-a-drive-link", null);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts).toHaveLength(1); // text only, no inline_data
  });

  it("omits inlineData from payload when driveLinks is null", () => {
    mockOkResponse("ok");
    runInference("prompt", null, null);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.tools).toBeUndefined();
    expect(payload.contents[0].parts).toHaveLength(1);
  });

  it("passes systemPrompt to the payload", () => {
    mockOkResponse("ok");
    runInference("prompt", null, "Be concise");
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("Be concise");
  });

  it("uses default system prompt when systemPrompt is null", () => {
    mockOkResponse("ok");
    runInference("prompt", null, null);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("You are a helpful assistant.");
  });

  it("returns an error string when invokeGemini throws", () => {
    mockFetchResponse({ error: { message: "quota exceeded" } });
    expect(runInference("prompt", null, null)).toBe("Error: quota exceeded");
  });

  it("returns an error string when Drive fetch throws", () => {
    (DriveApp.getFileById as jest.Mock).mockImplementationOnce(() => {
      throw new Error("File not found");
    });
    expect(
      runInference("prompt", "https://drive.google.com/file/d/abc123/view", null),
    ).toBe("Error: File not found");
  });
});
```

**Step 2: Run to verify failure**

```bash
npx jest __tests__/inference.test.ts --no-coverage
```

Expected: FAIL — `runInference` module does not exist

**Step 3: Implement `src/server/inference.ts`**

```typescript
/**
 * inference.ts — Unified inference handler for menu-triggered AI calls.
 *
 * runInference normalizes raw cell values into a Gemini request and executes
 * it via invokeGemini. It has no SpreadsheetApp dependency — callers are
 * responsible for writing the returned value to the sheet.
 */

import { invokeGemini } from "./api";
import { fetchAndEncodeFile } from "./drive";
import { flattenArg, isValidDriveLink, extractId } from "./utils";
import type { GeminiInlineData } from "../shared/types";

/**
 * Execute a single Gemini inference from raw cell values.
 *
 * @param userPrompts  Cell value(s) for the user message — scalar or 2D range.
 * @param driveLinks   Cell value(s) containing Drive URLs to attach as inline
 *                     data. Invalid or non-Drive strings are silently filtered.
 *                     Pass null to omit.
 * @param systemPrompt Cell value for the system instruction. First non-empty
 *                     string is used. Pass null to use the model default.
 * @returns The model response string, an "Error: ..." string on failure,
 *          or null if userPrompts is empty (signals caller to skip this row).
 */
export function runInference(
  userPrompts: unknown,
  driveLinks: unknown,
  systemPrompt: unknown,
): string | null {
  const userTexts = flattenArg(userPrompts);
  if (userTexts.length === 0) return null;

  try {
    const inlineData: GeminiInlineData[] = flattenArg(driveLinks)
      .filter(isValidDriveLink)
      .map((link) => fetchAndEncodeFile(extractId(link)));

    return invokeGemini({
      systemPrompt: flattenArg(systemPrompt)[0] ?? undefined,
      userTexts,
      inlineData: inlineData.length ? inlineData : undefined,
    });
  } catch (e) {
    return "Error: " + (e as Error).message;
  }
}
```

**Step 4: Run to verify passage**

```bash
npx jest __tests__/inference.test.ts --no-coverage
```

Expected: PASS — all 10 tests

**Step 5: Add coverage threshold**

In `jest.config.cjs`, add inside `coverageThreshold`:

```javascript
"./src/server/inference.ts": {
  statements: 90,
  branches: 80,
  functions: 100,
},
```

**Step 6: Commit**

```bash
git add src/server/inference.ts __tests__/inference.test.ts jest.config.cjs
git commit -m "feat: add runInference unified inference handler"
```

---

### Task 5: Update `customFunctions.ts` to use new modules

**Files:**
- Modify: `src/server/customFunctions.ts`

The existing `customFunctions.test.ts` suite covers all behavior. No new tests needed — verify existing tests still pass after rewiring.

**Step 1: Confirm tests currently pass**

```bash
npx jest __tests__/customFunctions.test.ts --no-coverage
```

Expected: PASS (baseline before changes)

**Step 2: Rewrite `customFunctions.ts`**

Replace the file contents entirely:

```typescript
/**
 * customFunctions.ts — Google Sheets custom functions.
 *
 * Functions here are callable directly from spreadsheet cells via the
 * @customfunction JSDoc tag. Key constraints vs. menu-triggered functions:
 * - Cannot display UI (no dialogs, no prompts, no alerts)
 * - Errors must be returned as strings — thrown exceptions show as generic
 *   script errors in the cell with no useful message
 * - PropertiesService.getScriptProperties() is available after the add-on
 *   has been authorized by the user (opening the menu triggers authorization)
 * - Range arguments arrive as unknown[][], single cells as raw scalars
 */

import { invokeGemini } from "./api";
import { flattenArg } from "./utils";
import { TOOL_REGISTRY } from "./tools";

export { TOOL_REGISTRY };

/**
 * Call the Gemini API from a spreadsheet cell.
 *
 * @param {string|Array} userTexts One or more text parts for the user message.
 *   Pass a single string, a cell reference, or a range / array literal.
 *   Example: "Summarize this" or A1 or A1:A3 or {A1,B4,B10}
 * @param {string} [systemPrompt] (Optional) System-level instruction for the model.
 *   Example: "You are a concise summarizer."
 * @param {string|Array} [toolNames] (Optional) Names of pre-registered tools to enable.
 *   Example: "myTool" or {A5,A6}
 * @return {string} The model's text response, or "[SSI Error: ...]" on failure.
 * @customfunction
 */
export function SSI(userTexts: unknown, systemPrompt?: string, toolNames?: unknown): string {
  try {
    const resolvedTools = flattenArg(toolNames).map((name) => {
      const decl = TOOL_REGISTRY[name];
      if (!decl) throw new Error(`unknown tool '${name}'`);
      return decl;
    });

    return invokeGemini({
      systemPrompt: systemPrompt || undefined,
      userTexts: flattenArg(userTexts),
      tools: resolvedTools.length ? resolvedTools : undefined,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `[SSI Error: ${msg}]`;
  }
}
```

**Step 3: Run to verify passage**

```bash
npx jest __tests__/customFunctions.test.ts --no-coverage
```

Expected: PASS — all existing tests pass unchanged

**Step 4: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

**Step 5: Commit**

```bash
git add src/server/customFunctions.ts
git commit -m "refactor: SSI delegates to invokeGemini, imports from utils and tools"
```

---

### Task 6: Update `runBatchAI` in `index.ts`

**Files:**
- Modify: `src/server/index.ts`

`index.ts` is excluded from unit test coverage. Verification is running the full test suite.

**Step 1: Update imports**

Replace:
```typescript
import { callGeminiAPI } from "./api";
```
with:
```typescript
import { runInference } from "./inference";
```

**Step 2: Remove the API key block**

In `runBatchAI`, delete these lines (just before the header mapping):

```typescript
const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
if (!apiKey) {
  ui.alert(
    "🛑 Configuration Error",
    "API Key not found. Go to Project Settings > Script Properties and add GEMINI_API_KEY.",
    ui.ButtonSet.OK,
  );
  return;
}
```

**Step 3: Replace the loop body**

Replace everything from `for (let i = 0; ...` to the closing `}` and the toast after with:

```typescript
SpreadsheetApp.getActive().toast(`Starting AI Batch (${mode} Mode)...`, "AI Agent", -1);
let processed = 0;

for (let i = 0; i < dataValues.length; i++) {
  const row = dataValues[i];
  const realRowIndex = range.getRow() + i;

  SpreadsheetApp.getActive().toast(`Processing Row ${realRowIndex}...`, "AI Agent", -1);

  const userPrompts = mode === "TEXT"
    ? [row[map.user_prompt], row[map.source_text]]
    : [row[map.user_prompt]];
  const driveLinks = mode === "FILE" ? row[map.source_drive] : null;

  const result = runInference(userPrompts, driveLinks, row[map.sys_prompt]);
  if (result === null) continue;

  sheet.getRange(realRowIndex, map.output + 1).setValue(result);
  processed++;
  SpreadsheetApp.flush();
}
SpreadsheetApp.getActive().toast(`Complete! Processed ${processed} rows.`, "Success", 5);
```

**Step 4: Run full test suite**

```bash
npm test
```

Expected: PASS — all tests across all suites

**Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors

**Step 6: Commit**

```bash
git add src/server/index.ts
git commit -m "refactor: runBatchAI loop delegates to runInference"
```

---

### Task 7: Final verification

**Step 1: Full suite with coverage**

```bash
npm run test:coverage
```

Expected: all thresholds pass including the new `inference.ts` entry

**Step 2: Lint**

```bash
npm run lint
```

Expected: no errors or warnings

**Step 3: Build**

```bash
npm run build
```

Expected: clean build to `dist/`
