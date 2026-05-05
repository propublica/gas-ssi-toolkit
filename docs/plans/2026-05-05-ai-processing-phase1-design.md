# AI Processing Redesign — Phase 1: Parallel Inference Pipeline

## Context

The current per-row sequential inference loop in `runBatchAI` processes ~5s per row. At
1,000 rows that is ~83 minutes of wall time with the sidebar open throughout. PRs #77 and
#78 added chunked execution and cancellation, but the fundamental bottleneck — sequential
Drive fetches and sequential Gemini calls inside each chunk — remains.

Phase 1 replaces the sequential inner loop with a parallel pipeline using
`UrlFetchApp.fetchAll()`. The client-side chunked execution system stays; what changes is
what happens inside each chunk.

Phase 2 (async fire-and-forget via Gemini Batch API) is designed but not yet planned —
see `docs/plans/2026-05-05-ai-processing-phase2-notes.md`.

## Root Cause

Two serial bottlenecks per row:

1. **Drive download** — `DriveApp.getFileById().getBlob().getBytes()` is a GAS service
   call. Single-threaded by design, cannot be parallelized.

2. **Gemini API call** — `UrlFetchApp.fetch()` fires one HTTP request at a time.

Fix: `ScriptApp.getOAuthToken()` turns Drive downloads into plain HTTP requests that
`fetchAll()` can parallelize. Files are uploaded to the Gemini Files API to get URI
references, eliminating large inline base64 payloads. All Gemini inference calls then
fire together via a second `fetchAll()`.

## Architecture

### What stays unchanged

The client-side chunked execution system is untouched — GAS's 6-minute execution limit
still applies per `google.script.run` call.

```
computeChunks()       chunk boundary math — unchanged
runChunks()           client-side chunk loop — unchanged
JobStore              job tracking, cancellation, polling — unchanged
writeJobProgress()    CacheService progress writes — unchanged
getJobProgress()      sidebar polling — unchanged
SSI custom function   uses runInference(), text-only — unaffected
```

Chunk size increases from 10 to 50 rows because each chunk now completes in ~15–25s
instead of ~50s, well within the 6-minute window.

### New per-chunk flow

**Text-only chunk** (no Drive file inputs — skips all file work):

```
1. Build all N request payloads (pure, no I/O)
2. fetchAll N Gemini inference calls → N results     ← parallel
3. Batch write N results → single SpreadsheetApp.flush()
```

**Multimodal chunk** (has Drive file inputs — two waves of parallelism):

```
Wave 1 — file work:
  1a. fetchAll Drive metadata calls → mimeType + size per unique file  ← parallel
  1b. fetchAll Drive export URLs → raw bytes per unique file            ← parallel
  1c. fetchAll Gemini Files API uploads → Map<driveId, geminiUri>       ← parallel
      (processed in sub-batches of 10 to manage peak memory)

Wave 2 — inference:
  2.  Build all N request payloads using URI refs from map (pure, no I/O)
  3.  fetchAll N Gemini inference calls → N results                     ← parallel
  4.  Batch write N results → single SpreadsheetApp.flush()
```

Wave 2 cannot start until Wave 1 completes — inference payloads depend on the URI map.
Within each wave, all requests are concurrent.

Drive file deduplication applies within a chunk: if the same Drive URL appears in
multiple rows, it is downloaded and uploaded once; the URI is reused across all rows.

### Drive export URLs (Wave 1b)

All requests use `Authorization: Bearer {ScriptApp.getOAuthToken()}`.

| File type | URL |
|---|---|
| Google Docs | `GET /drive/v3/files/{id}/export?mimeType=application/pdf` |
| PDF / image / video / audio | `GET /drive/v3/files/{id}?alt=media` |
| Google Sheets | `GET /drive/v3/files/{id}/export?mimeType=text/csv` |

**Sheets caveat:** Drive export only produces the first sheet as CSV. Multi-sheet exports
still require `SpreadsheetApp` to enumerate sheets and cannot be parallelized. Accepted
limitation — address in a follow-up if multi-sheet sources become common.

### Inline data vs. Files API

Two separate paths are maintained:

**`runBatchAI` (parallel batch path):** always uses Files API for Drive files. Sequential
`DriveApp` fetches are the bottleneck regardless of file size — the parallelism benefit
outweighs the extra Files API upload round trip.

**`runInference` (single-call path, SSI only):** keeps `prepareDriveAttachments()` and
the inline base64 path. Drive file handling in `runInference` is preserved specifically
to support a future "Test Row" feature — see Deferred.

## File Changes

### New: `src/server/files.ts`

- `uploadFilesToGemini(files: Map<string, Uint8Array>, mimeTypes: Map<string, string>, apiKey: string): Map<string, string>`
  — multipart `fetchAll` uploads to Gemini Files API; returns `driveId → geminiUri`; processed in sub-batches of 10

