# ⚡ SSI Drive & AI Tools

Google Apps Script toolkit for importing Drive files, extracting text, sampling data, and running multimodal AI inference — developed locally with TypeScript, Rollup, and Clasp.

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
└── .prettierrc               # Formatting
```

### Module Breakdown

| Module | What it does | Apps Script globals used |
|--------|-------------|------------------------|
| `config.ts` | Column names, model name, limits | None |
| `api.ts` | `callGeminiAPI()` — text and multimodal | `UrlFetchApp`, `DriveApp`, `Utilities` |
| `drive.ts` | `extractTextUniversal()`, OCR via Doc conversion | `DriveApp`, `Drive` (Advanced), `DocumentApp` |
| `dialog.ts` | HTML string for the modal dialog | None |
| `utils.ts` | ID extraction, link validation, seeded RNG, recursive file listing | `DriveApp` (only `getAllFilesRecursive`) |
| `index.ts` | Menu creation, 4 tools, `global.*` assignments | `SpreadsheetApp`, `HtmlService`, `PropertiesService` |

## Prerequisites

- Node.js 18+ and npm
- Apps Script API enabled: https://script.google.com/home/usersettings
- Drive Advanced Service enabled in the Apps Script editor (Services > + > Drive API v3)

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Authenticate with Google
npm run clasp:login

# 3. Edit .clasp.dev.json with your script ID
#    (from Extensions > Apps Script in your Google Sheet)

# 4. Set your Gemini API key in Script Properties:
#    Apps Script editor > Project Settings > Script Properties
#    Key: GEMINI_API_KEY   Value: your-key-here

# 5. Build and deploy
npm run deploy:dev
```

## Development

```bash
npm run build              # Build once to dist/
npm run deploy:dev         # Build + push to dev script
npm run deploy:prod        # Build + push to prod script
npm run deploy:watch       # Rebuild + push on every save

npm test                   # Run tests
npm run test:watch         # Run tests in watch mode
npm run lint               # Lint TypeScript
npm run format             # Format with Prettier
```

## How the Build Works

```
src/**/*.ts  →  Rollup (TS + node-resolve)  →  dist/index.js  →  clasp push  →  Apps Script
```

Rollup bundles everything into a single IIFE. Functions are exposed to Apps Script via `global.functionName = functionName` at the bottom of `index.ts`. If you add a new function that needs to be callable from the Sheets menu or a trigger, add it there.

## Key Notes

**Drive Advanced Service:** The `extractTextUniversal` function uses `Drive.Files.create()` and `Drive.Files.remove()` (v3 API) for PDF/image OCR. This is the Drive *Advanced Service*, not `DriveApp`. It must be enabled separately in the Apps Script editor AND is declared in `appsscript.json` under `enabledAdvancedServices`.

**appsscript.json must be in dist/:** Clasp needs the manifest alongside the bundled JS. Either copy it manually (`cp appsscript.json dist/`) or add a Rollup copy plugin. The build script uses `rimraf dist` so you'll need to copy it after each build.

**Custom functions have limited permissions:** The `GEMINI()` custom function (if you add one) cannot access `PropertiesService`, so passing an API key to it requires a different pattern (hardcoded config, cache, or trigger-based pre-fetch).

**Localhost during development:** `UrlFetchApp` runs on Google's servers. To hit localhost, you need a tunnel (ngrok, Cloudflare Tunnel) or a deployed staging endpoint.
