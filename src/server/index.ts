/**
 * index.ts — Entry point for SSI Drive & AI Tools.
 *
 * This file contains the top-level tool functions (the ones users invoke
 * from the menu) and exposes them to Apps Script via globalThis.
 *
 * Business logic is imported from sibling modules. Only this file should
 * assign to `global.*` — that's the contract with Rollup's IIFE output.
 */

import { CONFIG } from "./config";
import { callGeminiAPI } from "./api";
import { checkDriveService, extractTextUniversal, fetchAndEncodeFile } from "./drive";
import {
  extractId,
  isValidDriveLink,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
} from "./utils";
import { HTML_TEMPLATE } from "./dialog";
import type { AIMode, ColumnMap } from "../shared/types";

// ==========================================
// 🚀 MENU & INITIALIZATION
// ==========================================

export function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu("⚡ SSI Toolkit")
    .addItem("🚀 Open SSI Sidebar", "showSidebar")
    .addToUi();
}

// ==========================================
// 🖥️ UI HANDLERS
// ==========================================

export function showSourceDialog(): void {
  const htmlOutput = HtmlService.createHtmlOutput(HTML_TEMPLATE).setWidth(400).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "Choose AI Data Source");
}

export function handleDialogSelection(mode: string): void {
  runBatchAI(mode as AIMode);
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

export function runBatchAI(mode: AIMode): void {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
  if (!apiKey) {
    ui.alert(
      "🛑 Configuration Error",
      "API Key not found. Go to Project Settings > Script Properties and add GEMINI_API_KEY.",
      ui.ButtonSet.OK,
    );
    return;
  }

  // Map column headers to indices
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] as string[];
  const map: ColumnMap = {
    source_drive: headers.indexOf(CONFIG.COLUMNS.SOURCE_DRIVE),
    source_text: headers.findIndex((h) => h.includes(CONFIG.COLUMNS.SOURCE_TEXT)),
    sys_prompt: headers.indexOf(CONFIG.COLUMNS.SYS_PROMPT),
    user_prompt: headers.indexOf(CONFIG.COLUMNS.USER_PROMPT),
    output: headers.indexOf(CONFIG.COLUMNS.OUTPUT),
  };

  if (
    map.source_drive === -1 ||
    map.sys_prompt === -1 ||
    map.user_prompt === -1 ||
    map.output === -1
  ) {
    ui.alert(
      "Error: Missing Columns",
      `Ensure headers exist: ${Object.values(CONFIG.COLUMNS).join(", ")}`,
      ui.ButtonSet.OK,
    );
    return;
  }

  // Process selected rows
  const range = sheet.getActiveRange();
  if (!range) return;

  const dataValues = sheet
    .getRange(range.getRow(), 1, range.getNumRows(), sheet.getLastColumn())
    .getValues();

  SpreadsheetApp.getActive().toast(`Starting AI Batch (${mode} Mode)...`, "AI Agent", -1);
  let processed = 0;

  for (let i = 0; i < dataValues.length; i++) {
    const row = dataValues[i];
    const usrPrompt = row[map.user_prompt] as string;
    const realRowIndex = range.getRow() + i;

    if (usrPrompt) {
      SpreadsheetApp.getActive().toast(`Processing Row ${realRowIndex}...`, "AI Agent", -1);
      let result = "";

      try {
        const systemPrompt = row[map.sys_prompt] as string;

        if (mode === "TEXT") {
          const sourceText = map.source_text > -1 ? (row[map.source_text] as string) : "";
          if (!sourceText || sourceText.length <= 5 || sourceText.includes("Error")) {
            result = "[Skipped: No valid text]";
          } else {
            result = callGeminiAPI({ apiKey, systemPrompt, userTexts: [usrPrompt, sourceText] });
          }
        } else {
          const link = row[map.source_drive] as string;
          if (!isValidDriveLink(link)) {
            result = "[Skipped: No valid Drive Link]";
          } else {
            const inlineData = fetchAndEncodeFile(extractId(link));
            result = callGeminiAPI({ apiKey, systemPrompt, userTexts: [usrPrompt], inlineData });
          }
        }

        sheet.getRange(realRowIndex, map.output + 1).setValue(result);
        processed++;
      } catch (e) {
        sheet.getRange(realRowIndex, map.output + 1).setValue("Error: " + (e as Error).message);
      }
      SpreadsheetApp.flush();
    }
  }
  SpreadsheetApp.getActive().toast(`Complete! Processed ${processed} rows.`, "Success", 5);
}

// ==========================================
// 🔀 SIDEBAR DISPATCHER
// ==========================================

const TOOLS: Record<string, () => void> = {
  importDriveLinks,
  showSourceDialog,
  sampleRowsToEvaluation,
  extractTextFromSelection,
};

export function runTool(functionName: string): void {
  const fn = TOOLS[functionName];
  if (!fn) throw new Error("Function not found: " + functionName);
  fn();
}
