import { computeChunks } from "../src/client/panels/configure-ai-run";

describe("computeChunks", () => {
  it("returns a single chunk when row count equals chunk size", () => {
    expect(computeChunks({ start: 2, end: 51 }, 50)).toEqual([{ start: 2, end: 51 }]);
  });

  it("returns a single chunk when row count is less than chunk size", () => {
    expect(computeChunks({ start: 2, end: 11 }, 50)).toEqual([{ start: 2, end: 11 }]);
  });

  it("returns multiple full chunks", () => {
    expect(computeChunks({ start: 2, end: 101 }, 50)).toEqual([
      { start: 2, end: 51 },
      { start: 52, end: 101 },
    ]);
  });

  it("trims the last chunk to the actual end row", () => {
    expect(computeChunks({ start: 2, end: 75 }, 50)).toEqual([
      { start: 2, end: 51 },
      { start: 52, end: 75 },
    ]);
  });

  it("handles a start row other than 2", () => {
    expect(computeChunks({ start: 10, end: 69 }, 50)).toEqual([
      { start: 10, end: 59 },
      { start: 60, end: 69 },
    ]);
  });

  it("returns a single chunk for exactly one row", () => {
    expect(computeChunks({ start: 5, end: 5 }, 50)).toEqual([{ start: 5, end: 5 }]);
  });
});
