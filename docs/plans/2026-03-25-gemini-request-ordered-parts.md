# GeminiRequest Ordered Parts — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `GeminiRequest.userTexts`/`inlineData` with an ordered `parts: GeminiUserPart[]` array that directly mirrors the Gemini REST API's `contents[].parts` structure.

**Architecture:** Server-internal refactor only. `RunConfig` and `shared/types.ts` are untouched. The outgoing HTTP payload shape to Gemini is identical — only the internal representation changes. `drive.ts` is untouched. `runInference`'s external signature is unchanged.

**Design doc:** `docs/plans/2026-03-25-gemini-request-ordered-parts-design.md`

**Tech Stack:** TypeScript, Jest/ts-jest, Rollup (GAS bundle)

---

## Context: TDD approach for this type refactor

Tasks 1–3 form one atomic Red→Green cycle. Changing `GeminiRequest` (Task 2) simultaneously breaks old tests (which use `userTexts`) and unblocks new tests (which use `parts`). You cannot make new tests green without changing both the type and the implementation. Tasks 4–5 then restore the old tests to green. This is the correct TDD sequence for a breaking type rename.

Tests that check the **outgoing HTTP payload** shape do NOT need changes — the REST JSON Gemini receives is identical before and after this refactor. This covers all of `inference.test.ts` and `customFunctions.test.ts`.

---

## Task 1: Write new failing tests for `buildGeminiPayload`

**Files:**
- Modify: `__tests__/api.test.ts`

These tests describe the new `parts`-based interface. They will fail with a TypeScript
error (`parts` does not exist on `GeminiRequest`) until Task 2 lands.

**Step 1: Add four new tests at the bottom of the `buildGeminiPayload` describe block**

Append these inside the `describe("buildGeminiPayload", ...)` block in `__tests__/api.test.ts`,
after the existing `"passes through generationConfig"` and `maxOutputTokens` tests:

```typescript
describe("parts-based assembly", () => {
  it("maps a text part to a REST text part", () => {
    const payload = buildGeminiPayload({
      apiKey: "k",
      parts: [{ kind: "text", text: "Hello" }],
    });
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(1);
    expect(parts[0]).toEqual({ text: "Hello" });
  });

  it("maps an inline_data part to a REST inline_data part", () => {
    const payload = buildGeminiPayload({
      apiKey: "k",
      parts: [
        { kind: "text", text: "Describe this" },
        { kind: "inline_data", data: { mime_type: "application/pdf", data: "base64==" } },
      ],
    });
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({ inline_data: { mime_type: "application/pdf", data: "base64==" } });
  });

  it("maps a file_uri part to a REST file_data part", () => {
    const payload = buildGeminiPayload({
      apiKey: "k",
      parts: [
        { kind: "text", text: "Describe this" },
        {
          kind: "file_uri",
          mimeType: "application/pdf",
          fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
        },
      ],
    });
    const parts = (payload.contents as any)[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({
      file_data: {
        mime_type: "application/pdf",
        file_uri: "https://generativelanguage.googleapis.com/v1beta/files/abc123",
      },
    });
  });

  it("preserves declared part order in the REST payload", () => {
    const payload = buildGeminiPayload({
      apiKey: "k",
      parts: [
        { kind: "text", text: "First" },
        { kind: "inline_data", data: { mime_type: "image/jpeg", data: "img==" } },
        { kind: "text", text: "Last" },
      ],
    });
    const parts = (payload.contents as any)[0].parts;
    expect(parts[0]).toEqual({ text: "First" });
    expect(parts[1]).toEqual({ inline_data: { mime_type: "image/jpeg", data: "img==" } });
    expect(parts[2]).toEqual({ text: "Last" });
  });
});
```

**Step 2: Run the new tests and confirm they fail with a TypeScript error**

```bash
npx jest __tests__/api.test.ts --testNamePattern="parts-based assembly"
```

Expected: compile error — `Argument of type '{ apiKey: string; parts: ... }' is not assignable to parameter of type 'GeminiRequest'`. Property `parts` does not exist.

---

## Task 2: Add `GeminiUserPart` and update `GeminiRequest` in `server/types.ts`

**Files:**
- Modify: `src/server/types.ts`

**Step 1: Add `GeminiUserPart` below the `GeminiInlineData` interface**

```typescript
export type GeminiUserPart =
  | { kind: "text"; text: string }
  | { kind: "inline_data"; data: GeminiInlineData }
  | { kind: "file_uri"; mimeType: string; fileUri: string };
```

**Step 2: Replace `userTexts` and `inlineData` in `GeminiRequest`**

