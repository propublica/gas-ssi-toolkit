# AI Processing Phase 1: Parallel Inference Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sequential per-row inference loop in `runBatchAI` with a parallel pipeline using `UrlFetchApp.fetchAll()`, reducing 1,000-row runs from ~83 minutes to ~8–10 minutes.

**Architecture:** Two waves of parallelism per chunk. Wave 1 (multimodal only): fetch Drive metadata → download files → upload to Gemini Files API, all via `fetchAll`. Wave 2: build all N request payloads, fire all N Gemini inference calls via `fetchAll`, batch-write results. The client-side chunk loop (`computeChunks`/`runChunks`/`JobStore`) is unchanged — GAS's 6-minute execution limit still applies per call.

**Tech Stack:** Google Apps Script V8, TypeScript, `UrlFetchApp.fetchAll`, Gemini Files API (`/upload/v1beta/files`), Drive API v3 (`/drive/v3/files`), Jest + ts-jest.

---

## File Map

| File | Change |
|---|---|
| `src/server/api.ts` | Add `callGeminiAPIBatch` |
| `src/server/drive.ts` | Add `fetchDriveMetadata`, `downloadDriveFiles` |
| `src/server/files.ts` | **NEW** — `uploadFilesToGemini` |
| `src/server/inference.ts` | Extract `buildUserParts` (private), add `buildInferenceRequest`, simplify `runInference` |
| `src/server/index.ts` | Refactor `runBatchAI` inner loop — no unit tests (excluded from coverage) |
| `src/client/panels/configure-ai-run.ts` | Update `CHUNK_SIZE`, `CHUNK_WARN_THRESHOLD`, warning dialog copy |
| `__tests__/api.test.ts` | Add `callGeminiAPIBatch` tests + `file_data` passthrough test |
| `__tests__/drive.test.ts` | Add `fetchDriveMetadata` + `downloadDriveFiles` tests |
| `__tests__/files.test.ts` | **NEW** — `uploadFilesToGemini` tests |
| `__tests__/inference.test.ts` | Add `buildInferenceRequest` tests |
| `jest.config.cjs` | Add coverage threshold for `src/server/files.ts` |

**Note:** `src/server/types.ts` already has `GeminiFileApiData` (with `file_uri` and `mime_type` fields) and the `file_data` variant of `GeminiUserPart`. No changes needed.

---

## Task 1: Add `callGeminiAPIBatch` to `api.ts`

**Files:**
- Modify: `src/server/api.ts`
- Test: `__tests__/api.test.ts`

- [ ] **Step 1: Add `fetchAll` mock to api.test.ts and write failing tests**

Add `UrlFetchApp.fetchAll` to the existing mock at the top of `__tests__/api.test.ts` (before imports), then add a `describe("callGeminiAPIBatch")` block at the bottom of the file:

```typescript
// In the existing mock block at the top (before imports):
(globalThis as any).UrlFetchApp = {
  fetch: jest.fn(),
  fetchAll: jest.fn(),
};
```

```typescript
// Add at the bottom of __tests__/api.test.ts:

import { callGeminiAPIBatch } from "../src/server/api";

function mockFetchAllResponses(bodies: unknown[]) {
  (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue(
    bodies.map((body) => ({ getContentText: () => JSON.stringify(body) })),
  );
}

describe("callGeminiAPIBatch", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns one GeminiResponse per request", () => {
    mockFetchAllResponses([
      { candidates: [{ content: { parts: [{ text: "Result A" }] } }] },
      { candidates: [{ content: { parts: [{ text: "Result B" }] } }] },
    ]);
    const reqs: GeminiRequest[] = [
      { apiKey: "key", userParts: [{ text: "Q1" }] },
      { apiKey: "key", userParts: [{ text: "Q2" }] },
    ];
    const results = callGeminiAPIBatch(reqs);
    expect(results).toHaveLength(2);
    expect(results[0].text).toBe("Result A");
    expect(results[1].text).toBe("Result B");
  });

  it("returns empty array for empty input", () => {
    expect(callGeminiAPIBatch([])).toEqual([]);
    expect(UrlFetchApp.fetchAll as jest.Mock).not.toHaveBeenCalled();
  });

  it("maps a Gemini error response to an error text result (does not throw)", () => {
    mockFetchAllResponses([
      { error: { message: "quota exceeded" } },
      { candidates: [{ content: { parts: [{ text: "OK" }] } }] },
    ]);
    const reqs: GeminiRequest[] = [
      { apiKey: "key", userParts: [{ text: "Q1" }] },
      { apiKey: "key", userParts: [{ text: "Q2" }] },
    ];
    const results = callGeminiAPIBatch(reqs);
    expect(results[0].text).toMatch(/Error:/);
    expect(results[1].text).toBe("OK");
  });

  it("includes file_data parts in the request payload", () => {
    mockFetchAllResponses([
      { candidates: [{ content: { parts: [{ text: "ok" }] } }] },
    ]);
    const req: GeminiRequest = {
      apiKey: "key",
      userParts: [
        { text: "Describe this file" },
        { file_data: { file_uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mime_type: "application/pdf" } },
      ],
    };
    callGeminiAPIBatch([req]);
    const calls = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[0][0];
    const payload = JSON.parse(calls[0].payload);
    expect(payload.contents[0].parts[1].file_data).toEqual({
      file_uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
      mime_type: "application/pdf",
    });
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx jest __tests__/api.test.ts -t "callGeminiAPIBatch" --no-coverage
```

