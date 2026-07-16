import { buildConfigSnapshot, configsMatch } from "../src/shared/run-stats";
import type { RunConfig } from "../src/shared/types";

describe("buildConfigSnapshot", () => {
  it("picks only the five cost-relevant fields", () => {
    const config: RunConfig = {
      promptCols: [{ col: "col_a", kind: "text" }],
      systemPromptCol: "sys",
      outputCol: "out",
      rowRange: { start: 2, end: 11 },
      tools: ["google_search"],
      includeGrounding: true,
      applyMarkdown: true,
      prefixWithColName: true,
      model: "gemini-3.1-pro-preview",
    };
    expect(buildConfigSnapshot(config)).toEqual({
      promptCols: [{ col: "col_a", kind: "text" }],
      systemPromptCol: "sys",
      tools: ["google_search"],
      prefixWithColName: true,
      model: "gemini-3.1-pro-preview",
    });
  });

  it("normalizes an absent tools array to []", () => {
    const config: Partial<RunConfig> = { promptCols: [], outputCol: "out" };
    expect(buildConfigSnapshot(config).tools).toEqual([]);
  });

  it("normalizes an absent prefixWithColName to false", () => {
    const config: Partial<RunConfig> = { promptCols: [], outputCol: "out" };
    expect(buildConfigSnapshot(config).prefixWithColName).toBe(false);
  });

  it("defaults promptCols to [] when absent (Partial<RunConfig> input)", () => {
    expect(buildConfigSnapshot({}).promptCols).toEqual([]);
  });
});

describe("configsMatch", () => {
  it("returns true for two snapshots built the same way", () => {
    const config: RunConfig = { promptCols: [{ col: "a", kind: "text" }], outputCol: "out" };
    expect(configsMatch(buildConfigSnapshot(config), buildConfigSnapshot(config))).toBe(true);
  });

  it("treats tools: undefined and tools: [] as equal", () => {
    const a = buildConfigSnapshot({ promptCols: [], outputCol: "out", tools: undefined });
    const b = buildConfigSnapshot({ promptCols: [], outputCol: "out", tools: [] });
    expect(configsMatch(a, b)).toBe(true);
  });

  it("returns false when promptCols differ", () => {
    const a = buildConfigSnapshot({ promptCols: [{ col: "a", kind: "text" }], outputCol: "out" });
    const b = buildConfigSnapshot({ promptCols: [{ col: "b", kind: "text" }], outputCol: "out" });
    expect(configsMatch(a, b)).toBe(false);
  });

  it("returns false when model differs", () => {
    const a = buildConfigSnapshot({
      promptCols: [],
      outputCol: "out",
      model: "gemini-3.1-flash-lite",
    });
    const b = buildConfigSnapshot({
      promptCols: [],
      outputCol: "out",
      model: "gemini-3.1-pro-preview",
    });
    expect(configsMatch(a, b)).toBe(false);
  });
});