Old:
```typescript
export interface GeminiRequest {
  apiKey: string;
  modelName?: string;
  systemPrompt?: string;
  userTexts: string[];
  inlineData?: GeminiInlineData[];
  tools?: ToolId[];
  generationConfig?: GeminiGenerationConfig;
}
```

New:
```typescript
export interface GeminiRequest {
  apiKey: string;
  modelName?: string;
  systemPrompt?: string;
  parts: GeminiUserPart[];
  tools?: ToolId[];
  generationConfig?: GeminiGenerationConfig;
}
```

**Step 3: Run the new tests — they should still fail, now with a logic error not a type error**

```bash
npx jest __tests__/api.test.ts --testNamePattern="parts-based assembly"
```

Expected: tests fail because `buildGeminiPayload` still tries to read `req.userTexts` (which no longer exists on the type). You may see a runtime error or wrong output. Existing tests will also fail to compile — that is expected and will be fixed in Tasks 3–5.

---

## Task 3: Update `buildGeminiPayload` in `api.ts`

**Files:**
- Modify: `src/server/api.ts`

**Step 1: Rename the internal REST part interface and add `file_data`**

Old:
```typescript
interface GeminiPart {
  text?: string;
  inline_data?: GeminiInlineData;
}
```

New:
```typescript
interface GeminiRestPart {
  text?: string;
  inline_data?: GeminiInlineData;
  file_data?: { mime_type: string; file_uri: string };
}
```

**Step 2: Replace the append logic with a flat map over `parts`**

Old:
```typescript
export function buildGeminiPayload(req: GeminiRequest): Record<string, unknown> {
  const parts: GeminiPart[] = req.userTexts.map((text) => ({ text }));
  req.inlineData?.forEach((d) => parts.push({ inline_data: d }));

  const payload: Record<string, unknown> = {
    system_instruction: {
      parts: [{ text: req.systemPrompt || "You are a helpful assistant." }],
    },
    contents: [{ role: "user", parts }],
  };
  // ...
```

New:
```typescript
export function buildGeminiPayload(req: GeminiRequest): Record<string, unknown> {
  const parts: GeminiRestPart[] = req.parts.map((p) => {
    if (p.kind === "text") return { text: p.text };
    if (p.kind === "inline_data") return { inline_data: p.data };
    return { file_data: { mime_type: p.mimeType, file_uri: p.fileUri } };
  });

  const payload: Record<string, unknown> = {
    system_instruction: {
      parts: [{ text: req.systemPrompt || "You are a helpful assistant." }],
    },
    contents: [{ role: "user", parts }],
  };
  // ... remainder unchanged
```

**Step 3: Run the new tests — they should now pass**

```bash
npx jest __tests__/api.test.ts --testNamePattern="parts-based assembly"
```

Expected: 4 new tests pass. Existing tests in `api.test.ts` still fail due to `userTexts` in `baseReq` — fix next.

---

## Task 4: Update existing tests in `api.test.ts`

**Files:**
- Modify: `__tests__/api.test.ts`

All changes here replace `userTexts`/`inlineData` with `parts`. The assertions do not change — the REST payload shape is identical.

**Step 1: Update `baseReq`**

Old:
```typescript
const baseReq: GeminiRequest = {
  apiKey: "key123",
  systemPrompt: "Be helpful",
  userTexts: ["Summarize this"],
};
```

New:
```typescript
const baseReq: GeminiRequest = {
  apiKey: "key123",
  systemPrompt: "Be helpful",
  parts: [{ kind: "text", text: "Summarize this" }],
};
```

**Step 2: Update the `buildGeminiPayload` tests that construct their own `req` objects**

"assembles multiple text parts in order":
```typescript
// old
const req: GeminiRequest = { ...baseReq, userTexts: ["Prompt", "Context"] };
// new
const req: GeminiRequest = {
  ...baseReq,
  parts: [
    { kind: "text", text: "Prompt" },
    { kind: "text", text: "Context" },
  ],
};
```

"appends inline_data as the final part when provided":
```typescript
// old
const req: GeminiRequest = {
  ...baseReq,
  userTexts: ["What is this?"],
  inlineData: [{ mime_type: "application/pdf", data: "base64==" }],
};
// new
const req: GeminiRequest = {
  ...baseReq,
  parts: [
    { kind: "text", text: "What is this?" },
    { kind: "inline_data", data: { mime_type: "application/pdf", data: "base64==" } },
  ],
};
// assertion is unchanged — still checks parts[1].inline_data
```

