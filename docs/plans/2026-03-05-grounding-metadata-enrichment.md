# Grounding Metadata Enrichment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Lift response parsing out of `callGeminiAPI` so the full structured Gemini response (text + grounding metadata + code execution pairs) is preserved for callers instead of discarding everything except the text.

**Architecture:** Change `callGeminiAPI` and `invokeGemini` to return a new `GeminiResponse` typed object. Update `runInference` to return `GeminiResponse | null`. Update `SSI` to call `.text` on the result — behavior unchanged. `runBatchAI` is left untouched in this phase; metadata presentation is a separate design decision.

**Tech Stack:** TypeScript, Jest, Google Apps Script (UrlFetchApp), Gemini REST API v1beta

---

## Gemini API Response Shapes (Reference)

### Google Search / URL Context
Metadata lives on `candidates[0].groundingMetadata`:
```json
{
  "webSearchQueries": ["query string"],
  "groundingChunks": [
    { "web": { "uri": "https://...", "title": "Page Title" } },
    { "retrievedContext": { "uri": "https://...", "title": "Page Title" } }
  ]
}
```

### Code Execution
Extra parts interspersed in `candidates[0].content.parts`:
```json
[
  { "text": "Let me calculate..." },
  { "executableCode": { "language": "PYTHON", "code": "print(1+1)" } },
  { "codeExecutionResult": { "outcome": "OUTCOME_OK", "output": "2\n" } },
  { "text": "The result is 2." }
]
```
Text assembly must join all `text` parts. Code pairs are captured separately.

---

### Task 1: Add `GeminiResponse` types to `server/types.ts`

**Files:**
- Modify: `src/server/types.ts`

No tests needed — pure type definitions.

**Step 1: Add the new interfaces**

Add after the existing `GeminiGenerationConfig` interface (around line 34):

```typescript
export interface GeminiGroundingChunk {
  web?: { uri: string; title: string };
  retrievedContext?: { uri: string; title: string };
}

export interface GeminiGroundingMetadata {
  webSearchQueries?: string[];
  groundingChunks?: GeminiGroundingChunk[];
}

export interface GeminiCodePair {
  code: { language: string; code: string };
  result: { outcome: string; output: string };
}

/**
 * Structured representation of a Gemini generateContent response.
 * Returned by callGeminiAPI and invokeGemini in place of a bare string.
 */
export interface GeminiResponse {
  /** Assembled from all text parts in candidates[0].content.parts. */
  text: string;
  /** Present when google_search or url_context grounding was active. */
  groundingMetadata?: GeminiGroundingMetadata;
  /** Present when code_execution was active and code blocks were returned. */
  codePairs?: GeminiCodePair[];
}
```

**Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: passes (no usages changed yet).

**Step 3: Commit**

```bash
git add src/server/types.ts
git commit -m "feat: add GeminiResponse types to server/types.ts"
```

---

### Task 2: Update `callGeminiAPI` to return `GeminiResponse`

**Files:**
- Modify: `src/server/api.ts`
- Modify: `__tests__/api.test.ts`

**Step 1: Update the failing tests first**

In `__tests__/api.test.ts`, update the import and the `callGeminiAPI` describe block:

```typescript
import { buildGeminiPayload, callGeminiAPI, invokeGemini } from "../src/server/api";
import { CONFIG } from "../src/server/config";
import type { GeminiRequest } from "../src/server/types";
```

Replace the entire `callGeminiAPI` describe block with:

```typescript
describe("callGeminiAPI", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the text from the first candidate", () => {
    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "AI says hello" }] } }],
    });
    expect(callGeminiAPI(baseReq).text).toBe("AI says hello");
  });

  it("returns 'No response.' when candidates are empty", () => {
    mockFetchResponse({ candidates: [] });
    expect(callGeminiAPI(baseReq).text).toBe("No response.");
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
    const url = (UrlFetchApp.fetch as jest.Mock).mock.calls[0][0] as string;
    expect(url).toContain(CONFIG.MODEL_NAME);
  });

  it("assembles text from multiple text parts (code execution interleaving)", () => {
    mockFetchResponse({
      candidates: [{
        content: {
          parts: [
            { text: "Let me check." },
            { executableCode: { language: "PYTHON", code: "1+1" } },
            { codeExecutionResult: { outcome: "OUTCOME_OK", output: "2\n" } },
            { text: "The answer is 2." },
          ],
        },
      }],
    });
    expect(callGeminiAPI(baseReq).text).toBe("Let me check.\n\nThe answer is 2.");
  });

  it("populates codePairs when executableCode and codeExecutionResult parts are present", () => {
    mockFetchResponse({
      candidates: [{
        content: {
          parts: [
            { text: "Sure." },
            { executableCode: { language: "PYTHON", code: "print(42)" } },
            { codeExecutionResult: { outcome: "OUTCOME_OK", output: "42\n" } },
          ],
        },
      }],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.codePairs).toHaveLength(1);
    expect(resp.codePairs![0].code.code).toBe("print(42)");
    expect(resp.codePairs![0].result.output).toBe("42\n");
  });

  it("populates groundingMetadata for google_search results", () => {
    mockFetchResponse({
      candidates: [{
        content: { parts: [{ text: "Found it." }] },
        groundingMetadata: {
          webSearchQueries: ["test query"],
          groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }],
        },
      }],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.groundingMetadata?.webSearchQueries).toEqual(["test query"]);
    expect(resp.groundingMetadata?.groundingChunks![0].web?.uri).toBe("https://example.com");
  });

  it("populates groundingMetadata for url_context results", () => {
    mockFetchResponse({
      candidates: [{
        content: { parts: [{ text: "From the URL." }] },
        groundingMetadata: {
          groundingChunks: [{ retrievedContext: { uri: "https://example.com", title: "Example" } }],
        },
      }],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.groundingMetadata?.groundingChunks![0].retrievedContext?.uri).toBe("https://example.com");
  });

  it("returns undefined groundingMetadata and codePairs when not present", () => {
    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "plain" }] } }],
    });
    const resp = callGeminiAPI(baseReq);
    expect(resp.groundingMetadata).toBeUndefined();
    expect(resp.codePairs).toBeUndefined();
  });
});
```

