/**
 * Tests for src/server/index.ts (Menu and sidebar functions)
 */

// ── Mock runInference (hoisted by Jest) ────────────────────────
jest.mock("../src/server/inference", () => ({
  runInference: jest.fn(),
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

import { onOpen, showSidebar, runTool, importDriveLinks, runBatchAI } from "../src/server/index";
import { runInference } from "../src/server/inference";

const mockRunInference = runInference as jest.MockedFunction<typeof runInference>;

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
    mockActiveSheet.getRange.mockReturnValue({ setValues: mockSetValues });
    mockActiveSheet.getLastColumn.mockReturnValue(1);
    mockActiveSheet.getLastRow.mockReturnValue(0);
    // Provide a header row for findOrCreateColumn
    mockActiveSheet.getRange.mockImplementation(
      (row: number, col: number, numRows?: number, _numCols?: number) => {
        if (row === 1 && col === 1 && numRows === 1) {
          return { getValues: () => [["source_drive"]] };
        }
        return { setValues: mockSetValues };
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
