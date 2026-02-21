# GEMINI Custom Function Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `=GEMINI(userTexts, inlineData?, systemPrompt?, toolNames?)` custom function that calls the Gemini API directly from a spreadsheet cell.

**Architecture:** Four independent changes bundled into four commits: (1) upgrade `GeminiRequest.inlineData` to an array, (2) add `src/server/customFunctions.ts` with tests, (3) wire the function into the Rollup bundle, (4) add the coverage threshold. Tests and implementation are bundled in one commit because the pre-commit hook (Jest) requires a green suite at every commit.

**Tech Stack:** TypeScript, Google Apps Script globals (UrlFetchApp, DriveApp, Utilities, PropertiesService), Jest + ts-jest, Rollup IIFE bundle

---

### Task 1: Upgrade `GeminiRequest.inlineData` to an array

The Gemini API supports multiple `inline_data` parts per message. The interface should reflect this. All four changes below must land in one commit — they are tightly coupled through the type system.

**Files:**
- Modify: `src/shared/types.ts:59`
- Modify: `src/server/api.ts:23-26`
- Modify: `src/server/index.ts:302-303`
- Modify: `__tests__/api.test.ts` (update inlineData test + add multi-file test)

---

**Step 1: Update `GeminiRequest.inlineData` in `src/shared/types.ts`**

Find line 59:
```typescript
inlineData?: GeminiInlineData; // appended as a final part if present
```
Replace with:
```typescript
inlineData?: GeminiInlineData[]; // each item appended as an inline_data part
```

---

**Step 2: Update `buildGeminiPayload` in `src/server/api.ts`**

Find lines 24-26:
```typescript
  if (req.inlineData) {
    parts.push({ inline_data: req.inlineData });
  }
```
Replace with:
```typescript
  req.inlineData?.forEach((d) => parts.push({ inline_data: d }));
```

---

**Step 3: Update `runBatchAI` in `src/server/index.ts`**

Find line 302-303:
```typescript
            const inlineData = fetchAndEncodeFile(extractId(link));
            result = callGeminiAPI({ apiKey, systemPrompt, userTexts: [usrPrompt], inlineData });
```
Replace with:
```typescript
            const inlineData = [fetchAndEncodeFile(extractId(link))];
            result = callGeminiAPI({ apiKey, systemPrompt, userTexts: [usrPrompt], inlineData });
```

---

**Step 4: Update `__tests__/api.test.ts`**

Find the existing `buildGeminiPayload` test named `"appends inline_data as the final part when provided"`. Change the `inlineData` value from a single object to a single-element array:

```typescript
// Before:
inlineData: { mime_type: "application/pdf", data: "base64==" },
// After:
inlineData: [{ mime_type: "application/pdf", data: "base64==" }],
```

Then add a new test immediately after it inside the same `describe("buildGeminiPayload")` block:

```typescript
  it("appends multiple inline_data parts when inlineData has multiple items", () => {
    const req: GeminiRequest = {
      ...baseReq,
      userTexts: ["Describe both files"],
      inlineData: [
        { mime_type: "application/pdf", data: "file1==" },
        { mime_type: "image/jpeg", data: "file2==" },
      ],
    };
    const payload = buildGeminiPayload(req);
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(3); // 1 text + 2 inline_data
    expect(parts[1].inline_data.mime_type).toBe("application/pdf");
    expect(parts[2].inline_data.mime_type).toBe("image/jpeg");
  });
```

---

**Step 5: Run tests — expect all to pass**

```bash
npm test
```

Expected: all 52 tests PASS (one new test added).

---

**Step 6: Commit**

```bash
git add src/shared/types.ts src/server/api.ts src/server/index.ts __tests__/api.test.ts
git commit -m "feat: upgrade GeminiRequest.inlineData to array for multi-file support"
```

---

### Task 2: Add GEMINI custom function with tests

Tests and implementation must land in one commit — the pre-commit hook runs Jest, so the test file cannot exist without a passing implementation.

**Files:**
- Create: `__tests__/customFunctions.test.ts`
- Create: `src/server/customFunctions.ts`

---

**Step 1: Create `__tests__/customFunctions.test.ts`**

