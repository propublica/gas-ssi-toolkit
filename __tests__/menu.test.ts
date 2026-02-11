/**
 * Tests for src/server/index.ts (Menu related functions)
 */

// ── Mock globals BEFORE imports ────────────────────────────────

const mockAddItem = jest.fn().mockReturnThis(); // This allows chaining
const mockAddSeparator = jest.fn().mockReturnThis(); // Added this line
const mockAddToUi = jest.fn();
const mockMenu = {
  addItem: mockAddItem,
  addSeparator: mockAddSeparator, // Added this line
  addToUi: mockAddToUi,
};
const mockCreateMenu = jest.fn().mockReturnValue(mockMenu);
const mockUi = {
  createMenu: mockCreateMenu,
};
const mockSpreadsheetApp = {
  getUi: jest.fn().mockReturnValue(mockUi),
};

(globalThis as any).SpreadsheetApp = mockSpreadsheetApp;

// ── Import after mocks ─────────────────────────────────────────

import { onOpen } from "../src/server/index";

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
