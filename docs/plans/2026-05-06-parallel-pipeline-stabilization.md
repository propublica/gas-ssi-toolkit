# Parallel Inference Pipeline — Stabilization & Memory Architecture

**Date:** 2026-05-06  
**Follows:** `2026-05-05-ai-processing-phase1-design.md`

This document records the architectural decisions made during the stabilization pass
on the Phase 1 parallel inference pipeline, and defines the current state of the system
as a handoff reference.

---

## What Was Stabilized

The Phase 1 design was implemented but crashed in production on real-world runs due to
three classes of bugs: shared-drive auth failures, per-file errors aborting entire chunks,
and V8 memory exhaustion from the file upload approach. This pass addressed all three.

---

## Decision 1: Shared Drive Support (`supportsAllDrives=true`)

**Problem:** Files in shared/Team Drives returned HTTP 404 from the Drive REST API v3,
even though `DriveApp.getFileById()` could access them. The raw HTTP path
(`fetchDriveMetadata`, `downloadDriveFiles`) was not authorized for shared drives by
default.

**Fix:** Added `&supportsAllDrives=true` to all three Drive API v3 URL templates in
`fetchDriveMetadata` and `downloadDriveFiles`.

**Why not use DriveApp directly:** `DriveApp` is sequential. Replacing `fetchAll`-based
downloads with `DriveApp.getFileById().getBlob()` calls would eliminate the parallelism
that is the entire point of the Phase 1 redesign. The correct fix is the query parameter,
not a different API.

---

## Decision 2: Partial-Success Pattern for Wave 1

**Problem:** A single failing file in any of the three Wave 1 stages (`fetchDriveMetadata`,
`downloadDriveFiles`, `uploadFilesToGemini`) was aborting the entire chunk. One bad file ID
caused every row in a 40-row chunk to fail silently.

**Fix:** All three Wave 1 functions now return `{ result, errors: Map<string, string> }`
instead of throwing. Each function passes only its successes to the next stage:

```
metadata fetch → passes only files whose metadata succeeded → download
download       → passes only files that downloaded successfully → upload
upload         → passes only files that uploaded successfully → fileUriMap
```

Errors from all three stages are merged into a single `fileErrors` map. Rows whose files
appear in that map receive a `[File error: ...]` cell value; rows whose files are clean
proceed normally to Wave 2 inference.

**Single-flush invariant:** File-error cell writes and inference results both land in the
same post-batch write loop, followed by one `SpreadsheetApp.flush()`. This ensures that on
a 6-minute timeout the sheet is never left in a partially-written state from a previous
chunk.

---

## Decision 3: Resumable Upload Protocol (Blob payload)

This was the most significant architectural change in this session.

**Original design:** `uploadFilesToGemini` used the Gemini Files API multipart upload — a
single `fetchAll` call per sub-batch, with each request body constructed as:

```
pre (header string → Uint8Array) + bytes (Uint8Array) + post (footer string → Uint8Array)
→ body (Uint8Array concatenation)
→ Array.from(body) (Byte[] = number[], passed to UrlFetchApp)
```

**The memory problem:** V8's `number[]` stores each element as a 64-bit float — 8 bytes per
byte of file content. A 2MB file became ~18MB of V8 heap just for the upload payload
(`Uint8Array` body + `Array.from` expansion + the original download bytes). With 5–10 files
in a sub-batch, this exceeded GAS's ~50MB V8 heap limit and caused "JavaScript runtime
exited unexpectedly" crashes.

**Fix:** Switched to the Gemini Files API **resumable** upload protocol. Each file now takes
two requests instead of one:

1. **Init** (`POST` with JSON metadata) → response header `x-goog-upload-url` contains a
   session URI
2. **Upload** (`POST` to session URI with `payload: blob`) — the GAS `Blob` object returned
   by `response.getBlob()` is passed directly to `UrlFetchApp` as `BlobSource`

**Why this eliminates the memory problem:** The `Blob` from `response.getBlob()` is a GAS
native object. When passed as `payload` to `UrlFetchApp.fetchAll`, GAS transfers the bytes
from the download buffer to the upload buffer inside its own C++ layer. Our JavaScript code
never calls `getBytes()`, `getContent()`, or `Array.from()` on file content. V8 heap
pressure per file is now the Blob proxy object (~hundreds of bytes), not the file content.