"appends multiple inline_data parts when inlineData has multiple items":
```typescript
// old
const req: GeminiRequest = {
  ...baseReq,
  userTexts: ["Describe both files"],
  inlineData: [
    { mime_type: "application/pdf", data: "file1==" },
    { mime_type: "image/jpeg", data: "file2==" },
  ],
};
// new
const req: GeminiRequest = {
  ...baseReq,
  parts: [
    { kind: "text", text: "Describe both files" },
    { kind: "inline_data", data: { mime_type: "application/pdf", data: "file1==" } },
    { kind: "inline_data", data: { mime_type: "image/jpeg", data: "file2==" } },
  ],
};
// assertions unchanged
```

"uses default system prompt when systemPrompt is omitted":
```typescript
// old
const req: GeminiRequest = { apiKey: "k", userTexts: ["hi"] };
// new
const req: GeminiRequest = { apiKey: "k", parts: [{ kind: "text", text: "hi" }] };
```

"passes through generationConfig when provided":
```typescript
// old
const req: GeminiRequest = {
  ...baseReq,
  generationConfig: { temperature: 0.5, maxOutputTokens: 1024 },
};
// new — no parts change needed, baseReq already updated
```

"applies CONFIG.MAX_OUTPUT_TOKENS as default when generationConfig omits maxOutputTokens":
```typescript
// old
const req: GeminiRequest = { ...baseReq, generationConfig: { temperature: 0.7 } };
// new — no parts change needed, baseReq already updated
```

"uses caller-supplied maxOutputTokens over CONFIG default":
```typescript
// old
const req: GeminiRequest = { ...baseReq, generationConfig: { maxOutputTokens: 512 } };
// new — no parts change needed, baseReq already updated
```

**Step 3: Update the `invokeGemini` tests that pass inline args**

"returns a GeminiResponse with text from the first candidate":
```typescript
// old
const result = invokeGemini({ userTexts: ["hello"] });
// new
const result = invokeGemini({ parts: [{ kind: "text", text: "hello" }] });
```

"throws when the API key property is not set":
```typescript
// old
expect(() => invokeGemini({ userTexts: ["hello"] })).toThrow(/GEMINI_API_KEY/);
// new
expect(() => invokeGemini({ parts: [{ kind: "text", text: "hello" }] })).toThrow(/GEMINI_API_KEY/);
```

"passes systemPrompt through to the payload":
```typescript
// old
invokeGemini({ systemPrompt: "Be concise", userTexts: ["hello"] });
// new
invokeGemini({ systemPrompt: "Be concise", parts: [{ kind: "text", text: "hello" }] });
```

"passes inlineData through to the payload":
```typescript
// old
invokeGemini({
  userTexts: ["describe this"],
  inlineData: [{ mime_type: "application/pdf", data: "base64==" }],
});
// new
invokeGemini({
  parts: [
    { kind: "text", text: "describe this" },
    { kind: "inline_data", data: { mime_type: "application/pdf", data: "base64==" } },
  ],
});
// assertion unchanged — still checks payload.contents[0].parts[1].inline_data.mime_type
```

**Step 4: Run all api.test.ts tests and confirm they pass**

```bash
npx jest __tests__/api.test.ts
```

Expected: all tests pass, no failures, no TypeScript errors.

---

## Task 5: Update `api-function-tools.test.ts`

**Files:**
- Modify: `__tests__/api-function-tools.test.ts`

**Step 1: Update `baseReq`**

Old:
```typescript
const baseReq: GeminiRequest = {
  apiKey: "key",
  userTexts: ["hello"],
};
```

New:
```typescript
const baseReq: GeminiRequest = {
  apiKey: "key",
  parts: [{ kind: "text", text: "hello" }],
};
```

No other changes needed — the assertions check tool payload structure, not parts.

**Step 2: Run the file and confirm it passes**

```bash
npx jest __tests__/api-function-tools.test.ts
```

Expected: all tests pass.

**Step 3: Commit**

```bash
git add src/server/types.ts src/server/api.ts __tests__/api.test.ts __tests__/api-function-tools.test.ts
git commit -m "$(cat <<'EOF'
refactor: replace GeminiRequest userTexts/inlineData with ordered parts array

GeminiRequest now uses parts: GeminiUserPart[] (text | inline_data | file_uri)
instead of separate userTexts and inlineData pools. buildGeminiPayload becomes
a flat map with no append logic. Outgoing HTTP payload to Gemini is unchanged.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update `inference.ts` internals

**Files:**
- Modify: `src/server/inference.ts`

`runInference`'s external signature does not change. The internal assembly changes
from passing two separate arguments to `invokeGemini` to building a single ordered
`GeminiUserPart[]`.

**Step 1: Add `GeminiUserPart` to the import from `./types`**

Old:
```typescript
import type { GeminiResponse } from "./types";
```

New:
```typescript
import type { GeminiResponse, GeminiUserPart } from "./types";
```

**Step 2: Replace the body of `runInference`**

Old:
```typescript
  try {
    const inlineData =
      driveLinks !== undefined
        ? prepareDriveAttachments(flattenArg(driveLinks).filter(isValidDriveLink).map(extractId))
        : [];

    return invokeGemini({
      systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
      userTexts,
      inlineData: inlineData.length ? inlineData : undefined,
      tools: tools?.length ? tools : undefined,
    });
  }
