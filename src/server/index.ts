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
} from "./utils";
import type { RunConfig, PrepRecipeParams, PrepRecipeResult } from "../shared/types";

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

export function importDriveLinks(): void {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // 1. Get Folder
  const folderResponse = ui.prompt(
    "Step 1/2: Select Folder",
    "Paste the Google Drive Folder Link or ID:",
    ui.ButtonSet.OK_CANCEL,
  );
  if (folderResponse.getSelectedButton() !== ui.Button.OK) return;
  const folderId = extractId(folderResponse.getResponseText().trim());

  // 2. Get Location
  const activeA1 = sheet.getActiveCell().getA1Notation();
  const cellResponse = ui.prompt(
    "Step 2/2: Confirm Location",
    `Importing links starting at cell ${activeA1}.\nClick OK to proceed or type a new cell below:`,
    ui.ButtonSet.OK_CANCEL,
  );
  if (cellResponse.getSelectedButton() !== ui.Button.OK) return;
  const startCell = cellResponse.getResponseText().trim() || activeA1;

  try {
    const parentFolder = DriveApp.getFolderById(folderId);
    const targetRange = sheet.getRange(startCell);

    SpreadsheetApp.getActive().toast("Scanning folder...", "Listing", -1);

    const allFiles: { url: string }[] = [];
    getAllFilesRecursive(parentFolder, allFiles);

    if (allFiles.length > 0) {
      const output = allFiles.map((f) => [f.url]);
      sheet
        .getRange(targetRange.getRow(), targetRange.getColumn(), output.length, 1)
        .setValues(output);
      ui.alert(`Success! Imported ${output.length} links starting at ${startCell}`);
    } else {
      ui.alert("No files found in that folder.");
    }
  } catch (e) {
    ui.alert(
      "Error accessing folder",
      "Please ensure you have access to this folder ID.\n\nDetails: " + (e as Error).message,
      ui.ButtonSet.OK,
    );
  }
}

// ==========================================
// 📝 TOOL 2: EXTRACT TEXT
// ==========================================

export function extractTextFromSelection(): void {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  if (!checkDriveService(ui)) return;

  const range = sheet.getActiveRange();
  if (!range) return;

  const values = range.getValues();
  const totalRows = range.getNumRows();

  if (totalRows > 10) {
    const confirm = ui.alert(
      "Batch Process",
      `You selected ${totalRows} rows. This may take time. Continue?`,
      ui.ButtonSet.YES_NO,
    );
    if (confirm !== ui.Button.YES) return;
  }

  SpreadsheetApp.getActive().toast("Starting extraction...", "Init", -1);
  let processedCount = 0;

  for (let i = 0; i < totalRows; i++) {
    const cellValue = values[i][0];

    if (isValidDriveLink(cellValue)) {
      const fileId = extractId(cellValue);
      SpreadsheetApp.getActive().toast(`Extracting (${i + 1}/${totalRows})`, "Processing", -1);

      const text = truncateText(extractTextUniversal(fileId), 49000);

      range.getCell(i + 1, 2).setValue(text);
      processedCount++;
      SpreadsheetApp.flush();
    }
  }
  SpreadsheetApp.getActive().toast(`Done! Extracted ${processedCount} files.`, "Complete", 5);
}

// ==========================================
// 🎲 TOOL 3: DYNAMIC SAMPLING
// ==========================================

