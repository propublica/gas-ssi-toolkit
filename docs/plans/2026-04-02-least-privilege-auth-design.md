# Least-Privilege Auth Scope Reduction — Design Document

## Problem

The SSI Toolkit's current OAuth manifest requests `https://www.googleapis.com/auth/drive`
— full read, write, and delete access to every file in the user's Google Drive. This scope
produces the consent screen warning: **"See, edit, create, and delete all of your Google
Drive files."** Every user who has seen this prompt has expressed concern, creating friction
that slows adoption and triggers internal security reviews.

The same problem exists, to a lesser degree, with the `documents` scope ("See, edit,
create, and delete all your Google Docs documents"), though the primary complaint is
about Drive.

## Non-Goals

- **Google Picker integration.** Replacing text inputs with a Picker component was
  evaluated and rejected. The `drive.file` scope (Picker-based per-file authorization) does
  not support recursive folder scanning — a core requirement of the Import Drive Links tool.
  A "Service Account Bridge" workaround was also rejected: it introduces persistent ACL
  entries on user files, requires service account credential management, and would be
  blocked by the organizational Drive sharing policies that motivated this change.

- **`spreadsheets.currentonly` migration.** The Run AI tool's file export path calls
  `SpreadsheetApp.openById()` to enumerate all sheets in a Drive-linked Google Sheet. This
  requires the full `spreadsheets` scope. Switching to `Drive.Files.export()` for Sheets
  would limit export to the first sheet only. Multi-sheet support is retained; this
  migration is deferred.

- **`documents` scope elimination.** Replacing `DocumentApp.openById()` with
  `Drive.Files.export()` was considered but the existing codebase contains an explicit
  warning that `Drive.Files.export()` returns metadata rather than file content in the Apps
  Script Advanced Service. Eliminating `documents` safely would require a verified
  alternative (e.g., direct `UrlFetchApp` export call), which is deferred.

## Solution

Replace the single `drive` scope with two narrower scopes that together cover the same
functional surface:

- **`drive.readonly`** — read access to all Drive files. Covers folder scanning, file
  metadata lookups, and file content reads for Extract Text and Run AI.
- **`drive.file`** — write access scoped to files the app creates. Covers the temporary
  Google Doc created (and deleted) during OCR in Extract Text.

No code changes are required. This is a manifest-only change.

## Scope Changes

| Scope | Before | After | Reason |
|---|---|---|---|
| `spreadsheets` | `auth/spreadsheets` | unchanged | `SpreadsheetApp.openById()` needed for multi-sheet Drive file export |
| `drive` | `auth/drive` | **`auth/drive.readonly` + `auth/drive.file`** | Split into read-all + app-files-write |
| `documents` | `auth/documents` | unchanged | `DocumentApp.openById()` used for OCR; safe alternative deferred |
| `script.external_request` | — | unchanged | Required for `UrlFetchApp` (Gemini API) |
| `script.container.ui` | — | unchanged | Required for sidebar and menu |

## Why This Works

Each Drive operation in the codebase maps to exactly one of the two new scopes:

| Operation | Location | Scope |
|---|---|---|
| `DriveApp.getFolderById()` + recursive listing | `index.ts`, `utils.ts` | `drive.readonly` |
| `DriveApp.getFileById()` (metadata, blob reads) | `drive.ts` | `drive.readonly` |
| `Drive.Files.list()` | `utils.ts` via Advanced Service | `drive.readonly` |
| `Drive.Files.create()` (temp OCR doc) | `drive.ts:57` | `drive.file` |
| `Drive.Files.remove()` (temp OCR doc cleanup) | `drive.ts:60` | `drive.file` |
| `SpreadsheetApp.openById()` (Sheets file export) | `drive.ts:103` | `spreadsheets` |

No operation in the codebase requires Drive write access to files other than the
app-created OCR temp docs. The `drive` scope was over-provisioned.

## Consent Screen Impact

Before:
- "See, edit, create, and delete **all** of your Google Drive files"
- "See, edit, create, and delete **all** your Google Docs documents"

After:
- "See and download **all** your Google Drive files" (`drive.readonly`)
- "See, edit, create, and delete only the **specific** Google Drive files you use with this app" (`drive.file`)
- "See, edit, create, and delete **all** your Google Docs documents" (`documents` — unchanged)

## Re-Authorization

Changing OAuth scopes in `appsscript.json` triggers a re-authorization prompt for all
existing users on their next interaction with the add-on. This is expected behavior.
Users should be informed before the change is deployed.

## Files Touched

| File | Change |
|---|---|
| `appsscript.json` | Replace `auth/drive` with `auth/drive.readonly` + `auth/drive.file` |

## Manual Test Plan

Deploy to a test instance and verify each tool end-to-end:

| Tool | Operation | Expected scope |
|---|---|---|
| Import Drive Links | Recursive folder scan, write URLs to sheet | `drive.readonly` + `spreadsheets` |
| Extract Text — Google Doc | Read doc body text | `drive.readonly` + `documents` |
| Extract Text — PDF/image | Create temp doc, OCR, delete temp doc | `drive.readonly` + `drive.file` + `documents` |
| Run AI — text columns | Batch inference, write to sheet | `spreadsheets` + `script.external_request` |
| Run AI — Drive file inputs (Doc, PDF, image) | Fetch and encode file for Gemini | `drive.readonly` |
| Run AI — Drive file inputs (Sheets) | Open spreadsheet, enumerate all sheets | `spreadsheets` |
