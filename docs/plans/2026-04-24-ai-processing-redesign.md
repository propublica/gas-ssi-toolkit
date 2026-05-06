# AI Processing Redesign — Design Document

## Context

The chunked batch execution design (`2026-03-31-chunked-batch-execution-design.md`) solved
the Apps Script 6-minute timeout by splitting `runBatchAI` into client-orchestrated 50-row
chunks. That design explicitly deferred two follow-on improvements:

> **Time-based trigger chaining** would remove the sidebar-open requirement.
> **External pipeline dispatch** — for batches beyond ~5,000 rows, the right tool is a
> Vertex AI batch inference job. The `dispatchChunked` interface is designed to be
> replaceable.

This document designs both. The problem that motivates them is **speed**, not timeouts.
At 3–6 seconds per row (sequential Drive fetch + sequential Gemini call), a 300-row batch
takes 15–30 minutes of babysitting. Users routinely need to process 1,000+ rows.

## The Two User Stories

**Small batch (< ~500 rows):** User wants to watch results stream in, chunk by chunk,
in real time. Sidebar stays open. Speed is the priority.

**Large batch (1,000+ rows):** User wants to submit the job and come back when it's done.
Closing the sidebar should not stop the run. Throughput over thousands of rows matters
more than live feedback.

## Root Cause Analysis

The current per-row flow has two serial bottlenecks:

1. **Drive download** — `DriveApp.getFileById()` + `file.getBlob().getBytes()` are GAS
   service calls. Single-threaded by design. Cannot be parallelized with `fetchAll()`.

2. **Gemini API call** — `UrlFetchApp.fetch()` fires one HTTP request at a time.

At 3s/call × 50 rows = 2.5 minutes per chunk. With parallelism, both steps can run
concurrently within a chunk — the wall time becomes the slowest single call, not their sum.

Note: base64 encoding (between download and API call) is CPU-bound and always serial in
GAS, but it is not the bottleneck — encoding 1MB takes ~5–10ms vs. 1–3s for I/O.

## The Option Space

| Lever | What it does | GAS-native? |
|---|---|---|
| `UrlFetchApp.fetchAll()` | Fire N HTTP requests in parallel | Yes |
| Drive API via HTTP + OAuth token | Download Drive files as plain HTTP (parallelizable) | Yes, via `ScriptApp.getOAuthToken()` |
| Gemini Files API | Upload a file once, reference by URI instead of inline base64 | Yes, via UrlFetchApp |
| Gemini Batch API | Submit a whole job as JSONL, async results | Yes, via time-driven triggers |

**Ruled out:**
- **Context caching** — only helps with large shared system prompts. Not the bottleneck.
- **Vertex AI Batch Prediction** — requires GCP service account auth and IAM setup with
  no meaningful advantage over the Gemini Batch API for this use case.
- **Cloud Run / external runtime** — the GAS model distributes computational load across
  each user's execution context. Centralizing to Cloud Run adds operational overhead
  (scaling, multi-tenancy, billing) without a clear payoff. The Batch API already
  offloads the heavy inference work to Google's servers. Revisit only if file upload
  volume hits concrete GAS memory limits.

---

## Path 1 — Real-Time Parallel (Small Batches)

### Goal

Make each 50-row chunk 5–10× faster by parallelizing both Drive downloads and Gemini
calls within the chunk.

### Key Unlock

`ScriptApp.getOAuthToken()` returns the current user's Bearer token. This lets
`UrlFetchApp` hit Drive export URLs directly — turning GAS service calls into plain HTTP
requests that `fetchAll()` can parallelize.

### New Per-Chunk Flow

```
Current (sequential):
  for each row:
    DriveApp.getFileById() → getMimeType() → getBlob() → base64 → UrlFetchApp.fetch()

New (parallel):
  1. Metadata pass  — fetchAll() one Drive API call per unique file → mimeType + size
  2. Download pass  — fetchAll() Drive export URLs for all unique files
  3. Encode pass    — base64 encode all blobs (serial, ~5ms/file, negligible)
  4. Gemini pass    — fetchAll() all generateContent calls for the chunk
  5. Write pass     — batch-write all results to the sheet
```

Drive file deduplication applies within a chunk: if the same Drive URL appears in
multiple rows, it is downloaded once and the encoded blob is reused for each row's
Gemini payload.

### Drive Export URLs

| File type | URL pattern |
|---|---|
| Google Docs | `GET /drive/v3/files/{id}/export?mimeType=application/pdf` |
| Google Sheets | `GET /drive/v3/files/{id}/export?mimeType=text/csv` (one sheet) — see note |
| PDF / image / video / audio | `GET /drive/v3/files/{id}?alt=media` |

Auth header: `Authorization: Bearer {ScriptApp.getOAuthToken()}`.

