/**
 * Tests for src/server/index.ts (Menu and sidebar functions)
 */

// ── Mock runInference (hoisted by Jest) ────────────────────────
jest.mock("../src/server/inference", () => ({
  runInference: jest.fn(),
}));

// ── Mock getAllFilesRecursive (keep rest of utils real) ─────────
jest.mock("../src/server/utils", () => ({
  ...jest.requireActual("../src/server/utils"),
  getAllFilesRecursive: jest.fn(),
}));

// ── Mock globals BEFORE imports ────────────────────────────────

const mockAddItem = jest.fn().mockReturnThis();
const mockAddToUi = jest.fn();
const mockMenu = {
  addItem: mockAddItem,
  addToUi: mockAddToUi,
};
const mockCreateMenu = jest.fn().mockReturnValue(mockMenu);
const mockShowModalDialog = jest.fn();
const mockShowSidebarFn = jest.fn();
const mockPromptResponse = {
  getSelectedButton: jest.fn().mockReturnValue("CANCEL"),
  getResponseText: jest.fn().mockReturnValue(""),
};
const mockUi = {
  createMenu: mockCreateMenu,
  showModalDialog: mockShowModalDialog,
  showSidebar: mockShowSidebarFn,
  Button: { OK: "OK", YES: "YES", NO: "NO", CANCEL: "CANCEL" },
  ButtonSet: { OK_CANCEL: "OK_CANCEL", YES_NO: "YES_NO", OK: "OK" },
  prompt: jest.fn().mockReturnValue(mockPromptResponse),
  alert: jest.fn(),
};
const mockActiveSheet = {
  getActiveCell: jest.fn().mockReturnValue({ getA1Notation: jest.fn().mockReturnValue("A1") }),
  getActiveRange: jest.fn(),
  getLastRow: jest.fn().mockReturnValue(0),
  getLastColumn: jest.fn().mockReturnValue(0),
  getMaxRows: jest.fn().mockReturnValue(100),
  getRange: jest.fn(),
  getName: jest.fn().mockReturnValue("Sheet1"),
};
const mockSpreadsheetApp = {
  getUi: jest.fn().mockReturnValue(mockUi),
  getActiveSpreadsheet: jest.fn().mockReturnValue({
    getActiveSheet: jest.fn().mockReturnValue(mockActiveSheet),
    getSheetByName: jest.fn().mockReturnValue(null),
    insertSheet: jest.fn().mockReturnValue(mockActiveSheet),
    setActiveSheet: jest.fn(),
    toast: jest.fn(),
  }),
  getActive: jest.fn().mockReturnValue({ toast: jest.fn() }),
  WrapStrategy: { CLIP: "CLIP", WRAP: "WRAP", OVERFLOW: "OVERFLOW" },
};

const mockEvaluate = jest.fn().mockReturnValue({
  setTitle: jest.fn().mockReturnThis(),
  setWidth: jest.fn().mockReturnThis(),
});
const mockCreateTemplateFromFile = jest.fn().mockReturnValue({
  evaluate: mockEvaluate,
});
const mockCreateHtmlOutput = jest.fn().mockReturnValue({
  setWidth: jest.fn().mockReturnThis(),
  setHeight: jest.fn().mockReturnThis(),
});
const mockHtmlService = {
  createHtmlOutput: mockCreateHtmlOutput,
  createTemplateFromFile: mockCreateTemplateFromFile,
};

(globalThis as any).SpreadsheetApp = mockSpreadsheetApp;
(globalThis as any).HtmlService = mockHtmlService;

// ── Import after mocks ─────────────────────────────────────────

import { onOpen, showSidebar, runTool, importDriveLinks, runBatchAI, prepRecipe } from "../src/server/index";
import { runInference } from "../src/server/inference";
import { getAllFilesRecursive } from "../src/server/utils";

const mockRunInference = runInference as jest.MockedFunction<typeof runInference>;
const mockGetAllFilesRecursive = getAllFilesRecursive as jest.MockedFunction<
  typeof getAllFilesRecursive
>;

// ── Tests ──────────────────────────────────────────────────────

