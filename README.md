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
│   ├── utils.test.ts         # Tests for pure helpers
│   ├── api.test.ts           # Tests for Gemini API with mocked globals
│   ├── drive.test.ts         # Tests for Drive text extraction
│   └── menu.test.ts          # Tests for onOpen / menu registration
├── dist/                     # Build output (clasp pushes from here)
├── appsscript.json           # Manifest: scopes, Drive Advanced Service
├── .clasp.dev.json           # Dev script ID
├── .clasp.prod.json          # Prod script ID
├── rollup.config.js          # Bundler config
├── tsconfig.json             # TypeScript config (ES2019/V8 target)
├── jest.config.cjs           # Test runner
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
| `index.ts` | Menu creation, 4 tools, exports wired to footer stubs | `SpreadsheetApp`, `HtmlService`, `PropertiesService` |

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
npm run build              # Clean build to dist/
npm run build:watch        # Continuous rebuild on file changes
npm run deploy:dev         # Build + push to dev script
npm run deploy:prod        # Build + push to prod script
npm run deploy:watch:dev   # Continuous build + push watch (dev)
npm run deploy:watch:prod  # Continuous build + push watch (prod)

npm test                   # Run tests
npm run test:watch         # Run tests in watch mode
npm run test:coverage      # Run tests with coverage + enforce per-file thresholds

npm run lint               # Lint TypeScript
npm run lint:fix           # Lint with auto-fix
npm run format             # Format with Prettier
npm run format:check       # Check formatting without modifying files
npm run typecheck          # Type-check without building

npm run clasp:open         # Open the Apps Script editor in browser
npm run clasp:logs         # Tail execution logs from Apps Script
```

Run a single test file: `npx jest __tests__/utils.test.ts`
Run a single test by name: `npx jest -t "extractId"`

## How the Build Works

```
src/**/*.ts  →  Rollup (TS + node-resolve)  →  dist/index.js  →  clasp push  →  Apps Script
```

Rollup bundles everything into a single IIFE assigned to `_GASEntry`. Apps Script has no module system and can only discover top-level functions in the global scope. The `footer` field in `rollup.config.js` bridges this gap by appending plain global stubs that delegate into the IIFE:

```js
function onOpen(e) { _GASEntry.onOpen(e); }
function showSourceDialog() { _GASEntry.showSourceDialog(); }
// ... one stub per public entry point
```

**To expose a new function to Apps Script, you must do both:**
1. `export` it from `src/server/index.ts`
2. Add a matching global stub in the `footer` of `rollup.config.js`

If you skip step 2, the function will exist in the bundle but Apps Script won't be able to discover or call it.

## Tool 4 — Run AI: Required Columns

`runBatchAI` maps columns by header name. The active sheet must contain these exact headers (case-sensitive):

| Column header | Purpose |
|---|---|
| `source_drive` | Drive file link (multimodal mode) |
| `source_text` | Plain text input (text mode) |
| `system_prompt` | System prompt for each row |
| `user_prompt` | User prompt for each row |
| `ai_inference` | Output column (written by the tool) |

The Gemini API key must be stored as a Script Property (`GEMINI_API_KEY`) in Apps Script > Project Settings > Script Properties before Tool 4 will run.

## Key Notes

**Drive Advanced Service:** The `extractTextUniversal` function uses `Drive.Files.create()` and `Drive.Files.remove()` (v3 API) for PDF/image OCR. This is the Drive *Advanced Service*, not `DriveApp`. It must be enabled separately in the Apps Script editor AND is declared in `appsscript.json` under `enabledAdvancedServices`.

**appsscript.json must be in dist/:** Clasp needs the manifest alongside the bundled JS. The build script handles this automatically — it runs `rimraf dist`, Rollup, then copies `appsscript.json` into `dist/`. No manual copy needed.

**Custom functions have limited permissions:** The `GEMINI()` custom function (if you add one) cannot access `PropertiesService`, so passing an API key to it requires a different pattern (hardcoded config, cache, or trigger-based pre-fetch).

**Localhost during development:** `UrlFetchApp` runs on Google's servers. To hit localhost, you need a tunnel (ngrok, Cloudflare Tunnel) or a deployed staging endpoint.
