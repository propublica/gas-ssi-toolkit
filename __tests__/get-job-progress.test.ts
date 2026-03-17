const mockGet = jest.fn();
const mockUserCache = { get: mockGet };
const mockCacheService = { getUserCache: jest.fn().mockReturnValue(mockUserCache) };
(globalThis as unknown as Record<string, unknown>)["CacheService"] = mockCacheService;

// Mock GAS globals required by index.ts and its imports
(globalThis as unknown as Record<string, unknown>)["SpreadsheetApp"] = {
  getUi: jest.fn(),
  getActiveSpreadsheet: jest.fn(),
  getActive: jest.fn(),
  newRichTextValue: jest.fn(),
  newTextStyle: jest.fn(),
  WrapStrategy: { CLIP: "CLIP", WRAP: "WRAP" },
};
(globalThis as unknown as Record<string, unknown>)["HtmlService"] = {
  createTemplateFromFile: jest.fn(),
  createHtmlOutput: jest.fn(),
};
(globalThis as unknown as Record<string, unknown>)["DriveApp"] = {
  getFolderById: jest.fn(),
};
(globalThis as unknown as Record<string, unknown>)["UrlFetchApp"] = {
  fetch: jest.fn(),
};
(globalThis as unknown as Record<string, unknown>)["PropertiesService"] = {
  getScriptProperties: jest.fn().mockReturnValue({ getProperty: jest.fn() }),
};

import { getJobProgress } from "../src/server/index";

describe("getJobProgress", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns parsed progress when cache entry exists", () => {
    mockGet.mockReturnValue(JSON.stringify({ message: "Row 3 of 10", current: 3, total: 10 }));
    const result = getJobProgress("job-123");
    expect(result).toEqual({ message: "Row 3 of 10", current: 3, total: 10 });
    expect(mockGet).toHaveBeenCalledWith("job-123");
  });

  it("returns null when no cache entry exists", () => {
    mockGet.mockReturnValue(null);
    const result = getJobProgress("job-xyz");
    expect(result).toBeNull();
  });
});