describe("onOpen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a menu named '⚡ SSI Toolkit'", () => {
    onOpen();
    expect(mockCreateMenu).toHaveBeenCalledWith("⚡ SSI Toolkit");
  });

  it("adds a single item that opens the sidebar", () => {
    onOpen();
    expect(mockAddItem).toHaveBeenCalledTimes(1);
    expect(mockAddItem).toHaveBeenCalledWith("🚀 Open SSI Toolkit", "showSidebar");
  });

  it("adds the menu to the UI", () => {
    onOpen();
    expect(mockAddToUi).toHaveBeenCalledTimes(1);
  });
});

describe("showSidebar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("loads the sidebar from the 'Sidebar' template file", () => {
    showSidebar();
    expect(mockCreateTemplateFromFile).toHaveBeenCalledWith("Sidebar");
  });

  it("evaluates the template and shows the sidebar", () => {
    showSidebar();
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    expect(mockShowSidebarFn).toHaveBeenCalledTimes(1);
  });
});

describe("runTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("does nothing for an unknown function name", () => {
    expect(() => runTool("doesNotExist")).not.toThrow();
  });
});

const mockSetValues = jest.fn();

describe("importDriveLinks", () => {
  function makeFileIterator(files: { getUrl: () => string; getMimeType: () => string }[]) {
    let i = 0;
    return { hasNext: () => i < files.length, next: () => files[i++] };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore real getAllFilesRecursive behaviour for importDriveLinks tests
    const realUtils = jest.requireActual<typeof import("../src/server/utils")>(
      "../src/server/utils",
    );
    mockGetAllFilesRecursive.mockImplementation(realUtils.getAllFilesRecursive);

    mockActiveSheet.getRange.mockReturnValue({ setValues: mockSetValues });
    mockActiveSheet.getLastColumn.mockReturnValue(1);
    mockActiveSheet.getLastRow.mockReturnValue(0);
    // Provide a header row for findOrCreateColumn
    mockActiveSheet.getRange.mockImplementation(
      (row: number, col: number, numRows?: number, _numCols?: number) => {
        if (row === 1 && col === 1 && numRows === 1) {
          return { getValues: () => [["source_drive"]] };
        }
        return { setValues: mockSetValues, setWrapStrategy: jest.fn() };
      },
    );
  });

  it("calls DriveApp and writes file URLs to the output column", () => {
    const mockFile = {
      getUrl: (): string => "https://drive.google.com/file/1",
      getMimeType: (): string => "application/pdf",
    };
    const mockFiles = makeFileIterator([mockFile]);
    const mockSubfolders = makeFileIterator([]);
    const mockFolder = {
      getFiles: () => mockFiles,
      getFolders: () => mockSubfolders,
    };
    (globalThis as unknown as { DriveApp: unknown }).DriveApp = {
      getFolderById: jest.fn().mockReturnValue(mockFolder),
    };

    importDriveLinks({
      folderUrl: "https://drive.google.com/drive/folders/abc123",
      outputCol: "source_drive",
    });

    expect(mockSetValues).toHaveBeenCalledWith([["https://drive.google.com/file/1"]]);
  });
});

const mockSetValue = jest.fn();
const mockFlush = jest.fn();

