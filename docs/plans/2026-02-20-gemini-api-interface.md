# Gemini API Interface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `callGeminiAPI(apiKey, systemPrompt, userPrompt, context)` with a `GeminiRequest` options object interface that separates Drive I/O from the HTTP adapter, supports multiple text parts per message, and hooks for function calling.

**Architecture:** New `GeminiRequest` interface in `types.ts` carries all preprocessed inputs. `api.ts` becomes a pure HTTP adapter with a separately testable `buildGeminiPayload`. Drive fetch + base64 encode moves to `drive.ts` as `fetchAndEncodeFile`. `getAIContext` in `utils.ts` is deleted — its skip logic moves inline to `runBatchAI`.

**Tech Stack:** TypeScript, Jest + ts-jest, Google Apps Script globals (UrlFetchApp, DriveApp, Utilities)

---

### Task 1: Update shared types

**Files:**
- Modify: `src/shared/types.ts`

**Step 1: Remove old AI context types and add Gemini API types**

Replace the `// ── AI Context` section (lines 33–46) with the following. Keep `AIMode` — it is still used by `runBatchAI`.

```typescript
// ── AI Mode ────────────────────────────────────────────────────
export type AIMode = "TEXT" | "FILE";

// ── Gemini API ─────────────────────────────────────────────────

export interface GeminiInlineData {
  mime_type: string;
  data: string; // base64-encoded bytes
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters?: Record<string, unknown>; // JSON Schema object
}

export interface GeminiGenerationConfig {
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
}

export interface GeminiRequest {
  apiKey: string;
  modelName?: string; // defaults to CONFIG.MODEL_NAME if omitted
  systemPrompt?: string;
  userTexts: string[]; // assembled into parts: [{text}, {text}, ...]
  inlineData?: GeminiInlineData; // appended as a final part if present
  tools?: GeminiFunctionDeclaration[];
  generationConfig?: GeminiGenerationConfig;
}
```

The deleted types are: `TextContext`, `FileContext`, `AIContext`.

**Step 2: Run typecheck to see all breakage sites**

```bash
npm run typecheck
```

Expected: errors in `api.ts`, `utils.ts`, `index.ts` — these will be fixed in subsequent tasks.

**Step 3: Commit types**

```bash
git add src/shared/types.ts
git commit -m "feat: add GeminiRequest interface, remove AIContext types"
```

---

### Task 2: Rewrite api.ts tests (TDD — write tests before implementation)

**Files:**
- Modify: `__tests__/api.test.ts`

**Step 1: Replace the test file with the new test suite**

The new test file removes `DriveApp` and `Utilities` mocks entirely (those globals are no longer used in `api.ts`). It adds direct tests for `buildGeminiPayload` and updates `callGeminiAPI` tests to use `GeminiRequest`.

