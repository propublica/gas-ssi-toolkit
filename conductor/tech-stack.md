# Tech Stack

This document outlines the key technologies and tools used in the `gas-ssi-toolkit` project.

## Core Technologies

-   **Language:** TypeScript
-   **Platform:** Google Apps Script (running on Google's V8 runtime), Node.js (for local development)
-   **Bundler:** Rollup (bundles TypeScript into a single IIFE for Apps Script)
-   **Deployment Tool:** `@google/clasp`

## Key Google Services and APIs

-   **Gemini API:** For multimodal AI inference.
-   **Google Drive Advanced Service (v3 API):** Used for advanced file operations, including OCR functionality for PDF/image text extraction.
-   **`UrlFetchApp`:** Utilized for making external API calls, particularly to the Gemini API.
-   **`SpreadsheetApp`:** For interacting with Google Sheets, especially for menu creation and custom functions.
-   **`HtmlService`:** For serving HTML-based user interfaces and dialogs within Apps Script.
-   **`PropertiesService`:** For managing script properties, such as storing API keys securely.
-   **`DriveApp`:** Standard Google Drive service for basic file interactions.
-   **`DocumentApp`:** For interacting with Google Docs documents.

## Development Tools

-   **Testing Framework:** Jest
-   **Linting:** ESLint
-   **Formatting:** Prettier