**Header case sensitivity:** GAS's `HTTPResponse.getHeaders()` normalizes response header
keys to lowercase. The session URI header from Google's API arrives as `x-goog-upload-url`
(lowercase), not `X-Goog-Upload-URL`. The implementation uses a case-insensitive lookup:

```typescript
const sessionUri = Object.entries(headers).find(
  ([k]) => k.toLowerCase() === "x-goog-upload-url",
)?.[1];
```

---

## Decision 4: Client-Side Chunking for Sheet-Selection Mode

**Problem:** When the user selected rows via the spreadsheet (no explicit row range), the
`handleRun` path in `ConfigureAIRunPanel` called `runBatchAI` directly — bypassing the
`computeChunks` / `runChunks` loop that enforces the `CHUNK_SIZE` limit. A 71-row selection
processed all 71 rows in one 6-minute execution slot.

**Fix:** Added `getActiveRangeInfo()` as a new server function that returns the active
selection bounds. In the `else` branch of `handleRun`, the client now calls
`getActiveRangeInfo()` first, then chunks the result identically to the explicit row-range
path.

---

## Current Tunable Parameters

| Constant | Location | Current Value | Meaning |
|---|---|---|---|
| `CHUNK_SIZE` | `src/client/panels/configure-ai-run.ts` | `40` | Rows per `google.script.run` call |
| `CHUNK_WARN_THRESHOLD` | same | `200` | Show confirmation dialog above this row count |
| `FILE_PIPELINE_BATCH_SIZE` | `src/server/index.ts` | `10` | Files per download→upload sub-batch in Wave 1 |

**`CHUNK_SIZE` guidance:** Each chunk's Wave 2 inference runs N Gemini calls in parallel via
`fetchAll`. At ~1s average per call, 40 rows takes ~40s of network time plus Wave 1 file
work. Well within the 6-minute slot. Could be increased to 60–80 if file volumes are low.

**`FILE_PIPELINE_BATCH_SIZE` guidance:** `UrlFetchApp.fetchAll` has an undocumented
practical limit around 20 concurrent requests. The resumable protocol uses two `fetchAll`
passes per sub-batch (init + upload), so 10 files × 2 = 20 requests per pass — at the
safe limit. Reduce to 5 if rate-limit errors appear during upload; increase only if the
`fetchAll` limit is confirmed higher.

---

## Current File Responsibilities

| File | Responsibility |
|---|---|
| `src/server/index.ts` | `runBatchAI` orchestrator — Wave 1 sub-batch loop + Wave 2 batch inference + single flush |
| `src/server/drive.ts` | `fetchDriveMetadata`, `downloadDriveFiles` — parallel Drive HTTP via `fetchAll`; `prepareDriveAttachments` — inline base64 path for SSI custom function |
| `src/server/files.ts` | `uploadFilesToGemini` — two-phase resumable upload; Blob pass-through, no `Array.from()` |
| `src/server/api.ts` | `callGeminiAPIBatch` — parallel Gemini inference via `fetchAll`; `callGeminiAPI` / `invokeGemini` — single-call path for SSI |
| `src/client/panels/configure-ai-run.ts` | Client chunking — `computeChunks`, `runChunks`, `getActiveRangeInfo` integration |

---

## Future Parallelization Work

> **Note for future sessions:** The current two-wave sequential design (all files upload →
> then all inference fires) is correct and stable, but leaves throughput on the table for
> mixed chunks where some rows have files and others do not. A more efficient architecture
> would pipeline at the row level: as soon as a row's files finish uploading, queue that row
> for inference rather than waiting for all files across the chunk to complete. This would
> allow Wave 2 inference to begin for file-ready rows while Wave 1 continues processing the
> remaining files in parallel.
>
> Additional candidates worth evaluating before a future redesign:
>
> - **Gemini Files API URI caching** — files uploaded in one chunk are valid for 48 hours.
>   Persisting `driveId → geminiUri` in `CacheService` across chunks would eliminate
>   re-uploading the same file in consecutive chunks of the same run.
>
> - **True async execution** — the current model requires the sidebar to remain open for the
>   duration of a run. Time-based triggers firing independent chunk workers would allow
>   runs to complete in the background and report results via a completion column or
>   notification.
>
> - **Vertex AI Batch Prediction** — for very large jobs (1,000+ rows), the Gemini Batch
>   API (designed in `2026-05-05-ai-processing-phase2-notes.md`) remains the most scalable
>   path. The Phase 1 parallel pipeline is the right foundation for runs up to a few hundred
>   rows; above that threshold the async batch path becomes necessary.