```

New:
```typescript
  try {
    const textParts: GeminiUserPart[] = userTexts.map((text) => ({ kind: "text", text }));
    const fileParts: GeminiUserPart[] =
      driveLinks !== undefined
        ? prepareDriveAttachments(
            flattenArg(driveLinks).filter(isValidDriveLink).map(extractId),
          ).map((data) => ({ kind: "inline_data", data }))
        : [];

    return invokeGemini({
      systemPrompt: systemPrompt !== undefined ? flattenArg(systemPrompt)[0] : undefined,
      parts: [...textParts, ...fileParts],
      tools: tools?.length ? tools : undefined,
    });
  }
```

**Step 3: Run `inference.test.ts` and confirm all tests still pass without changes**

```bash
npx jest __tests__/inference.test.ts
```

Expected: all tests pass. These tests check the outgoing HTTP payload shape, which is
unchanged — text parts still appear as `{ text }` and inline data still appears as
`{ inline_data }` in the REST JSON.

**Step 4: Commit**

```bash
git add src/server/inference.ts
git commit -m "$(cat <<'EOF'
refactor: update runInference to assemble GeminiUserPart[] for invokeGemini

Text values and Drive inline data are now wrapped into an ordered GeminiUserPart[]
before being passed to invokeGemini. Text-first ordering is preserved for Phase 1.
External signature and outgoing payload shape are unchanged.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Update `customFunctions.ts`

**Files:**
- Modify: `src/server/customFunctions.ts`

`SSI` calls `invokeGemini` directly with `userTexts`. This needs to wrap the flattened
strings into text parts.

**Step 1: Update the `invokeGemini` call in `SSI`**

Old:
```typescript
    return invokeGemini({
      systemPrompt: systemPrompt || undefined,
      userTexts: flattenArg(userTexts),
      tools: resolvedToolIds.length ? resolvedToolIds : undefined,
    }).text;
```

New:
```typescript
    return invokeGemini({
      systemPrompt: systemPrompt || undefined,
      parts: flattenArg(userTexts).map((text): import("./types").GeminiUserPart => ({
        kind: "text",
        text,
      })),
      tools: resolvedToolIds.length ? resolvedToolIds : undefined,
    }).text;
```

Alternatively, add `GeminiUserPart` to the import at the top of the file and use it
directly:

```typescript
import { invokeGemini } from "./api";
import { flattenArg } from "./utils";
import { TOOL_REGISTRY } from "./tools";
import type { ToolId } from "../shared/types";
import type { GeminiUserPart } from "./types";
```

Then the call becomes:

```typescript
    return invokeGemini({
      systemPrompt: systemPrompt || undefined,
      parts: flattenArg(userTexts).map((text): GeminiUserPart => ({ kind: "text", text })),
      tools: resolvedToolIds.length ? resolvedToolIds : undefined,
    }).text;
```

**Step 2: Run `customFunctions.test.ts` and confirm all tests pass without changes**

```bash
npx jest __tests__/customFunctions.test.ts
```

Expected: all tests pass. Tests check the outgoing HTTP payload shape (`parts[0].text`,
`parts.length`), which is unchanged.

**Step 3: Commit**

```bash
git add src/server/customFunctions.ts
git commit -m "$(cat <<'EOF'
refactor: update SSI custom function to pass GeminiUserPart[] to invokeGemini

SSI now wraps flattenArg output into text parts before calling invokeGemini,
matching the updated GeminiRequest interface.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Full verification

**Step 1: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, no failures, no TypeScript errors in output.

**Step 2: Run typecheck across both tsconfigs**

```bash
npm run typecheck
```

Expected: clean output, no errors.

**Step 3: Run a full build**

```bash
npm run build
```

Expected: build completes, `dist/index.js` and `dist/Sidebar.html` emitted without errors.

**Step 4: Run lint**

```bash
npm run lint
```

Expected: no errors or warnings.
