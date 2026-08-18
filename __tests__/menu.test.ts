/**
 * Tests for src/server/index.ts (Menu and sidebar functions)
 */

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
  flush: jest.fn(),
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

import {
  onOpen,
  showSidebar,
  runTool,
  importDriveLinks,
  getDefaultRowRange,
  prepRecipe,
} from "../src/server/index";

// ── Tests ──────────────────────────────────────────────────────

describe("onOpen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates a menu named '📐 SSI Toolkit'", () => {
    onOpen();
    expect(mockCreateMenu).toHaveBeenCalledWith("📐 SSI Toolkit");
  });

  it("adds a single item that opens the sidebar", () => {
    onOpen();
    expect(mockAddItem).toHaveBeenCalledTimes(1);
    expect(mockAddItem).toHaveBeenCalledWith("📐 Open SSI Toolkit", "showSidebar");
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

describe("getDefaultRowRange", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns row 2 through the sheet's last row", () => {
    mockActiveSheet.getLastRow.mockReturnValue(11);
    expect(getDefaultRowRange()).toEqual({ start: 2, end: 11 });
  });

  it("returns null when the sheet has only a header row", () => {
    mockActiveSheet.getLastRow.mockReturnValue(1);
    expect(getDefaultRowRange()).toBeNull();
  });

  it("returns null for a completely empty sheet", () => {
    mockActiveSheet.getLastRow.mockReturnValue(0);
    expect(getDefaultRowRange()).toBeNull();
  });
});

describe("prepRecipe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveSheet.getLastColumn.mockReturnValue(1);
    (mockActiveSheet as unknown as { getMaxRows: jest.Mock }).getMaxRows = jest
      .fn()
      .mockReturnValue(1000);
    // findOrCreateColumn's header lookup, its new-header-cell write, its
    // wrap-strategy range, and writeColumn's data write are all distinct
    // getRange call shapes sharing one mock, distinguished by arg shape.
    mockActiveSheet.getRange.mockImplementation(
      (row: number, col: number, numRows?: number, numCols?: number) => {
        if (row === 1 && col === 1 && numRows === 1 && numCols !== undefined) {
          return { getValues: () => [["existing_col"]] }; // header-row lookup
        }
        if (row === 1 && numRows === undefined) {
          return { setValue: jest.fn() }; // new column's header cell
        }
        if (row === 1 && numCols === 1) {
          return { setWrapStrategy: jest.fn() }; // wrap-strategy range
        }
        return { setValues: mockSetValues, setWrapStrategy: jest.fn() }; // data write (writeColumn)
      },
    );
  });

  it("fills a bare fill-value column to match the sheet's existing row count when no list-drive-folder spec is present", () => {
    mockActiveSheet.getLastRow.mockReturnValue(51); // header + 50 data rows

    const result = prepRecipe({
      cols: [
        {
          colTitle: "System Prompt",
          fillStrategy: { kind: "fill-value", value: "Summarize this." },
        },
      ],
      inputValues: {},
    });

    expect(mockSetValues).toHaveBeenCalledWith(Array(50).fill(["Summarize this."]));
    expect(result).toEqual({ rowRange: { start: 2, end: 51 } });
  });

  it("falls back to 1 row when the sheet has only a header row and no folder spec", () => {
    mockActiveSheet.getLastRow.mockReturnValue(1);

    prepRecipe({
      cols: [{ colTitle: "System Prompt", fillStrategy: { kind: "fill-value", value: "x" } }],
      inputValues: {},
    });

    expect(mockSetValues).toHaveBeenCalledWith([["x"]]);
  });

  it("keeps numRows folder-count-driven when a list-drive-folder spec is present, ignoring a larger pre-existing sheet size (regression guard)", () => {
    // Sheet already has far more rows than the folder has files — this must
    // NOT inflate the accompanying fill-value column beyond the folder count.
    mockActiveSheet.getLastRow.mockReturnValue(500);
    const mockFiles = (() => {
      const files = [
        { getUrl: () => "https://drive.google.com/file/1" },
        { getUrl: () => "https://drive.google.com/file/2" },
      ];
      let i = 0;
      return { hasNext: () => i < files.length, next: () => files[i++] };
    })();
    const mockSubfolders = { hasNext: () => false, next: () => undefined };
    (globalThis as unknown as { DriveApp: unknown }).DriveApp = {
      getFolderById: jest.fn().mockReturnValue({
        getFiles: () => mockFiles,
        getFolders: () => mockSubfolders,
      }),
    };

    prepRecipe({
      cols: [
        { colTitle: "Drive Link", fillStrategy: { kind: "list-drive-folder", inputId: "folder" } },
        { colTitle: "System Prompt", fillStrategy: { kind: "fill-value", value: "Summarize." } },
      ],
      inputValues: { folder: "https://drive.google.com/drive/folders/abc123" },
    });

    expect(mockSetValues).toHaveBeenCalledWith(Array(2).fill(["Summarize."]));
  });
});