describe("runBatchAI", () => {
  // Headers: [Prompt(0), DriveLink(1), Output(2)]
  const HEADERS = ["Prompt", "Drive Link", "Output"];

  beforeEach(() => {
    jest.clearAllMocks();
    mockRunInference.mockReturnValue({ text: "AI result" });
    (globalThis as unknown as { SpreadsheetApp: unknown }).SpreadsheetApp = {
      ...mockSpreadsheetApp,
      flush: mockFlush,
      getActive: jest.fn().mockReturnValue({ toast: jest.fn() }),
    };

    // Sheet: 3 columns (Prompt, Drive Link, Output), last row = 2
    mockActiveSheet.getLastColumn.mockReturnValue(3);
    mockActiveSheet.getLastRow.mockReturnValue(2);

    mockActiveSheet.getRange.mockImplementation(
      (row: number, col: number, numRows?: number, numCols?: number) => {
        // Header row read for getSheetHeaders
        if (row === 1 && col === 1 && numRows === 1) {
          return { getValues: () => [HEADERS] };
        }
        // Data range read for the row loop
        if (numRows !== undefined && numCols !== undefined) {
          return {
            getValues: () => [["hello prompt", "https://drive.google.com/file/abc", ""]],
          };
        }
        // Individual cell write
        return { setValue: mockSetValue, setRichTextValue: jest.fn() };
      },
    );

    // SpreadsheetApp.flush is called after each row
    (globalThis as unknown as { SpreadsheetApp: { flush: jest.Mock } }).SpreadsheetApp.flush =
      mockFlush;
  });

  it("writes runInference result to output column", () => {
    const config = {
      userPromptParts: [{ kind: "text" as const, col: "Prompt" }],
      outputCol: "Output",
      rowRange: { start: 2, end: 2 },
    };

    runBatchAI(config);

    expect(mockRunInference).toHaveBeenCalledTimes(1);
    expect(mockSetValue).toHaveBeenCalledWith("AI result");
  });

  it("alerts and returns early when a userPromptParts column is missing", () => {
    const config = {
      userPromptParts: [{ kind: "text" as const, col: "NonExistent" }],
      outputCol: "Output",
      rowRange: { start: 2, end: 2 },
    };

    runBatchAI(config);

    expect(mockUi.alert).toHaveBeenCalledWith(
      "Error: Missing Columns",
      expect.stringContaining("NonExistent"),
      expect.anything(),
    );
    expect(mockRunInference).not.toHaveBeenCalled();
  });

  it("skips rows where runInference returns null", () => {
    mockRunInference.mockReturnValue(null);
    const config = {
      userPromptParts: [{ kind: "text" as const, col: "Prompt" }],
      outputCol: "Output",
      rowRange: { start: 2, end: 2 },
    };

    runBatchAI(config);

    expect(mockRunInference).toHaveBeenCalledTimes(1);
    expect(mockSetValue).not.toHaveBeenCalled();
  });

  it("passes userPromptParts to runInference in declared order", () => {
    // Headers: Context(0), Doc(1), Question(2), Output(3)
    const orderedHeaders = ["Context", "Doc", "Question", "Output"];
    mockActiveSheet.getLastColumn.mockReturnValue(4);
    mockActiveSheet.getRange.mockImplementation(
      (row: number, col: number, numRows?: number, numCols?: number) => {
        if (row === 1 && col === 1 && numRows === 1) {
          return { getValues: () => [orderedHeaders] };
        }
        if (numRows !== undefined && numCols !== undefined) {
          return {
            getValues: () => [["ctx val", "doc val", "q val", ""]],
          };
        }
        return { setValue: mockSetValue, setRichTextValue: jest.fn() };
      },
    );

    const config = {
      userPromptParts: [
        { kind: "text" as const, col: "Context" },
        { kind: "file" as const, col: "Doc" },
        { kind: "text" as const, col: "Question" },
      ],
      outputCol: "Output",
      rowRange: { start: 2, end: 2 },
    };

    runBatchAI(config);

    expect(mockRunInference).toHaveBeenCalledWith(
      [
        { kind: "text", value: "ctx val" },
        { kind: "file", value: "doc val" },
        { kind: "text", value: "q val" },
      ],
      undefined,
      undefined,
    );
  });
});

// ── prepRecipe helpers ─────────────────────────────────────────

const mockWriteColumnCalls: Array<{ colIdx: number; values: string[] }> = [];
const mockFindOrCreateColumnResults: Map<string, number> = new Map();

