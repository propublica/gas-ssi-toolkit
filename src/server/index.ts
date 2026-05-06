/**
 * index.ts — Entry point for SSI Drive & AI Tools.
 *
 * This file contains the top-level tool functions (the ones users invoke
 * from the menu) and exposes them to Apps Script via globalThis.
 *
 * Business logic is imported from sibling modules. Only this file should
 * assign to `global.*` — that's the contract with Rollup's IIFE output.
 */

export { SSI } from "./customFunctions";
import { callGeminiAPIBatch } from "./api";
import {
  fetchDriveMetadata,
  downloadDriveFiles,
  checkDriveService,
  extractTextUniversal,
} from "./drive";
import { uploadFilesToGemini } from "./files";
import { buildInferenceRequest } from "./inference";
import {
  buildRichInferenceCellContent,
  buildRichGroundingCellContent,
  type CellContent,
} from "./rich-text";
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
} from "./utils";
import { CONFIG } from "./config";
import type {
  RunConfig,
  PrepRecipeParams,
  PrepRecipeResult,
  ImportDriveLinksConfig,
  ExtractTextConfig,
} from "../shared/types";
import type { DriveFileInfo, PromptInput, GeminiRequest } from "./types";

// ==========================================
// 🚀 MENU & INITIALIZATION
// ==========================================

export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("⚡ SSI Toolkit")
    .addItem("🚀 Open SSI Toolkit", "showSidebar")
    .addToUi();
}

/**
 * Ensures the menu appears immediately after the user installs the add-on
 * from the marketplace, without requiring a refresh.
 */
export function onInstall(): void {
  onOpen();
}

// ==========================================
// 🖥️ UI HANDLERS
// ==========================================

export function getSheetHeaders(): string[] {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0] as string[];
}

export function showSidebar(): void {
  const html = HtmlService.createTemplateFromFile("Sidebar");
  const output = html.evaluate().setTitle("SSI Toolkit").setWidth(300);
  SpreadsheetApp.getUi().showSidebar(output);
}

// ==========================================
// 📂 TOOL 1: IMPORT DRIVE LINKS
// ==========================================

export function importDriveLinks(config: ImportDriveLinksConfig, jobId?: string): void {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const folderId = extractId(config.folderUrl);

  if (jobId) {
    writeJobProgress(CacheService.getUserCache(), jobId, { message: "Scanning folder..." });
  }

  const parentFolder = DriveApp.getFolderById(folderId);
  const allFiles: DriveFileInfo[] = [];
  getAllFilesRecursive(parentFolder, allFiles, config.mimeTypes);

  const col = findOrCreateColumn(sheet, config.outputCol, SpreadsheetApp.WrapStrategy.CLIP);
  writeColumn(
    sheet,
    col,
    allFiles.map((f) => f.url),
  );
  SpreadsheetApp.getActive().toast(
    `Imported ${allFiles.length} link${allFiles.length === 1 ? "" : "s"} into "${config.outputCol}".`,
    "Complete",
    5,
  );
}

// ==========================================
// 📝 TOOL 2: EXTRACT TEXT
// ==========================================

export function extractText(config: ExtractTextConfig, jobId?: string): void {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (!checkDriveService(SpreadsheetApp.getUi())) return;

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0] as string[];
  const sourceColIdx = headers.indexOf(config.sourceCol);

  if (sourceColIdx === -1) {
    throw new Error(`Column "${config.sourceCol}" not found`);
  }

  const outputCol = findOrCreateColumn(sheet, config.outputCol, SpreadsheetApp.WrapStrategy.WRAP);

  let startRow: number;
  let total: number;
  if (config.rowRange) {
    startRow = config.rowRange.start;
    total = config.rowRange.end - config.rowRange.start + 1;
  } else {
    const activeRange = sheet.getActiveRange();
    if (!activeRange) return;
    startRow = activeRange.getRow();
    total = activeRange.getNumRows();
  }

  for (let i = 0; i < total; i++) {
    const rowIdx = startRow + i; // sheet row number (1-indexed; start=2 = first data row)

    if (jobId) {
      writeJobProgress(CacheService.getUserCache(), jobId, {
        message: `Extracting row ${i + 1} of ${total}...`,
        current: i + 1,
        total,
      });
    }

    const cellValue = sheet.getRange(rowIdx, sourceColIdx + 1).getValue() as string;

    if (!isValidDriveLink(cellValue)) {
      continue;
    }

    const fileId = extractId(cellValue);
    const text = truncateText(extractTextUniversal(fileId), 49000);
    sheet.getRange(rowIdx, outputCol).setValue(text);
    SpreadsheetApp.flush();
  }
}

