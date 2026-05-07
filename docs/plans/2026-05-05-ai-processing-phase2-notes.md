# AI Processing Redesign — Phase 2: Async Batch Mode (Design Notes)

**Status:** Designed, not yet planned.
**Prerequisite:** Phase 1 (`docs/plans/2026-05-05-ai-processing-phase1-design.md`) complete.
**To resume:** Run the brainstorming or writing-plans skill against this document.

---

## Problem This Solves

Phase 1 brings 1,000 rows from ~83 min to ~8–10 min. But the sidebar must stay open the
entire time, and any disconnection stops the run. For jobs above ~500 rows, users want
to submit the job and come back when it's done.

Phase 2 adds a second run mode: fire-and-forget via the Gemini Batch API. No execution
window, no sidebar requirement, 50% token cost discount.

---

## User Stories

**Small batch (< ~500 rows):** Use Phase 1 parallel path. Live progress, results stream
in chunk by chunk.

**Large batch (500+ rows):** Submit the job, close the sidebar, come back later. Results
written to sheet when Gemini finishes (minutes to hours depending on job size).

---

## Infrastructure Required

- **Gemini Batch API** — accepts JSONL of requests, processes async, returns JSONL of
  results. 50% token cost discount vs. standard API.
- **GCS bucket** — input/output staging for JSONL files. Batch API reads input from and
  writes output to GCS.
- **GAS time-driven trigger** — fires every minute, independent of whether any user has
  the spreadsheet open. Polls job status and writes results on completion.

New OAuth scope needed: `https://www.googleapis.com/auth/devstorage.read_write`

---

## Four-Phase Job Lifecycle

### Phase 1 — File Upload (sidebar open, ~1–2 min for large file sets)

1. Collect all unique Drive file IDs across the full row range
2. `downloadDriveFiles()` + `uploadFilesToGemini()` in parallel sub-batches of 20
3. Build `fileUriMap: driveId → geminiUri`

Deduplication: each unique Drive file is uploaded once regardless of how many rows
reference it. Initial implementation always re-uploads (no cross-run cache); URI caching
is a follow-up (see Phase 1 deferred section).

### Phase 2 — Job Submission (same GAS execution as Phase 1)

1. Build JSONL — one line per row:
   ```json
   {"key": "row-42", "request": {"model": "...", "contents": [...], "systemInstruction": {...}}}
   ```
2. POST JSONL to GCS bucket
3. POST to Gemini Batch API endpoint → receive `batchJobName` (`"batches/abc123"`)
4. Persist `BatchJobState` to `UserProperties` (keyed by spreadsheet ID)
5. Create time-driven trigger: `ScriptApp.newTrigger("pollBatchJob").timeBased().everyMinutes(1).create()`
6. Return control to sidebar — user sees "Job submitted"

### Phase 3 — Polling (trigger fires every ~1 min, no sidebar required)

Triggered function: `pollBatchJob()`

1. Read `BatchJobState` from `UserProperties`
   - Key missing → zombie guard: delete trigger and exit
2. GET batch job status from Gemini API
3. Branch on status:
   - `PENDING` / `RUNNING`: write progress to `CacheService`; check `submittedAt` —
     if >24h with no result, mark stale and clean up
   - `FAILED` / `CANCELLED`: write error to `CacheService`, clean up
   - `SUCCEEDED`: proceed to Phase 4

### Phase 4 — Results Writing (same trigger execution as Phase 3 success)

1. Download results JSONL from GCS
2. Parse each line — map `"key"` field (`"row-42"`) back to sheet row number
3. Write to output column — same rich text / plain text logic as `runBatchAI`
4. Clean up: delete trigger, delete `UserProperties` key
5. Write completion status to `CacheService` for sidebar to display

---

## Job State

Stored in `UserProperties` (per-user, all spreadsheets), keyed by spreadsheet ID so
multiple users of the same add-on have independent jobs.

**One active batch job per spreadsheet per user.** `submitBatchJob()` rejects if a key
already exists.

