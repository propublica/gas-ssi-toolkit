/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    // Client source files and sidebar tests use the client tsconfig (DOM lib).
    "^.+/src/client/.+\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
    "^.+/__tests__/sidebar\\.test\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
    // All other TypeScript files use the main tsconfig.
    "^.+\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.json" }],
  },
  roots: ["<rootDir>/__tests__"],
  moduleNameMapper: {
    "^@server/(.*)$": "<rootDir>/src/server/$1",
    "^@shared/(.*)$": "<rootDir>/src/shared/$1",
  },
  // Scope coverage to source files only.
  // src/server/index.ts is excluded from coverage collection: onOpen and
  // openQuickstartDoc are tested in menu.test.ts, but the four tool
  // orchestrators (importDriveLinks, extractTextFromSelection,
  // sampleRowsToEvaluation, runBatchAI) are deeply coupled to SpreadsheetApp
  // UI globals (prompts, dialogs, active ranges) and are not unit-tested.
  // See docs/plans/2026-02-18-testing-coverage-design.md for full rationale.
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/server/index.ts",
  ],
  coverageThreshold: {
    // Thresholds are set ~5 points below observed full-suite coverage to allow
    // minor fluctuations without requiring constant updates.
    // config.ts, dialog.ts (pure exports) and shared/types.ts (interfaces only)
    // are included in collectCoverageFrom but need no explicit thresholds —
    // they contain no branching logic and are fully exercised by other tests.
    "./src/server/api.ts": {
      statements: 95,
      branches: 90,
      functions: 100,
    },
    "./src/server/utils.ts": {
      statements: 83,
      branches: 93,
      functions: 100,
    },
    "./src/server/drive.ts": {
      statements: 95,
      branches: 95,
      functions: 100,
    },
    "./src/server/customFunctions.ts": {
      statements: 90,
      branches: 85,
      functions: 100,
    },
    "./src/server/inference.ts": {
      statements: 90,
      branches: 80,
      functions: 100,
    },
    "./src/client/sidebar.ts": {
      statements: 95,
      branches: 81,
      functions: 95,
    },
  },
};