**Step 2: Run to confirm failures**

```bash
npx jest __tests__/api.test.ts
```
Expected: the updated `callGeminiAPI` tests fail (return type is still `string`).

**Step 3: Update `callGeminiAPI` in `src/server/api.ts`**

Update the import line:
```typescript
import type { GeminiInlineData, GeminiRequest, GeminiResponse, GeminiCodePair } from "./types";
```

Replace the `callGeminiAPI` function (current lines 63–82):

```typescript
export function callGeminiAPI(req: GeminiRequest): GeminiResponse {
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

  const candidate = (json.candidates as Array<Record<string, unknown>> | undefined)?.[0];
  const parts =
    (candidate?.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts ?? [];

  // Assemble text from all text parts (may be interspersed with code execution parts)
  const textParts = parts
    .filter((p): p is { text: string } => typeof p["text"] === "string")
    .map((p) => p.text);
  const text = textParts.join("\n\n") || "No response.";

  // Extract consecutive executableCode + codeExecutionResult pairs
  const codePairs: GeminiCodePair[] = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const curr = parts[i];
    const next = parts[i + 1];
    if (curr["executableCode"] !== undefined && next["codeExecutionResult"] !== undefined) {
      codePairs.push({
        code: curr["executableCode"] as GeminiCodePair["code"],
        result: next["codeExecutionResult"] as GeminiCodePair["result"],
      });
      i++; // skip the result part — already consumed
    }
  }

  const groundingMetadata = candidate?.["groundingMetadata"] as
    | GeminiResponse["groundingMetadata"]
    | undefined;

  return {
    text,
    ...(groundingMetadata !== undefined && { groundingMetadata }),
    ...(codePairs.length > 0 && { codePairs }),
  };
}
```

**Step 4: Run `callGeminiAPI` tests**

```bash
npx jest __tests__/api.test.ts
```
Expected: `callGeminiAPI` tests pass. `invokeGemini` tests will fail — fix next.

---

### Task 3: Update `invokeGemini` to return `GeminiResponse`

**Files:**
- Modify: `src/server/api.ts` (return type only)
- Modify: `__tests__/api.test.ts` (invokeGemini describe block)

**Step 1: Update invokeGemini tests**

Replace the `invokeGemini` describe block:

```typescript
describe("invokeGemini", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns a GeminiResponse with text from the first candidate", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "result" }] } }] });
    const result = invokeGemini({ userTexts: ["hello"] });
    expect(result.text).toBe("result");
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

**Step 2: Run to confirm failures**

```bash
npx jest __tests__/api.test.ts
```
Expected: `invokeGemini` tests fail.

**Step 3: Update `invokeGemini` return type in `src/server/api.ts`**

```typescript
export function invokeGemini(params: Omit<GeminiRequest, "apiKey">): GeminiResponse {
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
  if (!apiKey) throw new Error(`${CONFIG.API_KEY_PROPERTY} script property not set`);
  return callGeminiAPI({ apiKey, ...params });
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
git commit -m "feat: callGeminiAPI and invokeGemini return GeminiResponse"
```

---

### Task 4: Update `runInference` to return `GeminiResponse | null`

**Files:**
- Modify: `src/server/inference.ts`
- Modify: `__tests__/inference.test.ts`

**Step 1: Update the failing tests**

In `__tests__/inference.test.ts`, update return-value assertions. The mock body shape is unchanged — only the assertion style changes.

```typescript
describe("runInference", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns a GeminiResponse for a scalar user prompt", () => {
    mockOkResponse("AI response");
    expect(runInference("Hello AI")?.text).toBe("AI response");
  });

  it("returns null when userPrompts flattens to empty", () => {
    expect(runInference(null)).toBeNull();
    expect(runInference("")).toBeNull();
  });

  it("flattens a vertical range of user prompts", () => {
    mockOkResponse("ok");
    runInference([["p1"], ["p2"]]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts).toHaveLength(2);
    expect(payload.contents[0].parts[0].text).toBe("p1");
    expect(payload.contents[0].parts[1].text).toBe("p2");
  });

  it("encodes a valid drive link as inlineData", () => {
    mockOkResponse("ok");
    runInference("prompt", "https://drive.google.com/file/d/abc123/view");
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts[1].inline_data).toEqual({
      mime_type: "application/pdf",
      data: "encoded==",
    });
  });

  it("filters out invalid drive links silently", () => {
    mockOkResponse("ok");
    runInference("prompt", "not-a-drive-link");
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts).toHaveLength(1);
  });

  it("omits inlineData from payload when driveLinks is omitted", () => {
    mockOkResponse("ok");
    runInference("prompt");
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts).toHaveLength(1);
  });

  it("passes systemPrompt to the payload", () => {
    mockOkResponse("ok");
    runInference("prompt", undefined, "Be concise");
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("Be concise");
  });

  it("uses default system prompt when systemPrompt is omitted", () => {
    mockOkResponse("ok");
    runInference("prompt");
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("You are a helpful assistant.");
  });

  it("returns an error response when invokeGemini throws", () => {
    mockFetchResponse({ error: { message: "quota exceeded" } });
    expect(runInference("prompt")?.text).toBe("Error: quota exceeded");
  });

  it("returns an error response when Drive fetch throws", () => {
    (DriveApp.getFileById as jest.Mock).mockImplementationOnce(() => {
      throw new Error("File not found");
    });
    expect(runInference("prompt", "https://drive.google.com/file/d/abc123/view")?.text).toBe(
      "Error: File not found",
    );
  });

  it("passes tools to the payload when provided", () => {
    mockOkResponse("ok");
    runInference("prompt", undefined, undefined, ["google_search"]);
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.tools).toBeDefined();
    expect(payload.tools[0]).toHaveProperty("google_search");
  });

  it("omits tools from the payload when not provided", () => {
    mockOkResponse("ok");
    runInference("prompt");
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.tools).toBeUndefined();
  });
});
```

**Step 2: Run to confirm failures**

```bash
npx jest __tests__/inference.test.ts
```
Expected: FAIL on `?.text` assertions.

**Step 3: Update `runInference` in `src/server/inference.ts`**

```typescript
import { invokeGemini } from "./api";
import { fetchAndEncodeFile } from "./drive";
import { flattenArg, isValidDriveLink, extractId } from "./utils";
import type { GeminiInlineData, GeminiResponse } from "./types";
import type { ToolId } from "../shared/types";

export function runInference(
  userPrompts: unknown,
  driveLinks?: unknown,
  systemPrompt?: unknown,
  tools?: ToolId[],
): GeminiResponse | null {
  const userTexts = flattenArg(userPrompts);
  if (userTexts.length === 0) return null;

  try {
    const inlineData: GeminiInlineData[] =
      driveLinks !== undefined
        ? flattenArg(driveLinks)
            .filter(isValidDriveLink)
            .map((link) => fetchAndEncodeFile(extractId(link)))
        : [];

    return invokeGemini({
      systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
      userTexts,
      inlineData: inlineData.length ? inlineData : undefined,
      tools: tools?.length ? tools : undefined,
    });
  } catch (e) {
    return { text: "Error: " + (e as Error).message };
  }
}
```

**Step 4: Run tests**

```bash
npx jest __tests__/inference.test.ts
```
Expected: all pass.

**Step 5: Commit**

```bash
git add src/server/inference.ts __tests__/inference.test.ts
git commit -m "feat: runInference returns GeminiResponse | null"
```

---

### Task 5: Update `SSI` to call `.text` on `invokeGemini` result

**Files:**
- Modify: `src/server/customFunctions.ts`

**Step 1: Run existing SSI tests to expose the breakage**

```bash
npx jest __tests__/customFunctions.test.ts
```
Expected: failures — `SSI` is now returning a stringified object instead of the text.

**Step 2: Update the `invokeGemini` call in `src/server/customFunctions.ts`**

Only the `return invokeGemini(...)` line changes:

```typescript
return invokeGemini({
  systemPrompt: systemPrompt || undefined,
  userTexts: flattenArg(userTexts),
  tools: resolvedToolIds.length ? resolvedToolIds : undefined,
}).text;
```

**Step 3: Run SSI tests**

```bash
npx jest __tests__/customFunctions.test.ts
```
Expected: all pass (behavior unchanged from the user's perspective).

**Step 4: Commit**

```bash
git add src/server/customFunctions.ts
git commit -m "feat: SSI uses invokeGemini().text after GeminiResponse refactor"
```

---

### Task 6: Full verification

**Step 1: Run full test suite with coverage**

```bash
npm run test:coverage
```
Expected: all pass, coverage thresholds met.

**Step 2: Build**

```bash
npm run build
```
Expected: clean build, no errors.

**Step 3: Lint and format check**

```bash
npm run lint && npm run format:check
```
Expected: no issues.
