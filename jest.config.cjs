/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: {
    // All TypeScript files use the client tsconfig (ES2019 + DOM lib). Using a single
    // rule avoids a ts-jest static ConfigSet caching bug: TsJestTransformer._cachedConfigSets
    // is keyed by global Jest config reference, not by transformerOptions. On CI (1 worker),
    // a server-test transformer running first would cache ConfigSet(tsconfig.json, no DOM),
    // causing all subsequent client transforms to inherit the wrong tsconfig and fail with
    // "Cannot find name 'document'". Server code compiles cleanly under the client tsconfig
    // since it never references DOM globals.
    "^.+\\.ts$": ["ts-jest", { tsconfig: "./tsconfig.client.json" }],
  },
  cacheDirectory: "<rootDir>/.jest-cache",
  roots: ["<rootDir>/__tests__"],
  testPathIgnorePatterns: ["/node_modules/", "/__tests__/helpers/"],
  moduleNameMapper: {
    "^@server/(.*)$": "<rootDir>/src/server/$1",
    "^@shared/(.*)$": "<rootDir>/src/shared/$1",
  },
  // Scope coverage to source files only.
  // src/server/index.ts is excluded: the four tool orchestrators are deeply
  // coupled to SpreadsheetApp UI globals and are not unit-tested.
  // src/client/sidebar-entry.ts is excluded: contains only init() which is
  // untestable (runs at module load time before beforeEach sets up the DOM).
  // See docs/plans/2026-02-18-testing-coverage-design.md for full rationale.
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/server/index.ts",
    "!src/client/sidebar-entry.ts",
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
    "./src/server/files.ts": {
      statements: 90,
      branches: 80,
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
    "./src/client/router.ts": {
      statements: 90,
      branches: 85,
      functions: 100,
    },
    "./src/client/services.ts": {
      statements: 90,
      branches: 80,
      functions: 100,
    },
    "./src/client/components/tag-list.ts": {
      statements: 95,
      branches: 80,
      functions: 100,
    },
    "./src/client/components/single-tag-list.ts": {
      statements: 90,
      branches: 85,
      functions: 95,
    },
    "./src/client/components/row-range.ts": {
      statements: 90,
      branches: 85,
      functions: 100,
    },
    "./src/client/components/lockable-field.ts": {
      statements: 95,
      branches: 90,
      functions: 100,
    },
    "./src/client/panels/tool-list.ts": {
      statements: 85,
      branches: 75,
      functions: 90,
    },
    "./src/client/panels/configure-ai-run.ts": {
      statements: 85,
      branches: 70,
      functions: 90,
    },
    "./src/client/components/recipe-prep-cook.ts": {
      statements: 90,
      branches: 95,
      functions: 88,
    },
    "./src/client/panels/recipe.ts": {
      statements: 88,
      branches: 72,
      functions: 72,
    },
    "./src/client/panels/recipes-list.ts": {
      statements: 95,
      branches: 70,
      functions: 100,
    },
    "./src/client/panels/import-drive-links.ts": {
      statements: 95,
      branches: 75,
      functions: 95,
      lines: 95,
    },
    "./src/server/gemini-grounding.ts": {
      statements: 95,
      branches: 85,
      functions: 100,
    },
    "./src/server/markdown-to-rich-text.ts": {
      statements: 95,
      branches: 95,
      functions: 100,
    },
  },
};
