/**
 * Tests for src/server/utils.ts
 *
 * These are the pure functions that have zero dependency on Apps Script
 * globals, so they need no mocking at all.
 */

import { extractId, isValidDriveLink, createSeededRandom, sampleRows } from "../src/server/utils";

describe("extractId", () => {
  it("extracts ID from a standard Drive file URL", () => {
    const url = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view";
    expect(extractId(url)).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  });

  it("extracts ID from a folder URL", () => {
    const url = "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    expect(extractId(url)).toBe("1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
  });

  it("returns the input if it already looks like an ID", () => {
    const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
    expect(extractId(id)).toBe(id);
  });

  it("returns empty string for null/undefined/non-string", () => {
    expect(extractId(null)).toBe("");
    expect(extractId(undefined)).toBe("");
    expect(extractId(123)).toBe("");
  });

  it("returns the raw input for short strings with no match", () => {
    expect(extractId("short")).toBe("short");
  });
});

describe("isValidDriveLink", () => {
  it("returns true for drive.google.com URLs", () => {
    expect(isValidDriveLink("https://drive.google.com/file/d/abc123/view")).toBe(true);
  });

  it("returns true for URLs containing /d/", () => {
    expect(isValidDriveLink("https://docs.google.com/document/d/abc123/edit")).toBe(true);
  });

  it("returns false for non-Drive URLs", () => {
    expect(isValidDriveLink("https://example.com/file.pdf")).toBe(false);
  });

  it("returns false for non-string inputs", () => {
    expect(isValidDriveLink(null)).toBe(false);
    expect(isValidDriveLink(42)).toBe(false);
    expect(isValidDriveLink(undefined)).toBe(false);
  });
});

describe("createSeededRandom", () => {
  it("produces deterministic output for a given seed", () => {
    const rng1 = createSeededRandom(42);
    const rng2 = createSeededRandom(42);

    const seq1 = Array.from({ length: 10 }, () => rng1());
    const seq2 = Array.from({ length: 10 }, () => rng2());

    expect(seq1).toEqual(seq2);
  });

  it("produces different output for different seeds", () => {
    const rng1 = createSeededRandom(42);
    const rng2 = createSeededRandom(99);

    expect(rng1()).not.toEqual(rng2());
  });

  it("produces values in [0, 1)", () => {
    const rng = createSeededRandom(123);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });
});

describe("sampleRows", () => {
  const data = [["a"], ["b"], ["c"], ["d"], ["e"]];

  it("returns the correct number of rows", () => {
    expect(sampleRows(data, 3, 42)).toHaveLength(3);
  });

  it("produces reproducible output for the same seed", () => {
    const first = sampleRows(data, 3, 42);
    const second = sampleRows(data, 3, 42);
    expect(first).toEqual(second);
  });

  it("produces different output for different seeds", () => {
    const first = sampleRows(data, 3, 42);
    const second = sampleRows(data, 3, 99);
    expect(first).not.toEqual(second);
  });

  it("returns all rows when sampleSize equals data length", () => {
    const result = sampleRows(data, 5, 42);
    expect(result).toHaveLength(5);
    expect(result).toEqual(expect.arrayContaining(data));
  });
});
