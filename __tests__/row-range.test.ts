import { sanitizeRowRange } from "../src/client/components/row-range";

describe("sanitizeRowRange", () => {
  it("passes through a valid range unchanged", () => {
    expect(sanitizeRowRange({ start: 5, end: 10 })).toEqual({ start: 5, end: 10 });
  });

  it("clamps a start row below 2 up to 2", () => {
    expect(sanitizeRowRange({ start: 1, end: 10 })).toEqual({ start: 2, end: 10 });
  });

  it("returns null when the range is only the header row", () => {
    expect(sanitizeRowRange({ start: 1, end: 1 })).toBeNull();
  });

  it("returns null when the range is inverted, independent of row 1", () => {
    expect(sanitizeRowRange({ start: 5, end: 3 })).toBeNull();
  });
});
