# T17/R24 — Gemini API Key via Auth Header: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send `GEMINI_API_KEY` to Gemini via the `x-goog-api-key` request header instead of the URL query string, and consolidate all key resolution into one module so the raw key never crosses a function boundary.

**Architecture:** A new `src/server/gemini-auth.ts` becomes the sole owner of the API key, exposing `geminiAuthHeaders()` (throws when unset) and `hasGeminiApiKey()` (cheap UI preflight). The three Gemini call sites drop `?key=` from their URLs and attach the header instead. `GeminiRequest.apiKey`, `uploadFilesToGemini`'s `apiKey` parameter, `invokeGemini`, and `CONFIG.API_KEY_PROPERTY` are all deleted, making it a compile error to pass a key around. A source-scanning regression test prevents a future endpoint from reintroducing the pattern.

**Tech Stack:** TypeScript (ES2019 target, Apps Script V8 runtime), Jest + ts-jest, Rollup, ESLint + Prettier.

**Spec:** `docs/superpowers/specs/2026-07-29-t17-api-key-header-design.md`

## Global Constraints

- **Header name is exactly `x-goog-api-key`** (lowercase). Confirmed against `https://ai.google.dev/gemini-api/docs/api-key`.
- **Missing-key message is exactly `GEMINI_API_KEY script property not set`** — unchanged from today's wording, because `__tests__/customFunctions.test.ts:126` asserts `/\[SSI Error:.*GEMINI_API_KEY/` and that assertion must keep describing real behavior.
- **Resolve the credential once per fetch batch**, never inside a `.map()` callback — each `geminiAuthHeaders()` call reads a script property, and a chunk can hold dozens of rows.
- **Do not touch phase 2 of the Files API upload.** The session URI returned by phase 1 is self-authenticating; Google's own docs send no credential on phase 2.
- **The API key must never appear in a URL.** That is the entire point of this work.
- **R25/AI-79 is out of scope** — do not change `runInference()`'s or `SSI()`'s catch blocks.
- Code style: named exports only, explicit return types, `const` by default, `===`, double quotes, trailing commas, semicolons. No Node.js built-ins in `src/` (tests may use them via `/// <reference types="node" />`).
- Every task ends green: `npm test` and `npm run typecheck` both pass before committing.

## File Structure

**Created:**
- `src/server/gemini-auth.ts` — sole owner of `GEMINI_API_KEY`. Two functions, two constants. No URL, payload, or response concerns.
- `__tests__/gemini-auth.test.ts` — unit tests for the above.
- `__tests__/credential-hygiene.test.ts` — source-scanning regression guard for T17.

**Modified:**
- `src/server/api.ts` — header swap in `callGeminiAPI` (`:55-66`) and `callGeminiAPIBatch` (`:114-127`); delete `invokeGemini` (`:180-189`).
- `src/server/files.ts` — header swap in phase-1 init (`:36-47`); drop the `apiKey` parameter (`:25-29`).
- `src/server/types.ts` — delete `GeminiRequest.apiKey` (`:163`) and `AppConfig.API_KEY_PROPERTY` (`:14`).
- `src/server/config.ts` — delete `API_KEY_PROPERTY` (`:10`).
- `src/server/inference.ts` — `invokeGemini` → `callGeminiAPI` (`:13`, `:108`); return type `Omit<GeminiRequest, "apiKey">` → `GeminiRequest` (`:74`).
- `src/server/customFunctions.ts` — `invokeGemini` → `callGeminiAPI` (`:14`, `:40`).
- `src/server/index.ts` — replace the key lookup + alert (`:382-385`) with a `hasGeminiApiKey()` preflight; drop `apiKey` from the `uploadFilesToGemini` call (`:468-472`) and the request push (`:516`).
- `jest.config.cjs` — add a per-file coverage threshold for `gemini-auth.ts`.
- `__tests__/api.test.ts`, `__tests__/files.test.ts`, `__tests__/api-function-tools.test.ts` — updated for the new signatures and header assertions.
- `docs/threat_models/ssi-toolkit-threat-model.md`, `CLAUDE.md` — documentation.

**Task ordering rationale:** Task 1 adds the module with nothing depending on it. Task 2 does the `api.ts` swap *and* the `GeminiRequest.apiKey` deletion together, because deleting a required field cascades into every caller at once — there is no green intermediate state. Task 3 removes the last two key holders (`files.ts`, `index.ts`) and the now-dead `CONFIG` entry. Tasks 4–5 add the guard and the docs.

---

### Task 1: The `gemini-auth.ts` module

**Files:**
- Create: `src/server/gemini-auth.ts`
- Create: `__tests__/gemini-auth.test.ts`
- Modify: `jest.config.cjs` (coverage threshold block, after the `./src/server/inference.ts` entry around line 69)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `API_KEY_PROPERTY: string` — the literal `"GEMINI_API_KEY"`
  - `MISSING_API_KEY_MESSAGE: string` — the literal `"GEMINI_API_KEY script property not set"`
  - `hasGeminiApiKey(): boolean`
  - `geminiAuthHeaders(): Record<string, string>` — returns `{ "x-goog-api-key": <key> }`, throws `Error(MISSING_API_KEY_MESSAGE)` when unset

