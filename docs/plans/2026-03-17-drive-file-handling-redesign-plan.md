# Drive File Handling Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `fetchAndEncodeFile` with a correct, aggregate-aware `prepareDriveAttachments` pipeline that supports Google Docs, Google Sheets, video, and audio, and enforces accurate base64-adjusted size limits.

**Architecture:** A private `exportAndEncodeFile` handles per-file MIME routing and encoding; a public `prepareDriveAttachments` orchestrates all files for a row and enforces both size validation tiers. `runInference` is updated to call the new public function. Config constants replace the stale single threshold.

**Tech Stack:** TypeScript, Google Apps Script (DriveApp, SpreadsheetApp, Drive Advanced Service, Utilities), Jest + ts-jest

**Design doc:** `docs/plans/2026-03-17-drive-file-handling-redesign.md`

---

### Task 1: Update `config.ts` and `types.ts`

**Files:**
- Modify: `src/server/config.ts`
- Modify: `src/server/types.ts`

**Step 1: Replace `MAX_FILE_SIZE_BYTES` in `AppConfig` (`types.ts`)**

In `src/server/types.ts`, find the `AppConfig` interface and replace the single field with three:

```typescript
export interface AppConfig {
  API_KEY_PROPERTY: string;
  MODEL_NAME: string;
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
  INLINE_MAX_TOTAL_BYTES: number;  // 95MB (100MB ceiling × 0.95)
  INLINE_MAX_PDF_BYTES: number;    // 47MB (50MB ceiling × 0.95)
  INLINE_PREFLIGHT_FACTOR: number; // exact base64 expansion ratio (4/3)
  MAX_OUTPUT_TOKENS: number;
}
```

**Step 2: Update `config.ts` with new constants**

Replace the `MAX_FILE_SIZE_BYTES` line in `src/server/config.ts`:

```typescript
export const CONFIG: AppConfig = {
  API_KEY_PROPERTY: "GEMINI_API_KEY",
  MODEL_NAME: "gemini-3.1-flash-lite-preview",
  INLINE_MAX_TOTAL_BYTES: 95 * 1024 * 1024,   // 95MB (100MB ceiling × 0.95)
  INLINE_MAX_PDF_BYTES:   47 * 1024 * 1024,   // 47MB (50MB ceiling × 0.95)
  INLINE_PREFLIGHT_FACTOR: 4 / 3,             // exact base64 expansion ratio
  MAX_OUTPUT_TOKENS: 1024,
};
```

**Step 3: Run typecheck to catch all references to the old constant**

```bash
npm run typecheck
```

Expected: errors pointing at any remaining `MAX_FILE_SIZE_BYTES` references (will be fixed in later tasks).

**Step 4: Commit**

```bash
git add src/server/config.ts src/server/types.ts
git commit -m "refactor: replace MAX_FILE_SIZE_BYTES with three inline limit constants"
```

---

### Task 2: Write failing tests for `prepareDriveAttachments`

**Files:**
- Modify: `__tests__/drive.test.ts`

These tests will fail until Task 3 is complete. That is expected.

**Step 1: Expand the mock setup at the top of `drive.test.ts`**

The existing mocks cover `DriveApp`, `DocumentApp`, `Utilities`, and `MimeType`. Add `SpreadsheetApp`, extend `MimeType` with `GOOGLE_SHEETS`, and add `Utilities.Charset`. Replace the entire mock block at the top of the file (before any imports):

```typescript
const mockAlert = jest.fn();
const mockUi = {
  alert: mockAlert,
  ButtonSet: { OK: "OK" },
};

(globalThis as any).Drive = {
  Files: {
    export: jest.fn(),
  },
};

(globalThis as any).DriveApp = {
  getFileById: jest.fn(),
};

(globalThis as any).DocumentApp = {
  openById: jest.fn(),
};

(globalThis as any).SpreadsheetApp = {
  openById: jest.fn(),
};

(globalThis as any).Utilities = {
  base64Encode: jest.fn().mockReturnValue("base64data=="),
  Charset: { UTF_8: "UTF-8" },
};

(globalThis as any).MimeType = {
  GOOGLE_DOCS: "application/vnd.google-apps.document",
  GOOGLE_SHEETS: "application/vnd.google-apps.spreadsheet",
  PDF: "application/pdf",
};
```

