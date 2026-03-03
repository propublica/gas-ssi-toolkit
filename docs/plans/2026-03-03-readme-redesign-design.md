# README Redesign Design

**Date:** 2026-03-03

## Goal

Rewrite `README.md` to serve contributors and developers. Focus on practical onboarding: key commands, build pipeline, local dev requirements, and broad design principles. Cut anything that belongs in CLAUDE.md.

## Audience

Contributors and developers. End-user documentation lives elsewhere.

## Structure

### 1. What this is
2-3 sentences. What the project is, tech stack, how it deploys. No feature list.

### 2. Prerequisites
Short list of what blocks you from running anything:
- Node.js 22+
- Apps Script API enabled
- A Google Sheet with an attached Apps Script project
- A Gemini API key (for Run AI)

Note: `@google/clasp` is a devDependency — no global install needed.

### 3. Setup
Minimal numbered steps from clone to first deploy. Covers both dev and prod deployment paths.

### 4. Key commands
Grouped by purpose: build, deploy, test, quality, utilities. Only the commands you reach for every day — no exhaustive list.

### 5. Build pipeline
Two Rollup configs in one build:
- **Server:** `src/server/index.ts` → `dist/index.js` (IIFE). Footer stubs bridge the GAS global scope gap. Rule: export from `index.ts` AND add a footer stub — skipping the stub means Apps Script can't find the function.
- **Client:** `src/client/sidebar-entry.ts` → `dist/Sidebar.html`. Custom Rollup plugin inlines JS and CSS into the HTML template at build time.
- `appsscript.json` is copied into `dist/` as part of the build.

### 6. Architecture
Hard boundary between two TypeScript environments:
- **Server** (`src/server/`): GAS globals only in `index.ts`. Everything else is pure functions.
- **Client** (`src/client/`): `google.script.run` only in `services.ts`, which wraps each call as a Promise — the connective tissue between server functions and the client. Everything else consumes those Promises.
- Panel/router system: `Router` manages a navigation stack; each `Panel` handles its own render and state. `recipes.ts` holds the named recipe registry.
- Rule: keep the layering intact — GAS globals in `index.ts`, `google.script.run` in `services.ts`, business logic in pure testable modules.

### 7. Testing
Jest with ts-jest. Tests in `__tests__/`.
- Mock GAS globals on `globalThis` BEFORE importing the module under test.
- Mock `google.script.run` by capturing the success/failure handlers and invoking them manually.
- Coverage enforced per-file via `npm run test:coverage`.

## What to cut
- File/directory tree
- Per-module breakdown table
- Tool 4 column requirements (end-user info)
- GAS gotchas / Key Notes section

All of that lives in CLAUDE.md.
