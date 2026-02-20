# Gemini API Interface Design

**Date:** 2026-02-20
**Status:** Approved

## Context

`src/server/api.ts` currently exports a single function `callGeminiAPI(apiKey, systemPrompt, userPrompt, context)`. It has two responsibilities that should be separated:

1. Drive file I/O — fetching a file by ID, checking its size, and base64-encoding it via `DriveApp` and `Utilities`
2. HTTP call to the Gemini `generateContent` endpoint via `UrlFetchApp`

`AIContext` (a discriminated union of `TextContext | FileContext`) encodes both the text-append and file-attach paths inside the API function. This couples Drive logic to the HTTP adapter and requires tests to mock `DriveApp` and `Utilities` alongside `UrlFetchApp`.

The refactor replaces `callGeminiAPI` entirely with a cleaner interface that:
- Accepts fully preprocessed inputs (all encoding and text assembly done by the caller)
- Removes all `DriveApp` and `Utilities` dependencies from `api.ts`
- Supports multiple text parts per user message
- Provides a hook for function calling (tools)
- Exposes `buildGeminiPayload` as a pure, independently testable function

## Design

### 1. New types in `src/shared/types.ts`

Add Gemini API primitives and a unified request interface. Remove `AIContext`, `TextContext`, and `FileContext`.

```typescript
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
  modelName?: string;              // defaults to CONFIG.MODEL_NAME if omitted
  systemPrompt?: string;
  userTexts: string[];             // assembled into parts: [{text}, {text}, ...]
  inlineData?: GeminiInlineData;  // appended as a final part if present
  tools?: GeminiFunctionDeclaration[];
  generationConfig?: GeminiGenerationConfig;
}
```

### 2. `src/server/api.ts` — two exported functions

```typescript
export function buildGeminiPayload(req: GeminiRequest): Record<string, unknown>
export function callGeminiAPI(req: GeminiRequest): string
```

**`buildGeminiPayload`** — pure function, no GAS globals:
- Assembles `system_instruction` from `req.systemPrompt` (defaults to `"You are a helpful assistant."`)
- Builds `parts` array: one `{ text }` per entry in `req.userTexts`, then appends `{ inline_data }` if `req.inlineData` is present
- Merges `generationConfig` and `tools` if provided
- Returns the full payload object

**`callGeminiAPI`** — calls `buildGeminiPayload`, then `UrlFetchApp.fetch`. Only GAS global needed is `UrlFetchApp`. Returns the text of `candidates[0].content.parts[0].text` or `"No response."`.

### 3. Call-site changes in `src/server/index.ts`

`runBatchAI` pre-assembles the `GeminiRequest` before calling the API. Drive fetching and encoding moves out of `api.ts`:

```typescript
// TEXT mode
const result = callGeminiAPI({
  apiKey,
  systemPrompt: row[map.sys_prompt],
  userTexts: [row[map.user_prompt], row[map.source_text]].filter(Boolean),
});

// FILE mode
const encoded = fetchAndEncodeFile(fileId); // Drive fetch + base64, returns GeminiInlineData
const result = callGeminiAPI({
  apiKey,
  systemPrompt: row[map.sys_prompt],
  userTexts: [row[map.user_prompt]],
  inlineData: encoded,
});
```

The Drive fetch + encode helper (`fetchAndEncodeFile`) belongs in `src/server/drive.ts` alongside the existing Drive logic.

### 4. Test changes in `__tests__/api.test.ts`

- Remove all `DriveApp` and `Utilities` mocks
- Add direct tests for `buildGeminiPayload` covering: single text part, multiple text parts, inline data appended as final part, system prompt default, tools field, generationConfig passthrough
- Update `callGeminiAPI` tests to use the new `GeminiRequest` shape
- Add a test for the Drive helper in `__tests__/drive.test.ts`

## What This Does Not Include

- Multi-turn conversation support (the `contents` array remains a single user turn)
- Agentic function calling execution loop — `tools` is wired to the payload but the response parsing for `functionCall` candidates is not implemented; that is deferred until a concrete use case is designed
- Changes to `src/server/config.ts` or `appsscript.json`

## Separation of Concerns After Refactor

| Responsibility | Location |
|---|---|
| Gemini HTTP call + payload assembly | `src/server/api.ts` |
| Drive file fetch + base64 encode | `src/server/drive.ts` |
| Text context assembly, column mapping | `src/server/index.ts` (`runBatchAI`) |
| Gemini API types | `src/shared/types.ts` |