**Step 2: Update the import line**

Replace the import at line 36:

```typescript
import { checkDriveService, extractTextUniversal, prepareDriveAttachments } from "../src/server/drive";
```

(`fetchAndEncodeFile` is removed; `prepareDriveAttachments` is the new public function.)

**Step 3: Replace the `fetchAndEncodeFile` describe block with `prepareDriveAttachments` tests**

Delete the existing `describe("fetchAndEncodeFile", ...)` block and add:

```typescript
describe("prepareDriveAttachments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (globalThis as any).Drive = {
      Files: { export: jest.fn() },
    };
  });

  it("returns empty array for empty input", () => {
    expect(prepareDriveAttachments([])).toEqual([]);
  });

  it("encodes a PDF by fetching its blob directly", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 1024,
      getName: () => "report.pdf",
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    });

    const result = prepareDriveAttachments(["pdfId"]);
    expect(result).toHaveLength(1);
    expect(result[0].mime_type).toBe("application/pdf");
    expect(result[0].data).toBe("base64data==");
  });

  it("encodes an image by fetching its blob directly", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "image/png",
      getSize: () => 512,
      getName: () => "photo.png",
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    });

    const result = prepareDriveAttachments(["imgId"]);
    expect(result).toHaveLength(1);
    expect(result[0].mime_type).toBe("image/png");
  });

  it("encodes a video by fetching its blob directly", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "video/mp4",
      getSize: () => 1024,
      getName: () => "clip.mp4",
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    });

    const result = prepareDriveAttachments(["videoId"]);
    expect(result).toHaveLength(1);
    expect(result[0].mime_type).toBe("video/mp4");
  });

  it("encodes an audio file by fetching its blob directly", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "audio/mpeg",
      getSize: () => 512,
      getName: () => "audio.mp3",
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    });

    const result = prepareDriveAttachments(["audioId"]);
    expect(result).toHaveLength(1);
    expect(result[0].mime_type).toBe("audio/mpeg");
  });

  it("exports a Google Doc as PDF", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/vnd.google-apps.document",
      getName: () => "doc.gdoc",
    });
    (Drive.Files.export as jest.Mock).mockReturnValue({
      getBytes: () => [1, 2, 3],
    });

    const result = prepareDriveAttachments(["docId"]);
    expect(result).toHaveLength(1);
    expect(result[0].mime_type).toBe("application/pdf");
    expect(Drive.Files.export).toHaveBeenCalledWith("docId", "application/pdf");
  });

  it("exports each sheet of a Google Sheets file as a separate CSV part", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/vnd.google-apps.spreadsheet",
      getName: () => "data.gsheet",
    });
    const mockSheet1 = {
      getName: () => "Sheet1",
      getDataRange: () => ({ getValues: () => [["a", "b"], ["1", "2"]] }),
    };
    const mockSheet2 = {
      getName: () => "Sheet2",
      getDataRange: () => ({ getValues: () => [["x", "y"], ["3", "4"]] }),
    };
    (SpreadsheetApp.openById as jest.Mock).mockReturnValue({
      getSheets: () => [mockSheet1, mockSheet2],
    });

    const result = prepareDriveAttachments(["sheetId"]);
    expect(result).toHaveLength(2);
    expect(result[0].mime_type).toBe("text/csv");
    expect(result[1].mime_type).toBe("text/csv");
    expect(Utilities.base64Encode).toHaveBeenCalledTimes(2);
  });

  it("throws a descriptive error for unsupported file types", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/zip",
      getName: () => "archive.zip",
    });

    expect(() => prepareDriveAttachments(["zipId"])).toThrow(
      "Unsupported file type"
    );
  });

  it("throws pre-flight error for PDF exceeding raw size threshold before downloading blob", () => {
    // 36MB raw * 4/3 = 48MB encoded > 47MB INLINE_MAX_PDF_BYTES
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 36 * 1024 * 1024,
      getName: () => "big.pdf",
    });

    expect(() => prepareDriveAttachments(["bigPdfId"])).toThrow(
      "File too large"
    );
    // blob should NOT have been fetched
    expect(DriveApp.getFileById("bigPdfId").getBlob).toBeUndefined();
  });

  it("throws per-PDF error mentioning Files API when encoded PDF exceeds 47MB", () => {
    // Simulate a PDF that passes raw pre-flight but whose encoded form is just over limit.
    // We mock base64Encode to return a large string by making getBytes() large.
    // Easier: just set getSize() just under preflight but mock encoded data as large.
    // Simplest approach: set size just below preflight threshold, then override base64Encode.
    const ALMOST_PREFLIGHT = Math.floor((47 * 1024 * 1024) / (4 / 3)) - 1;
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => ALMOST_PREFLIGHT,
      getName: () => "large.pdf",
      getBlob: () => ({ getBytes: () => new Array(ALMOST_PREFLIGHT).fill(0) }),
    });
    // Return a data string whose .length exceeds INLINE_MAX_PDF_BYTES
    (Utilities.base64Encode as jest.Mock).mockReturnValue(
      "x".repeat(48 * 1024 * 1024)
    );

    expect(() => prepareDriveAttachments(["largePdfId"])).toThrow(
      /PDF.*too large|too large.*PDF/i
    );
  });

  it("throws total request error mentioning Files API when combined encoded size exceeds 95MB", () => {
    // Two images, each fine individually, combined > 95MB encoded
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "image/jpeg",
      getSize: () => 1024,
      getName: () => "img.jpg",
      getBlob: () => ({ getBytes: () => [1, 2, 3] }),
    });
    (Utilities.base64Encode as jest.Mock).mockReturnValue(
      "x".repeat(50 * 1024 * 1024) // 50MB each → 100MB total > 95MB
    );

    expect(() => prepareDriveAttachments(["img1", "img2"])).toThrow(
      /combined|total/i
    );
  });

  it("error messages reference the Gemini Files API escape hatch", () => {
    (DriveApp.getFileById as jest.Mock).mockReturnValue({
      getMimeType: () => "application/pdf",
      getSize: () => 36 * 1024 * 1024,
      getName: () => "big.pdf",
    });

    expect(() => prepareDriveAttachments(["bigPdfId"])).toThrow(
      /Files API/i
    );
  });

  it("returns combined parts from multiple files of different types", () => {
    (DriveApp.getFileById as jest.Mock)
      .mockReturnValueOnce({
        getMimeType: () => "application/pdf",
        getSize: () => 1024,
        getName: () => "doc.pdf",
        getBlob: () => ({ getBytes: () => [1, 2, 3] }),
      })
      .mockReturnValueOnce({
        getMimeType: () => "image/png",
        getSize: () => 512,
        getName: () => "chart.png",
        getBlob: () => ({ getBytes: () => [4, 5, 6] }),
      });

    const result = prepareDriveAttachments(["pdfId", "imgId"]);
    expect(result).toHaveLength(2);
    expect(result[0].mime_type).toBe("application/pdf");
    expect(result[1].mime_type).toBe("image/png");
  });
});
```