export function sampleRowsToEvaluation(): void {
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

export function runBatchAI(config: RunConfig): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  const headers = getSheetHeaders();
  if (headers.length === 0) {
    ui.alert("Error", "The active sheet has no column headers.", ui.ButtonSet.OK);
    return;
  }

  // Validate user prompt columns (required)
  const userPromptIdxs = resolveColumns(headers, config.userPromptCols);
  const missingUserPrompt = config.userPromptCols.filter((_, i) => userPromptIdxs[i] === -1);
  if (missingUserPrompt.length > 0) {
    ui.alert(
      "Error: Missing Columns",
      `Could not find columns: ${missingUserPrompt.join(", ")}`,
      ui.ButtonSet.OK,
    );
    return;
  }

  // Validate drive file columns (if selected)
  let driveFileIdxs: number[] = [];
  if (config.driveFileCols && config.driveFileCols.length > 0) {
    driveFileIdxs = resolveColumns(headers, config.driveFileCols);
    const missingDrive = config.driveFileCols.filter((_, i) => driveFileIdxs[i] === -1);
    if (missingDrive.length > 0) {
      ui.alert(
        "Error: Missing Columns",
        `Could not find columns: ${missingDrive.join(", ")}`,
        ui.ButtonSet.OK,
      );
      return;
    }
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

  SpreadsheetApp.getActive().toast(`Starting AI Batch...`, "AI Agent", -1);
  let processed = 0;

  for (let i = 0; i < dataValues.length; i++) {
    const row = dataValues[i];
    const realRowIndex = startRow + i;

    SpreadsheetApp.getActive().toast(`Processing Row ${realRowIndex}...`, "AI Agent", -1);

    const userPrompts = userPromptIdxs.map((idx) => row[idx]);
    const driveLinks = driveFileIdxs.length > 0 ? driveFileIdxs.map((idx) => row[idx]) : undefined;
    const systemPrompt = systemPromptIdx >= 0 ? row[systemPromptIdx] : undefined;

    const result = runInference(userPrompts, driveLinks, systemPrompt, config.tools);
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

const TOOLS: Record<string, () => void> = {
  importDriveLinks,
  sampleRowsToEvaluation,
  extractTextFromSelection,
};

export function runTool(functionName: string): void {
  const fn = TOOLS[functionName];
  if (!fn) throw new Error("Function not found: " + functionName);
  fn();
}

// ==========================================
// RECIPE PREP
// ==========================================

export function prepRecipe(params: PrepRecipeParams): PrepRecipeResult {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const colNames: PrepRecipeResult["colNames"] = {};
  let numRows = 1;

  if (params.driveFolder) {
    const folderId = extractId(params.driveFolder.url);
    const folder = DriveApp.getFolderById(folderId);
    const files: { url: string }[] = [];
    getAllFilesRecursive(folder, files);
    numRows = files.length || 1;
    const col = findOrCreateColumn(
      sheet,
      params.driveFolder.colTitle,
      SpreadsheetApp.WrapStrategy.CLIP,
    );
    writeColumn(
      sheet,
      col,
      files.map((f) => f.url),
      SpreadsheetApp.WrapStrategy.CLIP,
    );
    colNames.driveLink = params.driveFolder.colTitle;
  }

  if (params.systemPrompt) {
    const col = findOrCreateColumn(
      sheet,
      params.systemPrompt.colTitle,
      SpreadsheetApp.WrapStrategy.CLIP,
    );
    writeColumn(
      sheet,
      col,
      Array(numRows).fill(params.systemPrompt.value) as string[],
      SpreadsheetApp.WrapStrategy.CLIP,
    );
    colNames.systemPrompt = params.systemPrompt.colTitle;
  }

  if (params.userPrompts) {
    colNames.userPrompts = [];
    for (const up of params.userPrompts) {
      const col = findOrCreateColumn(sheet, up.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
      writeColumn(
        sheet,
        col,
        Array(numRows).fill(up.value) as string[],
        SpreadsheetApp.WrapStrategy.CLIP,
      );
      colNames.userPrompts.push(up.colTitle);
    }
  }

  if (params.outputCol) {
    findOrCreateColumn(sheet, params.outputCol.colTitle, SpreadsheetApp.WrapStrategy.CLIP);
    colNames.outputCol = params.outputCol.colTitle;
  }

  SpreadsheetApp.flush();

  return {
    rowRange: { start: 2, end: 2 + numRows - 1 },
    colNames,
    tools: params.tools,
  };
}
