/**
 * Tests for src/server/utils.ts
 *
 * Most functions in utils.ts are purely computational with no GAS dependencies.
 * getAllFilesRecursive accepts a GAS Folder type but is testable via duck-typed
 * fake iterators — no globalThis mocking required.
 */

import {
  extractId,
  isValidDriveLink,
  createSeededRandom,
  getAllFilesRecursive,
  sampleRows,
  truncateText,
  flattenArg,
  resolveColumns,
  findOrCreateColumn,
  writeColumn,
  writeJobProgress,
} from "../src/server/utils";
import type { DriveFileInfo } from "../src/server/types";

describe("extractId", () => {
  it("extracts ID from a standard Drive file URL", () => {
    const url = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view";
    expect(extractId(url)).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  });

  it("extracts ID from a folder URL", () => {
    const url = "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    expect(extractId(url)).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  });

  it("returns the input if it already looks like an ID", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    expect(extractId(id)).toBe(id);
  });

  it("returns empty string for null/undefined/non-string", () => {
    expect(extractId(null)).toBe("");
    expect(extractId(undefined)).toBe("");
    expect(extractId(123)).toBe("");
  });

  it("returns the raw input for short strings with no match", () => {
    expect(extractId("short")).toBe("short");
  });
});

describe("isValidDriveLink", () => {
  it("returns true for drive.google.com URLs", () => {
    expect(isValidDriveLink("https://drive.google.com/file/d/abc123/view")).toBe(true);
  });

  it("returns true for URLs containing /d/", () => {
    expect(isValidDriveLink("https://docs.google.com/document/d/abc123/edit")).toBe(true);
  });

  it("returns false for non-Drive URLs", () => {
    expect(isValidDriveLink("https://example.com/file.pdf")).toBe(false);
  });

  it("returns false for non-string inputs", () => {
    expect(isValidDriveLink(null)).toBe(false);
    expect(isValidDriveLink(42)).toBe(false);
    expect(isValidDriveLink(undefined)).toBe(false);
  });
});

describe("createSeededRandom", () => {
  it("produces deterministic output for a given seed", () => {
    const rng1 = createSeededRandom(42);
    const rng2 = createSeededRandom(42);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it("produces different output for different seeds", () => {
    const rng1 = createSeededRandom(42);
    const rng2 = createSeededRandom(99);

    expect(rng1()).not.toEqual(rng2());
  });

  it("produces values in [0, 1)", () => {
    const rng = createSeededRandom(123);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it("produces values in [0, 1) when called without a seed", () => {
    const rng = createSeededRandom();
    const val = rng();
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThan(1);
  });
});

describe("sampleRows", () => {
  const data = [["a"], ["b"], ["c"], ["d"], ["e"]];

  it("returns the correct number of rows", () => {
    expect(sampleRows(data, 3, 42)).toHaveLength(3);
  });

  it("produces reproducible output for the same seed", () => {
    const first = sampleRows(data, 3, 42);
    const second = sampleRows(data, 3, 42);
    expect(first).toEqual(second);
  });

  it("produces different output for different seeds", () => {
    const first = sampleRows(data, 3, 42);
    const second = sampleRows(data, 3, 99);
    expect(first).not.toEqual(second);
  });

  it("returns all rows when sampleSize equals data length", () => {
    const result = sampleRows(data, 5, 42);
    expect(result).toHaveLength(5);
    expect(result).toEqual(expect.arrayContaining(data));
  });
});

describe("truncateText", () => {
  it("returns short text unchanged", () => {
    expect(truncateText("hello", 100)).toBe("hello");
  });

  it("returns text at exact limit unchanged", () => {
    const text = "a".repeat(100);
    expect(truncateText(text, 100)).toBe(text);
  });

  it("truncates text over the limit and appends suffix", () => {
    const text = "a".repeat(101);
    const result = truncateText(text, 100);
    expect(result).toBe("a".repeat(100) + "... [TRUNCATED]");
  });
});

describe("getAllFilesRecursive", () => {
  function makeFileIterator(urls: string[]) {
    let i = 0;
    return { hasNext: () => i < urls.length, next: () => ({ getUrl: () => urls[i++] }) };
  }

  function makeFolderIterator(folders: object[]) {
    let i = 0;
    return { hasNext: () => i < folders.length, next: () => folders[i++] };
  }

  function makeFolder(urls: string[], subfolders: object[] = []) {
    return {
      getFiles: () => makeFileIterator(urls),
      getFolders: () => makeFolderIterator(subfolders),
    };
  }

  it("collects file URLs from a flat folder", () => {
    const folder = makeFolder([
      "https://drive.google.com/file/d/abc",
      "https://drive.google.com/file/d/def",
    ]);
    const result: DriveFileInfo[] = [];
    getAllFilesRecursive(folder as any, result);
    expect(result).toEqual([
      { url: "https://drive.google.com/file/d/abc" },
      { url: "https://drive.google.com/file/d/def" },
    ]);
  });

  it("recurses into subfolders", () => {
    const subfolder = makeFolder(["https://drive.google.com/file/d/xyz"]);
    const rootFolder = makeFolder(["https://drive.google.com/file/d/abc"], [subfolder]);
    const result: DriveFileInfo[] = [];
    getAllFilesRecursive(rootFolder as any, result);
    expect(result).toEqual([
      { url: "https://drive.google.com/file/d/abc" },
      { url: "https://drive.google.com/file/d/xyz" },
    ]);
  });

  it("returns an empty list for an empty folder", () => {
    const folder = makeFolder([]);
    const result: DriveFileInfo[] = [];
    getAllFilesRecursive(folder as any, result);
    expect(result).toHaveLength(0);
  });

  it("filters by mimeType prefix when mimeTypePrefixes is provided", () => {
    const mockDoc = { getUrl: () => "doc-url", getMimeType: () => "application/vnd.google-apps.document" };
    const mockPdf = { getUrl: () => "pdf-url", getMimeType: () => "application/pdf" };
    const mockImg = { getUrl: () => "img-url", getMimeType: () => "image/png" };
    const files = makeFileIterator([]) as any;
    let i = 0;
    const mockFiles = [mockDoc, mockPdf, mockImg];
    const fileIter = { hasNext: () => i < mockFiles.length, next: () => mockFiles[i++] };
    const subfolders = makeFolderIterator([]);
    const folder = { getFiles: () => fileIter, getFolders: () => subfolders } as unknown as GoogleAppsScript.Drive.Folder;

    const result: DriveFileInfo[] = [];
    getAllFilesRecursive(folder, result, ["application/"]);
    expect(result.map((f) => f.url)).toEqual(["doc-url", "pdf-url"]);
  });

  it("imports all files when mimeTypePrefixes is absent", () => {
    const mockDoc = { getUrl: () => "doc-url", getMimeType: () => "application/vnd.google-apps.document" };
    const mockImg = { getUrl: () => "img-url", getMimeType: () => "image/png" };
    let i = 0;
    const mockFiles = [mockDoc, mockImg];
    const fileIter = { hasNext: () => i < mockFiles.length, next: () => mockFiles[i++] };
    const subfolders = makeFolderIterator([]);
    const folder = { getFiles: () => fileIter, getFolders: () => subfolders } as unknown as GoogleAppsScript.Drive.Folder;

    const result: DriveFileInfo[] = [];
    getAllFilesRecursive(folder, result);
    expect(result.map((f) => f.url)).toEqual(["doc-url", "img-url"]);
  });
});

describe("flattenArg", () => {
  it("wraps a scalar string in an array", () => {
    expect(flattenArg("hello")).toEqual(["hello"]);
  });

  it("flattens a vertical range (multiple rows, one column)", () => {
    expect(flattenArg([["row1"], ["row2"], ["row3"]])).toEqual(["row1", "row2", "row3"]);
  });

  it("flattens a horizontal range (one row, multiple columns)", () => {
    expect(flattenArg([["col1", "col2", "col3"]])).toEqual(["col1", "col2", "col3"]);
  });

  it("filters empty strings from ranges", () => {
    expect(flattenArg([["text", "", "more"]])).toEqual(["text", "more"]);
  });

  it("filters null values from ranges", () => {
    expect(flattenArg([["a", null, "b"]])).toEqual(["a", "b"]);
  });

  it("returns an empty array for null input", () => {
    expect(flattenArg(null)).toEqual([]);
  });

  it("returns an empty array for an empty string scalar", () => {
    expect(flattenArg("")).toEqual([]);
  });

  it("converts non-string scalars to strings", () => {
    expect(flattenArg(42)).toEqual(["42"]);
  });
});

describe("resolveColumns", () => {
  it("returns indices for all found names", () => {
    expect(resolveColumns(["a", "b", "c"], ["a", "c"])).toEqual([0, 2]);
  });

  it("returns -1 for names not in headers", () => {
    expect(resolveColumns(["a", "b"], ["c"])).toEqual([-1]);
  });

  it("returns empty array for empty names list", () => {
    expect(resolveColumns(["a", "b"], [])).toEqual([]);
  });

  it("returns -1 for all names when headers is empty", () => {
    expect(resolveColumns([], ["a"])).toEqual([-1]);
  });

  it("preserves the order of the names argument", () => {
    expect(resolveColumns(["x", "y", "z"], ["z", "x"])).toEqual([2, 0]);
  });
});

// ── findOrCreateColumn ──────────────────────────────────────────

describe("findOrCreateColumn", () => {
  function makeSheet(headers: string[]): GoogleAppsScript.Spreadsheet.Sheet {
    const values = [headers.slice()];
    return {
      getLastColumn: () => headers.length,
      getRange: jest
        .fn()
        .mockImplementation((_row: number, _col: number, numRows?: number, numCols?: number) => {
          if (numRows === 1 && numCols !== undefined) {
            return { getValues: () => values };
          }
          return { setValue: jest.fn() };
        }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
  }

  it("returns 1-based index of existing column", () => {
    const sheet = makeSheet(["Drive Link", "System Prompt", "Output"]);
    expect(findOrCreateColumn(sheet, "System Prompt")).toBe(2);
  });

  it("appends new column and returns its 1-based index when not found", () => {
    const sheet = makeSheet(["Drive Link"]);
    const setValueMock = jest.fn();
    (sheet.getRange as jest.Mock).mockImplementation(
      (_row: number, _col: number, numRows?: number, numCols?: number) => {
        if (numRows === 1 && numCols !== undefined) {
          return { getValues: () => [["Drive Link"]] };
        }
        return { setValue: setValueMock };
      },
    );
    const idx = findOrCreateColumn(sheet, "New Col");
    expect(idx).toBe(2);
    expect(setValueMock).toHaveBeenCalledWith("New Col");
  });

  it("appends to column 1 when sheet is empty", () => {
    const setValueMock = jest.fn();
    const sheet = {
      getLastColumn: () => 0,
      getRange: jest.fn().mockReturnValue({ setValue: setValueMock }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    const idx = findOrCreateColumn(sheet, "My Col");
    expect(idx).toBe(1);
    expect(setValueMock).toHaveBeenCalledWith("My Col");
  });

  it("applies wrapStrategy to the new column range when provided", () => {
    const setValueMock = jest.fn();
    const setWrapStrategyMock = jest.fn();
    const sheet = {
      getLastColumn: () => 0,
      getMaxRows: () => 100,
      getRange: jest
        .fn()
        .mockImplementation((_row: number, _col: number, numRows?: number) =>
          numRows !== undefined
            ? { setWrapStrategy: setWrapStrategyMock }
            : { setValue: setValueMock },
        ),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    const wrapStrategy = "CLIP" as unknown as GoogleAppsScript.Spreadsheet.WrapStrategy;
    findOrCreateColumn(sheet, "My Col", wrapStrategy);
    expect(setWrapStrategyMock).toHaveBeenCalledWith(wrapStrategy);
  });
});

// ── writeColumn ─────────────────────────────────────────────────

describe("writeJobProgress", () => {
  it("writes serialized progress to cache with 5-minute TTL", () => {
    const mockPut = jest.fn();
    const mockCache = { put: mockPut } as unknown as GoogleAppsScript.Cache.Cache;

    writeJobProgress(mockCache, "job-123", { message: "Processing row 3 of 10", current: 3, total: 10 });

    expect(mockPut).toHaveBeenCalledWith(
      "job-123",
      JSON.stringify({ message: "Processing row 3 of 10", current: 3, total: 10 }),
      300,
    );
  });

  it("writes message-only progress (no current/total)", () => {
    const mockPut = jest.fn();
    const mockCache = { put: mockPut } as unknown as GoogleAppsScript.Cache.Cache;

    writeJobProgress(mockCache, "job-456", { message: "Scanning folder..." });

    expect(mockPut).toHaveBeenCalledWith(
      "job-456",
      JSON.stringify({ message: "Scanning folder..." }),
      300,
    );
  });
});

describe("writeColumn", () => {
  it("writes values starting at row 2 using a single setValues call", () => {
    const setValuesMock = jest.fn();
    const sheet = {
      getRange: jest.fn().mockReturnValue({ setValues: setValuesMock }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    writeColumn(sheet, 3, ["a", "b", "c"]);
    expect(sheet.getRange).toHaveBeenCalledWith(2, 3, 3, 1);
    expect(setValuesMock).toHaveBeenCalledWith([["a"], ["b"], ["c"]]);
  });

  it("does nothing when values array is empty", () => {
    const sheet = {
      getRange: jest.fn(),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    writeColumn(sheet, 1, []);
    expect(sheet.getRange).not.toHaveBeenCalled();
  });

  it("applies wrapStrategy to the written range when provided", () => {
    const setValuesMock = jest.fn();
    const setWrapStrategyMock = jest.fn();
    const sheet = {
      getRange: jest
        .fn()
        .mockReturnValue({ setValues: setValuesMock, setWrapStrategy: setWrapStrategyMock }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    const wrapStrategy = "CLIP" as unknown as GoogleAppsScript.Spreadsheet.WrapStrategy;
    writeColumn(sheet, 3, ["a", "b"], wrapStrategy);
    expect(setWrapStrategyMock).toHaveBeenCalledWith(wrapStrategy);
  });
});
