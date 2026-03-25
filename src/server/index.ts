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
import { runInference } from "./inference";
import {
  buildRichInferenceCellContent,
  buildRichGroundingCellContent,
  type CellContent,
} from "./rich-text";
import { checkDriveService, extractTextUniversal } from "./drive";
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
} from "./utils";
import type {
  RunConfig,
  PrepRecipeParams,
  PrepRecipeResult,
  ImportDriveLinksConfig,
  ExtractTextConfig,
} from "../shared/types";
import type { DriveFileInfo } from "./types";

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

  // Resolve all userPromptParts columns once before the row loop
  const partCols = config.userPromptParts.map((p) => p.col);
  const partIdxs = resolveColumns(headers, partCols);
  const missingParts = partCols.filter((_, i) => partIdxs[i] === -1);
  if (missingParts.length > 0) {
    ui.alert(
      "Error: Missing Columns",
      `Could not find columns: ${missingParts.join(", ")}`,
      ui.ButtonSet.OK,
    );
    return;
  }

  // Build a header→0-based-index map for O(1) lookup inside the row loop
  const resolvedCols: Record<string, number> = {};
  config.userPromptParts.forEach((p, i) => {
    resolvedCols[p.col] = partIdxs[i];
  });

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

  const totalRows = dataValues.length;
  let processed = 0;

  for (let i = 0; i < dataValues.length; i++) {
    const row = dataValues[i];
    const realRowIndex = startRow + i;

    if (jobId) {
      writeJobProgress(CacheService.getUserCache(), jobId, {
        message: `Processing row ${i + 1} of ${totalRows}`,
        current: i + 1,
        total: totalRows,
      });
    }

    // Build parts for this row in declared order
    const rowParts = config.userPromptParts.map((part) => ({
      kind: part.kind,
      value: row[resolvedCols[part.col]],
    }));
    const systemPrompt = systemPromptIdx >= 0 ? row[systemPromptIdx] : undefined;

    const result = runInference(rowParts, systemPrompt, config.tools);
    if (result === null) continue;

    if (config.applyMarkdown) {
      try {
        sheet
          .getRange(realRowIndex, outputIdx + 1)
          .setRichTextValue(toCellValue(buildRichInferenceCellContent(result)));
      } catch (_e) {
        // Fall back to plain text if rich text rendering fails for this row.
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

    processed++;
    SpreadsheetApp.flush();
  }

  SpreadsheetApp.getActive().toast(`Complete! Processed ${processed} rows.`, "Success", 5);
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

export function prepRecipe(params: PrepRecipeParams): PrepRecipeResult {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  let numRows = 1;
  const resultColumns: PrepRecipeResult["columns"] = [];

  for (const col of params.columns) {
    switch (col.kind) {
      case "drive-file-folder": {
        const folderId = extractId(col.url);
        const folder = DriveApp.getFolderById(folderId);
        const files: { url: string }[] = [];
        getAllFilesRecursive(folder, files);
        numRows = files.length || 1;
        const colIdx = findOrCreateColumn(sheet, col.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
        writeColumn(
          sheet,
          colIdx,
          files.map((f) => f.url),
          SpreadsheetApp.WrapStrategy.CLIP,
        );
        resultColumns.push({ kind: col.kind, colTitle: col.colTitle });
        break;
      }
      case "drive-file-constant": {
        const colIdx = findOrCreateColumn(sheet, col.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
        writeColumn(
          sheet,
          colIdx,
          Array(numRows).fill(col.url) as string[],
          SpreadsheetApp.WrapStrategy.CLIP,
        );
        resultColumns.push({ kind: col.kind, colTitle: col.colTitle });
        break;
      }
      case "system-prompt": {
        const colIdx = findOrCreateColumn(sheet, col.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
        writeColumn(
          sheet,
          colIdx,
          Array(numRows).fill(col.text) as string[],
          SpreadsheetApp.WrapStrategy.CLIP,
        );
        resultColumns.push({ kind: col.kind, colTitle: col.colTitle });
        break;
      }
      case "user-prompt": {
        const colIdx = findOrCreateColumn(sheet, col.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
        writeColumn(
          sheet,
          colIdx,
          Array(numRows).fill(col.text) as string[],
          SpreadsheetApp.WrapStrategy.CLIP,
        );
        resultColumns.push({ kind: col.kind, colTitle: col.colTitle });
        break;
      }
      case "output": {
        findOrCreateColumn(sheet, col.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
        resultColumns.push({ kind: col.kind, colTitle: col.colTitle });
        break;
      }
    }
  }

  SpreadsheetApp.flush();

  return {
    rowRange: { start: 2, end: 2 + numRows - 1 },
    columns: resultColumns,
    settings: params.settings,
  };
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