// ==========================================
// 🎲 TOOL 3: DYNAMIC SAMPLING
// ==========================================

export function sampleRowsToEvaluation(_jobId?: string): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sourceSheet = ss.getActiveSheet();
  const sourceName = sourceSheet.getName();

  const targetName = `${sourceName}_evaluation`;
  let targetSheet = ss.getSheetByName(targetName);

  const lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) {
    ui.alert("Error", `The sheet "${sourceName}" appears to be empty.`, ui.ButtonSet.OK);
    return;
  }

  const allData = sourceSheet.getRange(2, 1, lastRow - 1, sourceSheet.getLastColumn()).getValues();

  // Sample size
  const countResponse = ui.prompt(
    "Sample Data",
    `Found ${allData.length} rows in "${sourceName}".\nHow many rows would you like to sample to "${targetName}"?`,
    ui.ButtonSet.OK_CANCEL,
  );
  if (countResponse.getSelectedButton() !== ui.Button.OK) return;

  const sampleSize = parseInt(countResponse.getResponseText());
  if (isNaN(sampleSize) || sampleSize < 1 || sampleSize > allData.length) {
    ui.alert(
      "Error",
      `Please enter a valid number between 1 and ${allData.length}.`,
      ui.ButtonSet.OK,
    );
    return;
  }

  // Seed
  const seedResponse = ui.prompt(
    "Random Seed",
    "Enter a seed number for reproducibility (default: 42):",
    ui.ButtonSet.OK_CANCEL,
  );
  if (seedResponse.getSelectedButton() !== ui.Button.OK) return;
  const seed = parseInt(seedResponse.getResponseText()) || 42;

  // Create target sheet if missing
  if (!targetSheet) {
    targetSheet = ss.insertSheet(targetName);
    const headers = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues();
    targetSheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }

  const selectedRows = sampleRows(allData, sampleSize, seed);

  // Write to target
  const targetRow = targetSheet.getLastRow() + 1;
  targetSheet
    .getRange(targetRow, 1, selectedRows.length, selectedRows[0].length)
    .setValues(selectedRows);

  ss.setActiveSheet(targetSheet);
  ui.alert(
    "Success",
    `Copied ${sampleSize} rows from "${sourceName}" to "${targetName}" using seed ${seed}.`,
    ui.ButtonSet.OK,
  );
}

// ==========================================
// 🧠 TOOL 4: AI BATCH PROCESSOR
// ==========================================

function toCellValue(content: CellContent): GoogleAppsScript.Spreadsheet.RichTextValue {
  const builder = SpreadsheetApp.newRichTextValue().setText(content.text);
  content.ranges.forEach(({ startIndex, endIndex, bold, italic, url }) => {
    if (bold === true || italic === true) {
      const style = SpreadsheetApp.newTextStyle();
      if (bold === true) style.setBold(true);
      if (italic === true) style.setItalic(true);
      builder.setTextStyle(startIndex, endIndex, style.build());
    }
    if (url) builder.setLinkUrl(startIndex, endIndex, url);
  });
  return builder.build();
}