```typescript
/**
 * Tests for src/server/customFunctions.ts
 *
 * Mocks UrlFetchApp, DriveApp, Utilities, and PropertiesService globally
 * before importing, per the GAS globals pattern used across this test suite.
 */

// ── Mock globals BEFORE imports ────────────────────────────────

(globalThis as any).UrlFetchApp = {
  fetch: jest.fn(),
};

(globalThis as any).DriveApp = {
  getFileById: jest.fn(),
};

(globalThis as any).Utilities = {
  base64Encode: jest.fn().mockReturnValue("base64data=="),
};

(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue("test-api-key"),
  }),
};

// ── Import after mocks ─────────────────────────────────────────

import { GEMINI } from "../src/server/customFunctions";

// ── Helpers ────────────────────────────────────────────────────

function mockFetchResponse(body: unknown): void {
  (UrlFetchApp.fetch as jest.Mock).mockReturnValue({
    getContentText: () => JSON.stringify(body),
  });
}

function mockOkResponse(text: string): void {
  mockFetchResponse({ candidates: [{ content: { parts: [{ text }] } }] });
}

function mockDriveFile(): void {
  (DriveApp.getFileById as jest.Mock).mockReturnValue({
    getMimeType: () => "application/pdf",
    getSize: () => 1024,
    getBlob: () => ({ getBytes: () => [1, 2, 3] }),
  });
}

// ── Tests ──────────────────────────────────────────────────────

describe("GEMINI", () => {
  beforeEach(() => jest.clearAllMocks());

  // ── userTexts normalization ──────────────────────────────────

  describe("userTexts normalization", () => {
    it("accepts a single string", () => {
      mockOkResponse("ok");
      GEMINI("hello");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(1);
      expect(payload.contents[0].parts[0].text).toBe("hello");
    });

    it("flattens a vertical range (multiple rows, one column)", () => {
      mockOkResponse("ok");
      GEMINI([["row1"], ["row2"], ["row3"]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(3);
      expect(payload.contents[0].parts[0].text).toBe("row1");
      expect(payload.contents[0].parts[2].text).toBe("row3");
    });

    it("flattens a horizontal range (one row, multiple columns)", () => {
      mockOkResponse("ok");
      GEMINI([["col1", "col2", "col3"]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(3);
    });

    it("filters empty strings from ranges", () => {
      mockOkResponse("ok");
      GEMINI([["text", "", "more text"]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(2);
    });
  });

  // ── inlineData normalization ─────────────────────────────────

  describe("inlineData normalization", () => {
    const driveUrl = "https://drive.google.com/file/d/abc123defgh456ijklm789nop/view";
    const driveUrl2 = "https://drive.google.com/file/d/xyz789defgh456ijklm012abc/view";

    it("attaches a single Drive URL as one inline_data part", () => {
      mockOkResponse("ok");
      mockDriveFile();
      GEMINI("prompt", driveUrl);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(2); // text + inline_data
      expect(payload.contents[0].parts[1].inline_data.mime_type).toBe("application/pdf");
    });

    it("attaches multiple Drive URLs as multiple inline_data parts", () => {
      mockOkResponse("ok");
      mockDriveFile();
      GEMINI("prompt", [[driveUrl, driveUrl2]]);
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(3); // text + 2 inline_data
    });

    it("omits inline_data parts when inlineData is not provided", () => {
      mockOkResponse("ok");
      GEMINI("prompt");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.contents[0].parts).toHaveLength(1);
      expect(payload.contents[0].parts[0].inline_data).toBeUndefined();
    });
  });

  // ── systemPrompt ─────────────────────────────────────────────

  describe("systemPrompt", () => {
    it("sets system_instruction when provided", () => {
      mockOkResponse("ok");
      GEMINI("prompt", undefined, "Be concise");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.system_instruction.parts[0].text).toBe("Be concise");
    });

    it("uses default system prompt when omitted", () => {
      mockOkResponse("ok");
      GEMINI("prompt");
      const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
      expect(payload.system_instruction.parts[0].text).toBe("You are a helpful assistant.");
    });
  });

  // ── toolNames ────────────────────────────────────────────────

  describe("toolNames", () => {
    it("returns an error string for an unknown tool name", () => {
      const result = GEMINI("prompt", undefined, undefined, "nonExistentTool");
      expect(result).toMatch(/\[GEMINI Error:.*nonExistentTool/);
    });
  });

  // ── API key ──────────────────────────────────────────────────

  describe("API key", () => {
    it("returns an error string when GEMINI_API_KEY is not set", () => {
      (PropertiesService.getScriptProperties().getProperty as jest.Mock).mockReturnValueOnce(null);
      const result = GEMINI("prompt");
      expect(result).toMatch(/\[GEMINI Error:.*GEMINI_API_KEY/);
    });
  });

  // ── error handling ───────────────────────────────────────────

  describe("error handling", () => {
    it("returns an error string on API error response", () => {
      mockFetchResponse({ error: { message: "quota exceeded" } });
      const result = GEMINI("prompt");
      expect(result).toMatch(/\[GEMINI Error:.*quota exceeded/);
    });

    it("returns the model text on success", () => {
      mockOkResponse("The answer is 42");
      const result = GEMINI("What is the answer?");
      expect(result).toBe("The answer is 42");
    });
  });
});
```