- [ ] **Step 1: Write the failing test**

Create `__tests__/gemini-auth.test.ts`. Note the repo pattern: GAS globals are assigned to `globalThis` **before** the import, because imports execute immediately.

```ts
/**
 * Tests for src/server/gemini-auth.ts
 *
 * GAS globals mocked: PropertiesService. No UrlFetchApp — this module makes no
 * network calls.
 */

// ── Mock globals BEFORE imports ────────────────────────────────

const mockGetProperty = jest.fn();

(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn().mockReturnValue({ getProperty: mockGetProperty }),
};

// ── Import after mocks ─────────────────────────────────────────

import {
  API_KEY_PROPERTY,
  MISSING_API_KEY_MESSAGE,
  geminiAuthHeaders,
  hasGeminiApiKey,
} from "../src/server/gemini-auth";

// ── Tests ──────────────────────────────────────────────────────

describe("constants", () => {
  it("names the GEMINI_API_KEY script property", () => {
    expect(API_KEY_PROPERTY).toBe("GEMINI_API_KEY");
  });

  // Pinned wording: customFunctions.test.ts asserts /\[SSI Error:.*GEMINI_API_KEY/
  // against the message this constant produces.
  it("uses the established missing-key wording", () => {
    expect(MISSING_API_KEY_MESSAGE).toBe("GEMINI_API_KEY script property not set");
  });
});

describe("geminiAuthHeaders", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns the key in an x-goog-api-key header", () => {
    mockGetProperty.mockReturnValue("secret-key");
    expect(geminiAuthHeaders()).toEqual({ "x-goog-api-key": "secret-key" });
  });

  it("reads the key from the GEMINI_API_KEY script property", () => {
    mockGetProperty.mockReturnValue("secret-key");
    geminiAuthHeaders();
    expect(mockGetProperty).toHaveBeenCalledWith("GEMINI_API_KEY");
  });

  it("throws MISSING_API_KEY_MESSAGE when the property is unset", () => {
    mockGetProperty.mockReturnValue(null);
    expect(() => geminiAuthHeaders()).toThrow(MISSING_API_KEY_MESSAGE);
  });

  it("throws when the property is an empty string", () => {
    mockGetProperty.mockReturnValue("");
    expect(() => geminiAuthHeaders()).toThrow(MISSING_API_KEY_MESSAGE);
  });
});

describe("hasGeminiApiKey", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns true when the key is set", () => {
    mockGetProperty.mockReturnValue("secret-key");
    expect(hasGeminiApiKey()).toBe(true);
  });

  it("returns false when the key is unset", () => {
    mockGetProperty.mockReturnValue(null);
    expect(hasGeminiApiKey()).toBe(false);
  });

  it("returns false for an empty string", () => {
    mockGetProperty.mockReturnValue("");
    expect(hasGeminiApiKey()).toBe(false);
  });

  it("does not throw when the key is unset", () => {
    mockGetProperty.mockReturnValue(null);
    expect(() => hasGeminiApiKey()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest __tests__/gemini-auth.test.ts
```

Expected: FAIL — `Cannot find module '../src/server/gemini-auth'`.

- [ ] **Step 3: Write the implementation**

Create `src/server/gemini-auth.ts`:

```ts
/**
 * gemini-auth.ts — Gemini API credential resolution.
 *
 * Sole owner of GEMINI_API_KEY. Every Gemini REST call authenticates with the
 * `x-goog-api-key` header produced here.
 *
 * The key must never be interpolated into a request URL. UrlFetchApp can throw an
 * exception containing the full request URL on a fetch-level failure (DNS error,
 * timeout) — which `muteHttpExceptions` does not suppress — and both runInference()
 * and SSI() write raw exception messages into spreadsheet cells. A key in the URL
 * is therefore one network hiccup away from being readable in a cell.
 *
 * See T17/R24 in docs/threat_models/ssi-toolkit-threat-model.md.
 */

export const API_KEY_PROPERTY = "GEMINI_API_KEY";

export const MISSING_API_KEY_MESSAGE = `${API_KEY_PROPERTY} script property not set`;

/**
 * Report whether the API key is configured, without throwing.
 * For UI preflight checks that would rather alert than fail mid-run.
 */
export function hasGeminiApiKey(): boolean {
  return !!PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
}

/**
 * Credential header for a Gemini REST call. Resolve once per fetch batch —
 * every call reads a script property.
 *
 * @throws Error with MISSING_API_KEY_MESSAGE when the property is unset
 */
export function geminiAuthHeaders(): Record<string, string> {
  const apiKey = PropertiesService.getScriptProperties().getProperty(API_KEY_PROPERTY);
  if (!apiKey) throw new Error(MISSING_API_KEY_MESSAGE);
  return { "x-goog-api-key": apiKey };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest __tests__/gemini-auth.test.ts
```

Expected: PASS — 10 tests (2 constants, 4 `geminiAuthHeaders`, 4 `hasGeminiApiKey`).

- [ ] **Step 5: Add the coverage threshold**

In `jest.config.cjs`, inside `coverageThreshold`, add this entry immediately after the `"./src/server/inference.ts"` block (keeping the server entries grouped before the client ones):

```js
    "./src/server/gemini-auth.ts": {
      statements: 100,
      branches: 100,
      functions: 100,
    },
```