describe("prepRecipe", () => {
  const mockFlushPrep = jest.fn();

  // Track writeColumn calls by spying on mockActiveSheet.getRange behaviour.
  // findOrCreateColumn and writeColumn use the real util implementations,
  // which call sheet.getRange / setValues under the hood.
  // We capture calls via mockActiveSheet.getRange mock.

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllFilesRecursive.mockReset();
    mockWriteColumnCalls.length = 0;
    mockFindOrCreateColumnResults.clear();

    // SpreadsheetApp.flush is called at the end of prepRecipe
    (globalThis as unknown as { SpreadsheetApp: typeof mockSpreadsheetApp & { flush: jest.Mock } })
      .SpreadsheetApp.flush = mockFlushPrep;

    // Sheet setup for findOrCreateColumn + writeColumn:
    //   - getLastColumn returns 0 so findOrCreateColumn always appends a new col
    //   - getRange(1, 1, 1, ...) returns a header row (empty so no match → append)
    //   - getRange(2, colIdx, numRows, 1) is called by writeColumn → setValues
    mockActiveSheet.getLastColumn.mockReturnValue(0);
    mockActiveSheet.getLastRow.mockReturnValue(10);

    mockActiveSheet.getRange.mockImplementation(
      (row: number, col: number, numRows?: number, numCols?: number) => {
        // Header row read by findOrCreateColumn (getRange(1, 1, 1, lastCol))
        if (row === 1 && col === 1 && numRows === 1) {
          return { getValues: () => [[]] };
        }
        // Header cell title write by findOrCreateColumn: getRange(1, newCol)
        if (row === 1 && numRows === undefined) {
          return { setValue: jest.fn() };
        }
        // Wrap strategy range: getRange(1, newCol, maxRows, 1) — row=1, numRows>1
        if (row === 1 && numRows !== undefined && numRows > 1 && numCols === 1) {
          return { setWrapStrategy: jest.fn() };
        }
        // writeColumn range: (2, colIdx, n, 1)
        if (row === 2 && numRows !== undefined && numCols === 1) {
          const captured = { colIdx: col, values: [] as string[] };
          mockWriteColumnCalls.push(captured);
          return {
            setValues: (vals: string[][]) => {
              captured.values = vals.map((r) => r[0]);
            },
            setWrapStrategy: jest.fn(),
          };
        }
        // Fallback
        return { setValue: jest.fn(), setValues: jest.fn(), setWrapStrategy: jest.fn() };
      },
    );

    // DriveApp.getFolderById — always returns a stub folder
    (globalThis as unknown as { DriveApp: unknown }).DriveApp = {
      getFolderById: jest.fn().mockReturnValue({}),
    };
  });

  it("writes drive-file-folder column and sets rowRange from file count", () => {
    // getAllFilesRecursive mutates files array — inject 3 entries
    mockGetAllFilesRecursive.mockImplementation(
      (_folder: unknown, files: { url: string }[]) => {
        files.push(
          { url: "https://drive.google.com/file/a" },
          { url: "https://drive.google.com/file/b" },
          { url: "https://drive.google.com/file/c" },
        );
      },
    );

    const result = prepRecipe({
      columns: [
        {
          kind: "drive-file-folder",
          colTitle: "Drive Link",
          url: "https://drive.google.com/drive/folders/abc1234567890123456789012345",
        },
      ],
    });

    expect(result.rowRange).toEqual({ start: 2, end: 4 });
    expect(result.columns).toEqual([{ kind: "drive-file-folder", colTitle: "Drive Link" }]);
    expect(mockWriteColumnCalls).toHaveLength(1);
    expect(mockWriteColumnCalls[0].values).toEqual([
      "https://drive.google.com/file/a",
      "https://drive.google.com/file/b",
      "https://drive.google.com/file/c",
    ]);
  });

  it("writes drive-file-constant same URL to every row", () => {
    // First column: folder with 2 files → numRows = 2
    mockGetAllFilesRecursive.mockImplementation(
      (_folder: unknown, files: { url: string }[]) => {
        files.push(
          { url: "https://drive.google.com/file/x" },
          { url: "https://drive.google.com/file/y" },
        );
      },
    );

    const constUrl = "https://drive.google.com/file/d/xyz123456789012345678901234/view";

    const result = prepRecipe({
      columns: [
        {
          kind: "drive-file-folder",
          colTitle: "Drive Link",
          url: "https://drive.google.com/drive/folders/abc1234567890123456789012345",
        },
        {
          kind: "drive-file-constant",
          colTitle: "Ref File",
          url: constUrl,
        },
      ],
    });

    expect(result.rowRange).toEqual({ start: 2, end: 3 });
    // Find the writeColumn call for "Ref File" — it's the second call
    const refFileWrite = mockWriteColumnCalls[1];
    expect(refFileWrite).toBeDefined();
    expect(refFileWrite.values).toEqual([constUrl, constUrl]);
  });

  it("writes system-prompt text to every row", () => {
    mockGetAllFilesRecursive.mockImplementation(
      (_folder: unknown, files: { url: string }[]) => {
        files.push(
          { url: "https://drive.google.com/file/p" },
          { url: "https://drive.google.com/file/q" },
        );
      },
    );

    const result = prepRecipe({
      columns: [
        {
          kind: "drive-file-folder",
          colTitle: "Drive Link",
          url: "https://drive.google.com/drive/folders/abc1234567890123456789012345",
        },
        {
          kind: "system-prompt",
          colTitle: "System Prompt",
          text: "You are an analyst.",
        },
      ],
    });

    expect(result.rowRange).toEqual({ start: 2, end: 3 });
    const sysPromptWrite = mockWriteColumnCalls[1];
    expect(sysPromptWrite).toBeDefined();
    expect(sysPromptWrite.values).toEqual(["You are an analyst.", "You are an analyst."]);
  });

  it("writes user-prompt text to every row", () => {
    mockGetAllFilesRecursive.mockImplementation(
      (_folder: unknown, files: { url: string }[]) => {
        files.push({ url: "https://drive.google.com/file/r" });
      },
    );

    prepRecipe({
      columns: [
        {
          kind: "drive-file-folder",
          colTitle: "Drive Link",
          url: "https://drive.google.com/drive/folders/abc1234567890123456789012345",
        },
        {
          kind: "user-prompt",
          colTitle: "User Prompt",
          text: "Summarize this document.",
        },
      ],
    });

    const userPromptWrite = mockWriteColumnCalls[1];
    expect(userPromptWrite).toBeDefined();
    expect(userPromptWrite.values).toEqual(["Summarize this document."]);
  });

  it("creates output column without writing data", () => {
    // No folder column — numRows stays 1, but output column should only be created
    const result = prepRecipe({
      columns: [{ kind: "output", colTitle: "AI_Output" }],
    });

    expect(result.columns).toEqual([{ kind: "output", colTitle: "AI_Output" }]);
    // writeColumn should NOT have been called (no data written for output)
    expect(mockWriteColumnCalls).toHaveLength(0);
    // rowRange defaults to { start: 2, end: 2 } (numRows=1)
    expect(result.rowRange).toEqual({ start: 2, end: 2 });
  });

  it("echoes settings in result", () => {
    const result = prepRecipe({
      columns: [{ kind: "output", colTitle: "Out" }],
      settings: { tools: ["google_search"], applyMarkdown: true },
    });

    expect(result.settings).toEqual({ tools: ["google_search"], applyMarkdown: true });
  });

  it("returns columns in input order", () => {
    mockGetAllFilesRecursive.mockImplementation(
      (_folder: unknown, files: { url: string }[]) => {
        files.push({ url: "https://drive.google.com/file/s" });
      },
    );

    const result = prepRecipe({
      columns: [
        {
          kind: "drive-file-folder",
          colTitle: "Drive Link",
          url: "https://drive.google.com/drive/folders/abc1234567890123456789012345",
        },
        {
          kind: "user-prompt",
          colTitle: "User Prompt",
          text: "Describe the file.",
        },
        { kind: "output", colTitle: "Result" },
      ],
    });

    expect(result.columns.map((c) => c.kind)).toEqual([
      "drive-file-folder",
      "user-prompt",
      "output",
    ]);
    expect(result.columns.map((c) => c.colTitle)).toEqual([
      "Drive Link",
      "User Prompt",
      "Result",
    ]);
  });

  it("uses numRows=1 for drive-file-constant when no folder column precedes it", () => {
    const constUrl = "https://drive.google.com/file/d/xyz123456789012345678901234/view";

    const result = prepRecipe({
      columns: [
        {
          kind: "drive-file-constant",
          colTitle: "Ref File",
          url: constUrl,
        },
      ],
    });

    expect(result.rowRange).toEqual({ start: 2, end: 2 });
    expect(mockWriteColumnCalls).toHaveLength(1);
    expect(mockWriteColumnCalls[0].values).toEqual([constUrl]);
  });
});
