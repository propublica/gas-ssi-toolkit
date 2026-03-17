# Drive File Handling Redesign

**Date:** 2026-03-17
**Status:** Design complete, pending implementation

## Problem

The current `fetchAndEncodeFile` function has four compounding shortcomings:

1. **Stale size limit.** Hard-capped at 25MB — an old conservative number, not the actual Gemini API limit.
2. **Wrong measurement.** Checks raw file size against a post-encoded limit. Base64 encoding expands file size by exactly 4/3, so the check is inaccurate.
3. **No aggregate validation.** The limit applies to the total request payload, not per file. Multiple attachments per row can silently combine to exceed the limit.
4. **No Google Workspace support.** Google Docs and Sheets return unsupported MIME types (`application/vnd.google-apps.document` / `.spreadsheet`) — Gemini rejects them as inline data.

## Goals

1. Support Google Docs (export as PDF) and Google Sheets (export each sheet as a separate CSV inline part)
2. Support video and audio MIME types via blob encoding
3. Raise inline size limits to match what the Gemini REST API actually accepts
4. Enforce limits correctly: post-encoded, aggregate across all attachments in a row
5. Surface clear, actionable error messages
6. Document the Gemini Files API as the escape hatch for files exceeding inline limits

## Out of Scope

- Implementing the Gemini Files API (see escape hatch section below)
- Rebuilding `extractTextUniversal` (text extraction feature will be redesigned separately)

## API Limits

Source: https://ai.google.dev/gemini-api/docs/file-input-methods#method-comparison

| Limit | Value | Notes |
|---|---|---|
| Total request ceiling | 100MB | Post-encoded (base64), all `inline_data` parts combined |
| Per-PDF ceiling | 50MB | Post-encoded, per individual PDF file |
| Base64 expansion | 4/3 | Exact ratio; `Utilities.base64Encode()` produces compact output (no line breaks) |

We apply a **5% safety buffer** to both ceilings to account for:
- JSON envelope overhead (prompt text, `mime_type` fields, etc.)
- Exported file size uncertainty (Docs/Sheets native size does not predict exported PDF/CSV size)

Effective buffered thresholds:
- Total: **95MB post-encoded** (~71MB raw)
- Per-PDF: **47MB post-encoded** (~35MB raw)

## File Type Routing

| MIME type | Handling |
|---|---|
| `application/vnd.google-apps.document` | Export as PDF via `Drive.Files.export` → single inline part |
| `application/vnd.google-apps.spreadsheet` | Export each sheet as CSV via `Drive.Files.export` with `gid` → one inline part per sheet |
| `application/pdf` | Fetch blob directly → single inline part |
| `image/*` | Fetch blob directly → single inline part |
| `video/*` | Fetch blob directly → single inline part |
| `audio/*` | Fetch blob directly → single inline part |
| Everything else | Throw descriptive error: `"Unsupported file type: [mime_type]"` |

Note: video and audio files are the most likely types to exceed inline size limits in practice. They are the primary real-world trigger for the Files API escape hatch.

## Size Validation

Two independent check tiers, both run inside `prepareDriveAttachments` after all files are encoded. Both operate on post-encoded size (`rawBytes * 4/3`).

**Tier 1 — Per-PDF check:**
- For each encoded part whose `mime_type` is `application/pdf`
- Encoded size must be ≤ `INLINE_MAX_PDF_BYTES` (47MB)
- Pre-flight shortcut for binary files: if `file.getSize() * INLINE_PREFLIGHT_FACTOR > INLINE_MAX_PDF_BYTES`, throw before downloading the blob
- Pre-flight is skipped for Workspace exports (exported size is unknown before export)
- Error: `"File too large: [name] (~[X]MB raw). PDFs must be under ~35MB raw / 47MB encoded. Consider the Gemini Files API for large payloads."`