---

**Step 2: Run `__tests__/customFunctions.test.ts` — expect it to fail**

```bash
npx jest __tests__/customFunctions.test.ts
```

Expected: FAIL — `GEMINI` not exported yet.

---

**Step 3: Create `src/server/customFunctions.ts`**

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
 *   has been authorized by the user
 * - Range arguments arrive as unknown[][], single cells as raw scalars
 */

import { CONFIG } from "./config";
import { callGeminiAPI } from "./api";
import { fetchAndEncodeFile } from "./drive";
import { extractId } from "./utils";
import type { GeminiFunctionDeclaration } from "../shared/types";

// ── Tool Registry ────────────────────────────────────────────────────────────
//
// Map tool names to GeminiFunctionDeclaration objects.
// Add entries here as concrete tool use cases are designed.

const TOOL_REGISTRY: Record<string, GeminiFunctionDeclaration> = {};

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Normalize a custom function argument to a flat array of non-empty strings.
 * GAS passes single-cell references as raw scalars and ranges as 2D arrays.
 */
function flattenArg(val: unknown): string[] {
  if (!Array.isArray(val)) return val != null ? [String(val)] : [];
  return (val as unknown[][])
    .flat()
    .filter((v) => v !== "" && v != null)
    .map(String);
}

// ── Custom Functions ─────────────────────────────────────────────────────────

/**
 * Call the Gemini API from a spreadsheet cell.
 *
 * @param {string|Array} userTexts One or more text parts for the user message.
 *   Pass a single string, a cell reference, or a range / array literal.
 *   Example: "Summarize this" or A1 or A1:A3 or {A1,B4,B10}
 * @param {string|Array} inlineData Drive URL(s) or file ID(s) to attach as
 *   inline data. Pass a single URL, a cell reference, or a range / array literal.
 *   Example: A2 or {A2,A3}
 * @param {string} systemPrompt System-level instruction for the model.
 *   Example: "You are a concise summarizer."
 * @param {string|Array} toolNames Names of pre-registered tools to enable.
 *   Example: "myTool" or {A5,A6}
 * @return {string} The model's text response, or "[GEMINI Error: ...]" on failure.
 * @customfunction
 */