**Step 4: Run the new tests to verify they fail**

```bash
npx jest __tests__/drive.test.ts --no-coverage
```

Expected: `prepareDriveAttachments` tests fail with "not exported" or similar. `checkDriveService` and `extractTextUniversal` tests should still pass.

**Step 5: Commit failing tests**

```bash
git add __tests__/drive.test.ts
git commit -m "test: add failing tests for prepareDriveAttachments (TDD)"
```

---

### Task 3: Implement `exportAndEncodeFile` and `prepareDriveAttachments` in `drive.ts`

**Files:**
- Modify: `src/server/drive.ts`

**Step 1: Add the private `exportAndEncodeFile` function**

This handles per-file MIME routing. Add after the existing imports in `drive.ts`:

```typescript
/**
 * Route a single Drive file by MIME type, export or fetch its content,
 * and return base64-encoded inline data parts ready for Gemini.
 *
 * Returns an array because Google Sheets files produce one part per sheet.
 * All other types return a single-element array.
 *
 * Does NOT perform size validation — that is the responsibility of
 * prepareDriveAttachments, which sees the full set of files for a row.
 */
function exportAndEncodeFile(fileId: string): GeminiInlineData[] {
  const file = DriveApp.getFileById(fileId);
  const mimeType = file.getMimeType();

  if (mimeType === MimeType.GOOGLE_DOCS) {
    const pdfBlob = Drive.Files.export(fileId, "application/pdf");
    return [
      {
        mime_type: "application/pdf",
        data: Utilities.base64Encode(pdfBlob.getBytes()),
      },
    ];
  }

  if (mimeType === MimeType.GOOGLE_SHEETS) {
    const ss = SpreadsheetApp.openById(fileId);
    return ss.getSheets().map((sheet) => {
      const values = sheet.getDataRange().getValues();
      const csv = values
        .map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")
        )
        .join("\n");
      return {
        mime_type: "text/csv",
        data: Utilities.base64Encode(csv, Utilities.Charset.UTF_8),
      };
    });
  }

  if (
    mimeType === MimeType.PDF ||
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("audio/")
  ) {
    return [
      {
        mime_type: mimeType,
        data: Utilities.base64Encode(file.getBlob().getBytes()),
      },
    ];
  }

  throw new Error(
    `Unsupported file type: ${mimeType} (${file.getName()}). ` +
      `Supported types: Google Docs, Google Sheets, PDF, image/*, video/*, audio/*.`
  );
}
```

**Step 2: Add the public `prepareDriveAttachments` function**

Add after `exportAndEncodeFile`:

```typescript
/**
 * Prepare all Drive file attachments for a single Gemini inference call.
 *
 * Fetches and encodes each file, then enforces two size validation tiers:
 *
 * Tier 1 — Per-PDF pre-flight (checked before blob download):
 *   Raw file size × INLINE_PREFLIGHT_FACTOR must not exceed INLINE_MAX_PDF_BYTES.
 *   Skipped for Workspace exports (exported size is unknown before export).
 *
 * Tier 2 — Total request check (checked after all files are encoded):
 *   Sum of all encoded part lengths must not exceed INLINE_MAX_TOTAL_BYTES.
 *
 * For files exceeding inline limits, consider the Gemini Files API (up to 2GB,
 * no base64 overhead): https://ai.google.dev/api/files
 * TODO: implement uploadToFilesAPI() and route oversized files here instead of throwing.
 */
