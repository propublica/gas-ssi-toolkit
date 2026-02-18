/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
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
    // Thresholds are set ~5 points below observed full-suite coverage.
    // utils.ts functions is set at 100% (above current 90%) intentionally:
    // it acts as the TDD gate that requires getAllFilesRecursive to be tested
    // (Task 3). All other thresholds are already met.
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
  },
};