### `src/server/drive.ts`

| Change | Function | Notes |
|---|---|---|
| ADD | `fetchDriveMetadata(fileIds, oauthToken)` | Wave 1a — parallel Drive API metadata via `fetchAll` |
| ADD | `downloadDriveFiles(fileIds, metadata, oauthToken)` | Wave 1b — parallel Drive export via `fetchAll` |
| KEEP | `prepareDriveAttachments()` | Inline path for `runInference` / future Test Row |
| KEEP | `exportAndEncodeFile()` | Used by `prepareDriveAttachments` |
| KEEP | `extractTextUniversal()` | Text extraction tool — unaffected |
| KEEP | `checkDriveService()` | Unaffected |

### `src/server/api.ts`

| Change | Function | Notes |
|---|---|---|
| ADD | `callGeminiAPIBatch(payloads, apiKey)` | Wraps `UrlFetchApp.fetchAll`, maps responses by index |
| KEEP | `callGeminiAPI()` | Single-call path — used by `invokeGemini` |
| KEEP | `invokeGemini()` | SSI entry point — unchanged |
| KEEP | `buildGeminiPayload()` | Payload assembly — unchanged |

### `src/server/inference.ts`

The user-parts assembly is extracted into a private helper shared by both paths:

| Change | Function | Notes |
|---|---|---|
| EXTRACT (private) | `buildUserParts(promptInputs, fileUriMap?)` | Text inputs: same as today. File inputs: URI lookup from map when provided |
| ADD | `buildInferenceRequest(promptInputs, systemPrompt?, tools?, fileUriMap?)` | Calls `buildUserParts`, returns `GeminiRequest \| null` — no HTTP call; used by batch path in `index.ts` |
| SIMPLIFY | `runInference(promptInputs, systemPrompt?, tools?)` | Becomes: `buildInferenceRequest` + `invokeGemini`; Drive file branch preserved but not called by SSI |

### `src/server/types.ts`

- ADD `GeminiFileData: { fileUri: string; mimeType: string }`
- EXPAND `GeminiUserPart` union to include `{ fileData: GeminiFileData }`

### `src/server/index.ts`

- REFACTOR `runBatchAI` inner loop:
  - Detect `hasFileInputs` from `config.promptCols`
  - Text-only path: `buildInferenceRequest` × N → `callGeminiAPIBatch`
  - Multimodal path: file waves → `buildInferenceRequest` × N → `callGeminiAPIBatch`
  - Batch write all results per chunk; single `SpreadsheetApp.flush()` per chunk

### `src/client/panels/configure-ai-run.ts`

| Change | Detail |
|---|---|
| `CHUNK_SIZE` | 10 → 50 |
| `CHUNK_WARN_THRESHOLD` | 50 → 200 |
| Time estimate in warning dialog | `~5s/row` → `~0.5s/row` |
| Progress messages | Per-pass (see below) |

## Progress UX

`fetchAll` returns all-at-once, so per-row progress within a chunk is replaced with
per-pass messages written via `writeJobProgress`:

```
"Downloading files for chunk N of M..."    (wave 1b, multimodal only)
"Uploading files for chunk N of M..."      (wave 1c, multimodal only)
"Running AI on chunk N of M..."            (wave 2 / inference pass)
```

Between-chunk `"Rows X–Y of Z"` messages are unchanged.

## Performance

| Scenario | Current | Phase 1 |
|---|---|---|
| 1,000 text-only rows | ~83 min | ~8–10 min |
| 1,000 multimodal rows (small files) | ~83 min | ~15–20 min |
| Chunk execution time | ~50s (10 rows) | ~15–25s (50 rows) |

## Deferred

- **"Test Row" feature** — single-row interactive inference via `runInference()` +
  `prepareDriveAttachments()` inline data; natural home for a future "Test this row"
  button in `ConfigureAIRunPanel`. `prepareDriveAttachments` is kept specifically to
  support this (see `memory/project_test_row_concept.md`).

- **Cross-run URI cache** — `PropertiesService` cache of `driveId → geminiUri` with 48h
  TTL, lazy expiry cleanup, LRU eviction backstop; avoids re-uploading files across runs.
  Slot in as a Phase 1 follow-up once the Files API upload path is stable.

- **Multi-sheet Sheets export parallelization** — `SpreadsheetApp` dependency prevents
  HTTP parallelism; defer unless multi-sheet sources become common.

- **Phase 2: Async Batch Mode** — fire-and-forget for 1,000+ row jobs via Gemini Batch
  API + GCS + time-driven triggers. Full design in
  `docs/plans/2026-05-05-ai-processing-phase2-notes.md`.