export function prepareDriveAttachments(fileIds: string[]): GeminiInlineData[] {
  if (fileIds.length === 0) return [];

  const parts: GeminiInlineData[] = [];

  for (const fileId of fileIds) {
    const file = DriveApp.getFileById(fileId);
    const mimeType = file.getMimeType();

    // Tier 1 pre-flight: check raw size for binary file types before downloading blob.
    // Workspace exports (Docs/Sheets) are skipped — exported size is unknown pre-export.
    if (
      mimeType === MimeType.PDF ||
      mimeType.startsWith("image/") ||
      mimeType.startsWith("video/") ||
      mimeType.startsWith("audio/")
    ) {
      const estimatedEncodedSize = file.getSize() * CONFIG.INLINE_PREFLIGHT_FACTOR;
      if (mimeType === MimeType.PDF && estimatedEncodedSize > CONFIG.INLINE_MAX_PDF_BYTES) {
        throw new Error(
          `File too large: "${file.getName()}" (~${Math.round(file.getSize() / 1024 / 1024)}MB raw). ` +
            `PDFs must be under ~${Math.round(CONFIG.INLINE_MAX_PDF_BYTES / CONFIG.INLINE_PREFLIGHT_FACTOR / 1024 / 1024)}MB raw ` +
            `(${Math.round(CONFIG.INLINE_MAX_PDF_BYTES / 1024 / 1024)}MB encoded). ` +
            `Consider the Gemini Files API for large payloads: https://ai.google.dev/api/files`
        );
      }
    }

    parts.push(...exportAndEncodeFile(fileId));
  }

  // Tier 1 post-encode: verify each individual PDF part is within its per-file limit.
  for (const part of parts) {
    if (part.mime_type === "application/pdf" && part.data.length > CONFIG.INLINE_MAX_PDF_BYTES) {
      throw new Error(
        `PDF too large after encoding (~${Math.round(part.data.length / 1024 / 1024)}MB encoded, ` +
          `limit ${Math.round(CONFIG.INLINE_MAX_PDF_BYTES / 1024 / 1024)}MB). ` +
          `Consider the Gemini Files API for large payloads: https://ai.google.dev/api/files`
      );
    }
  }

  // Tier 2: verify total combined encoded size across all parts.
  const totalEncodedBytes = parts.reduce((sum, part) => sum + part.data.length, 0);
  if (totalEncodedBytes > CONFIG.INLINE_MAX_TOTAL_BYTES) {
    throw new Error(
      `Attachments too large: combined encoded size is ~${Math.round(totalEncodedBytes / 1024 / 1024)}MB, ` +
        `exceeds ${Math.round(CONFIG.INLINE_MAX_TOTAL_BYTES / 1024 / 1024)}MB inline limit. ` +
        `Consider the Gemini Files API for large payloads: https://ai.google.dev/api/files`
    );
  }

  return parts;
}
```

**Step 3: Remove `fetchAndEncodeFile` from `drive.ts`**

Delete the entire `fetchAndEncodeFile` export (lines 72–81 in the original file). It is replaced by the new functions.

**Step 4: Run tests**

```bash
npx jest __tests__/drive.test.ts --no-coverage
```

Expected: all `prepareDriveAttachments` tests pass. `checkDriveService` and `extractTextUniversal` tests still pass.

**Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: one remaining error — `inference.ts` still imports the deleted `fetchAndEncodeFile`. Fix in the next task.

**Step 6: Commit**

```bash
git add src/server/drive.ts
git commit -m "feat: add prepareDriveAttachments with MIME routing and size validation"
```

---

### Task 4: Update `runInference` and its tests

**Files:**
- Modify: `src/server/inference.ts`
- Modify: `__tests__/inference.test.ts`

**Step 1: Update the import in `inference.ts`**

Replace:
```typescript
import { fetchAndEncodeFile } from "./drive";
```
With:
```typescript
import { prepareDriveAttachments } from "./drive";
```

**Step 2: Replace the `inlineData` assembly block in `runInference`**

Replace:
```typescript
const inlineData: GeminiInlineData[] =
  driveLinks !== undefined
    ? flattenArg(driveLinks)
        .filter(isValidDriveLink)
        .map((link) => fetchAndEncodeFile(extractId(link)))
    : [];