100% is honest here — the module is two small functions and the Task 1 tests cover both branches of each.

- [ ] **Step 6: Verify coverage and types**

```bash
npx jest __tests__/gemini-auth.test.ts --coverage --collectCoverageFrom='src/server/gemini-auth.ts'
npm run typecheck
```

Expected: 100% across statements/branches/functions for `gemini-auth.ts`; typecheck clean.

- [ ] **Step 7: Commit**

```bash
git add src/server/gemini-auth.ts __tests__/gemini-auth.test.ts jest.config.cjs
git commit -m "feat(security): add gemini-auth module owning the API key (T17/R24)"
```

---

### Task 2: Switch `api.ts` to the header and delete `GeminiRequest.apiKey`

This task is deliberately atomic: deleting a required interface field breaks every caller at once, so there is no green state between "swap the header" and "remove the field."

**Files:**
- Modify: `src/server/api.ts:55-66` (`callGeminiAPI`), `:114-127` (`callGeminiAPIBatch`), `:180-189` (delete `invokeGemini`)
- Modify: `src/server/types.ts:163` (delete `apiKey`)
- Modify: `src/server/inference.ts:13`, `:74`, `:108`
- Modify: `src/server/customFunctions.ts:14`, `:40`
- Modify: `src/server/index.ts:516`
- Test: `__tests__/api.test.ts`, `__tests__/api-function-tools.test.ts`

**Interfaces:**
- Consumes: `geminiAuthHeaders()` from Task 1.
- Produces: `callGeminiAPI(req: GeminiRequest): GeminiResponse` becomes the single production entry point for one-off inference (replacing `invokeGemini`). `GeminiRequest` no longer has an `apiKey` field, so `buildInferenceRequest` returns `GeminiRequest | null`.

- [ ] **Step 1: Write the failing tests**

In `__tests__/api.test.ts`, add these two tests inside the existing `describe("callGeminiAPI", ...)` block (place them after the `"falls back to CONFIG.DEFAULT_MODEL..."` test at line 236-241):

```ts
  it("sends the API key as an x-goog-api-key header, never in the URL", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    callGeminiAPI(baseReq);
    const [url, options] = (UrlFetchApp.fetch as jest.Mock).mock.calls[0];
    expect(url).not.toContain("test-api-key");
    expect(url).not.toContain("key=");
    expect(options.headers).toEqual({ "x-goog-api-key": "test-api-key" });
  });

  it("throws the missing-key message when the script property is unset", () => {
    (PropertiesService.getScriptProperties().getProperty as jest.Mock).mockReturnValueOnce(null);
    expect(() => callGeminiAPI(baseReq)).toThrow(/GEMINI_API_KEY/);
  });
```

And add these inside the existing `describe("callGeminiAPIBatch", ...)` block (after the `"returns empty array for empty input"` test at line 444-447):

```ts
  it("sends the API key as a header on every request, never in the URL", () => {
    mockFetchAllResponses([
      { candidates: [{ content: { parts: [{ text: "A" }] } }] },
      { candidates: [{ content: { parts: [{ text: "B" }] } }] },
    ]);
    callGeminiAPIBatch([{ userParts: [{ text: "Q1" }] }, { userParts: [{ text: "Q2" }] }]);
    const requests = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[0][0];
    expect(requests).toHaveLength(2);
    requests.forEach((r: { url: string; headers: Record<string, string> }) => {
      expect(r.url).not.toContain("test-api-key");
      expect(r.url).not.toContain("key=");
      expect(r.headers).toEqual({ "x-goog-api-key": "test-api-key" });
    });
  });

  it("resolves the credential once per batch, not once per request", () => {
    mockFetchAllResponses([
      { candidates: [{ content: { parts: [{ text: "A" }] } }] },
      { candidates: [{ content: { parts: [{ text: "B" }] } }] },
      { candidates: [{ content: { parts: [{ text: "C" }] } }] },
    ]);
    const getProperty = PropertiesService.getScriptProperties().getProperty as jest.Mock;
    getProperty.mockClear();
    callGeminiAPIBatch([
      { userParts: [{ text: "Q1" }] },
      { userParts: [{ text: "Q2" }] },
      { userParts: [{ text: "Q3" }] },
    ]);
    expect(getProperty).toHaveBeenCalledTimes(1);
  });

  it("does not read the script property for an empty batch", () => {
    const getProperty = PropertiesService.getScriptProperties().getProperty as jest.Mock;
    getProperty.mockClear();
    expect(callGeminiAPIBatch([])).toEqual([]);
    expect(getProperty).not.toHaveBeenCalled();
  });
```

Now strip the `apiKey` properties from every `GeminiRequest` literal in the two test files. Two shapes exist — own-line (`  apiKey: "key123",`) and inline (`{ apiKey: "key", userParts: ... }`):

```bash
perl -i -pe 's/^\s*apiKey: "[^"]*",\n$//; s/apiKey: "[^"]*", //g' \
  __tests__/api.test.ts __tests__/api-function-tools.test.ts
```

Then fix the one remaining spread form by hand — `__tests__/api.test.ts:226`, inside `"throws on API error response"`:

```ts
    expect(() => callGeminiAPI(baseReq)).toThrow("Invalid API key");
```

Finally, retire the `describe("invokeGemini", ...)` block (lines 359-396, starting at the `// ── invokeGemini tests ───` comment). Its four tests split two ways:

- **Delete** `"returns a GeminiResponse with text from the first candidate"` and `"throws when the API key property is not set"` — the two tests you just added to the `callGeminiAPI` describe supersede them exactly.
- **Move** `"passes systemPrompt through to the payload"` and `"passes inlineData through to the payload"` into the `describe("callGeminiAPI", ...)` block, changing `invokeGemini(` to `callGeminiAPI(` in each. Do **not** delete these. They are the only tests asserting that `buildGeminiPayload`'s output is actually serialized into the `UrlFetchApp` payload — the existing `inline_data` and `system_instruction` tests at lines 124-181 call `buildGeminiPayload` directly and never touch `fetch`, so they do not cover that wiring.

After moving, the `systemPrompt` test reads:

```ts
  it("passes systemPrompt through to the payload", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    callGeminiAPI({ systemPrompt: "Be concise", userParts: [{ text: "hello" }] });
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.system_instruction.parts[0].text).toBe("Be concise");
  });
```

and the `inlineData` test reads:

```ts
  it("passes inlineData through to the payload", () => {
    mockFetchResponse({ candidates: [{ content: { parts: [{ text: "ok" }] } }] });
    callGeminiAPI({
      userParts: [
        { text: "describe this" },
        { inline_data: { mime_type: "application/pdf", data: "base64==" } },
      ],
    });
    const payload = JSON.parse((UrlFetchApp.fetch as jest.Mock).mock.calls[0][1].payload);
    expect(payload.contents[0].parts[1].inline_data.mime_type).toBe("application/pdf");
  });
```

Then remove `invokeGemini` from the import list at line 27, delete the now-empty `describe` block and its section comment, and verify nothing is left behind:

```bash
grep -n "apiKey\|invokeGemini" __tests__/api.test.ts __tests__/api-function-tools.test.ts
```

Expected: no output.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest __tests__/api.test.ts
```

Expected: FAIL — `options.headers` is `undefined` and the URL still contains `test-api-key`.

- [ ] **Step 3: Implement the header swap in `api.ts`**

Add the import at the top of `src/server/api.ts`, after the `CONFIG` import on line 10:

```ts
import { geminiAuthHeaders } from "./gemini-auth";
```

Replace the body of `callGeminiAPI` (lines 56-64) so the URL loses `?key=` and gains the header:

```ts
  const modelName = req.modelName ?? CONFIG.DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: "post",
    contentType: "application/json",
    headers: geminiAuthHeaders(),
    payload: JSON.stringify(buildGeminiPayload(req)),
    muteHttpExceptions: true,
  };
```

In `callGeminiAPIBatch`, resolve once before the `map` (replacing lines 117-127). The existing early return on line 115 stays above it, so an empty batch never touches the script property:

```ts
  // Resolve the credential once — geminiAuthHeaders() reads a script property,
  // and this map can hold every row in a chunk.
  const headers = geminiAuthHeaders();

  const requests = reqs.map((req) => {
    const modelName = req.modelName ?? CONFIG.DEFAULT_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
    return {
      url,
      method: "post" as const,
      contentType: "application/json",
      headers,
      payload: JSON.stringify(buildGeminiPayload(req)),
      muteHttpExceptions: true,
    };
  });
```

Delete `invokeGemini` entirely — lines 180-189, including its JSDoc block. Update the module docstring's second paragraph (lines 4-5) to note that credential resolution now lives in `gemini-auth.ts`:

```ts
 * Pure HTTP adapter. All preprocessing (Drive file fetching, base64 encoding,
 * text assembly) is the caller's responsibility, and the credential comes from
 * gemini-auth.ts.