**Sheets caveat:** The current Sheets export logic in `exportAndEncodeFile` uses
`SpreadsheetApp` to enumerate sheets and export each as CSV. The Drive export endpoint
only exports the first sheet as CSV. Multi-sheet exports still require `SpreadsheetApp`
and cannot be parallelized. This is an acceptable limitation for the initial
implementation — document it, address in a follow-up if multi-sheet files become common.

### Memory Ceiling

Apps Script execution memory is roughly 50MB. At ~1.3MB base64 per 1MB PDF, a 50-row
chunk with 1MB PDFs reaches ~65MB — above the safe ceiling. The chunk size constant
(currently `50` in `configure-ai-run.ts`) should be made adaptive based on estimated
file sizes from the metadata pass. Initial implementation: keep the fixed 50-row chunk
but add a per-row size guard that skips parallelization and falls back to sequential
for rows whose files exceed a threshold.

### Progress UX

`fetchAll()` results arrive all-at-once (when the slowest call in the batch finishes),
not row-by-row. The per-row `"Processing row N of 50"` progress updates inside a chunk
go away. Replace with:

- **During download pass:** `"Downloading files for chunk N of M..."`
- **During Gemini pass:** `"Running AI on chunk N of M..."`
- **Between chunks:** existing `"Chunk N of M — starting..."` (unchanged)

This is a minor UX regression within a chunk but a major improvement in total time.

### Files Touched

| File | Change |
|---|---|
| `src/server/drive.ts` | Add `downloadDriveFilesParallel(fileIds, oauthToken)` — returns `Map<fileId, GeminiInlineData[]>` using fetchAll; keep `prepareDriveAttachments` as fallback |
| `src/server/inference.ts` | Add `runInferenceBatch(rows, systemPrompts, tools)` — accepts pre-fetched blobs, fires all Gemini calls via fetchAll |
| `src/server/api.ts` | Add `callGeminiAPIBatch(requests)` — wraps `UrlFetchApp.fetchAll()`, maps responses back to requests by index |
| `src/server/index.ts` | Refactor `runBatchAI` to use parallel path when `DriveApp` service is not needed or falls back gracefully |
| `src/shared/types.ts` | No changes needed |

---

## Path 2 — Async Batch (Large Batches)

### Goal

Allow users to submit 1,000+ row jobs that run entirely on Google's infrastructure.
The sidebar can be closed. Results are written to the sheet when the job completes.

### Infrastructure

**Gemini Files API** — Upload files to Gemini's servers, get back a stable URI
(`https://generativelanguage.googleapis.com/v1beta/files/abc123`). Files are cached
for 48 hours. Use URIs in the batch JSONL instead of inline base64 — dramatically
smaller payloads.

**Gemini Batch API** — Submit a JSONL file (one request per line), get back a batch job
name. Gemini runs the job asynchronously. Poll for status; download results JSONL when
complete.

**GAS time-driven triggers** — Installable triggers that fire on a schedule, independent
of whether any user has the spreadsheet open. The polling trigger fires every minute to
check batch job status.

### Four-Phase Flow

#### Phase 1 — File Upload (one GAS execution, sidebar open)

1. Collect all unique Drive file IDs across the full row range
2. Get `ScriptApp.getOAuthToken()` once
3. Download all files via Drive export URLs (`fetchAll()` in chunks of 20)
4. Upload each file to Gemini Files API (`fetchAll()` in chunks of 20)
5. Record `driveFileId → geminiFileUri` mapping in memory

Deduplication: each unique Drive file is uploaded once regardless of how many rows
reference it. The 48-hour cache means re-runs within the same day can skip re-upload
if URIs are persisted (future optimization; initial implementation always re-uploads).

#### Phase 2 — Job Submission (same execution)

1. Build JSONL — one line per row:
   ```json
   {"key": "row-2", "request": {"model": "...", "contents": [...fileData URIs + text parts...], "systemInstruction": {...}}}
   ```
2. POST JSONL to Gemini Batch API endpoint
3. Receive batch job name: `batches/abc123`
4. Persist job state to `UserProperties` (see State Management below)
5. Create a time-driven trigger (every 1 minute) via `ScriptApp.newTrigger()`
6. Return control to the sidebar — user sees "Job submitted"

#### Phase 3 — Polling (trigger fires every ~1 minute)

Triggered function: `pollBatchJob()`

1. Read job state from `UserProperties` — if missing, delete the trigger and exit
   (zombie guard)
2. GET batch job status from Gemini API
3. If `PENDING` or `RUNNING`: write progress to `CacheService` so sidebar can display;
   check `submittedAt` — if >24 hours old with no results, mark as stale and stop
4. If `SUCCEEDED`: proceed to Phase 4
5. If `FAILED` or `CANCELLED`: write error to a well-known `CacheService` key, clean up
   (delete trigger + delete UserProperties key)

#### Phase 4 — Results Writing (same trigger execution as Phase 3 success)