```
With:
```typescript
const inlineData: GeminiInlineData[] =
  driveLinks !== undefined
    ? prepareDriveAttachments(
        flattenArg(driveLinks).filter(isValidDriveLink).map(extractId)
      )
    : [];
```

Also remove the `GeminiInlineData` import from `inference.ts` if it is now unused (it was only used for the type annotation on the `inlineData` variable, which TypeScript can now infer).

**Step 3: Update the mock setup in `inference.test.ts`**

The existing DriveApp mock returns a PDF file with `getSize: () => 1000` — this is compatible with the new pre-flight check (1000 bytes is well under the limit). No structural change needed.

However, the `Drive.Files.export` mock must exist since `prepareDriveAttachments` calls `DriveApp.getFileById` which may hit the export path. Add it to the globals block at the top of `inference.test.ts` (before imports):

```typescript
(globalThis as any).Drive = {
  Files: { export: jest.fn() },
};

(globalThis as any).SpreadsheetApp = {
  openById: jest.fn(),
};

(globalThis as any).MimeType = {
  GOOGLE_DOCS: "application/vnd.google-apps.document",
  GOOGLE_SHEETS: "application/vnd.google-apps.spreadsheet",
  PDF: "application/pdf",
};
```

**Step 4: Run all tests**

```bash
npm test
```

Expected: all 262+ tests pass (plus the new drive tests).

**Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: clean.

**Step 6: Commit**

```bash
git add src/server/inference.ts __tests__/inference.test.ts
git commit -m "refactor: wire runInference to prepareDriveAttachments"
```

---

### Task 5: Final verification

**Step 1: Run full test suite with coverage**

```bash
npm run test:coverage
```

Expected: all tests pass, per-file coverage thresholds met.

**Step 2: Run lint**

```bash
npm run lint
```

Expected: no errors.

**Step 3: Build**

```bash
npm run build
```

Expected: clean build to `dist/`.

**Step 4: Commit design doc (if not already committed)**

```bash
git add docs/plans/2026-03-17-drive-file-handling-redesign.md docs/plans/2026-03-17-drive-file-handling-redesign-plan.md
git commit -m "docs: add drive file handling redesign spec and implementation plan"
```