```

- [ ] **Step 4: Delete the `apiKey` field and fix every caller**

In `src/server/types.ts`, delete line 163 (`  apiKey: string;`) from `GeminiRequest`.

Run the typechecker to enumerate the fallout — this is the intended safety net:

```bash
npm run typecheck
```

Fix each reported site:

`src/server/inference.ts` — line 13 import, line 74 return type, line 108 call:

```ts
import { callGeminiAPI } from "./api";
```

```ts
): GeminiRequest | null {
```

```ts
    return callGeminiAPI(req);
```

`src/server/customFunctions.ts` — line 14 import and line 40 call:

```ts
import { callGeminiAPI } from "./api";
```

```ts
    return callGeminiAPI({
```

`src/server/index.ts` line 516 — drop `apiKey` from the pushed request. The `apiKey` local at line 382 stays for now; `uploadFilesToGemini` still needs it until Task 3:

```ts
      requests.push({ ...req, modelName: config.model });
```

Also update the two doc comments that name the old function — `src/server/inference.ts:5` and `src/server/types.ts:121` — replacing `invokeGemini` with `callGeminiAPI`.

- [ ] **Step 5: Run the full suite and typecheck**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean; all suites pass. `__tests__/inference.test.ts` and `__tests__/customFunctions.test.ts` should pass untouched — they already mock `PropertiesService`, which is what `geminiAuthHeaders()` reads.

- [ ] **Step 6: Commit**

```bash
git add src/server/api.ts src/server/types.ts src/server/inference.ts \
  src/server/customFunctions.ts src/server/index.ts \
  __tests__/api.test.ts __tests__/api-function-tools.test.ts
git commit -m "fix(security): authenticate generateContent via x-goog-api-key header (T17/R24)

Drops ?key= from both generateContent call sites and deletes
GeminiRequest.apiKey, so a key can no longer be attached to a request
object. invokeGemini is gone — callGeminiAPI is now the single
production entry point for one-off inference."
```

---

### Task 3: Switch `files.ts` to the header and remove the last key holders

**Files:**
- Modify: `src/server/files.ts:25-29` (signature), `:36-47` (phase-1 init)
- Modify: `src/server/index.ts:382-385` (preflight), `:468-472` (upload call)
- Modify: `src/server/config.ts:10`, `src/server/types.ts:14`
- Test: `__tests__/files.test.ts`

**Interfaces:**
- Consumes: `geminiAuthHeaders()`, `hasGeminiApiKey()`, `MISSING_API_KEY_MESSAGE` from Task 1.
- Produces: `uploadFilesToGemini(files: Map<string, GoogleAppsScript.Base.Blob>, mimeTypes: Map<string, string>): { uploads: Map<string, { uri: string; mimeType: string }>; errors: Map<string, string> }` — two parameters, not three.

- [ ] **Step 1: Write the failing tests**

`__tests__/files.test.ts` has no `PropertiesService` mock yet. Add one to the mock block at the top (before the import on line 13), alongside the existing `UrlFetchApp` mock:

```ts
(globalThis as any).PropertiesService = {
  getScriptProperties: jest.fn().mockReturnValue({
    getProperty: jest.fn().mockReturnValue("test-api-key"),
  }),
};
```

Drop the now-removed third argument from all nine call sites:

```bash
perl -i -0777 -pe 's/,\s*\n?\s*"(?:test-)?key"\s*\)/)/g' __tests__/files.test.ts
grep -n '"key"\|"test-key"' __tests__/files.test.ts
```

Expected from the grep: no output. (The `perl` handles both the single-line `uploadFilesToGemini(files, mimeTypes, "key")` form and the multi-line form at lines 148-151, 174-177.)

Then add this test to the `describe("uploadFilesToGemini", ...)` block, next to the existing `"sends resumable protocol headers in init request"` test at line 144:

```ts
  it("authenticates the init request with a header, never in the URL", () => {
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce([mockInitResponse("https://upload.example.com/s1")])
      .mockReturnValueOnce([mockUploadResponse("https://example.com/f", "application/pdf")]);

    uploadFilesToGemini(
      new Map([["f1", makeBlob("f1")]]),
      new Map([["f1", "application/pdf"]]),
    );

    const initCall = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[0][0];
    expect(initCall[0].url).not.toContain("test-api-key");
    expect(initCall[0].url).not.toContain("key=");
    expect(initCall[0].headers["x-goog-api-key"]).toBe("test-api-key");
    // The resumable-protocol headers must survive the merge
    expect(initCall[0].headers["X-Goog-Upload-Protocol"]).toBe("resumable");
  });

  it("sends no credential on the phase-2 upload request", () => {
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce([mockInitResponse("https://upload.example.com/s1")])
      .mockReturnValueOnce([mockUploadResponse("https://example.com/f", "application/pdf")]);

    uploadFilesToGemini(
      new Map([["f1", makeBlob("f1")]]),
      new Map([["f1", "application/pdf"]]),
    );

    // The session URI returned by phase 1 is self-authenticating — Google's own
    // docs send no key here, so adding one would only widen exposure.
    const uploadCall = (UrlFetchApp.fetchAll as jest.Mock).mock.calls[1][0];
    expect(uploadCall[0].headers["x-goog-api-key"]).toBeUndefined();
  });

  it("resolves the credential once per batch, not once per file", () => {
    (UrlFetchApp.fetchAll as jest.Mock)
      .mockReturnValueOnce([
        mockInitResponse("https://upload.example.com/s1"),
        mockInitResponse("https://upload.example.com/s2"),
        mockInitResponse("https://upload.example.com/s3"),
      ])
      .mockReturnValueOnce([
        mockUploadResponse("https://example.com/a", "application/pdf"),
        mockUploadResponse("https://example.com/b", "application/pdf"),
        mockUploadResponse("https://example.com/c", "application/pdf"),
      ]);

    const getProperty = PropertiesService.getScriptProperties().getProperty as jest.Mock;
    getProperty.mockClear();
    uploadFilesToGemini(
      new Map([
        ["f1", makeBlob("f1")],
        ["f2", makeBlob("f2")],
        ["f3", makeBlob("f3")],
      ]),
      new Map([
        ["f1", "application/pdf"],
        ["f2", "application/pdf"],
        ["f3", "application/pdf"],
      ]),
    );
    expect(getProperty).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest __tests__/files.test.ts
```

Expected: FAIL — `initCall[0].headers["x-goog-api-key"]` is `undefined`, and TypeScript complains about the two-argument calls.

- [ ] **Step 3: Implement the `files.ts` changes**

Add the import at the top of `src/server/files.ts`, before the `uploadFilesToGemini` JSDoc block:

```ts
import { geminiAuthHeaders } from "./gemini-auth";
```

Change the signature (lines 25-29) — the `apiKey` parameter is gone:

```ts
export function uploadFilesToGemini(
  files: Map<string, GoogleAppsScript.Base.Blob>,
  mimeTypes: Map<string, string>,
): { uploads: Map<string, { uri: string; mimeType: string }>; errors: Map<string, string> } {
```

Remove the `@param apiKey    Gemini API key` line from the JSDoc (line 22).

Replace the phase-1 init block (lines 35-47). `geminiAuthHeaders()` is called once, above the `map`, and merged with the existing upload headers:

```ts
  // Phase 1: initiate all resumable uploads in parallel — lightweight JSON requests only.
  // Credential resolved once outside the map (each call reads a script property).
  const authHeaders = geminiAuthHeaders();
  const initRequests = fileIds.map((fileId) => ({
    url: "https://generativelanguage.googleapis.com/upload/v1beta/files",
    method: "post" as const,
    contentType: "application/json",
    headers: {
      ...authHeaders,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Type": mimeTypes.get(fileId) ?? "application/octet-stream",
    },
    payload: JSON.stringify({ file: { display_name: fileId } }),
    muteHttpExceptions: true,
  }));
```

Note the early return on line 33 (`if (fileIds.length === 0)`) sits above this, so an empty batch still makes no property read.

Leave the phase-2 block (lines 73-84) untouched.

Finally, extend the module docstring with a line recording why phase 2 carries no credential:

```ts
 * Phase 1 authenticates with the `x-goog-api-key` header (see gemini-auth.ts);
 * phase 2 needs no credential because the returned session URI is self-authenticating.
```

- [ ] **Step 4: Implement the `index.ts` preflight**

In `src/server/index.ts`, add to the imports (next to the existing `import { uploadFilesToGemini } from "./files";` on line 21):

```ts
import { hasGeminiApiKey, MISSING_API_KEY_MESSAGE } from "./gemini-auth";
```

Replace lines 382-386 — the property lookup and hardcoded message both go, and no `apiKey` local remains:

```ts
  if (!hasGeminiApiKey()) {
    ui.alert("Error", MISSING_API_KEY_MESSAGE, ui.ButtonSet.OK);
    return null;
  }
```

Update the `uploadFilesToGemini` call at lines 468-472 to two arguments:

```ts
        const { uploads: batchUploads, errors: batchUploadErrors } = uploadFilesToGemini(
          batchBytes,
          batchMimeTypes,
        );
```

- [ ] **Step 5: Delete the dead `CONFIG` entry**

Nothing reads it any more. Confirm, then delete:

```bash
grep -rn "API_KEY_PROPERTY" src/
```

Expected: only `src/server/gemini-auth.ts`. If `src/server/config.ts` or `src/server/types.ts` still appears, an earlier step was missed.

Delete line 10 of `src/server/config.ts` (`  API_KEY_PROPERTY: "GEMINI_API_KEY",`) and line 14 of `src/server/types.ts` (`  API_KEY_PROPERTY: string;`).

- [ ] **Step 6: Run the full suite and typecheck**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean, all suites pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/files.ts src/server/index.ts src/server/config.ts \
  src/server/types.ts __tests__/files.test.ts
git commit -m "fix(security): authenticate Files API upload via header, drop apiKey plumbing (T17/R24)

uploadFilesToGemini resolves its own credential, so runBatchAI no longer
holds the raw key. The missing-key preflight now routes through
hasGeminiApiKey()/MISSING_API_KEY_MESSAGE, and CONFIG.API_KEY_PROPERTY is
deleted — gemini-auth.ts is the only module that names the property."
```

---

### Task 4: Credential-hygiene regression guard

The fix is six lines; without this test, a future `countTokens` or embeddings endpoint reintroduces T17 silently. The guard asserts two invariants: no credential is interpolated into a URL, and only `gemini-auth.ts` names the key property.

**Files:**
- Create: `__tests__/credential-hygiene.test.ts`

**Interfaces:**
- Consumes: the finished state of Tasks 1-3 (this test scans `src/server/` as a whole).
- Produces: nothing importable.

- [ ] **Step 1: Write the test**

Create `__tests__/credential-hygiene.test.ts`. The `/// <reference types="node" />` directive is required — `tsconfig.client.json` deliberately omits `"node"` from `types` because it collides with the `google-apps-script` `MimeType` declaration, so files needing `fs` opt in individually (same pattern as `__tests__/markdown-to-rich-text.test.ts`).

```ts
/// <reference types="node" />
/**
 * Credential-hygiene regression guard for T17/R24.
 *
 * These are source-scanning tests, not behavioral ones. They exist because the
 * T17 fix is easy to undo by accident: the next person adding a Gemini endpoint
 * will copy an existing `?key=` snippet from a tutorial, and nothing else in the
 * suite would notice.
 *
 * See docs/threat_models/ssi-toolkit-threat-model.md (T17) and
 * docs/superpowers/specs/2026-07-29-t17-api-key-header-design.md
 */

import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const SERVER_DIR = join(__dirname, "..", "src", "server");

const SERVER_FILES = readdirSync(SERVER_DIR).filter((f) => f.endsWith(".ts"));

/** Credential names that must never appear as a URL query parameter. */
const CREDENTIAL_PARAM = "(?:key|api_?key|access_token|token)";

const URL_CREDENTIAL_PATTERNS = [
  // ?key=${apiKey}  — template interpolation
  new RegExp(`[?&]${CREDENTIAL_PARAM}=\\$\\{`, "i"),
  // "?key=" + apiKey  — string concatenation
  new RegExp(`[?&]${CREDENTIAL_PARAM}=["']?\\s*\\+`, "i"),
];

function offendingLines(source: string, patterns: RegExp[]): string[] {
  return source
    .split("\n")
    .map((line, i) => ({ line: line.trim(), lineNo: i + 1 }))
    .filter(({ line }) => patterns.some((p) => p.test(line)))
    .map(({ line, lineNo }) => `${lineNo}: ${line}`);
}

describe("credential hygiene in src/server", () => {
  it("scans a plausible number of server files", () => {
    // Guards against the glob silently matching nothing and the suite passing vacuously.
    expect(SERVER_FILES.length).toBeGreaterThan(5);
  });

  it.each(SERVER_FILES)("%s does not put a credential in a URL query string", (file) => {
    const source = readFileSync(join(SERVER_DIR, file), "utf8");
    // Gemini and Drive both accept a credential header; a key in the URL can be
    // echoed back by a UrlFetchApp exception and written into a cell.
    expect(offendingLines(source, URL_CREDENTIAL_PATTERNS)).toEqual([]);
  });

  it("names the GEMINI_API_KEY property in gemini-auth.ts only", () => {
    const namingFiles = SERVER_FILES.filter((file) =>
      readFileSync(join(SERVER_DIR, file), "utf8").includes("GEMINI_API_KEY"),
    );
    expect(namingFiles).toEqual(["gemini-auth.ts"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it passes against the fixed code**

```bash
npx jest __tests__/credential-hygiene.test.ts
```

Expected: PASS. (Unlike the earlier tasks, this test codifies an invariant Tasks 1-3 already established — it should be green immediately.)

- [ ] **Step 3: Verify the guard actually catches a regression**

A guard test that cannot fail is worthless, so prove it fails. Temporarily reintroduce the vulnerability in `src/server/api.ts:57`:

```ts
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${req.modelName}`;
```

Then run:

```bash
npx jest __tests__/credential-hygiene.test.ts
```

Expected: FAIL on `api.ts does not put a credential in a URL query string`, with the offending line number in the diff.

- [ ] **Step 4: Revert the deliberate regression**

```bash
git checkout src/server/api.ts
npx jest __tests__/credential-hygiene.test.ts
```

Expected: PASS. Confirm `git diff src/server/api.ts` is empty before continuing.

- [ ] **Step 5: Commit**

```bash
git add __tests__/credential-hygiene.test.ts
git commit -m "test(security): guard against credentials in request URLs (T17/R24)"
```

---

### Task 5: Documentation and final verification

**Files:**
- Modify: `docs/threat_models/ssi-toolkit-threat-model.md:204` (T17 row), `:237` (R24 row), `:285` (Open Items row)
- Modify: `CLAUDE.md` (server module graph)

**Interfaces:**
- Consumes: the finished state of Tasks 1-4.
- Produces: nothing importable.

- [ ] **Step 1: Update the T17 threat row**

`docs/threat_models/ssi-toolkit-threat-model.md` line 204 currently describes the vulnerability in the present tense. Append this sentence to the end of that table cell (before the closing `|`), preserving the existing prose so the historical finding stays readable:

```text
 Fixed 2026-07-29 (AI-78/R24): all three call sites now authenticate with the `x-goog-api-key` header via `src/server/gemini-auth.ts`, so no credential appears in a request URL and a `UrlFetchApp` exception can no longer echo one. `__tests__/credential-hygiene.test.ts` fails the build if the pattern returns. The R25 half of this threat remains open — `runInference()` and `SSI()` still write raw exception messages into cells, which is a general information-disclosure gap even without the key in scope (see AI-79)
```

- [ ] **Step 2: Update the R24 mitigation row**

Line 237 — append the implementation note to that row's Description cell:

```text
. Implemented 2026-07-29 (AI-78): credential resolution consolidated into `src/server/gemini-auth.ts` (`geminiAuthHeaders()`), `GeminiRequest.apiKey` and `uploadFilesToGemini`'s `apiKey` parameter deleted so the raw key no longer crosses a function boundary, and `CONFIG.API_KEY_PROPERTY` removed
```

- [ ] **Step 3: Update the Open Items row**

Line 285 — flip Status from `Open` to `Closed` and note the follow-on:

```text
| High | Closed | [AI-78](https://linear.app/propublica/issue/AI-78/fix-t17-gemini-api-key-sent-via-url-query-string) | — | Fix T17 — API key in URL | Done 2026-07-29 — `GEMINI_API_KEY` now sent via the `x-goog-api-key` header from `src/server/gemini-auth.ts`; source-scanning guard in `__tests__/credential-hygiene.test.ts`. R25/AI-79 (echoed exceptions) still open (R24) |
```

Leave the PR column as `—` for now, matching the AI-89 row's precedent; backfill it after the PR exists if desired.

- [ ] **Step 4: Update `CLAUDE.md`**

In the server module dependency graph, add a `gemini-auth.ts` line after the `api.ts` entry:

```text
├── src/server/gemini-auth.ts    (geminiAuthHeaders, hasGeminiApiKey, API_KEY_PROPERTY, MISSING_API_KEY_MESSAGE —
│                                 sole owner of GEMINI_API_KEY; the key is sent as the x-goog-api-key header and
│                                 must never appear in a request URL (T17/R24))
```

Amend the `api.ts` line in the same graph, which currently names `invokeGemini`:

```text
├── src/server/api.ts            (callGeminiAPI, callGeminiAPIBatch, buildGeminiPayload — pure HTTP adapter via
│                                 UrlFetchApp; credential from gemini-auth.ts; buildGeminiPayload resolves ToolId[]
│                                 via TOOL_REGISTRY, splits grounding vs function tools)
```

Then check for other stale `invokeGemini` mentions in the file and update them to `callGeminiAPI`:

```bash
grep -n "invokeGemini" CLAUDE.md
```

The `customFunctions.ts` graph entry and the "Security" section's threat-model note are the likely hits.

- [ ] **Step 5: Full verification**

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:coverage
```

Expected: all four clean, including the per-file coverage threshold for `gemini-auth.ts`.

Then confirm no credential-in-URL pattern survives anywhere in the source, and that the key is named in exactly one place:

```bash
grep -rn "key=\${" src/ ; grep -rln "GEMINI_API_KEY" src/
```

Expected: no output from the first; only `src/server/gemini-auth.ts` from the second.

Finally, confirm the bundle still builds — the Rollup footer and Apps Script stubs are unaffected, but `invokeGemini` was never a global stub so this should be a no-op:

```bash
npm run build && grep -c "invokeGemini" dist/index.js
```

Expected: build succeeds; `grep -c` prints `0`.

- [ ] **Step 6: Commit**

```bash
git add docs/threat_models/ssi-toolkit-threat-model.md CLAUDE.md
git commit -m "docs(security): record T17/R24 as fixed, add gemini-auth to module graph"
```

- [ ] **Step 7: Manual QA against the dev sheet**

Automated tests cannot prove Google accepts the header — every `UrlFetchApp` call is mocked. This step is the only real verification that the fix works, and it must pass before the PR.

```bash
npm run deploy
```

Then in the dev sheet:

1. Open **SSI Tools → Run AI**, map a text prompt column and an output column, and run 2-3 rows. Confirm real model output lands in the cells (this exercises `callGeminiAPIBatch` with the header).
2. Type `=SSI("Say hello")` into an empty cell. Confirm a real response, not `[SSI Error: ...]` (this exercises `callGeminiAPI`).
3. Run an AI job with a **file** prompt column pointing at a Drive PDF. Confirm output referencing the file's contents (this exercises the Files API upload — the phase-1 header change and the untouched phase-2 path).
4. In Apps Script **Project Settings → Script Properties**, rename `GEMINI_API_KEY` to `GEMINI_API_KEY_OFF`, then start a Run AI job. Confirm the alert reads `GEMINI_API_KEY script property not set` and that it appears *immediately*, before any file processing. Restore the property name afterward.

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §1 New module `gemini-auth.ts` | Task 1 |
| §2 Call-site changes (`callGeminiAPI`, `callGeminiAPIBatch`) | Task 2 |
| §2 Call-site changes (`files.ts` phase 1; phase 2 untouched) | Task 3 |
| §3 Remove `GeminiRequest.apiKey`, `invokeGemini` | Task 2 |
| §3 Remove `uploadFilesToGemini` param, `CONFIG.API_KEY_PROPERTY`, `AppConfig` field, `runBatchAI` local | Task 3 |
| §4 Missing-key UX (`hasGeminiApiKey` preflight) | Task 3, Step 4 |
| §5 Testing layer 1 (module unit tests) | Task 1 |
| §5 Testing layer 2 (existing suites inverted) | Tasks 2-3 |
| §5 Testing layer 3 (regression guard) | Task 4 |
| §5 Coverage thresholds | Task 1, Step 5 |
| §6 Documentation (threat model, `CLAUDE.md`) | Task 5 |
| Verification section | Task 5, Steps 5 and 7 |

No spec requirement is unassigned.

**Placeholder scan:** No TBDs, no "add error handling", no "similar to Task N". Every code step carries the literal code to write, and every command carries its expected output.

**Type consistency:** `geminiAuthHeaders()` and `hasGeminiApiKey()` keep the same names and signatures from Task 1 through Task 5. `MISSING_API_KEY_MESSAGE` and `API_KEY_PROPERTY` are used consistently. `uploadFilesToGemini`'s new two-parameter signature is declared in Task 3's Interfaces block and matches every call updated in that task. `callGeminiAPI` replaces `invokeGemini` uniformly across `inference.ts`, `customFunctions.ts`, and the docs.

**One risk flagged for the executor:** the two `perl -i` commands in Tasks 2 and 3 edit test files in bulk. Each is followed by a `grep` verifying zero matches remain — if that grep prints anything, fix the stragglers by hand rather than re-running the `perl`.