Expected: FAIL — `callGeminiAPIBatch is not a function`

- [ ] **Step 3: Implement `callGeminiAPIBatch` in `src/server/api.ts`**

Add after the existing `callGeminiAPI` function. Unlike `callGeminiAPI` (which throws on error), the batch version maps errors to `{ text: "Error: ..." }` so one bad row does not abort the whole chunk:

```typescript
/**
 * Fire N Gemini generateContent requests in parallel via UrlFetchApp.fetchAll.
 * Per-response errors are mapped to { text: "Error: ..." } rather than throwing,
 * so a single failed row does not abort the rest of the batch.
 */
export function callGeminiAPIBatch(reqs: GeminiRequest[]): GeminiResponse[] {
  if (reqs.length === 0) return [];

  const requests = reqs.map((req) => {
    const modelName = req.modelName ?? CONFIG.MODEL_NAME;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${req.apiKey}`;
    return {
      url,
      method: "post" as const,
      contentType: "application/json",
      payload: JSON.stringify(buildGeminiPayload(req)),
      muteHttpExceptions: true,
    };
  });

  const responses = UrlFetchApp.fetchAll(requests);

  return responses.map((response, i) => {
    const json = JSON.parse(response.getContentText()) as Record<string, unknown>;

    if (json.error) {
      return { text: `Error: ${(json.error as { message: string }).message}` };
    }

    const candidate = (json.candidates as Array<Record<string, unknown>> | undefined)?.[0];
    const parts =
      (candidate?.content as { parts?: Array<Record<string, unknown>> } | undefined)?.parts ?? [];

    const textParts = parts
      .filter((p): p is { text: string } => typeof p["text"] === "string")
      .map((p) => p.text);
    const text = textParts.join("\n\n") || "No response.";

    const codePairs: GeminiCodePair[] = [];
    for (let j = 0; j < parts.length - 1; j++) {
      const curr = parts[j];
      const next = parts[j + 1];
      if (curr["executableCode"] !== undefined && next["codeExecutionResult"] !== undefined) {
        codePairs.push({
          code: curr["executableCode"] as GeminiCodePair["code"],
          result: next["codeExecutionResult"] as GeminiCodePair["result"],
        });
        j++;
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
  });
}
```

- [ ] **Step 4: Run tests — expect pass**

```bash
npx jest __tests__/api.test.ts --no-coverage
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/server/api.ts __tests__/api.test.ts
git commit -m "feat: add callGeminiAPIBatch for parallel Gemini inference"
```

---

## Task 2: Add parallel Drive functions to `drive.ts`

**Files:**
- Modify: `src/server/drive.ts`
- Test: `__tests__/drive.test.ts`

- [ ] **Step 1: Add `UrlFetchApp.fetchAll` and `ScriptApp` to the mock block in `drive.test.ts`**

At the top of `__tests__/drive.test.ts`, add to the existing mock block (before imports):

```typescript
(globalThis as any).UrlFetchApp = {
  fetch: jest.fn(),
  fetchAll: jest.fn(),
};

(globalThis as any).ScriptApp = {
  getOAuthToken: jest.fn().mockReturnValue("mock-oauth-token"),
};
```

- [ ] **Step 2: Add failing tests for `fetchDriveMetadata` and `downloadDriveFiles`**

Add to `__tests__/drive.test.ts` (after existing imports, update the import line):

```typescript
import {
  checkDriveService,
  extractTextUniversal,
  prepareDriveAttachments,
  fetchDriveMetadata,
  downloadDriveFiles,
} from "../src/server/drive";
```

Then add these describe blocks at the bottom of the file:

```typescript
describe("fetchDriveMetadata", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns a map of fileId to mimeType and size", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getContentText: () => JSON.stringify({ mimeType: "application/pdf", size: "102400" }) },
      { getContentText: () => JSON.stringify({ mimeType: "image/png", size: "204800" }) },
    ]);
    const result = fetchDriveMetadata(["file1", "file2"], "token");
    expect(result.get("file1")).toEqual({ mimeType: "application/pdf", size: 102400 });
    expect(result.get("file2")).toEqual({ mimeType: "image/png", size: 204800 });
  });

  it("returns empty map for empty input", () => {
    expect(fetchDriveMetadata([], "token").size).toBe(0);
    expect(UrlFetchApp.fetchAll as jest.Mock).not.toHaveBeenCalled();
  });

  it("throws when Drive API returns an error", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getContentText: () => JSON.stringify({ error: { message: "File not found" } }) },
    ]);
    expect(() => fetchDriveMetadata(["bad-id"], "token")).toThrow("File not found");
  });
});

