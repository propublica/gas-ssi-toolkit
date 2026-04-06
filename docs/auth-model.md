# SSI Toolkit — Permissions Guide

When you install the SSI Toolkit, Google will ask you to approve a set of permissions
before the add-on can run. This document explains exactly what each permission allows the
add-on to do — and what it cannot do.

---

## Permissions Requested

### "See and download all your Google Drive files"
**Scope: `drive.readonly`**

This is a read-only permission. The add-on can look at and retrieve files in your Drive,
but it cannot create, edit, rename, move, or delete anything.

**Why it's needed:**
- **Import Drive Links** — scans a folder you specify, reads the list of files inside it
  (including subfolders), and writes their URLs into your spreadsheet.
- **Extract Text** — reads the content of a Google Doc or PDF you point it to.
- **Run AI** — retrieves the content of Drive files (Docs, PDFs, images) you've referenced
  in your spreadsheet and sends them to Gemini for analysis.

**What it cannot do:**
- Move, rename, or delete any of your files
- Upload or create files in your Drive
- Access files not referenced in your spreadsheet workflow

---

### "See, edit, create, and delete only the specific Google Drive files you use with this app"
**Scope: `drive.file`**

This write permission is narrowly scoped. The add-on can only create, read, and delete
files that it creates itself. It cannot touch any file that already exists in your Drive.

**Why it's needed:**
- **Extract Text (PDFs and images)** — to extract text from a PDF or image, the add-on
  creates a temporary Google Doc, reads its text content, then immediately deletes it.
  This temporary file lives in your Drive for only a few seconds during processing. No
  copy of your content is retained.

**What it cannot do:**
- Edit, move, or delete any file you created
- Access any existing file in your Drive

---

### "See, edit, create, and delete all your Google Docs documents"
**Scope: `documents`**

This permission allows the add-on to open and read Google Docs.

**Why it's needed:**
- **Extract Text** — reads the text content of Google Docs you reference, and reads the
  temporary Doc created during PDF/image OCR (see above).

**What it cannot do:**
- Open Docs that aren't referenced in your spreadsheet workflow
- Share or export your documents externally

---

### "See, edit, create, and delete all your Google Sheets spreadsheets"
**Scope: `spreadsheets`**

This permission allows the add-on to read and write spreadsheet data.

**Why it's needed:**
- All four tools read column data from and write results back to your active spreadsheet.
- **Run AI** — when a Drive file you've referenced is itself a Google Sheet, the add-on
  opens it to read all of its sheets and send their data to Gemini. This requires
  permission to open spreadsheets other than the one currently active.

**What it cannot do:**
- Access spreadsheets you haven't referenced in a workflow
- Send spreadsheet data anywhere other than the Gemini API for inference

---

### "Connect to an external service"
**Scope: `script.external_request`**

Allows the add-on to make outbound HTTP requests.

**Why it's needed:**
- All AI features send requests to the **Gemini API** (Google's AI service) to perform
  inference. No data is sent to any other external endpoint.

---

### "Display and run third-party web content in prompts and sidebars inside Google applications"
**Scope: `script.container.ui`**

Allows the add-on to display its sidebar and menu inside Google Sheets.

**Why it's needed:**
- Required for the SSI Tools menu and the sidebar interface to appear at all.

---

## Summary

| Permission | Can read your files? | Can edit/delete your files? | Scope |
|---|---|---|---|
| Drive (read-only) | Yes — any file you reference | No | `drive.readonly` |
| Drive (app files only) | Only files the app created | Only files the app created | `drive.file` |
| Google Docs | Yes — Docs you reference | No (reads only) | `documents` |
| Google Sheets | Yes — sheets you reference | Yes — writes results to your sheet | `spreadsheets` |
| External requests | — | — | Gemini API only |
| UI display | — | — | Sidebar and menu |

The add-on does not store your files, share them with third parties, or retain any content
after a workflow completes. All processing happens within Google's infrastructure — your
data passes from Google Drive to the Gemini API (also a Google service) and the results
are written back to your spreadsheet.
