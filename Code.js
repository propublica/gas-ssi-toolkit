/**
 * ⚡ SSI DRIVE & AI TOOLS (Dynamic Evaluation - Unrestricted)
 * * A unified toolkit for Google Sheets to import Drive files, extract text, 
 * * sample data dynamically, and run multimodal AI inference.
 */

// ==========================================
// ⚙️ CONFIGURATION
// ==========================================
const CONFIG = {
  API_KEY_PROPERTY: 'GEMINI_API_KEY',
  MODEL_NAME: 'gemini-2.0-flash', 
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024, // 25MB Apps Script Limit
  COLUMNS: {
    SOURCE_DRIVE: 'source_drive',
    SOURCE_TEXT: 'source_text', 
    SYS_PROMPT: 'system_prompt',
    USER_PROMPT: 'user_prompt',
    OUTPUT: 'ai_inference'
  }
};

// ==========================================
// 🚀 MENU & INITIALIZATION
// ==========================================
function onOpen() {
  SpreadsheetApp.getUi()
      .createMenu('⚡ SSI Tools')
      .addItem('1. Import Drive Links (Folder)', 'importDriveLinks')
      .addItem('2. Extract Text from Selected Cells', 'extractTextFromSelection')
      .addSeparator()
      .addItem('3. 🎲 Sample Rows for Evaluation', 'sampleRowsToEvaluation')
      .addItem('4. ▶️ Run AI on Selected Rows', 'showSourceDialog')
      .addToUi();
}

// ==========================================
// 🖥️ UI HANDLERS
// ==========================================
function showSourceDialog() {
  const htmlOutput = HtmlService.createHtmlOutput(HTML_TEMPLATE)
      .setWidth(400)
      .setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, 'Choose AI Data Source');
}

function handleDialogSelection(mode) {
  runBatchAI(mode);
}

// ==========================================
// 📂 TOOL 1: IMPORT LINKS
// ==========================================
function importDriveLinks() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();

  // 1. Get Folder
  const folderResponse = ui.prompt('Step 1/2: Select Folder', 'Paste the Google Drive Folder Link or ID:', ui.ButtonSet.OK_CANCEL);
  if (folderResponse.getSelectedButton() !== ui.Button.OK) return;
  const folderId = extractId(folderResponse.getResponseText().trim());

  // 2. Get Location
  const activeA1 = sheet.getActiveCell().getA1Notation();
  const cellResponse = ui.prompt('Step 2/2: Confirm Location', 
      `Importing links starting at cell ${activeA1}.\nClick OK to proceed or type a new cell below:`, 
      ui.ButtonSet.OK_CANCEL);
  
  if (cellResponse.getSelectedButton() !== ui.Button.OK) return;
  const startCell = cellResponse.getResponseText().trim() || activeA1;

  try {
    const parentFolder = DriveApp.getFolderById(folderId);
    const targetRange = sheet.getRange(startCell);
    
    SpreadsheetApp.getActive().toast('Scanning folder...', 'Listing', -1);
    
    let allFiles = [];
    getAllFilesRecursive(parentFolder, allFiles);

    if (allFiles.length > 0) {
      const output = allFiles.map(f => [f.url]);
      // Ensure we don't write past the sheet limits
      sheet.getRange(targetRange.getRow(), targetRange.getColumn(), output.length, 1).setValues(output);
      ui.alert(`Success! Imported ${output.length} links starting at ${startCell}`);
    } else {
      ui.alert('No files found in that folder.');
    }
  } catch (e) {
    ui.alert('Error accessing folder', 'Please ensure you have access to this folder ID.\n\nDetails: ' + e.message, ui.ButtonSet.OK);
  }
}