```typescript
/**
 * Tests for src/server/api.ts
 *
 * Only UrlFetchApp needs mocking — DriveApp and Utilities are no longer
 * used in this module.
 */

// ── Mock globals BEFORE imports ────────────────────────────────

(globalThis as any).UrlFetchApp = {
  fetch: jest.fn(),
};

// ── Import after mocks ─────────────────────────────────────────

import { buildGeminiPayload, callGeminiAPI } from "../src/server/api";
import type { GeminiRequest } from "../src/shared/types";

// ── Helpers ────────────────────────────────────────────────────

function mockFetchResponse(body: unknown) {
  (UrlFetchApp.fetch as jest.Mock).mockReturnValue({
    getContentText: () => JSON.stringify(body),
  });
}

const baseReq: GeminiRequest = {
  apiKey: "key123",
  systemPrompt: "Be helpful",
  userTexts: ["Summarize this"],
};

// ── buildGeminiPayload tests ───────────────────────────────────

describe("buildGeminiPayload", () => {
  it("assembles a single text part", () => {
    const payload = buildGeminiPayload(baseReq);
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(1);
    expect(parts[0].text).toBe("Summarize this");
  });

  it("assembles multiple text parts in order", () => {
    const req: GeminiRequest = { ...baseReq, userTexts: ["Prompt", "Context"] };
    const payload = buildGeminiPayload(req);
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0].text).toBe("Prompt");
    expect(parts[1].text).toBe("Context");
  });

  it("appends inline_data as the final part when provided", () => {
    const req: GeminiRequest = {
      ...baseReq,
      userTexts: ["What is this?"],
      inlineData: { mime_type: "application/pdf", data: "base64==" },
    };
    const payload = buildGeminiPayload(req);
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[1].inline_data).toEqual({ mime_type: "application/pdf", data: "base64==" });
  });

  it("uses default system prompt when systemPrompt is omitted", () => {
    const req: GeminiRequest = { apiKey: "k", userTexts: ["hi"] };
    const payload = buildGeminiPayload(req);
    expect((payload.system_instruction as any).parts[0].text).toBe("You are a helpful assistant.");
  });

  it("includes tools when provided", () => {
    const req: GeminiRequest = {
      ...baseReq,
      tools: [{ name: "myFn", description: "does stuff" }],
    };
    const payload = buildGeminiPayload(req);
    expect((payload.tools as any)[0].function_declarations[0].name).toBe("myFn");
  });

  it("omits tools key when tools array is empty or absent", () => {
    const payload = buildGeminiPayload(baseReq);
    expect(payload.tools).toBeUndefined();
  });

  it("passes through generationConfig when provided", () => {
    const req: GeminiRequest = {
      ...baseReq,
      generationConfig: { temperature: 0.5, maxOutputTokens: 1024 },
    };
    const payload = buildGeminiPayload(req);
    expect((payload.generationConfig as any).temperature).toBe(0.5);
  });
});

// ── callGeminiAPI tests ────────────────────────────────────────

describe("callGeminiAPI", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the text from the first candidate", () => {
    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "AI says hello" }] } }],
    });
    expect(callGeminiAPI(baseReq)).toBe("AI says hello");
  });

  it("returns 'No response.' when candidates are empty", () => {
    mockFetchResponse({ candidates: [] });
    expect(callGeminiAPI(baseReq)).toBe("No response.");
  });

  it("throws on API error response", () => {
    mockFetchResponse({ error: { message: "Invalid API key" } });
    expect(() => callGeminiAPI({ ...baseReq, apiKey: "bad" })).toThrow("Invalid API key");
  });

  it("uses modelName from request when provided", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    callGeminiAPI({ ...baseReq, modelName: "gemini-1.5-pro" });
    const url = (UrlFetchApp.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain("gemini-1.5-pro");
  });

  it("falls back to CONFIG.MODEL_NAME when modelName is omitted", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    callGeminiAPI(baseReq);
    const url = (UrlFetchApp.fetch as jest.Mock).mock.calls[0][0];
    expect(url).toContain("gemini-2.0-flash");
  });
});
```

**Step 2: Run the new tests — expect them to fail**

```bash
npx jest __tests__/api.test.ts
```

Expected: FAIL — `buildGeminiPayload` is not exported from `api.ts` yet, and `callGeminiAPI` has the wrong signature.

**Step 3: Commit the failing tests**

```bash
git add __tests__/api.test.ts
git commit -m "test: rewrite api tests for GeminiRequest interface (failing)"
```

---

### Task 3: Rewrite api.ts implementation

**Files:**
- Modify: `src/server/api.ts`

**Step 1: Replace the file contents**