describe("downloadDriveFiles", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uses export URL for Google Docs", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getResponseCode: () => 200, getContent: () => [1, 2, 3] },
    ]);
    const metadata = new Map([["docId", { mimeType: "application/vnd.google-apps.document", size: 0 }]]);
    downloadDriveFiles(["docId"], metadata, "token");
    const calls = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[0][0];
    expect(calls[0].url).toContain("export?mimeType=application/pdf");
  });

  it("uses export URL for Google Sheets", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getResponseCode: () => 200, getContent: () => [1, 2, 3] },
    ]);
    const metadata = new Map([["sheetId", { mimeType: "application/vnd.google-apps.spreadsheet", size: 0 }]]);
    downloadDriveFiles(["sheetId"], metadata, "token");
    const calls = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[0][0];
    expect(calls[0].url).toContain("export?mimeType=text/csv");
  });

  it("uses alt=media for binary files", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getResponseCode: () => 200, getContent: () => [255, 254] },
    ]);
    const metadata = new Map([["pdfId", { mimeType: "application/pdf", size: 0 }]]);
    downloadDriveFiles(["pdfId"], metadata, "token");
    const calls = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[0][0];
    expect(calls[0].url).toContain("?alt=media");
  });

  it("returns a map of fileId to Uint8Array bytes", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getResponseCode: () => 200, getContent: () => [10, 20, 30] },
    ]);
    const metadata = new Map([["fileId", { mimeType: "application/pdf", size: 0 }]]);
    const result = downloadDriveFiles(["fileId"], metadata, "token");
    expect(result.get("fileId")).toEqual(new Uint8Array([10, 20, 30]));
  });

  it("returns empty map for empty input", () => {
    expect(downloadDriveFiles([], new Map(), "token").size).toBe(0);
  });

  it("throws when a download returns HTTP error", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getResponseCode: () => 403, getContent: () => [] },
    ]);
    const metadata = new Map([["fileId", { mimeType: "application/pdf", size: 0 }]]);
    expect(() => downloadDriveFiles(["fileId"], metadata, "token")).toThrow("403");
  });
});
```

- [ ] **Step 3: Run failing tests**

```bash
npx jest __tests__/drive.test.ts -t "fetchDriveMetadata|downloadDriveFiles" --no-coverage
```

Expected: FAIL — functions not found

- [ ] **Step 4: Implement `fetchDriveMetadata` and `downloadDriveFiles` in `src/server/drive.ts`**

Add these exports at the bottom of `src/server/drive.ts`:

```typescript
/**
 * Fetch mimeType and size for a list of Drive file IDs in parallel via fetchAll.
 * Uses the Drive API v3 files.get endpoint with an OAuth Bearer token.
 */
export function fetchDriveMetadata(
  fileIds: string[],
  oauthToken: string,
): Map<string, { mimeType: string; size: number }> {
  if (fileIds.length === 0) return new Map();

  const requests = fileIds.map((id) => ({
    url: `https://www.googleapis.com/drive/v3/files/${id}?fields=id%2CmimeType%2Csize`,
    method: "get" as const,
    headers: { Authorization: `Bearer ${oauthToken}` },
    muteHttpExceptions: true,
  }));

  const responses = UrlFetchApp.fetchAll(requests);
  const result = new Map<string, { mimeType: string; size: number }>();

  responses.forEach((response, i) => {
    const json = JSON.parse(response.getContentText()) as {
      mimeType?: string;
      size?: string;
      error?: { message: string };
    };
    if (json.error) {
      throw new Error(`Failed to fetch metadata for ${fileIds[i]}: ${json.error.message}`);
    }
    result.set(fileIds[i], {
      mimeType: json.mimeType ?? "application/octet-stream",
      size: parseInt(json.size ?? "0", 10),
    });
  });

  return result;
}

/**
 * Download raw file bytes for a list of Drive files in parallel via fetchAll.
 * Routes Google Docs/Sheets to their export endpoints; all other types use alt=media.
 */
export function downloadDriveFiles(
  fileIds: string[],
  metadata: Map<string, { mimeType: string; size: number }>,
  oauthToken: string,
): Map<string, Uint8Array> {
  if (fileIds.length === 0) return new Map();

  const DOCS_MIME = "application/vnd.google-apps.document";
  const SHEETS_MIME = "application/vnd.google-apps.spreadsheet";

  const requests = fileIds.map((id) => {
    const mimeType = metadata.get(id)?.mimeType ?? "";
    let url: string;
    if (mimeType === DOCS_MIME) {
      url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=application%2Fpdf`;
    } else if (mimeType === SHEETS_MIME) {
      url = `https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=text%2Fcsv`;
    } else {
      url = `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
    }
    return {
      url,
      method: "get" as const,
      headers: { Authorization: `Bearer ${oauthToken}` },
      muteHttpExceptions: true,
    };
  });

  const responses = UrlFetchApp.fetchAll(requests);
  const result = new Map<string, Uint8Array>();

  responses.forEach((response, i) => {
    const code = response.getResponseCode();
    if (code >= 400) {
      throw new Error(`Failed to download file ${fileIds[i]}: HTTP ${code}`);
    }
    result.set(fileIds[i], new Uint8Array(response.getContent()));
  });

  return result;
}
```

- [ ] **Step 5: Run all drive tests**

```bash
npx jest __tests__/drive.test.ts --no-coverage
```

Expected: all pass

- [ ] **Step 6: Commit**

```bash
git add src/server/drive.ts __tests__/drive.test.ts
git commit -m "feat: add fetchDriveMetadata and downloadDriveFiles for parallel Drive access"
```

---

## Task 3: Create `src/server/files.ts` with `uploadFilesToGemini`

**Files:**
- Create: `src/server/files.ts`
- Create: `__tests__/files.test.ts`

- [ ] **Step 1: Write failing tests in `__tests__/files.test.ts`**

```typescript
/**
 * Tests for src/server/files.ts
 */