// ==========================================
// 📝 TOOL 2: EXTRACT TEXT
// ==========================================
function extractTextFromSelection() {
  const ui = SpreadsheetApp.getUi();
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  if (!checkDriveService(ui)) return;

  const range = sheet.getActiveRange();
  const values = range.getValues();
  const totalRows = range.getNumRows();

  if (totalRows > 10) {
    if (ui.alert('Batch Process', `You selected ${totalRows} rows. This may take time. Continue?`, ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  }

  SpreadsheetApp.getActive().toast('Starting extraction...', 'Init', -1);
  let processedCount = 0;

  for (let i = 0; i < totalRows; i++) {
    const cellValue = values[i][0];
    
    if (isValidDriveLink(cellValue)) {
      const fileId = extractId(cellValue);
      SpreadsheetApp.getActive().toast(`Extracting (${i + 1}/${totalRows})`, 'Processing', -1);
      
      let text = extractTextUniversal(fileId);
      if (text.length > 49000) text = text.substring(0, 49000) + "... [TRUNCATED]";
      
      // Write result to the cell immediately to the right
      range.getCell(i + 1, 2).setValue(text);
      processedCount++;
      SpreadsheetApp.flush(); 
    }
  }
  SpreadsheetApp.getActive().toast(`Done! Extracted ${processedCount} files.`, 'Complete', 5);
}

// ==========================================
// 🎲 TOOL 3: DYNAMIC SAMPLING (UPDATED)
// ==========================================
function sampleRowsToEvaluation() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  const sourceSheet = ss.getActiveSheet();
  const sourceName = sourceSheet.getName();

  // 1. Determine Target Sheet Name
  const targetName = `${sourceName}_evaluation`;
  let targetSheet = ss.getSheetByName(targetName);

  // 2. Validate Source Data
  const lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) {
    ui.alert('Error', `The sheet "${sourceName}" appears to be empty.`, ui.ButtonSet.OK);
    return;
  }
  
  const allData = sourceSheet.getRange(2, 1, lastRow - 1, sourceSheet.getLastColumn()).getValues();

  // 3. User Prompts
  const countResponse = ui.prompt('Sample Data', `Found ${allData.length} rows in "${sourceName}".\nHow many rows would you like to sample to "${targetName}"?`, ui.ButtonSet.OK_CANCEL);
  if (countResponse.getSelectedButton() !== ui.Button.OK) return;
  
  const sampleSize = parseInt(countResponse.getResponseText());
  if (isNaN(sampleSize) || sampleSize < 1 || sampleSize > allData.length) {
    ui.alert('Error', `Please enter a valid number between 1 and ${allData.length}.`, ui.ButtonSet.OK);
    return;
  }

  const seedResponse = ui.prompt('Random Seed', 'Enter a seed number for reproducibility (default: 42):', ui.ButtonSet.OK_CANCEL);
  if (seedResponse.getSelectedButton() !== ui.Button.OK) return;
  const seed = parseInt(seedResponse.getResponseText()) || 42;

  // 4. Create Target Sheet if missing
  if (!targetSheet) {
    targetSheet = ss.insertSheet(targetName);
    // Copy Headers from Source
    const headers = sourceSheet.getRange(1, 1, 1, sourceSheet.getLastColumn()).getValues();
    targetSheet.getRange(1, 1, 1, headers[0].length).setValues(headers);
  }

  // 5. Perform Sampling
  const seededRandom = createSeededRandom(seed);
  let indices = allData.map((_, i) => i);
  // Fisher-Yates Shuffle with seeded random
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(seededRandom() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  
  const selectedRows = indices.slice(0, sampleSize).map(index => allData[index]);
  
  // 6. Write to Target
  const targetRow = targetSheet.getLastRow() + 1;
  targetSheet.getRange(targetRow, 1, selectedRows.length, selectedRows[0].length).setValues(selectedRows);
  
  ss.setActiveSheet(targetSheet);
  ui.alert('Success', `Copied ${sampleSize} rows from "${sourceName}" to "${targetName}" using seed ${seed}.`, ui.ButtonSet.OK);
}

// ==========================================
// 🧠 TOOL 4: AI BATCH PROCESSOR
// ==========================================
function runBatchAI(mode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getActiveSheet();
  const ui = SpreadsheetApp.getUi();

  const apiKey = PropertiesService.getScriptProperties().getProperty(CONFIG.API_KEY_PROPERTY);
  if (!apiKey) {
    ui.alert('🛑 Configuration Error', 'API Key not found. Go to Project Settings > Script Properties and add GEMINI_API_KEY.', ui.ButtonSet.OK);
    return;
  }

  // Map columns
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {
    source_drive: headers.indexOf(CONFIG.COLUMNS.SOURCE_DRIVE),
    source_text: headers.findIndex(h => h.includes(CONFIG.COLUMNS.SOURCE_TEXT)), 
    sys_prompt: headers.indexOf(CONFIG.COLUMNS.SYS_PROMPT),
    user_prompt: headers.indexOf(CONFIG.COLUMNS.USER_PROMPT),
    output: headers.indexOf(CONFIG.COLUMNS.OUTPUT)
  };

  if (map.source_drive === -1 || map.sys_prompt === -1 || map.user_prompt === -1 || map.output === -1) {
    ui.alert('Error: Missing Columns', `Ensure headers exist: ${Object.values(CONFIG.COLUMNS).join(', ')}`, ui.ButtonSet.OK);
    return;
  }

  // Process Selected
  const range = sheet.getActiveRange();
  const dataValues = sheet.getRange(range.getRow(), 1, range.getNumRows(), sheet.getLastColumn()).getValues();

  SpreadsheetApp.getActive().toast(`Starting AI Batch (${mode} Mode)...`, 'AI Agent', -1);
  let processed = 0;

  for (let i = 0; i < dataValues.length; i++) {
    const row = dataValues[i];
    const usrPrompt = row[map.user_prompt];
    const realRowIndex = range.getRow() + i;

    if (usrPrompt) {
      SpreadsheetApp.getActive().toast(`Processing Row ${realRowIndex}...`, 'AI Agent', -1);
      let result = "";

      try {
        if (mode === 'TEXT') {
          const txt = (map.source_text > -1) ? row[map.source_text] : "";
          if (txt && txt.length > 5 && !txt.includes("Error")) {
            result = callGeminiAPI(apiKey, row[map.sys_prompt], usrPrompt, { textContext: txt });
          } else {
            result = "[Skipped: No valid text]";
          }
        } 
        else if (mode === 'FILE') {
          const link = row[map.source_drive];
          if (isValidDriveLink(link)) {
            result = callGeminiAPI(apiKey, row[map.sys_prompt], usrPrompt, { fileId: extractId(link) });
          } else {
            result = "[Skipped: No valid Drive Link]";
          }
        }
        sheet.getRange(realRowIndex, map.output + 1).setValue(result);
        processed++;
      } catch (e) {
        sheet.getRange(realRowIndex, map.output + 1).setValue("Error: " + e.message);
      }
      SpreadsheetApp.flush();
    }
  }
  SpreadsheetApp.getActive().toast(`Complete! Processed ${processed} rows.`, 'Success', 5);
}

// ==========================================
// 🤖 HELPER FUNCTIONS
// ==========================================

function callGeminiAPI(apiKey, systemPrompt, userPrompt, context) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.MODEL_NAME}:generateContent?key=${apiKey}`;
  
  const payload = {
    "system_instruction": { "parts": [{ "text": systemPrompt || "You are a helpful assistant." }] },
    "contents": [{ "role": "user", "parts": [{ "text": userPrompt }] }]
  };

  if (context.textContext) {
    const lastPart = payload.contents[0].parts.length - 1;
    payload.contents[0].parts[lastPart].text += `\n\n--- CONTEXT ---\n${context.textContext}`;
  } 
  else if (context.fileId) {
    const file = DriveApp.getFileById(context.fileId);
    if (file.getSize() > CONFIG.MAX_FILE_SIZE_BYTES) throw new Error(`File too large (>25MB).`);
    
    payload.contents[0].parts.push({
      "inline_data": { 
        "mime_type": file.getMimeType(), 
        "data": Utilities.base64Encode(file.getBlob().getBytes()) 
      }
    });
  }

  const options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());

  if (json.error) throw new Error(json.error.message);
  return json.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
}

function extractTextUniversal(fileId) {
  try {
    const file = DriveApp.getFileById(fileId);
    const mimeType = file.getMimeType();
    
    if (mimeType === MimeType.GOOGLE_DOCS) return DocumentApp.openById(fileId).getBody().getText();
    
    if (mimeType === MimeType.PDF || mimeType.includes('image/')) {
      const resource = { name: "Temp_" + file.getName(), mimeType: MimeType.GOOGLE_DOCS };
      const tempId = Drive.Files.create(resource, file.getBlob()).id; // v3 create
      const text = DocumentApp.openById(tempId).getBody().getText();
      Drive.Files.delete(tempId); // v3 delete
      return text;
    }
    return "[Skipped: Unsupported Type]";
  } catch (e) { return `[Error: ${e.message}]`; }
}

function checkDriveService(ui) {
  try { return Drive.Files; } catch (e) {
    ui.alert('🛑 Setup Required', 'Please enable "Drive API" in the Services list (+ icon on left).', ui.ButtonSet.OK);
    return false;
  }
}

function createSeededRandom(seed) {
  let m = 0x80000000, a = 1103515245, c = 12345;
  let state = seed ? seed : Math.floor(Math.random() * (m - 1));
  return function() { state = (a * state + c) % m; return state / (m - 1); };
}

function getAllFilesRecursive(folder, fileList) {
  const files = folder.getFiles();
  while (files.hasNext()) fileList.push({ url: files.next().getUrl() });
  const subfolders = folder.getFolders();
  while (subfolders.hasNext()) getAllFilesRecursive(subfolders.next(), fileList);
}

function extractId(input) { return (input && typeof input === 'string') ? (input.match(/[-\w]{25,}/) || [input])[0] : ""; }
function isValidDriveLink(input) { return typeof input === 'string' && (input.includes('drive.google.com') || input.includes('/d/')); }

// ==========================================
// 🌐 HTML TEMPLATE
// ==========================================
const HTML_TEMPLATE = `
<!DOCTYPE html>
<html>
  <head>
    <base target="_top">
    <style>
      body{font-family:'Google Sans',Arial,sans-serif;padding:20px;color:#202124;background:#fff}
      h3{margin-top:0;font-size:16px}
      .option{display:flex;align-items:flex-start;margin-bottom:12px;padding:10px;border:1px solid #e0e0e0;border-radius:8px;cursor:pointer;transition:0.2s}
      .option:hover{background:#f8f9fa;border-color:#1a73e8}
      .option input{margin:5px 12px 0 0;transform:scale(1.2)}
      .label-title{display:block;font-weight:500;font-size:14px;margin-bottom:4px}
      .label-desc{display:block;font-size:12px;color:#5f6368}
      .buttons{margin-top:24px;display:flex;justify-content:flex-end;gap:8px}
      button{padding:8px 24px;border-radius:4px;border:none;font-weight:500;cursor:pointer}
      .btn-cancel{background:#fff;color:#1a73e8;border:1px solid #dadce0}
      .btn-run{background:#1a73e8;color:#fff}
      .btn-run:hover{background:#1557b0}
    </style>
  </head>
  <body>
    <h3>Select Data Source</h3>
    <label class="option">
      <input type="radio" name="mode" value="TEXT" checked>
      <div><span class="label-title">Use Extracted Text</span><span class="label-desc">Fast. Reads "source_text". Best for plain text.</span></div>
    </label>
    <label class="option">
      <input type="radio" name="mode" value="FILE">
      <div>
        <span class="label-title">Use Drive File</span>
        <span class="label-desc">Multimodal. Reads PDFs, Images, Video, & Audio (max 25MB).</span>
      </div>
    </label>
    <div class="buttons">
      <button class="btn-cancel" onclick="google.script.host.close()">Cancel</button>
      <button class="btn-run" onclick="run()">Run AI</button>
    </div>
    <script>
      function run(){
        var m=document.querySelector('input[name="mode"]:checked').value;
        var b=document.querySelector('.btn-run');
        b.innerText='Starting...';b.disabled=true;
        google.script.run.withSuccessHandler(function(){google.script.host.close()}).handleDialogSelection(m);
      }
    </script>
  </body>
</html>`;