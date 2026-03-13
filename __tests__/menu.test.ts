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

import { onOpen, showSidebar, runTool } from "../src/server/index";

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

  it("dispatches 'importDriveLinks' without throwing", () => {
    // importDriveLinks calls ui.prompt() which is mocked to return CANCEL (early exit)
    expect(() => runTool("importDriveLinks")).not.toThrow();
  });

  it("throws for an unknown function name", () => {
    expect(() => runTool("doesNotExist")).toThrow("Function not found: doesNotExist");
  });
});
