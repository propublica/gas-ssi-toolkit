# AI Column Visibility Markers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply temporary column protection during `runBatchAI` execution and permanent amber highlighting to all cells it writes, so AI-generated content is visually distinct and marked as needing verification.

**Architecture:** Two new exported helpers in `utils.ts` (`protectAIOutputRange`, `markAIOutputRange`) are called from `runBatchAI` in `index.ts`. Protection wraps the write phase in a try/finally; amber marking is applied after `SpreadsheetApp.flush()` inside the try. Both helpers accept the `sheet` object as a parameter so they can be unit-tested with duck-typed fakes.

**Tech Stack:** Google Apps Script Spreadsheet API (`Range.protect()`, `Range.setBackground()`, `Range.setNote()`), Jest with ts-jest, TypeScript.

---

### Task 1: Add `protectAIOutputRange` helper (TDD)

**Files:**
- Create: `__tests__/utils-ai-marking.test.ts`
- Modify: `src/server/utils.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/utils-ai-marking.test.ts`:

```ts
import { protectAIOutputRange } from "@server/utils";

function makeProtection(): {
  setDescription: jest.Mock;
  remove: jest.Mock;
} {
  const p = { setDescription: jest.fn(), remove: jest.fn() };
  p.setDescription.mockReturnValue(p);
  return p;
}

describe("protectAIOutputRange", () => {
  it("protects the header cell and data range as separate ranges", () => {
    const headerProtection = makeProtection();
    const dataProtection = makeProtection();

    const mockSheet = {
      getRange: jest.fn()
        .mockReturnValueOnce({ protect: jest.fn().mockReturnValue(headerProtection) })
        .mockReturnValueOnce({ protect: jest.fn().mockReturnValue(dataProtection) }),
    };

    const result = protectAIOutputRange(
      mockSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet,
      3,   // colIdx (1-based)
      5,   // startRow
      10,  // numRows
    );

    expect(mockSheet.getRange).toHaveBeenNthCalledWith(1, 1, 3);
    expect(mockSheet.getRange).toHaveBeenNthCalledWith(2, 5, 3, 10, 1);
    expect(headerProtection.setDescription).toHaveBeenCalledWith("AI run in progress — please wait");
    expect(dataProtection.setDescription).toHaveBeenCalledWith("AI run in progress — please wait");
    expect(result).toEqual([headerProtection, dataProtection]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/utils-ai-marking.test.ts --no-coverage
```

Expected: FAIL with `SyntaxError` or `Cannot find module '@server/utils'` exporting `protectAIOutputRange` — confirms the export doesn't exist yet.

- [ ] **Step 3: Implement `protectAIOutputRange` in `src/server/utils.ts`**

Add at the end of `src/server/utils.ts`:

```ts
/**
 * Protect the output column header and data rows during an AI run.
 * Returns both Protection objects so the caller can remove them in a finally block.
 * Two separate ranges are used because the header (row 1) and data rows are
 * non-contiguous when startRow > 2.
 */
export function protectAIOutputRange(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  colIdx: number,
  startRow: number,
  numRows: number,
): GoogleAppsScript.Spreadsheet.Protection[] {
  const desc = "AI run in progress — please wait";
  const headerProtection = sheet.getRange(1, colIdx).protect().setDescription(desc);
  const dataProtection = sheet.getRange(startRow, colIdx, numRows, 1).protect().setDescription(desc);
  return [headerProtection, dataProtection];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx jest __tests__/utils-ai-marking.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add __tests__/utils-ai-marking.test.ts src/server/utils.ts
git commit -m "feat: add protectAIOutputRange helper"
```

---

### Task 2: Add `markAIOutputRange` helper (TDD)

**Files:**
- Modify: `__tests__/utils-ai-marking.test.ts`
- Modify: `src/server/utils.ts`

- [ ] **Step 1: Add the failing test**

Append to `__tests__/utils-ai-marking.test.ts`:

```ts
import { protectAIOutputRange, markAIOutputRange } from "@server/utils";
```

Update the import line at the top of the file to include `markAIOutputRange`, then add a new `describe` block:

```ts
describe("markAIOutputRange", () => {
  it("sets amber background and note on header, light amber wash on data cells", () => {
    const headerRange = { setBackground: jest.fn(), setNote: jest.fn() };
    const dataRange = { setBackground: jest.fn() };

    const mockSheet = {
      getRange: jest.fn()
        .mockReturnValueOnce(headerRange)
        .mockReturnValueOnce(dataRange),
    };

    markAIOutputRange(
      mockSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet,
      3,   // colIdx (1-based)
      5,   // startRow
      10,  // numRows
    );

    expect(mockSheet.getRange).toHaveBeenNthCalledWith(1, 1, 3);
    expect(headerRange.setBackground).toHaveBeenCalledWith("#F9AB00");
    expect(headerRange.setNote).toHaveBeenCalledWith(
      "AI-generated by Gemini — verify before publishing",
    );

    expect(mockSheet.getRange).toHaveBeenNthCalledWith(2, 5, 3, 10, 1);
    expect(dataRange.setBackground).toHaveBeenCalledWith("#FFF8E1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/utils-ai-marking.test.ts --no-coverage
```