// ── Mock globals BEFORE imports ────────────────────────────────

(globalThis as any).UrlFetchApp = {
  fetchAll: jest.fn(),
};

// ── Import after mocks ─────────────────────────────────────────

import { uploadFilesToGemini } from "../src/server/files";

// ── Tests ──────────────────────────────────────────────────────

describe("uploadFilesToGemini", () => {
  beforeEach(() => jest.clearAllMocks());

  function mockUploadResponse(fileId: string, uri: string, mimeType: string) {
    return {
      getContentText: () =>
        JSON.stringify({ file: { name: `files/${fileId}`, uri, mimeType } }),
    };
  }

  it("returns a map of fileId to uri and mimeType", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      mockUploadResponse("file1", "https://generativelanguage.googleapis.com/v1beta/files/abc", "application/pdf"),
      mockUploadResponse("file2", "https://generativelanguage.googleapis.com/v1beta/files/def", "image/png"),
    ]);
    const files = new Map([
      ["file1", new Uint8Array([1, 2, 3])],
      ["file2", new Uint8Array([4, 5, 6])],
    ]);
    const mimeTypes = new Map([
      ["file1", "application/pdf"],
      ["file2", "image/png"],
    ]);
    const result = uploadFilesToGemini(files, mimeTypes, "test-key");
    expect(result.get("file1")).toEqual({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
      mimeType: "application/pdf",
    });
    expect(result.get("file2")).toEqual({
      uri: "https://generativelanguage.googleapis.com/v1beta/files/def",
      mimeType: "image/png",
    });
  });

  it("returns empty map for empty input", () => {
    const result = uploadFilesToGemini(new Map(), new Map(), "key");
    expect(result.size).toBe(0);
    expect(UrlFetchApp.fetchAll as jest.Mock).not.toHaveBeenCalled();
  });

  it("throws when Files API returns an error", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      { getContentText: () => JSON.stringify({ error: { message: "quota exceeded" } }) },
    ]);
    const files = new Map([["fileId", new Uint8Array([1])]]);
    const mimeTypes = new Map([["fileId", "application/pdf"]]);
    expect(() => uploadFilesToGemini(files, mimeTypes, "key")).toThrow("quota exceeded");
  });

  it("processes files in sub-batches of 10", () => {
    const fileIds = Array.from({ length: 25 }, (_, i) => `file${i}`);
    const files = new Map(fileIds.map((id) => [id, new Uint8Array([1])]));
    const mimeTypes = new Map(fileIds.map((id) => [id, "application/pdf"]));

    const singleResponse = (id: string) => ({
      getContentText: () =>
        JSON.stringify({ file: { uri: `https://example.com/${id}`, mimeType: "application/pdf" } }),
    });

    // Three batches: 10 + 10 + 5
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce(fileIds.slice(0, 10).map(singleResponse))
      .mockReturnValueOnce(fileIds.slice(10, 20).map(singleResponse))
      .mockReturnValueOnce(fileIds.slice(20, 25).map(singleResponse));

    const result = uploadFilesToGemini(files, mimeTypes, "key");
    expect(UrlFetchApp.fetchAll as jest.Mock).toHaveBeenCalledTimes(3);
    expect(result.size).toBe(25);
  });

  it("sends multipart content-type header", () => {
    (UrlFetchApp.fetchAll as jest.Mock).mockReturnValue([
      mockUploadResponse("f1", "https://example.com/f1", "application/pdf"),
    ]);
    uploadFilesToGemini(
      new Map([["f1", new Uint8Array([1])]]),
      new Map([["f1", "application/pdf"]]),
      "key",
    );
    const calls = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[0][0];
    expect(calls[0].contentType).toMatch(/multipart\/related/);
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx jest __tests__/files.test.ts --no-coverage
```

Expected: FAIL — module not found

- [ ] **Step 3: Create `src/server/files.ts`**

```typescript
/**
 * files.ts — Gemini Files API integration.
 *
 * Uploads Drive file bytes to the Gemini Files API and returns stable URI
 * references. Files are cached on Gemini's servers for 48 hours.
 * Using URIs instead of inline base64 eliminates GAS memory pressure and
 * enables deduplication across rows in a chunk.
 */

/**
 * Upload a batch of files to the Gemini Files API in parallel.
 * Processed in sub-batches of 10 to limit peak memory.
 *
 * @param files     Map of driveFileId → raw bytes (Uint8Array)
 * @param mimeTypes Map of driveFileId → MIME type string
 * @param apiKey    Gemini API key
 * @returns Map of driveFileId → { uri, mimeType } from the Files API response
 */
export function uploadFilesToGemini(
  files: Map<string, Uint8Array>,
  mimeTypes: Map<string, string>,
  apiKey: string,
): Map<string, { uri: string; mimeType: string }> {
  const result = new Map<string, { uri: string; mimeType: string }>();
  const fileIds = Array.from(files.keys());
  if (fileIds.length === 0) return result;

  const BATCH_SIZE = 10;
  for (let i = 0; i < fileIds.length; i += BATCH_SIZE) {
    const batch = fileIds.slice(i, i + BATCH_SIZE);
    const requests = batch.map((fileId) =>
      buildUploadRequest(
        fileId,
        files.get(fileId)!,
        mimeTypes.get(fileId) ?? "application/octet-stream",
        apiKey,
      ),
    );

    const responses = UrlFetchApp.fetchAll(requests);
    responses.forEach((response, j) => {
      const fileId = batch[j];
      const json = JSON.parse(response.getContentText()) as {
        file?: { uri: string; mimeType: string };
        error?: { message: string };
      };
      if (json.error || !json.file?.uri) {
        throw new Error(
          `Failed to upload file ${fileId}: ${json.error?.message ?? "missing URI in response"}`,
        );
      }
      result.set(fileId, { uri: json.file.uri, mimeType: json.file.mimeType });
    });
  }

  return result;
}

function buildUploadRequest(
  fileId: string,
  bytes: Uint8Array,
  mimeType: string,
  apiKey: string,
): { url: string } & GoogleAppsScript.URL_Fetch.URLFetchRequestOptions {
  const boundary = "boundary" + Math.random().toString(36).slice(2, 18);
  const metadata = JSON.stringify({ file: { display_name: fileId } });

  const pre = stringToBytes(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const post = stringToBytes(`\r\n--${boundary}--`);

  const body = new Uint8Array(pre.length + bytes.length + post.length);
  body.set(pre, 0);
  body.set(bytes, pre.length);
  body.set(post, pre.length + bytes.length);

  return {
    url: `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    method: "post",
    contentType: `multipart/related; boundary=${boundary}`,
    headers: { "X-Goog-Upload-Protocol": "multipart" },
    payload: Array.from(body) as GoogleAppsScript.Byte[],
    muteHttpExceptions: true,
  };
}

function stringToBytes(s: string): Uint8Array {
  return new Uint8Array(s.split("").map((c) => c.charCodeAt(0)));
}
```

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/files.test.ts --no-coverage
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add src/server/files.ts __tests__/files.test.ts
git commit -m "feat: add uploadFilesToGemini for Gemini Files API integration"
```

---

## Task 4: Refactor `inference.ts` — add `buildInferenceRequest`

**Files:**
- Modify: `src/server/inference.ts`
- Test: `__tests__/inference.test.ts`

- [ ] **Step 1: Write failing tests for `buildInferenceRequest`**

Update the import line in `__tests__/inference.test.ts`:

```typescript
import { runInference, buildInferenceRequest } from "../src/server/inference";
```

Add these tests at the bottom of the file:

```typescript
describe("buildInferenceRequest", () => {
  it("returns a GeminiRequest for a text input", () => {
    const req = buildInferenceRequest([{ kind: "text", value: "Hello" }]);
    expect(req).not.toBeNull();
    expect(req!.userParts).toEqual([{ text: "Hello" }]);
  });

  it("returns null when all inputs are empty", () => {
    expect(buildInferenceRequest([{ kind: "text", value: "" }])).toBeNull();
    expect(buildInferenceRequest([{ kind: "text", value: null }])).toBeNull();
  });

  it("includes systemPrompt in the returned request", () => {
    const req = buildInferenceRequest([{ kind: "text", value: "Q" }], "Be concise");
    expect(req!.systemPrompt).toBe("Be concise");
  });

  it("includes tools in the returned request", () => {
    const req = buildInferenceRequest(
      [{ kind: "text", value: "Q" }],
      undefined,
      ["google_search"],
    );
    expect(req!.tools).toEqual(["google_search"]);
  });

  it("uses file URI from fileUriMap for file inputs", () => {
    const fileUriMap = new Map([
      ["fileId123", { uri: "https://generativelanguage.googleapis.com/v1beta/files/abc", mimeType: "application/pdf" }],
    ]);
    const req = buildInferenceRequest(
      [{ kind: "file", value: "https://drive.google.com/file/d/fileId123/view" }],
      undefined,
      undefined,
      fileUriMap,
    );
    expect(req).not.toBeNull();
    expect(req!.userParts).toEqual([
      {
        file_data: {
          file_uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
          mime_type: "application/pdf",
        },
      },
    ]);
  });

  it("skips file inputs with no URI in fileUriMap", () => {
    const fileUriMap = new Map<string, { uri: string; mimeType: string }>();
    const req = buildInferenceRequest(
      [{ kind: "file", value: "https://drive.google.com/file/d/missing123/view" }],
      undefined,
      undefined,
      fileUriMap,
    );
    // No parts — returns null
    expect(req).toBeNull();
  });

  it("uses prepareDriveAttachments (inline path) when no fileUriMap provided", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 1000,
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
      getName: () => "test.pdf",
    });
    (Utilities.base64Encode as jest.Mock).mockReturnValue("encoded==");

    const req = buildInferenceRequest([
      { kind: "file", value: "https://drive.google.com/file/d/fileId123/view" },
    ]);
    expect(req).not.toBeNull();
    expect(req!.userParts[0]).toHaveProperty("inline_data");
  });

  it("prefixes text parts with label when label is set", () => {
    const req = buildInferenceRequest([{ kind: "text", value: "content", label: "Article" }]);
    expect(req!.userParts[0]).toEqual({ text: "Article: content" });
  });

  it("does not add apiKey (caller responsibility)", () => {
    const req = buildInferenceRequest([{ kind: "text", value: "Q" }]);
    expect(req).not.toHaveProperty("apiKey");
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx jest __tests__/inference.test.ts -t "buildInferenceRequest" --no-coverage
```

Expected: FAIL — `buildInferenceRequest is not a function`

- [ ] **Step 3: Refactor `src/server/inference.ts`**

Replace the entire file:

```typescript
/**
 * inference.ts — Gemini request construction and single-call inference.
 *
 * buildInferenceRequest  — pure, no HTTP; assembles a GeminiRequest from row data
 *                          using pre-uploaded Files API URIs (batch path) or inline
 *                          base64 via prepareDriveAttachments (single-call path).
 * runInference           — single-call path for SSI custom function; calls
 *                          buildInferenceRequest then invokeGemini.
 */

import { invokeGemini } from "./api";
import { prepareDriveAttachments } from "./drive";
import { flattenArg, isValidDriveLink, extractId } from "./utils";
import type {
  GeminiRequest,
  GeminiResponse,
  GeminiUserPart,
  PromptInput,
} from "./types";
import type { ToolId } from "../shared/types";

/**
 * Assemble user-turn parts from prompt inputs.
 * Text inputs are flattened via flattenArg and optionally prefixed with a label.
 * File inputs use URI references from fileUriMap (Files API path) when provided,
 * or fall back to prepareDriveAttachments (inline base64 path) when not.
 */
function buildUserParts(
  promptInputs: PromptInput[],
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): GeminiUserPart[] {
  const userParts: GeminiUserPart[] = [];

  for (const input of promptInputs) {
    if (input.kind === "text") {
      const texts = flattenArg(input.value);
      const parts = input.label
        ? texts.map((text) => ({ text: `${input.label}: ${text}` }))
        : texts.map((text) => ({ text }));
      userParts.push(...parts);
    } else {
      const fileIds = flattenArg(input.value).filter(isValidDriveLink).map(extractId);
      if (fileIds.length === 0) continue;

      if (fileUriMap) {
        for (const fileId of fileIds) {
          const fileInfo = fileUriMap.get(fileId);
          if (fileInfo) {
            userParts.push({
              file_data: { file_uri: fileInfo.uri, mime_type: fileInfo.mimeType },
            });
          }
        }
      } else {
        const attachments = prepareDriveAttachments(fileIds);
        userParts.push(...attachments.map((inline_data) => ({ inline_data })));
      }
    }
  }

  return userParts;
}

/**
 * Build a Gemini generateContent request from row data without making an HTTP call.
 * Returns null if no prompt inputs produce any content (signals caller to skip row).
 *
 * @param fileUriMap  Pre-uploaded Files API URIs (batch path). Omit to use inline
 *                    base64 via prepareDriveAttachments (single-call path).
 */
export function buildInferenceRequest(
  promptInputs: PromptInput[],
  systemPrompt?: unknown,
  tools?: ToolId[],
  fileUriMap?: Map<string, { uri: string; mimeType: string }>,
): Omit<GeminiRequest, "apiKey"> | null {
  const userParts = buildUserParts(promptInputs, fileUriMap);
  if (userParts.length === 0) return null;

  return {
    systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
    userParts,
    tools: tools?.length ? tools : undefined,
  };
}

/**
 * Execute a single Gemini inference from raw cell values.
 * Used by the SSI custom function. Resolves the API key from ScriptProperties.
 *
 * @returns The model response, an object with "Error: ..." text on failure,
 *          or null if no prompt inputs produce any content.
 */
export function runInference(
  promptInputs: PromptInput[],
  systemPrompt?: unknown,
  tools?: ToolId[],
): GeminiResponse | null {
  try {
    const req = buildInferenceRequest(promptInputs, systemPrompt, tools);
    if (req === null) return null;
    return invokeGemini(req);
  } catch (e) {
    return { text: "Error: " + (e as Error).message };
  }
}
```

- [ ] **Step 4: Run all inference tests**

```bash
npx jest __tests__/inference.test.ts --no-coverage
```

Expected: all pass

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
npm test -- --no-coverage
```

Expected: all 439+ tests pass

- [ ] **Step 6: Commit**

```bash
git add src/server/inference.ts __tests__/inference.test.ts
git commit -m "refactor: extract buildInferenceRequest from runInference for batch path"
```

---

## Task 5: Refactor `runBatchAI` in `index.ts`

**Files:**
- Modify: `src/server/index.ts`

`index.ts` is excluded from unit test coverage (deep SpreadsheetApp coupling). Manual test instructions are at the end of this task.

- [ ] **Step 1: Update imports at the top of `src/server/index.ts`**

Find the existing import block and add the new functions:

```typescript
import { runBatchAI as _unused, ... } // replace the existing runInference import and add new ones
```

The full updated import block for the server modules (replace the relevant lines):

```typescript
import { callGeminiAPIBatch } from "./api";
import { fetchDriveMetadata, downloadDriveFiles } from "./drive";
import { uploadFilesToGemini } from "./files";
import { buildInferenceRequest } from "./inference";
import { CONFIG } from "./config";
import { flattenArg, isValidDriveLink, extractId, writeJobProgress, /* keep existing */ } from "./utils";
import type { GeminiRequest } from "./types";
```

Keep all other existing imports unchanged.

- [ ] **Step 2: Replace the `runBatchAI` inner loop**

Find the `for (let i = 0; i < dataValues.length; i++)` loop inside `runBatchAI` (currently lines ~334–380 in `src/server/index.ts`) and replace everything from after `const dataValues = ...` through `SpreadsheetApp.getActive().toast(...)` with the new parallel implementation:

```typescript
  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
  if (!apiKey) {
    ui.alert("Error", `${CONFIG.API_KEY_PROPERTY} script property not set`, ui.ButtonSet.OK);
    return;
  }

  const cache = CacheService.getUserCache();
  const hasFileInputs = config.promptCols.some((pc) => pc.kind === "file");

  // Build all prompt input arrays (one per row) — pure, no I/O
  const allPromptInputs = dataValues.map((row) =>
    config.promptCols.map((pc, colIdx) => ({
      kind: pc.kind,
      value: row[promptIdxs[colIdx]],
      ...(config.prefixWithColName ? { label: pc.col } : {}),
    })),
  );

  // Wave 1 — file work (multimodal chunks only)
  let fileUriMap = new Map<string, { uri: string; mimeType: string }>();

  if (hasFileInputs) {
    const oauthToken = ScriptApp.getOAuthToken();

    // Collect unique Drive file IDs across all rows in this chunk
    const allFileIds = new Set<string>();
    for (const inputs of allPromptInputs) {
      for (const input of inputs) {
        if (input.kind === "file") {
          flattenArg(input.value)
            .filter(isValidDriveLink)
            .map(extractId)
            .forEach((id) => allFileIds.add(id));
        }
      }
    }

    const fileIds = Array.from(allFileIds);
    if (fileIds.length > 0) {
      if (jobId) {
        writeJobProgress(cache, jobId, {
          message: `Downloading files for chunk...`,
        });
      }
      const metadata = fetchDriveMetadata(fileIds, oauthToken);
      const bytes = downloadDriveFiles(fileIds, metadata, oauthToken);

      if (jobId) {
        writeJobProgress(cache, jobId, {
          message: `Uploading files for chunk...`,
        });
      }
      const mimeTypes = new Map(fileIds.map((id) => [id, metadata.get(id)!.mimeType]));
      fileUriMap = uploadFilesToGemini(bytes, mimeTypes, apiKey);
    }
  }

  // Wave 2 — build requests and fire inference in parallel
  if (jobId) {
    writeJobProgress(cache, jobId, { message: `Running AI on chunk...` });
  }

  const requests: GeminiRequest[] = [];
  const rowIndices: number[] = [];

  for (let i = 0; i < allPromptInputs.length; i++) {
    const systemPrompt = systemPromptIdx >= 0 ? dataValues[i][systemPromptIdx] : undefined;
    const req = buildInferenceRequest(allPromptInputs[i], systemPrompt, config.tools, fileUriMap);
    if (req !== null) {
      requests.push({ ...req, apiKey });
      rowIndices.push(i);
    }
  }

  if (requests.length === 0) return;

  const results = callGeminiAPIBatch(requests);

  // Write all results — single flush at end
  for (let j = 0; j < results.length; j++) {
    const i = rowIndices[j];
    const realRowIndex = startRow + i;
    const result = results[j];

    if (config.applyMarkdown) {
      try {
        sheet
          .getRange(realRowIndex, outputIdx + 1)
          .setRichTextValue(toCellValue(buildRichInferenceCellContent(result)));
      } catch (_e) {
        sheet.getRange(realRowIndex, outputIdx + 1).setValue(result.text);
      }
    } else {
      sheet.getRange(realRowIndex, outputIdx + 1).setValue(result.text);
    }

    if (config.includeGrounding && groundingIdx >= 0) {
      const groundingContent = buildRichGroundingCellContent(result);
      if (groundingContent !== null) {
        sheet
          .getRange(realRowIndex, groundingIdx + 1)
          .setRichTextValue(toCellValue(groundingContent));
      }
    }
  }

  SpreadsheetApp.flush();
  SpreadsheetApp.getActive().toast(`Complete! Processed ${results.length} rows.`, "Success", 5);
```

- [ ] **Step 3: Build and check for type errors**

```bash
npm run typecheck
```

Expected: no errors. Fix any type mismatches before proceeding.

- [ ] **Step 4: Build the project**

```bash
npm run build
```

Expected: clean build to `dist/`

- [ ] **Step 5: Manual deploy and test — text-only run**

Deploy to the Apps Script project and run a text-only batch:

```bash
npm run deploy
```

1. Open the spreadsheet and sidebar
2. Set up a sheet with a text prompt column and 10 rows of data
3. Run AI on rows 2–11
4. Verify: results appear in the output column, job indicator shows "Running AI on chunk...", completion toast fires

- [ ] **Step 6: Manual deploy and test — multimodal run**

1. Add a file column with 3–5 Drive file URLs (mix of Docs and PDFs)
2. Run AI on those rows
3. Verify: job indicator shows "Downloading files...", then "Uploading files...", then "Running AI...", then results appear

- [ ] **Step 7: Commit**

```bash
git add src/server/index.ts
git commit -m "refactor: replace sequential runBatchAI loop with parallel fetchAll pipeline"
```

---

## Task 6: Update `configure-ai-run.ts` constants and warning dialog

**Files:**
- Modify: `src/client/panels/configure-ai-run.ts`

No new tests needed — `configure-ai-run.test.ts` tests `computeChunks` with an explicit chunk size argument and is unaffected by the constant changes.

- [ ] **Step 1: Update constants and warning dialog copy**

In `src/client/panels/configure-ai-run.ts`, make these three changes:

```typescript
// Line 12: change CHUNK_SIZE
export const CHUNK_SIZE = 50;

// Line 15: change CHUNK_WARN_THRESHOLD
export const CHUNK_WARN_THRESHOLD = 200;
```

Find the `confirm(...)` call in `handleRun` and update the time estimate:

```typescript
// Replace:
// const estimatedMins = Math.ceil((rowCount * 5) / 60);
const estimatedMins = Math.ceil((rowCount * 0.5) / 60) || 1;

// Replace the confirm message body:
const ok = globalThis.confirm(
  `You're about to process ${rowCount} rows across ${chunkCount} chunks.\n\n` +
    `This will take roughly ${estimatedMins} minute(s). ` +
    `The sidebar must remain open throughout — closing it will stop the run after the current chunk finishes.\n\n` +
    `Continue?`,
);
```

- [ ] **Step 2: Run existing configure-ai-run tests to confirm no regressions**

```bash
npx jest __tests__/configure-ai-run.test.ts --no-coverage
```

Expected: all pass

- [ ] **Step 3: Run full test suite**

```bash
npm test -- --no-coverage
```

Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/client/panels/configure-ai-run.ts
git commit -m "feat: increase chunk size to 50 rows and update warning dialog for parallel execution"
```

---

## Task 7: Add coverage threshold for `files.ts` and run full coverage check

**Files:**
- Modify: `jest.config.cjs`

- [ ] **Step 1: Add threshold for `src/server/files.ts`**

In `jest.config.cjs`, add to the `coverageThreshold` object (after the `api.ts` entry):

```javascript
"./src/server/files.ts": {
  statements: 90,
  branches: 85,
  functions: 100,
},
```

- [ ] **Step 2: Run coverage and confirm thresholds pass**

```bash
npm run test:coverage
```

Expected: all per-file thresholds pass. If `files.ts` falls below 90% statements, add tests in `__tests__/files.test.ts` for uncovered branches.

- [ ] **Step 3: Commit**

```bash
git add jest.config.cjs
git commit -m "test: add coverage threshold for files.ts"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `callGeminiAPIBatch` wraps `fetchAll` | Task 1 |
| `file_data` parts pass through `buildGeminiPayload` | Task 1 (test) |
| `fetchDriveMetadata` — parallel Drive API metadata | Task 2 |
| `downloadDriveFiles` — parallel Drive export | Task 2 |
| Google Sheets exports as CSV (first sheet only) | Task 2 (implemented, caveat documented in spec) |
| `uploadFilesToGemini` — Files API multipart upload, sub-batches of 10 | Task 3 |
| Extract `buildUserParts` (private), add `buildInferenceRequest` | Task 4 |
| `runInference` simplified to `buildInferenceRequest` + `invokeGemini` | Task 4 |
| Inline path (`prepareDriveAttachments`) preserved for `runInference` | Task 4 |
| `runBatchAI` — text-only path (skip file waves) | Task 5 |
| `runBatchAI` — multimodal path (Wave 1 + Wave 2) | Task 5 |
| Within-chunk progress messages (Download/Upload/Run AI) | Task 5 |
| Single `SpreadsheetApp.flush()` per chunk | Task 5 |
| `CHUNK_SIZE` 10 → 50 | Task 6 |
| `CHUNK_WARN_THRESHOLD` 50 → 200 | Task 6 |
| Time estimate update | Task 6 |
| Coverage threshold for `files.ts` | Task 7 |

**Type consistency check:**

- `buildInferenceRequest` returns `Omit<GeminiRequest, "apiKey"> | null` — matches usage in Task 5 where `apiKey` is spread in: `{ ...req, apiKey }`
- `fileUriMap` type is `Map<string, { uri: string; mimeType: string }>` — consistent across Task 3 (return type), Task 4 (parameter type), Task 5 (usage)
- `file_data` part uses `file_uri` and `mime_type` (snake_case) — matches existing `GeminiFileApiData` in `types.ts`
- `uploadFilesToGemini` takes `Map<string, Uint8Array>` and `Map<string, string>` (mimeTypes) — consistent between Task 3 and Task 5 usage
- `downloadDriveFiles` returns `Map<string, Uint8Array>` — consistent between Task 2 and Task 5 usage
- `fetchDriveMetadata` returns `Map<string, { mimeType: string; size: number }>` — consistent between Task 2 and Task 5 usage