```typescript
/**
 * api.ts — Gemini API interaction via UrlFetchApp.
 *
 * Pure HTTP adapter. All preprocessing (Drive file fetching, base64 encoding,
 * text assembly) is the caller's responsibility.
 *
 * Requires oauth scope: https://www.googleapis.com/auth/script.external_request
 */

import { CONFIG } from "./config";
import type { GeminiInlineData, GeminiRequest } from "../shared/types";

interface GeminiPart {
  text?: string;
  inline_data?: GeminiInlineData;
}

/**
 * Assemble the Gemini generateContent request payload from a GeminiRequest.
 * Pure function — no GAS globals. Independently testable.
 */
export function buildGeminiPayload(req: GeminiRequest): Record<string, unknown> {
  const parts: GeminiPart[] = req.userTexts.map((text) => ({ text }));
  if (req.inlineData) {
    parts.push({ inline_data: req.inlineData });
  }

  const payload: Record<string, unknown> = {
    system_instruction: {
      parts: [{ text: req.systemPrompt || "You are a helpful assistant." }],
    },
    contents: [{ role: "user", parts }],
  };

  if (req.generationConfig) {
    payload.generationConfig = req.generationConfig;
  }

  if (req.tools && req.tools.length > 0) {
    payload.tools = [{ function_declarations: req.tools }];
  }

  return payload;
}

/**
 * Call the Gemini generateContent endpoint and return the response text.
 */
export function callGeminiAPI(req: GeminiRequest): string {
  const modelName = req.modelName ?? CONFIG.MODEL_NAME;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${req.apiKey}`;

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(buildGeminiPayload(req)),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText()) as Record<string, unknown>;

  if (json.error) throw new Error((json.error as { message: string }).message);
  return (json.candidates as any)?.[0]?.content?.parts?.[0]?.text ?? "No response.";
}
```

**Step 2: Run the api tests — expect them to pass**

```bash
npx jest __tests__/api.test.ts
```

Expected: all tests PASS.

**Step 3: Commit**

```bash
git add src/server/api.ts
git commit -m "feat: rewrite api.ts with GeminiRequest options object and buildGeminiPayload"
```

---

### Task 4: Add fetchAndEncodeFile to drive.ts (TDD)

**Files:**
- Modify: `__tests__/drive.test.ts`
- Modify: `src/server/drive.ts`

**Step 1: Add failing tests for fetchAndEncodeFile in drive.test.ts**

Open `__tests__/drive.test.ts`. The file already mocks `DriveApp` and `Utilities` globally at the top. Add this `describe` block after the existing tests:

```typescript
describe("fetchAndEncodeFile", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns mime_type and base64-encoded data for a valid file", () => {
    const mockFile = {
      getMimeType: () => "application/pdf",
      getSize: () => 1024,
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    };
    (DriveApp.getFileById as jest.Mock).mockReturnValue(mockFile);

    const result = fetchAndEncodeFile("file123");
    expect(result.mime_type).toBe("application/pdf");
    expect(result.data).toBe("base64data=="); // matches mock in Utilities
  });

  it("throws when file exceeds 25MB", () => {
    const mockFile = {
      getMimeType: () => "application/pdf",
      getSize: () => 30 * 1024 * 1024,
      getBlob: () => ({ getBytes: () => [] }),
    };
    (DriveApp.getFileById as jest.Mock).mockReturnValue(mockFile);

    expect(() => fetchAndEncodeFile("bigfile")).toThrow("File too large");
  });
});
```

Also add `fetchAndEncodeFile` to the import line at the top of the file:

```typescript
import { checkDriveService, extractTextUniversal, fetchAndEncodeFile } from "../src/server/drive";
```

**Step 2: Run drive tests — expect new tests to fail**

```bash
npx jest __tests__/drive.test.ts
```

Expected: FAIL — `fetchAndEncodeFile` is not exported yet.

**Step 3: Add fetchAndEncodeFile to drive.ts**

Add this import at the top of `src/server/drive.ts` (after the JSDoc comment block):

```typescript
import { CONFIG } from "./config";
import type { GeminiInlineData } from "../shared/types";
```

Add this function at the end of `src/server/drive.ts`:

```typescript
/**
 * Fetch a Drive file by ID and return it as base64-encoded inline data
 * ready for the Gemini API. Throws if the file exceeds the 25MB limit.
 */