1. Download results JSONL from Gemini API response
2. Parse each line — map `key` field (`"row-2"`) back to sheet row number
3. Write results to the output column — same rich text / plain text logic as current
   `runBatchAI`
4. Clean up: delete time-driven trigger, delete UserProperties batch job key
5. Write completion status to CacheService for sidebar to display

### State Management

Job state is stored in **`UserProperties`** (per-user, all spreadsheets) with keys
namespaced by spreadsheet ID:

```
Key:   batch_job_{spreadsheetId}
Value: JSON string, ~500 bytes
```

```ts
interface BatchJobState {
  jobName: string;          // "batches/abc123"
  triggerId: string;        // ScriptApp trigger ID, for deletion
  spreadsheetId: string;
  sheetName: string;        // sheet name (not index — sheets can be reordered)
  rowRange: { start: number; end: number };
  outputCol: string;
  groundingCol?: string;
  applyMarkdown: boolean;
  includeGrounding: boolean;
  submittedAt: string;      // ISO 8601, for stale job detection
}
```

**Cleanup contract — all terminal states delete both the trigger and the property:**

| Outcome | Who cleans up |
|---|---|
| Job succeeded | `pollBatchJob()` after writing results |
| Job failed / cancelled | `pollBatchJob()` after surfacing error |
| User cancels from sidebar | `cancelBatchJob()` server function |
| Zombie (property missing on trigger fire) | `pollBatchJob()` deletes trigger and exits |
| Stale job (>24h, no results) | `pollBatchJob()` marks stale, cleans up |

**One active batch job per spreadsheet per user.** `submitBatchJob()` checks for an
existing `batch_job_{spreadsheetId}` key before proceeding and rejects with a clear
message if one exists.

### New Server Functions

| Function | Description |
|---|---|
| `submitBatchJob(config: RunConfig)` | Phases 1–2: upload files, submit job, create trigger, persist state |
| `pollBatchJob()` | Phase 3–4: poll status, write results, clean up — called by trigger |
| `getBatchJobStatus()` | Sidebar polls this to show progress: reads CacheService key |
| `cancelBatchJob()` | Calls Gemini cancel endpoint, deletes trigger, deletes UserProperties key |

`pollBatchJob` must be exported from `src/server/index.ts` and added to `rollup.config.js`
footer as a global stub — it is called by an installable trigger, not by
`google.script.run`.

### Sidebar UX Changes

**`ConfigureAIRunPanel`** gets a second run mode selector (or a threshold-based auto-switch):

- **Real-time** (default for < N rows): existing chunked dispatch
- **Async batch** (default for ≥ N rows, or user-selectable): calls `submitBatchJob()`

**New batch status state in the panel / job strip:**

- `"submitting"` — upload + submission in progress (may take 1–2 minutes for large file sets)
- `"batch-pending"` — job submitted, waiting for Gemini to start
- `"batch-running"` — Gemini is processing; show row count progress if API provides it
- `"batch-complete"` — results written; show completion toast
- `"batch-failed"` — surface error message; offer retry or clear

The job indicator persists across navigation (already supported by `JobIndicator`), so
the user can navigate the sidebar freely while a batch job runs.

---

## What to Build Now vs. Later

### Phase A — Now (3–5 days): Real-Time Parallelization

Delivers the biggest usability improvement for the common case (small-medium batches,
Drive file attachments). Works within the existing chunked execution architecture — no
new RPC functions, no trigger infrastructure, no UX redesign.

1. Add `downloadDriveFilesParallel()` to `drive.ts`
2. Add `callGeminiAPIBatch()` to `api.ts`
3. Add `runInferenceBatch()` to `inference.ts`
4. Refactor `runBatchAI` inner loop to use the parallel path per chunk
5. Update progress messages for batch UX

### Phase B — Next (1–2 sprints): Async Batch Path

Required for 1,000+ row reliability. Sidebar-close-safe. Larger architectural footprint:
new server functions, trigger management, UserProperties lifecycle, sidebar UX additions.

1. Implement `submitBatchJob()` (file upload + JSONL build + batch submission + trigger creation)
2. Implement `pollBatchJob()` (status check + results writing + cleanup)
3. Implement `getBatchJobStatus()` and `cancelBatchJob()`
4. Add global stubs to `rollup.config.js` for trigger-called functions
5. Add batch mode to `ConfigureAIRunPanel`
6. Add batch job states to `JobStore` / `JobIndicator`

### Deferred

- **Multi-sheet Google Sheets export parallelization** — SpreadsheetApp dependency makes
  this hard; address if multi-sheet files become a common source format
- **Gemini Files API URI caching across runs** — skip re-upload if same Drive file was
  uploaded within 48 hours; requires persisting `driveId → geminiUri` in PropertiesService
- **Cloud Run escape hatch** — only if GAS memory limits become a concrete problem for
  Phase B file uploads at very high row counts