**Tier 2 — Total request check:**
- Sum of all encoded `GeminiInlineData` parts must be ≤ `INLINE_MAX_TOTAL_BYTES` (95MB)
- Error: `"Attachments too large: combined encoded size is ~[X]MB, exceeds 95MB inline limit. Consider the Gemini Files API for large payloads."`

Both tiers must pass. A request with two 30MB raw PDFs each passes Tier 1 individually but may fail Tier 2 when combined.

## Function Signatures

### Public

```typescript
// drive.ts
export function prepareDriveAttachments(fileIds: string[]): GeminiInlineData[]
```

Takes all Drive file IDs for a row. Routes each file by MIME type, encodes all parts, runs both size validation tiers, returns the combined `GeminiInlineData[]` ready for a Gemini request. Throws on unsupported types, size violations, or Drive errors.

### Private

```typescript
// drive.ts (internal)
function exportAndEncodeFile(fileId: string): GeminiInlineData[]
```

Routes a single file by MIME type. Exports Workspace formats, fetches blobs for binary types, encodes to base64. Always returns an array — single-item for most types, one item per sheet for Sheets. No size checks here; that responsibility belongs to `prepareDriveAttachments`.

## Files API Escape Hatch

The Gemini Files API supports uploads up to 2GB with no base64 overhead. It is the correct solution for files exceeding inline limits.

It is **not implemented** in this iteration. When either size check fails, the error message directs users to the Files API. A `// TODO` comment at the throw site marks the exact seam where routing logic would be added.

Reference: https://ai.google.dev/api/files

The recommended community threshold for routing to the Files API is files > ~20MB raw, as inline data becomes inefficient at that scale.

## Change Surface

| File | Change |
|---|---|
| `src/server/config.ts` | Replace `MAX_FILE_SIZE_BYTES` with three new constants (see below) |
| `src/server/types.ts` | Remove `MAX_FILE_SIZE_BYTES` from `AppConfig` interface |
| `src/server/drive.ts` | Remove `fetchAndEncodeFile`; add `prepareDriveAttachments` (public) and `exportAndEncodeFile` (private) |
| `src/server/inference.ts` | Replace `.map(fetchAndEncodeFile)` chain with single `prepareDriveAttachments(fileIds)` call |

`checkDriveService` and `extractTextUniversal` in `drive.ts` are unchanged.

## Config Changes

```typescript
/**
 * Inline data size limits for the Gemini REST API.
 * Source: https://ai.google.dev/gemini-api/docs/file-input-methods#method-comparison
 *
 * - Total request ceiling: 100MB (post-encoded, all inline_data parts combined)
 * - Per-PDF ceiling: 50MB (post-encoded, per individual PDF file)
 * - Base64 encoding expands raw file size by exactly 4/3
 *
 * We apply a 5% safety buffer to both ceilings to account for:
 *   1. JSON envelope overhead (prompt text, mime_type fields, etc.)
 *   2. Exported file size uncertainty (Docs/Sheets native size before export is unknown)
 *
 * For files exceeding these limits, consider the Gemini Files API (up to 2GB,
 * no base64 overhead): https://ai.google.dev/api/files
 */
INLINE_MAX_TOTAL_BYTES: 95 * 1024 * 1024,   // 95MB (100MB ceiling × 0.95)
INLINE_MAX_PDF_BYTES:   47 * 1024 * 1024,   // 47MB (50MB ceiling × 0.95)
INLINE_PREFLIGHT_FACTOR: 4 / 3,             // exact base64 expansion ratio
```

## runInference Change

```typescript
// before
const inlineData: GeminiInlineData[] =
  driveLinks !== undefined
    ? flattenArg(driveLinks)
        .filter(isValidDriveLink)
        .map((link) => fetchAndEncodeFile(extractId(link)))
    : [];

// after
const inlineData: GeminiInlineData[] =
  driveLinks !== undefined
    ? prepareDriveAttachments(
        flattenArg(driveLinks).filter(isValidDriveLink).map(extractId)
      )
    : [];
```