export function fetchAndEncodeFile(fileId: string): GeminiInlineData {
  const file = DriveApp.getFileById(fileId);
  if (file.getSize() > CONFIG.MAX_FILE_SIZE_BYTES) {
    throw new Error("File too large (>25MB).");
  }
  return {
    mime_type: file.getMimeType(),
    data: Utilities.base64Encode(file.getBlob().getBytes()),
  };
}
```

**Step 4: Run drive tests — expect all to pass**

```bash
npx jest __tests__/drive.test.ts
```

Expected: all PASS.

**Step 5: Commit**

```bash
git add src/server/drive.ts __tests__/drive.test.ts
git commit -m "feat: add fetchAndEncodeFile to drive.ts"
```

---

### Task 5: Remove getAIContext from utils.ts and its tests

**Files:**
- Modify: `src/server/utils.ts`
- Modify: `__tests__/utils.test.ts`

**Step 1: Remove getAIContext from utils.ts**

In `src/server/utils.ts`:

1. Change the import on line 8 from:
   ```typescript
   import type { AIContext, AIMode, ColumnMap, DriveFileInfo } from "../shared/types";
   ```
   to:
   ```typescript
   import type { ColumnMap, DriveFileInfo } from "../shared/types";
   ```

2. Delete the entire `getAIContext` function (lines 82–102).

**Step 2: Remove getAIContext from utils.test.ts**

In `__tests__/utils.test.ts`:

1. Remove `getAIContext` from the import list (line 16).
2. Delete the entire `describe("getAIContext", ...)` block (lines 138–190).

**Step 3: Run utils tests — expect all to pass**

```bash
npx jest __tests__/utils.test.ts
```

Expected: all PASS.

**Step 4: Commit**

```bash
git add src/server/utils.ts __tests__/utils.test.ts
git commit -m "refactor: remove getAIContext (logic moved inline to runBatchAI)"
```

---

### Task 6: Update runBatchAI in index.ts

**Files:**
- Modify: `src/server/index.ts`

**Step 1: Update imports**

Change the import from `./utils` to remove `getAIContext`:

```typescript
import {
  extractId,
  getAIContext,   // ← remove this line
  isValidDriveLink,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
} from "./utils";
```

Add `fetchAndEncodeFile` to the `./drive` import:

```typescript
import { checkDriveService, extractTextUniversal, fetchAndEncodeFile } from "./drive";
```

Remove `AIMode` from the `../shared/types` import if it is no longer needed after this change — check whether `AIMode` is still used in the file (it is, in the `runBatchAI` signature and `handleDialogSelection`), so keep it.

**Step 2: Replace the try block inside runBatchAI**

Find this block inside the `for` loop in `runBatchAI` (around line 288):

```typescript
try {
  const context = getAIContext(row, map, mode);
  if (context) {
    result = callGeminiAPI(apiKey, row[map.sys_prompt] as string, usrPrompt, context);
  } else {
    result = mode === "TEXT" ? "[Skipped: No valid text]" : "[Skipped: No valid Drive Link]";
  }
  sheet.getRange(realRowIndex, map.output + 1).setValue(result);
  processed++;
} catch (e) {
  sheet.getRange(realRowIndex, map.output + 1).setValue("Error: " + (e as Error).message);
}
```

Replace it with:

```typescript
try {
  const systemPrompt = row[map.sys_prompt] as string;

  if (mode === "TEXT") {
    const sourceText = map.source_text > -1 ? (row[map.source_text] as string) : "";
    if (!sourceText || sourceText.length <= 5 || sourceText.includes("Error")) {
      result = "[Skipped: No valid text]";
    } else {
      result = callGeminiAPI({ apiKey, systemPrompt, userTexts: [usrPrompt, sourceText] });
    }
  } else {
    const link = row[map.source_drive] as string;
    if (!isValidDriveLink(link)) {
      result = "[Skipped: No valid Drive Link]";
    } else {
      const inlineData = fetchAndEncodeFile(extractId(link));
      result = callGeminiAPI({ apiKey, systemPrompt, userTexts: [usrPrompt], inlineData });
    }
  }

  sheet.getRange(realRowIndex, map.output + 1).setValue(result);
  processed++;
} catch (e) {
  sheet.getRange(realRowIndex, map.output + 1).setValue("Error: " + (e as Error).message);
}
```

**Step 3: Run typecheck — expect zero errors**

```bash
npm run typecheck
```

Expected: no errors.

**Step 4: Run full test suite**

```bash
npm test
```

Expected: all suites PASS.

**Step 5: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: update runBatchAI to use GeminiRequest interface"
```

---

### Task 7: Final verification

**Step 1: Run lint**

```bash
npm run lint
```

Expected: no errors or warnings.

**Step 2: Run full test suite with coverage**

```bash
npm run test:coverage
```

Expected: all thresholds met.

**Step 3: Build**

```bash
npm run build
```

Expected: clean build, no errors in `dist/`.
