import { formatDuration, truncate } from "../src/client/format";

describe("formatDuration", () => {
  it("formats sub-minute durations as seconds with one decimal", () => {
    expect(formatDuration(4200)).toBe("4.2s");
    expect(formatDuration(500)).toBe("0.5s");
    expect(formatDuration(0)).toBe("0.0s");
  });

  it("formats minute-scale durations as Xm Ys", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(78000)).toBe("1m 18s");
    expect(formatDuration(150000)).toBe("2m 30s");
  });

  it("formats hour-scale durations as Xh Ym", () => {
    expect(formatDuration(3600000)).toBe("1h 0m");
    expect(formatDuration(5400000)).toBe("1h 30m");
  });

  it("rounds a value that is just under a minute-boundary up into the next unit correctly", () => {
    // 59.96s rounds to 60.0s at one-decimal precision, which should display as
    // the next unit up (1m 0s), not the misleading "60.0s".
    expect(formatDuration(59960)).toBe("1m 0s");
  });

  it("rounds fractional seconds within the Xm Ys format rather than truncating", () => {
    // 119.6s -> naive floor/round-separately math could produce "1m 60s"; must
    // round the total first, then derive minutes/seconds from the rounded value.
    expect(formatDuration(119600)).toBe("2m 0s");
  });
});

describe("truncate", () => {
  it("returns the string unchanged when at or under maxLength", () => {
    expect(truncate("hello", 5)).toBe("hello");
    expect(truncate("hi", 5)).toBe("hi");
  });

  it("cuts to maxLength and appends an ellipsis when over the limit", () => {
    expect(truncate("hello world", 5)).toBe("hello…");
  });

  it("counts a prefix baked into the string against the limit, not just the content after it", () => {
    expect(truncate("Prompt: " + "x".repeat(80), 60)).toBe("Prompt: " + "x".repeat(52) + "…");
  });
});