Expected: FAIL — `markAIOutputRange` is not exported from `@server/utils`.

- [ ] **Step 3: Implement `markAIOutputRange` in `src/server/utils.ts`**

Add after `protectAIOutputRange` at the end of `src/server/utils.ts`:

```ts
/**
 * Apply amber background to the output column header and data rows after an AI run,
 * and add a note to the header explaining the content is AI-generated.
 * Called after SpreadsheetApp.flush() so it lands in the same visual update.
 */
export function markAIOutputRange(
  sheet: GoogleAppsScript.Spreadsheet.Sheet,
  colIdx: number,
  startRow: number,
  numRows: number,
): void {
  const header = sheet.getRange(1, colIdx);
  header.setBackground("#F9AB00");
  header.setNote("AI-generated by Gemini — verify before publishing");
  sheet.getRange(startRow, colIdx, numRows, 1).setBackground("#FFF8E1");
}
```

- [ ] **Step 4: Run all tests to verify nothing broke**

```bash
npx jest --no-coverage
```

Expected: All 489 existing tests pass, plus the 2 new ones (491 total).

- [ ] **Step 5: Commit**

```bash
git add __tests__/utils-ai-marking.test.ts src/server/utils.ts
git commit -m "feat: add markAIOutputRange helper"
```

---

### Task 3: Wire helpers into `runBatchAI`

**Files:**
- Modify: `src/server/index.ts`

