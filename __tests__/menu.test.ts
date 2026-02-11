/**
 * Tests for src/server/index.ts (Menu related functions)
 */

// ── Mock globals BEFORE imports ────────────────────────────────

const mockAddItem = jest.fn().mockReturnThis(); // This allows chaining
const mockAddSeparator = jest.fn().mockReturnThis();
const mockAddToUi = jest.fn();
const mockMenu = {
  addItem: mockAddItem,
  addSeparator: mockAddSeparator,
  addToUi: mockAddToUi,
};
const mockCreateMenu = jest.fn().mockReturnValue(mockMenu);
const mockShowModalDialog = jest.fn(); // Mock for showModalDialog
const mockUi = {
  createMenu: mockCreateMenu,
  showModalDialog: mockShowModalDialog, // Added this
};
const mockSpreadsheetApp = {
  getUi: jest.fn().mockReturnValue(mockUi),
};

const mockCreateHtmlOutput = jest.fn().mockReturnValue({
  // Mock methods that return 'this' for chaining
  setWidth: jest.fn().mockReturnThis(),
  setHeight: jest.fn().mockReturnThis(),
});
const mockHtmlService = {
  createHtmlOutput: mockCreateHtmlOutput,
};

(globalThis as any).SpreadsheetApp = mockSpreadsheetApp;
(globalThis as any).HtmlService = mockHtmlService; // Mock HtmlService

// ── Import after mocks ─────────────────────────────────────────

import { onOpen, openQuickstartDoc } from "../src/server/index"; // Import openQuickstartDoc

// ── Tests ──────────────────────────────────────────────────────

describe("onOpen", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should create an 'SSI Toolkit' menu", () => {
    onOpen();
    expect(mockSpreadsheetApp.getUi).toHaveBeenCalledTimes(1);
    expect(mockCreateMenu).toHaveBeenCalledWith("⚡ SSI Tools");
  });

  it("should add '0. Quickstart' as the first menu item", () => {
    onOpen();
    expect(mockAddItem).toHaveBeenNthCalledWith(1, "0. Quickstart", "openQuickstartDoc");
  });

  it("should add the menu to the UI", () => {
    onOpen();
    expect(mockAddToUi).toHaveBeenCalledTimes(1);
  });
});

describe("openQuickstartDoc", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should open the quickstart document in a new tab", () => {
    openQuickstartDoc();

    // Expect HtmlService.createHtmlOutput to be called with specific content
    expect(mockCreateHtmlOutput).toHaveBeenCalledWith(
      expect.stringContaining(
        "window.open('https://docs.google.com/document/d/1BQJzBHiE6L0hvU6NMD0jaQE71VWRpWH-vNQu3UtGjBA/edit?usp=sharing', '_blank');google.script.host.close();",
      ),
    );

    // Expect showModalDialog to be called
    expect(mockShowModalDialog).toHaveBeenCalledTimes(1);
    expect(mockCreateHtmlOutput().setWidth).toHaveBeenCalledWith(10); // Check for arbitrary width
    expect(mockCreateHtmlOutput().setHeight).toHaveBeenCalledWith(10); // Check for arbitrary height
  });
});
