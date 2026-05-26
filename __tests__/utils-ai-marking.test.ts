import { markAIOutputRange } from "../src/server/utils";

describe("markAIOutputRange", () => {
  it("sets amber background and note on header, light amber wash on data cells", () => {
    const headerRange = { setBackground: jest.fn(), setNote: jest.fn() };
    const dataRange = { setBackground: jest.fn() };

    const mockSheet = {
      getRange: jest.fn().mockReturnValueOnce(headerRange).mockReturnValueOnce(dataRange),
    };

    markAIOutputRange(
      mockSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet,
      3, // colIdx (1-based)
      5, // startRow
      10, // numRows
    );

    expect(mockSheet.getRange).toHaveBeenNthCalledWith(1, 1, 3);
    expect(headerRange.setBackground).toHaveBeenCalledWith("#F9AB00");
    expect(headerRange.setNote).toHaveBeenCalledWith(
      "Some cells in this column may be AI-generated — exercise good judgement when using",
    );

    expect(mockSheet.getRange).toHaveBeenNthCalledWith(2, 5, 3, 10, 1);
    expect(dataRange.setBackground).toHaveBeenCalledWith("#FFF8E1");
  });
});