`index.ts` is excluded from unit test coverage (it's coupled to SpreadsheetApp UI globals). Correctness is verified via typecheck and build.

- [ ] **Step 1: Update the import from `./utils`**

In `src/server/index.ts`, find the import block that lists utils functions (currently ends with `flattenArg`). Add the two new helpers:

```ts
import {
  extractId,
  isValidDriveLink,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  resolveColumns,
  findOrCreateColumn,
  writeColumn,
  writeJobProgress,
  interpolateTemplate,
  flattenArg,
  protectAIOutputRange,
  markAIOutputRange,
} from "./utils";
```

- [ ] **Step 2: Wrap the write phase in `runBatchAI`**

Inside `runBatchAI`, locate the block that builds `allPromptInputs` (around line 352). Immediately after it — and before the `// Wave 1` comment — add the protection call and open the `try` block. Then close with `finally` at the end of the function.

Replace from `// Wave 1 — file work` through the end of `runBatchAI` with:

```ts
  const protections = protectAIOutputRange(sheet, outputIdx + 1, startRow, numRows);
  try {
    // Wave 1 — file work (multimodal chunks only)
    const fileUriMap = new Map<string, { uri: string; mimeType: string }>();
    let fileErrors = new Map<string, string>();

    if (hasFileInputs) {
      const oauthToken = ScriptApp.getOAuthToken();

      const allFileIds = new Set<string>();
      for (const inputs of allPromptInputs) {
        for (const input of inputs) {
          if (input.kind === "file") {
            flattenArg(input.value)
              .filter(isValidDriveLink)
              .map(extractId)
              .forEach((id) => allFileIds.add(id));
          }
        }
      }

      const fileIds = Array.from(allFileIds);
      if (fileIds.length > 0) {
        if (jobId) {
          writeJobProgress(cache, jobId, {
            message: `Downloading files for rows ${startRow}–${startRow + numRows - 1}...`,
          });
        }
        const { metadata, errors: metadataErrors } = fetchDriveMetadata(fileIds, oauthToken);

        const downloadIds = fileIds.filter((id) => metadata.has(id));

        const DOCS_DRIVE_MIME = "application/vnd.google-apps.document";
        const SHEETS_DRIVE_MIME = "application/vnd.google-apps.spreadsheet";

        const allDownloadErrors = new Map<string, string>();
        const allUploadErrors = new Map<string, string>();
        for (let bStart = 0; bStart < downloadIds.length; bStart += FILE_PIPELINE_BATCH_SIZE) {
          const batchIds = downloadIds.slice(bStart, bStart + FILE_PIPELINE_BATCH_SIZE);
          if (jobId) {
            writeJobProgress(cache, jobId, {
              message: `Processing files ${bStart + 1}–${Math.min(bStart + FILE_PIPELINE_BATCH_SIZE, downloadIds.length)} of ${downloadIds.length}...`,
            });
          }
          const batchMetadata = new Map(batchIds.map((id) => [id, metadata.get(id)!]));
          const { bytes: batchBytes, errors: batchDownloadErrors } = downloadDriveFiles(
            batchIds,
            batchMetadata,
            oauthToken,
          );
          for (const [id, err] of batchDownloadErrors) allDownloadErrors.set(id, err);

          const batchUploadIds = batchIds.filter((id) => batchBytes.has(id));
          const batchMimeTypes = new Map(
            batchUploadIds.map((id) => {
              const driveMime = metadata.get(id)!.mimeType;
              let effectiveMime = driveMime;
              if (driveMime === DOCS_DRIVE_MIME) effectiveMime = "application/pdf";
              else if (driveMime === SHEETS_DRIVE_MIME) effectiveMime = "text/csv";
              return [id, effectiveMime];
            }),
          );
          const { uploads: batchUploads, errors: batchUploadErrors } = uploadFilesToGemini(
            batchBytes,
            batchMimeTypes,
            apiKey,
          );
          batchBytes.clear();
          for (const [id, info] of batchUploads) fileUriMap.set(id, info);
          for (const [id, err] of batchUploadErrors) allUploadErrors.set(id, err);
        }
        fileErrors = new Map([...metadataErrors, ...allDownloadErrors, ...allUploadErrors]);
      }
    }

    // Wave 2 — build requests and fire inference in parallel
    if (jobId) {
      writeJobProgress(cache, jobId, {
        message: `Running AI on rows ${startRow}–${startRow + numRows - 1}...`,
      });
    }

    const requests: GeminiRequest[] = [];
    const rowIndices: number[] = [];
    const directWrites = new Map<number, string>();

    for (let i = 0; i < allPromptInputs.length; i++) {
      if (fileErrors.size > 0) {
        const failedIds = allPromptInputs[i]
          .filter((inp) => inp.kind === "file")
          .flatMap((inp) => flattenArg(inp.value).filter(isValidDriveLink).map(extractId))
          .filter((id) => fileErrors.has(id));
        if (failedIds.length > 0) {
          directWrites.set(i, `[File error: ${fileErrors.get(failedIds[0])}]`);
          continue;
        }
      }

      const systemPrompt = systemPromptIdx >= 0 ? dataValues[i][systemPromptIdx] : undefined;
      const req = buildInferenceRequest(
        allPromptInputs[i],
        systemPrompt,
        config.tools,
        hasFileInputs ? fileUriMap : undefined,
      );
      if (req !== null) {
        requests.push({ ...req, apiKey });
        rowIndices.push(i);
      }
    }

    if (requests.length === 0 && directWrites.size === 0) {
      SpreadsheetApp.getActive().toast("No rows to process.", "Info", 5);
      return;
    }

    const results = requests.length > 0 ? callGeminiAPIBatch(requests) : [];

    for (let j = 0; j < results.length; j++) {
      const i = rowIndices[j];
      const realRowIndex = startRow + i;
      const result = results[j];

      if (config.applyMarkdown) {
        try {
          sheet
            .getRange(realRowIndex, outputIdx + 1)
            .setRichTextValue(toCellValue(buildRichInferenceCellContent(result)));
        } catch (_e) {
          sheet.getRange(realRowIndex, outputIdx + 1).setValue(result.text);
        }
      } else {
        sheet.getRange(realRowIndex, outputIdx + 1).setValue(result.text);
      }

      if (config.includeGrounding && groundingIdx >= 0) {
        const groundingContent = buildRichGroundingCellContent(result);
        if (groundingContent !== null) {
          sheet
            .getRange(realRowIndex, groundingIdx + 1)
            .setRichTextValue(toCellValue(groundingContent));
        }
      }
    }

    for (const [i, errorText] of directWrites) {
      sheet.getRange(startRow + i, outputIdx + 1).setValue(errorText);
    }

    SpreadsheetApp.flush();
    markAIOutputRange(sheet, outputIdx + 1, startRow, numRows);

    const successCount = results.filter((r) => !r.text.startsWith("Error:")).length;
    const errorCount = results.length - successCount + directWrites.size;
    SpreadsheetApp.getActive().toast(
      errorCount === 0
        ? `Complete! Processed ${results.length} rows.`
        : `Complete! Processed ${successCount} of ${results.length + directWrites.size} rows (${errorCount} errors).`,
      "Success",
      5,
    );
  } finally {
    protections.forEach((p) => p.remove());
  }
}
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: No errors.

- [ ] **Step 4: Run full test suite**

```bash
npx jest --no-coverage
```

Expected: All 491 tests pass.

- [ ] **Step 5: Build**

```bash
npm run build
```

Expected: Clean build with no errors, `dist/` updated.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: protect and amber-mark AI output column during runBatchAI"
```