```typescript
interface BatchJobState {
  jobName: string;           // "batches/abc123"
  triggerId: string;         // ScriptApp trigger ID — for clean deletion
  spreadsheetId: string;
  sheetName: string;         // name not index — sheets can be reordered
  rowRange: { start: number; end: number };
  outputCol: string;
  groundingCol?: string;
  applyMarkdown: boolean;
  includeGrounding: boolean;
  submittedAt: string;       // ISO 8601 — stale job detection (>24h)
}
```

### Cleanup contract

All terminal states delete both the trigger and the `UserProperties` key:

| Outcome | Who cleans up |
|---|---|
| Job succeeded | `pollBatchJob()` after writing results |
| Job failed / cancelled | `pollBatchJob()` after surfacing error |
| User cancels from sidebar | `cancelBatchJob()` server function |
| Zombie (property missing on trigger fire) | `pollBatchJob()` deletes trigger and exits |
| Stale job (>24h, no results) | `pollBatchJob()` marks stale, cleans up |

---

## New Server Functions

All four live in a new file: **`src/server/batch.ts`**

| Function | Called by |
|---|---|
| `submitBatchJob(config: RunConfig)` | `google.script.run` from sidebar |
| `pollBatchJob()` | Time-driven trigger (global stub in `rollup.config.js` footer) |
| `getBatchJobStatus()` | `google.script.run` — sidebar polls `CacheService` key |
| `cancelBatchJob()` | `google.script.run` from sidebar |

`pollBatchJob` must be exported from `src/server/index.ts` and added as a global stub in
`rollup.config.js` — it is called by an installable trigger, not by `google.script.run`.

---

## Client Changes

### `ConfigureAIRunPanel` — threshold-based mode selector

```
rowCount <= 500:    [Run AI]                → Phase 1 parallel path

rowCount > 500:     [Run Now]               → Phase 1 parallel path (slower, immediate)
                    [Submit Batch]          → Phase 2 async batch path
```

### New job states in `JobStore` / `JobIndicator`

```
"submitting"        upload + submission in progress (~1–2 min for large file sets)
"batch-pending"     job submitted, waiting for Gemini to start
"batch-running"     Gemini is processing
"batch-complete"    results written to sheet
"batch-failed"      surface error message, offer retry
```

`JobIndicator` already persists across navigation — user can browse the sidebar freely
while a batch job runs.

### New service calls (`src/client/services.ts`)

`submitBatchJob`, `getBatchJobStatus`, `cancelBatchJob`

### New declarations (`src/client/google.d.ts`)

Same three functions.

---

## File Changes Summary

```
src/server/batch.ts              NEW — submitBatchJob, pollBatchJob,
                                       getBatchJobStatus, cancelBatchJob

src/server/index.ts              EXPORT submitBatchJob, getBatchJobStatus,
                                        cancelBatchJob (re-export from batch.ts)

rollup.config.js                 ADD pollBatchJob global stub (trigger target)
                                 ADD submitBatchJob, getBatchJobStatus,
                                     cancelBatchJob stubs

src/client/panels/
  configure-ai-run.ts            ADD threshold logic (500-row), Submit Batch
                                     button, batch mode dispatch
src/client/services.ts           ADD submitBatchJob, getBatchJobStatus,
                                     cancelBatchJob
src/client/google.d.ts           ADD same three declarations
src/client/job-store.ts          ADD batch job status states
```

---

## Deferred from Phase 2

- **Cross-run URI cache** — upload files once per 48h window instead of re-uploading on
  every batch submission. `PropertiesService` cache keyed by `driveId + driveModifiedAt`,
  lazy expiry cleanup, LRU eviction backstop at ~1,500 entries. Design discussed in
  brainstorming session 2026-05-05.

- **Context caching** — Gemini server-side token caching for large shared system prompts.
  Only useful when system prompts are large and repeated across many rows. Not the current
  bottleneck; revisit if prompt patterns change.

- **Vertex AI Batch Prediction** — provides BigQuery integration and more granular GCP
  tooling, but no meaningful advantage over Gemini Batch API for this use case. Ruled out
  for now.
