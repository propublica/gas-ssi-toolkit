import { protectAIOutputRange, markAIOutputRange } from "../src/server/utils";

function makeProtection(): {
  setDescription: jest.Mock;
  remove: jest.Mock;
} {
  const p = { setDescription: jest.fn(), remove: jest.fn() };
  p.setDescription.mockReturnValue(p);
  return p;
}

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

describe("protectAIOutputRange", () => {
  it("protects the header cell and data range as separate ranges", () => {
    const headerProtection = makeProtection();
    const dataProtection = makeProtection();

    const mockSheet = {
      getRange: jest
        .fn()
        .mockReturnValueOnce({ protect: jest.fn().mockReturnValue(headerProtection) })
        .mockReturnValueOnce({ protect: jest.fn().mockReturnValue(dataProtection) }),
    };

    const result = protectAIOutputRange(
      mockSheet as unknown as GoogleAppsScript.Spreadsheet.Sheet,
      3, // colIdx (1-based)
      5, // startRow
      10, // numRows
    );

    expect(mockSheet.getRange).toHaveBeenNthCalledWith(1, 1, 3);
    expect(mockSheet.getRange).toHaveBeenNthCalledWith(2, 5, 3, 10, 1);
    expect(headerProtection.setDescription).toHaveBeenCalledWith(
      "AI run in progress — please wait",
    );
    expect(dataProtection.setDescription).toHaveBeenCalledWith("AI run in progress — please wait");
    expect(result).toEqual([headerProtection, dataProtection]);
  });
});
