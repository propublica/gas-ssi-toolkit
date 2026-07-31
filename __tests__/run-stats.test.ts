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

  it("normalizes a null systemPromptCol (as google.script.run's RPC bridge may deliver an omitted value) the same as undefined", () => {
    // TypeScript's RunConfig.systemPromptCol type is string|undefined, but google.script.run
    // serializes parameters through a JSON-like bridge that can coerce an undefined property
    // to null in transit — the server sees a value TypeScript's static types say can't happen.
    const withNull = buildConfigSnapshot({
      promptCols: [],
      outputCol: "out",
      systemPromptCol: null,
    } as unknown as Partial<RunConfig>);
    const withUndefined = buildConfigSnapshot({ promptCols: [], outputCol: "out" });
    expect(configsMatch(withNull, withUndefined)).toBe(true);
  });

  it("normalizes a null model the same as undefined, for the same reason", () => {
    const withNull = buildConfigSnapshot({
      promptCols: [],
      outputCol: "out",
      model: null,
    } as unknown as Partial<RunConfig>);
    const withUndefined = buildConfigSnapshot({ promptCols: [], outputCol: "out" });
    expect(configsMatch(withNull, withUndefined)).toBe(true);
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

  it("returns true for identical data with different top-level key order (google.script.run's RPC bridge does not preserve object key insertion order)", () => {
    // Real-world data captured from a production false-mismatch report: the client-computed
    // snapshot and the server round-tripped snapshot held identical values but arrived with
    // different key order, which a JSON.stringify string comparison treats as unequal.
    const live = {
      promptCols: [{ col: "Drive Link", kind: "file" as const }],
      systemPromptCol: "System Prompt",
      tools: [],
      prefixWithColName: false,
      model: "gemini-3.1-flash-lite" as const,
    };
    const cached = {
      systemPromptCol: "System Prompt",
      promptCols: [{ col: "Drive Link", kind: "file" as const }],
      model: "gemini-3.1-flash-lite" as const,
      prefixWithColName: false,
      tools: [],
    };
    expect(configsMatch(live, cached)).toBe(true);
  });

  it("returns true for identical promptCols entries with different key order within each element", () => {
    const a = buildConfigSnapshot({
      promptCols: [{ col: "a", kind: "text" }],
      outputCol: "out",
    });
    const b = buildConfigSnapshot({
      promptCols: [{ kind: "text", col: "a" } as unknown as { col: string; kind: "text" }],
      outputCol: "out",
    });
    expect(configsMatch(a, b)).toBe(true);
  });

  it("still returns false when promptCols differ in order (row order is semantically meaningful)", () => {
    const a = buildConfigSnapshot({
      promptCols: [
        { col: "a", kind: "text" },
        { col: "b", kind: "text" },
      ],
      outputCol: "out",
    });
    const b = buildConfigSnapshot({
      promptCols: [
        { col: "b", kind: "text" },
        { col: "a", kind: "text" },
      ],
      outputCol: "out",
    });
    expect(configsMatch(a, b)).toBe(false);
  });
});
