# Gemini Project Overview: gas-ssi-toolkit

This document provides a high-level overview of the `gas-ssi-toolkit` project to guide AI-based development and maintenance.

## Project Purpose

`gas-ssi-toolkit` is a Google Apps Script toolkit designed for integrating with Google Drive and performing multimodal AI inference. It enables developers to:
- Import and process Drive files.
- Extract text from various document types, including OCR for PDFs/images.
- Sample data.
- Run AI inference (specifically using the Gemini API) within Google Sheets or other Apps Script environments.

The project emphasizes local development using modern web development practices (TypeScript, Rollup, ESLint, Prettier) and deploys to Google Apps Script via `clasp`.

## Tech Stack

-   **Language:** TypeScript
-   **Platform:** Google Apps Script (running on Google's V8 runtime), Node.js (for local development)
-   **Bundler:** Rollup (bundles TypeScript into a single IIFE for Apps Script)
-   **Deployment Tool:** `@google/clasp`
-   **Key Google Services/APIs:**
    -   Gemini API (for AI inference)
    -   Google Drive Advanced Service (v3 API for advanced file operations, including OCR)
    -   `UrlFetchApp` (for external API calls, e.g., Gemini)
    -   `SpreadsheetApp`, `HtmlService`, `PropertiesService` (for Apps Script UI and settings)
-   **Testing:** Jest
-   **Linting:** ESLint
-   **Formatting:** Prettier
-   **Dependency Management:** npm

## Project Structure

```
gas-project/
├── src/
│   ├── server/
│   │   ├── index.ts          # Entry point — menu, tools, global exposure
│   │   ├── config.ts         # Central CONFIG object
│   │   ├── api.ts            # Gemini API calls via UrlFetchApp
│   │   ├── drive.ts          # Drive Advanced Service + text extraction
│   │   ├── dialog.ts         # HTML template for AI source dialog
│   │   └── utils.ts          # Pure helpers (extractId, seededRandom, etc.)
│   └── shared/
│       └── types.ts          # TypeScript interfaces
├── __tests__/
│   ├── utils.test.ts         # Tests for pure functions (no mocking)
│   └── api.test.ts           # Tests for Gemini API with mocked globals
├── dist/                     # Build output (clasp pushes from here)
├── appsscript.json           # Manifest: scopes, Drive Advanced Service
├── .clasp.dev.json           # Dev script ID
├── .clasp.prod.json          # Prod script ID
├── rollup.config.js          # Bundler config
├── tsconfig.json             # TypeScript config (ES2019/V8 target)
├── jest.config.js            # Test runner
├── .eslintrc.json            # Linting
├── .prettierrc               # Formatting
└── .husky/                   # Git hooks managed by Husky
```

## Development Workflow

### Prerequisites

-   Node.js 18+ and npm
-   Apps Script API enabled: `https://script.google.com/home/usersettings`
-   Drive Advanced Service enabled in the Apps Script editor (Services > + > Drive API v3)

### Setup

1.  **Install dependencies:**
    ```bash
    npm install
    ```
2.  **AuthenticaTe with Google:**
    ```bash
    npm run clasp:login
    ```
3.  **Configure `.clasp.dev.json`:** Edit this file with your development script ID from Google Sheets' Extensions > Apps Script.
4.  **Set Gemini API Key:** In the Apps Script editor, go to Project Settings > Script Properties and set `Key: GEMINI_API_KEY`, `Value: your-key-here`.

### Common Commands

-   **Build once:**
    ```bash
    npm run build
    ```
-   **Build and deploy to dev script:**
    ```bash
    npm run deploy:dev
    ```
-   **Build and deploy to prod script:**
    ```bash
    npm run deploy:prod
    ```
-   **Continuously build and push to dev script (watch mode):**
    ```bash
    npm run deploy:watch:dev
    ```
-   **Continuously build and push to prod script (watch mode):**
    ```bash
    npm run deploy:watch:prod
    ```
-   **Run tests:**
    ```bash
    npm test
    ```
-   **Run tests in watch mode:**
    ```bash
    npm run test:watch
    ```
-   **Lint TypeScript:**
    ```bash
    npm run lint
    ```
-   **Format with Prettier:**
    ```bash
    npm run format
    ```
-   **Open Apps Script project:**
    ```bash
    npm run clasp:open
    ```
-   **View Apps Script logs:**
    ```bash
    npm run clasp:logs
    ```

**Deployment Safety Note:**
The `deploy:watch:dev` and `deploy:watch:prod` commands explicitly set the target `.clasp.json` (development or production) before starting the continuous build and push process. This prevents accidental deployments to the wrong environment, which was a risk with the previous ambiguous `deploy:watch` command. Always ensure you are running the correct `deploy:watch` command for your intended target environment.


## Key Conventions & Architecture

-   **TypeScript:** The entire codebase is written in TypeScript for type safety and better maintainability.
-   **Rollup Bundling:** All TypeScript source files (`src/**/*.ts`) are bundled into a single IIFE (Immediately Invoked Function Expression) by Rollup. This bundled file is then pushed to Google Apps Script.
-   **`clasp` Deployment:** `@google/clasp` is used to manage and deploy the bundled code and `appsscript.json` manifest to Google Apps Script projects.
-   **Global Exposure:** Functions intended to be callable from Google Sheets custom functions, menus, or triggers are explicitly exposed as global functions in the bundled output's footer via `rollup.config.js`. This "footer trick" unwraps the exports from the IIFE, making them directly accessible to the Apps Script environment (e.g., `function onOpen(e) { _GASEntry.onOpen(e); }`).
-   **Module Separation:** Logic is separated into `server/` (backend-like Apps Script functionality) and `shared/` (common interfaces/types).
-   **Testing:** Jest is used for unit testing. Tests for pure functions (`utils.test.ts`) require no mocking, while API-related tests (`api.test.ts`) utilize mocked globals specific to Apps Script environment.
-   **Linting and Formatting:** ESLint enforces code quality rules, and Prettier ensures consistent code formatting. These checks are integrated into a pre-commit hook via `husky` and `lint-staged` to automatically fix issues on staged TypeScript files.
-   **Drive Advanced Service:** The `drive.ts` module specifically uses `Drive Advanced Service` (v3 API) for powerful file manipulations like OCR, requiring explicit enablement in the Apps Script editor and declaration in `appsscript.json`.
-   **`appsscript.json` Management:** The `appsscript.json` manifest, critical for defining Apps Script project settings and enabled services, must be present in the `dist/` folder alongside the bundled JavaScript for `clasp` to deploy correctly. The build process handles copying this file.
-   **Custom Function Limitations:** Custom functions in Google Sheets (`GEMINI()`) have limited access to Apps Script services (e.g., cannot directly access `PropertiesService`), requiring alternative patterns for managing sensitive data like API keys.
-   **Localhost Development:** Direct access to `localhost` from `UrlFetchApp` (which runs on Google servers) is not possible without tunneling solutions during development.