export function runBatchAI(config: RunConfig, jobId?: string): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  const headers = getSheetHeaders();
  if (headers.length === 0) {
    ui.alert("Error", "The active sheet has no column headers.", ui.ButtonSet.OK);
    return;
  }

  // Validate prompt columns (required — at least one)
  const promptIdxs = resolveColumns(
    headers,
    config.promptCols.map((pc) => pc.col),
  );
  const missingPromptCols = config.promptCols
    .filter((_, i) => promptIdxs[i] === -1)
    .map((pc) => pc.col);
  if (config.promptCols.length === 0 || missingPromptCols.length > 0) {
    ui.alert(
      "Error: Missing Columns",
      missingPromptCols.length > 0
        ? `Could not find columns: ${missingPromptCols.join(", ")}`
        : "Please select at least one prompt column.",
      ui.ButtonSet.OK,
    );
    return;
  }

  // Validate system prompt column (if selected)
  let systemPromptIdx = -1;
  if (config.systemPromptCol) {
    const idxs = resolveColumns(headers, [config.systemPromptCol]);
    if (idxs[0] === -1) {
      ui.alert(
        "Error: Missing Columns",
        `Could not find column: ${config.systemPromptCol}`,
        ui.ButtonSet.OK,
      );
      return;
    }
    systemPromptIdx = idxs[0];
  }

  // Resolve output column — create if not found
  let outputIdx = headers.indexOf(config.outputCol);
  if (outputIdx === -1) {
    const newColIdx = sheet.getLastColumn() + 1;
    sheet.getRange(1, newColIdx).setValue(config.outputCol);
    outputIdx = newColIdx - 1;
    headers.push(config.outputCol); // keep in sync, matching grounding column pattern
  }

  // Resolve grounding column — create if not found (only when opted in)
  let groundingIdx = -1;
  const groundingColName = config.outputCol + "_grounding";
  if (config.includeGrounding) {
    groundingIdx = headers.indexOf(groundingColName);
    if (groundingIdx === -1) {
      const newColIdx = sheet.getLastColumn() + 1;
      sheet.getRange(1, newColIdx).setValue(groundingColName);
      groundingIdx = newColIdx - 1;
      headers.push(groundingColName); // keep in sync for subsequent rows
    }
  }

  // Determine row range
  let startRow: number;
  let numRows: number;
  if (config.rowRange) {
    startRow = config.rowRange.start;
    numRows = config.rowRange.end - config.rowRange.start + 1;
  } else {
    const range = sheet.getActiveRange();
    if (!range) return;
    startRow = range.getRow();
    numRows = range.getNumRows();
  }

  const dataValues = sheet.getRange(startRow, 1, numRows, sheet.getLastColumn()).getValues();

  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
  if (!apiKey) {
    ui.alert("Error", `${CONFIG.API_KEY_PROPERTY} script property not set`, ui.ButtonSet.OK);
    return;
  }

  const cache = CacheService.getUserCache();
  const hasFileInputs = config.promptCols.some((pc) => pc.kind === "file");

  // Build all prompt input arrays (one per row) — pure, no I/O
  const allPromptInputs: PromptInput[][] = dataValues.map((row) =>
    config.promptCols.map((pc, colIdx) => ({
      kind: pc.kind,
      value: row[promptIdxs[colIdx]],
      ...(config.prefixWithColName ? { label: pc.col } : {}),
    })),
  );

  // Wave 1 — file work (multimodal chunks only)
  let fileUriMap = new Map<string, { uri: string; mimeType: string }>();
  let fileErrors = new Map<string, string>();

  if (hasFileInputs) {
    const oauthToken = ScriptApp.getOAuthToken();

    // Collect unique Drive file IDs across all rows in this chunk
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

      // Only attempt to download files whose metadata was successfully fetched
      const downloadIds = fileIds.filter((id) => metadata.has(id));
      const { bytes, errors: downloadErrors } = downloadDriveFiles(
        downloadIds,
        metadata,
        oauthToken,
      );

      if (jobId) {
        writeJobProgress(cache, jobId, {
          message: `Uploading files for rows ${startRow}–${startRow + numRows - 1}...`,
        });
      }
      // Translate Drive native MIME types to exported MIME types.
      // downloadDriveFiles exports Docs as PDF and Sheets as CSV, so we must use those
      // MIME types when uploading to Gemini, not the native Drive types.
      const DOCS_DRIVE_MIME = "application/vnd.google-apps.document";
      const SHEETS_DRIVE_MIME = "application/vnd.google-apps.spreadsheet";
      const uploadIds = downloadIds.filter((id) => bytes.has(id));
      const mimeTypes = new Map(
        uploadIds.map((id) => {
          const driveMime = metadata.get(id)!.mimeType;
          let effectiveMime = driveMime;
          if (driveMime === DOCS_DRIVE_MIME) effectiveMime = "application/pdf";
          else if (driveMime === SHEETS_DRIVE_MIME) effectiveMime = "text/csv";
          return [id, effectiveMime];
        }),
      );
      const uploadBytes = new Map(uploadIds.map((id) => [id, bytes.get(id)!]));
      const { uploads, errors: uploadErrors } = uploadFilesToGemini(uploadBytes, mimeTypes, apiKey);
      fileUriMap = uploads;
      fileErrors = new Map([...metadataErrors, ...downloadErrors, ...uploadErrors]);
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

  for (let i = 0; i < allPromptInputs.length; i++) {
    // If any file input for this row failed to fetch/download/upload, write the
    // error directly to the output cell and skip inference for this row.
    if (fileErrors.size > 0) {
      const failedIds = allPromptInputs[i]
        .filter((inp) => inp.kind === "file")
        .flatMap((inp) => flattenArg(inp.value).filter(isValidDriveLink).map(extractId))
        .filter((id) => fileErrors.has(id));
      if (failedIds.length > 0) {
        sheet
          .getRange(startRow + i, outputIdx + 1)
          .setValue(`[File error: ${fileErrors.get(failedIds[0])}]`);
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

  if (requests.length === 0) {
    SpreadsheetApp.getActive().toast("No rows to process.", "Info", 5);
    return;
  }

  const results = callGeminiAPIBatch(requests);

  // Write all results — single flush at end of chunk
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

  SpreadsheetApp.flush();
  const successCount = results.filter((r) => !r.text.startsWith("Error:")).length;
  SpreadsheetApp.getActive().toast(
    successCount === results.length
      ? `Complete! Processed ${results.length} rows.`
      : `Complete! Processed ${successCount} of ${results.length} rows (${results.length - successCount} errors).`,
    "Success",
    5,
  );
}

// ==========================================
// 🔀 SIDEBAR DISPATCHER
// ==========================================

export function runTool(functionName: string, jobId?: string): void {
  const TOOLS: Record<string, (jobId?: string) => void> = {
    sampleRowsToEvaluation,
  };
  TOOLS[functionName]?.(jobId);
}

// ==========================================
// RECIPE PREP
// ==========================================

export function prepRecipe({ cols, inputValues }: PrepRecipeParams): PrepRecipeResult {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  let numRows = 1;

  // Pass 1: scan Drive folders, cache results, determine numRows
  const folderCache = new Map<string, string[]>();
  for (const col of cols) {
    if (col.fillStrategy.kind === "list-drive-folder") {
      const url = inputValues[col.fillStrategy.inputId] ?? "";
      if (!folderCache.has(url)) {
        const folder = DriveApp.getFolderById(extractId(url));
        const files: { url: string }[] = [];
        getAllFilesRecursive(folder, files);
        folderCache.set(
          url,
          files.map((f) => f.url),
        );
      }
      numRows = Math.max(numRows, folderCache.get(url)!.length || 1);
    }
  }

  // Pass 2: write all columns
  for (const col of cols) {
    const colIdx = findOrCreateColumn(sheet, col.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
    switch (col.fillStrategy.kind) {
      case "list-drive-folder": {
        const urls = folderCache.get(inputValues[col.fillStrategy.inputId] ?? "") ?? [];
        writeColumn(sheet, colIdx, urls, SpreadsheetApp.WrapStrategy.CLIP);
        break;
      }
      case "fill-value":
        writeColumn(
          sheet,
          colIdx,
          Array(numRows).fill(col.fillStrategy.value) as string[],
          SpreadsheetApp.WrapStrategy.CLIP,
        );
        break;
      case "template": {
        const resolved = interpolateTemplate(col.fillStrategy.template, inputValues);
        writeColumn(
          sheet,
          colIdx,
          Array(numRows).fill(resolved) as string[],
          SpreadsheetApp.WrapStrategy.CLIP,
        );
        break;
      }
      case "create-empty":
        break;
    }
  }

  SpreadsheetApp.flush();
  return { rowRange: { start: 2, end: 2 + numRows - 1 } };
}

// ==========================================
// JOB PROGRESS
// ==========================================

export function getJobProgress(
  jobId: string,
): { message?: string; current?: number; total?: number } | null {
  const raw = CacheService.getUserCache().get(jobId);
  if (!raw) return null;
  return JSON.parse(raw) as { message?: string; current?: number; total?: number };
}
