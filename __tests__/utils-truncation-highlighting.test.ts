import { markTruncationHighlight } from "../src/server/utils";

describe("markTruncationHighlight", () => {
  it("sets a highlight background when the cell is truncated", () => {
    const cell = { setBackground: jest.fn() };

    markTruncationHighlight(cell as unknown as GoogleAppsScript.Spreadsheet.Range, true);

    expect(cell.setBackground).toHaveBeenCalledWith("#FCE8E6");
  });

  it("clears the background when the cell is not truncated", () => {
    const cell = { setBackground: jest.fn() };

    markTruncationHighlight(cell as unknown as GoogleAppsScript.Spreadsheet.Range, false);

    expect(cell.setBackground).toHaveBeenCalledWith(null);
  });
});