export function GEMINI(
  userTexts: unknown,
  inlineData?: unknown,
  systemPrompt?: string,
  toolNames?: unknown,
): string {
  try {
    // Resolve API key from Script Properties (set via Project Settings)
    const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
    if (!apiKey) {
      return `[GEMINI Error: ${CONFIG.API_KEY_PROPERTY} script property not set. Go to Project Settings > Script Properties to add it.]`;
    }

    // Normalize and validate tool names
    const resolvedTools = flattenArg(toolNames).map((name) => {
      const decl = TOOL_REGISTRY[name];
      if (!decl) throw new Error(`unknown tool '${name}'`);
      return decl;
    });

    // Normalize inlineData: fetch and encode each Drive URL / file ID
    const resolvedInlineData = inlineData != null
      ? flattenArg(inlineData).map((url) => fetchAndEncodeFile(extractId(url)))
      : undefined;

    return callGeminiAPI({
      apiKey,
      systemPrompt: systemPrompt || undefined,
      userTexts: flattenArg(userTexts),
      inlineData: resolvedInlineData?.length ? resolvedInlineData : undefined,
      tools: resolvedTools.length ? resolvedTools : undefined,
    });
  } catch (e) {
    return `[GEMINI Error: ${(e as Error).message}]`;
  }
}
```

---

**Step 4: Run tests — expect all to pass**

```bash
npm test
```

Expected: all tests PASS (new suite included).

---

**Step 5: Commit**

```bash
git add src/server/customFunctions.ts __tests__/customFunctions.test.ts
git commit -m "feat: add GEMINI custom function with tests"
```

---

### Task 3: Wire the function into the bundle

Per CLAUDE.md: to expose a function to Apps Script, you must (1) export it from `index.ts` and (2) add a global stub to the Rollup footer.

**Files:**
- Modify: `src/server/index.ts` (add re-export)
- Modify: `rollup.config.js:45` (add footer stub)

---

**Step 1: Add re-export to `src/server/index.ts`**

Add this line at the top of `src/server/index.ts`, after the existing imports block (after line 23 `import type { AIMode, ColumnMap } from "../shared/types";`):

```typescript
export { GEMINI } from "./customFunctions";
```

---

**Step 2: Add global stub to `rollup.config.js`**

Find the footer string (line 34–46). Add the `GEMINI` stub before the closing backtick:

```js
function GEMINI(userTexts, inlineData, systemPrompt, toolNames) { return _GASEntry.GEMINI(userTexts, inlineData, systemPrompt, toolNames); }
```

The footer section should look like this after the edit:

```js
    footer: `
/**
 * Global Handshake — Explicit function stubs for Google Apps Script discovery.
 */
function onOpen(e) { _GASEntry.onOpen(e); }
function showSidebar() { _GASEntry.showSidebar(); }
function runTool(fn) { _GASEntry.runTool(fn); }
function showSourceDialog() { _GASEntry.showSourceDialog(); }
function handleDialogSelection(mode) { _GASEntry.handleDialogSelection(mode); }
function importDriveLinks() { _GASEntry.importDriveLinks(); }
function extractTextFromSelection() { _GASEntry.extractTextFromSelection(); }
function sampleRowsToEvaluation() { _GASEntry.sampleRowsToEvaluation(); }
function GEMINI(userTexts, inlineData, systemPrompt, toolNames) { return _GASEntry.GEMINI(userTexts, inlineData, systemPrompt, toolNames); }
`,
```

---

**Step 3: Run tests and typecheck**

```bash
npm test && npm run typecheck
```

Expected: all tests PASS, zero type errors.

---

**Step 4: Commit**

```bash
git add src/server/index.ts rollup.config.js
git commit -m "feat: wire GEMINI custom function into Apps Script bundle"
```

---

### Task 4: Add coverage threshold for customFunctions.ts

**Files:**
- Modify: `jest.config.cjs:41` (add threshold entry before closing `}`)

---

**Step 1: Add threshold to `jest.config.cjs`**

Find the `coverageThreshold` block. Add a new entry for `customFunctions.ts` after the existing `drive.ts` entry:

```js
    "./src/server/customFunctions.ts": {
      statements: 90,
      branches: 85,
      functions: 100,
    },
```

---

**Step 2: Run coverage — verify threshold is met**

```bash
npm run test:coverage
```

Expected: all thresholds met. If `customFunctions.ts` is below 85% branches, check which branches are uncovered and add a targeted test in `__tests__/customFunctions.test.ts`.

---

**Step 3: Commit**

```bash
git add jest.config.cjs
git commit -m "test: add coverage threshold for customFunctions.ts"
```

---

### Task 5: Final verification

**Step 1: Run lint**

```bash
npm run lint
```

Expected: no errors or warnings.

**Step 2: Run full coverage suite**

```bash
npm run test:coverage
```

Expected: all per-file thresholds met.

**Step 3: Build**

```bash
npm run build
```

Expected: clean build. Verify `dist/index.js` contains the `GEMINI` global stub by running:

```bash
grep "function GEMINI" dist/index.js
```

Expected: one matching line.
