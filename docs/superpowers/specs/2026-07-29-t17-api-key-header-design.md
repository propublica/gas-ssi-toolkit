# T17/R24 — Move the Gemini API key out of the URL query string

**Issue:** [AI-78](https://linear.app/propublica/issue/AI-78/fix-t17-gemini-api-key-sent-via-url-query-string)
**Threat:** T17 — API key exposure via URL and echoed exceptions
**Mitigation:** R24 (Reduce). R25 (scrub echoed exception messages, [AI-79](https://linear.app/propublica/issue/AI-79/fix-t17-raw-exception-messages-echoed-into-spreadsheet-cells)) stays out of scope.
**Date:** 2026-07-29

## Problem

Three call sites authenticate to `generativelanguage.googleapis.com` by interpolating
`GEMINI_API_KEY` into the request URL:

| Site | Function | Fetch style |
| --- | --- | --- |
| `src/server/api.ts:57` | `callGeminiAPI` | `UrlFetchApp.fetch` |
| `src/server/api.ts:119` | `callGeminiAPIBatch` | `UrlFetchApp.fetchAll` |
| `src/server/files.ts:37` | `uploadFilesToGemini` phase 1 (init) | `UrlFetchApp.fetchAll` |

`UrlFetchApp` can throw an exception whose message contains the full request URL on a
fetch-level failure (DNS error, timeout). `muteHttpExceptions: true` suppresses HTTP status
errors, not fetch-level ones. Both `runInference()` and `SSI()` write raw exception messages
straight into a spreadsheet cell. Any editor of the sheet can trigger that path by typing
`=SSI(...)` into a cell, so a network hiccup can deposit the live production key into a cell
they can already read — usable directly against Gemini at the organization's expense.

The key is also passed as a function parameter through several layers
(`GeminiRequest.apiKey`, `uploadFilesToGemini`'s third argument, a local in `runBatchAI`),
which multiplies the number of places it can reach a log or an exception.

## Approach

Introduce one module that owns Gemini authentication, route all three call sites through it,
and delete every other path by which the raw key travels. The header swap is the fix; the
consolidation is what keeps the fix from regressing.

Verified against Google's current documentation before designing:

- `x-goog-api-key` is a supported credential header on `generativelanguage.googleapis.com`
  (`https://ai.google.dev/gemini-api/docs/api-key`).
- The Files API resumable-upload example authenticates phase 1 with `x-goog-api-key` and sends
  **no** credential on phase 2 — the returned session URI is self-authenticating
  (`https://ai.google.dev/gemini-api/docs/files`). Phase 2 therefore needs no change.

## Design

### 1. New module: `src/server/gemini-auth.ts`

Sole owner of the API key — and nothing else. Request URLs, payload assembly, and response
parsing stay where they are; this module answers exactly one question ("what credential do I
attach?"). No GAS UI dependencies; one `PropertiesService` read.

```ts
export const API_KEY_PROPERTY = "GEMINI_API_KEY";
export const MISSING_API_KEY_MESSAGE = `${API_KEY_PROPERTY} script property not set`;

/** Cheap preflight for UI code — reports presence without throwing. */
export function hasGeminiApiKey(): boolean;

/** Credential header for every Gemini REST call. Throws MISSING_API_KEY_MESSAGE when unset. */
export function geminiAuthHeaders(): Record<string, string>;
```

`geminiAuthHeaders()` returns `{ "x-goog-api-key": <key> }`. HTTP header names are
case-insensitive on the wire; the lowercase spelling matches Google's documentation.

`MISSING_API_KEY_MESSAGE` preserves the exact wording of the two messages it replaces, so the
existing `customFunctions.test.ts` assertion (`/\[SSI Error:.*GEMINI_API_KEY/`) and the
`api.test.ts` assertion (`/GEMINI_API_KEY/`) keep describing real behavior.

### 2. Call-site changes

Each URL drops its `?key=` suffix and gains the header. The URL strings otherwise stay inline
and unchanged — the endpoint host is not a secret, and hoisting it into an auth module would
mix concerns for no security benefit.

- **`callGeminiAPI`** — `headers: geminiAuthHeaders()` added to the existing options object.
- **`callGeminiAPIBatch`** — `geminiAuthHeaders()` is called **once**, before the `map`, and the
  result spread into each request. Calling it inside the callback would issue one
  `PropertiesService` read per row in the chunk.
- **`uploadFilesToGemini`** phase 1 — same single-resolution pattern; the auth header is merged
  with the existing `X-Goog-Upload-*` headers.
- **`uploadFilesToGemini`** phase 2 — unchanged.

### 3. The key stops crossing function boundaries

| Removal | Rationale |
| --- | --- |
| `GeminiRequest.apiKey` (`server/types.ts:163`) | Makes it a compile error to attach a key to a request object |
| `uploadFilesToGemini`'s `apiKey` parameter | Caller no longer needs to hold a key |
| `invokeGemini` (`api.ts:185-189`) | Its only behavior was resolving the key; it is now a pure alias of `callGeminiAPI`. Callers `inference.ts:108` and `customFunctions.ts:40` call `callGeminiAPI` directly, which also restores symmetry with `callGeminiAPIBatch`. |
| `CONFIG.API_KEY_PROPERTY` (`config.ts:10`) and `AppConfig.API_KEY_PROPERTY` (`types.ts:14`) | The constant now lives beside the only code that reads it |
| The `apiKey` local in `runBatchAI` (`index.ts:382`) | No longer needed by either downstream call |

After this, exactly one function in the codebase holds the raw key, and it hands the value
directly to `UrlFetchApp`.

### 4. Missing-key UX

`runBatchAI` has no try/catch around its body, and the client invokes it once per chunk. If key
resolution threw from inside the pipeline, a file-mode run would fail only after Drive metadata
fetch and file downloads had completed — wasted work, repeated per chunk.

`index.ts` therefore keeps an upfront check, but owns no key logic:

```ts
if (!hasGeminiApiKey()) {
  ui.alert("Error", MISSING_API_KEY_MESSAGE, ui.ButtonSet.OK);
  return null;
}
```

UI stays in `index.ts` per the architecture rule; the property lookup and the hardcoded message
string both move out.

### 5. Testing

Test-driven, three layers:

1. **`__tests__/gemini-auth.test.ts`** (new) — `geminiAuthHeaders()` returns the `x-goog-api-key`
   header with the resolved key; throws `MISSING_API_KEY_MESSAGE` when the property is unset;
   `hasGeminiApiKey()` returns `true`/`false` without throwing.
2. **Existing suites** — invert `api.test.ts:368` so it asserts the request URL does *not*
   contain the key, and add the complementary assertion that the header does. Add equivalent
   coverage for `callGeminiAPIBatch` and for `files.ts` phase 1. Update `files.test.ts` call
   signatures (third argument removed) and add a `PropertiesService` mock to that file, following
   the repo's "mock GAS globals on `globalThis` before importing" pattern.
3. **Regression guard** (new) — a test that reads every `src/server/*.ts` file and fails if any
   interpolates a credential into a URL query string (`key=${`). This is the piece that protects
   against a future `countTokens` or other endpoint reintroducing T17. Uses the
   `/// <reference types="node" />` directive at the top of the test file, per the existing
   convention for tests needing `readFileSync`.

Per-file coverage thresholds in `jest.config.cjs` must be extended to cover the new module.

### 6. Documentation

- **`docs/threat_models/ssi-toolkit-threat-model.md`** — record R24 as implemented in the T17
  row, flip the AI-78 Open Item to Closed, and state explicitly that R25/AI-79 remains open so
  T17 is not read as fully mitigated.
- **`CLAUDE.md`** — add `gemini-auth.ts` to the server module graph and remove `invokeGemini`
  from the `api.ts` description.

## Out of scope

- **R25 / AI-79** — scrubbing raw exception messages before they reach a cell. R24 removes the
  key from the exception text that R25 would scrub, so R25 becomes defense-in-depth rather than
  a co-requirement, but the underlying habit of echoing raw exceptions into cells is untouched
  by this work.
- `drive.ts`'s `googleapis.com` calls — those authenticate with an OAuth bearer token, not a
  query-string key, and are unaffected.

## Verification

- `npm test` — full suite green, including the new guard test.
- `npm run test:coverage` — per-file thresholds satisfied for `gemini-auth.ts`.
- `npm run typecheck` — both server and client configs. Deleting `GeminiRequest.apiKey` should
  surface every remaining caller as a type error, which is the intended safety net.
- `npm run lint`, `npm run format:check`.
- Live check against the dev sheet: run a text-mode AI run and a file-mode AI run (exercising the
  Files API upload path), and confirm both succeed with the header-based auth. Temporarily clear
  the `GEMINI_API_KEY` script property to confirm the preflight alert still fires.
