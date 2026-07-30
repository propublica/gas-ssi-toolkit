import {
  computeChunks,
  projectFullRunCost,
  accumulateRunStats,
  buildRunWarning,
} from "../src/client/panels/configure-ai-run";
import type { RunStats } from "../src/shared/types";
import type { MeasuredRun } from "../src/client/types";

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

const SAMPLE: RunStats = {
  rowCount: 10,
  totalTimeMs: 4200,
  totalInputTokens: 500,
  totalOutputTokens: 300,
  totalTokenCost: 0.02,
  totalGroundingQueries: 0,
  totalGroundingCost: 0,
  testedAt: 1234567890,
  config: {
    promptCols: [{ col: "col_a", kind: "text" }],
    systemPromptCol: undefined,
    tools: [],
    prefixWithColName: false,
    model: "gemini-3.1-flash-lite",
  },
};

describe("projectFullRunCost", () => {
  it("scales a token-only sample linearly", () => {
    // $0.02 over 10 rows = $0.002/row → 1000 rows = $2.00
    expect(projectFullRunCost(SAMPLE, 1000)).toBeCloseTo(2.0, 10);
  });

  it("includes grounding cost in the per-row rate", () => {
    const grounded: RunStats = { ...SAMPLE, totalGroundingCost: 0.14 };
    // ($0.02 + $0.14) over 10 rows = $0.016/row → 100 rows = $1.60
    expect(projectFullRunCost(grounded, 100)).toBeCloseTo(1.6, 10);
  });

  it("returns the sample's own cost when projecting to the sample size", () => {
    expect(projectFullRunCost(SAMPLE, SAMPLE.rowCount)).toBeCloseTo(0.02, 10);
  });

  it("handles a single-row sample", () => {
    const oneRow: RunStats = { ...SAMPLE, rowCount: 1, totalTokenCost: 0.005 };
    expect(projectFullRunCost(oneRow, 40)).toBeCloseTo(0.2, 10);
  });
});

describe("accumulateRunStats", () => {
  it("returns the chunk unchanged when there is no running total yet", () => {
    expect(accumulateRunStats(undefined, SAMPLE)).toEqual(SAMPLE);
  });

  it("sums every numeric field across two chunks", () => {
    const chunkB: RunStats = {
      ...SAMPLE,
      rowCount: 5,
      totalTimeMs: 1000,
      totalInputTokens: 200,
      totalOutputTokens: 100,
      totalTokenCost: 0.01,
      totalGroundingQueries: 2,
      totalGroundingCost: 0.03,
    };
    const result = accumulateRunStats(SAMPLE, chunkB);
    expect(result.rowCount).toBe(SAMPLE.rowCount + chunkB.rowCount);
    expect(result.totalTimeMs).toBe(SAMPLE.totalTimeMs + chunkB.totalTimeMs);
    expect(result.totalInputTokens).toBe(SAMPLE.totalInputTokens + chunkB.totalInputTokens);
    expect(result.totalOutputTokens).toBe(SAMPLE.totalOutputTokens + chunkB.totalOutputTokens);
    expect(result.totalTokenCost).toBeCloseTo(SAMPLE.totalTokenCost + chunkB.totalTokenCost, 10);
    expect(result.totalGroundingQueries).toBe(
      SAMPLE.totalGroundingQueries + chunkB.totalGroundingQueries,
    );
    expect(result.totalGroundingCost).toBeCloseTo(
      SAMPLE.totalGroundingCost + chunkB.totalGroundingCost,
      10,
    );
  });

  it("keeps the first chunk's testedAt and config", () => {
    const chunkB: RunStats = {
      ...SAMPLE,
      testedAt: SAMPLE.testedAt + 999,
      config: { ...SAMPLE.config, model: "gemini-3.1-pro-preview" },
    };
    const result = accumulateRunStats(SAMPLE, chunkB);
    expect(result.testedAt).toBe(SAMPLE.testedAt);
    expect(result.config).toBe(SAMPLE.config);
  });

  it("sums numeric fields the same regardless of argument order", () => {
    const chunkB: RunStats = {
      ...SAMPLE,
      rowCount: 7,
      totalTimeMs: 500,
      totalInputTokens: 50,
      totalOutputTokens: 25,
      totalTokenCost: 0.04,
      totalGroundingQueries: 1,
      totalGroundingCost: 0.02,
    };
    const forward = accumulateRunStats(SAMPLE, chunkB);
    const backward = accumulateRunStats(chunkB, SAMPLE);
    expect(forward.rowCount).toBe(backward.rowCount);
    expect(forward.totalTimeMs).toBe(backward.totalTimeMs);
    expect(forward.totalInputTokens).toBe(backward.totalInputTokens);
    expect(forward.totalOutputTokens).toBe(backward.totalOutputTokens);
    expect(forward.totalTokenCost).toBeCloseTo(backward.totalTokenCost, 10);
    expect(forward.totalGroundingQueries).toBe(backward.totalGroundingQueries);
    expect(forward.totalGroundingCost).toBeCloseTo(backward.totalGroundingCost, 10);
  });
});

// $5.00 over 10 rows = $0.50/row — crosses the $10 threshold at 21+ rows.
const EXPENSIVE: MeasuredRun = {
  stats: { ...SAMPLE, totalTokenCost: 5 },
  source: "test",
};
const CHEAP: MeasuredRun = { stats: SAMPLE, source: "test" };

describe("buildRunWarning", () => {
  describe("untested runs", () => {
    it("nudges above the chunk size", () => {
      const text = buildRunWarning({ start: 2, end: 42 }, 2, undefined, false)!;
      expect(text).toContain("41 rows across 2 chunks");
      expect(text).toContain("You haven't tested this configuration");
    });

    it("returns null at or below the chunk size", () => {
      expect(buildRunWarning({ start: 2, end: 41 }, 1, undefined, false)).toBeNull();
    });

    it("omits the file caveat, having no estimate to qualify", () => {
      const text = buildRunWarning({ start: 2, end: 42 }, 2, undefined, true)!;
      expect(text).not.toContain("Unusually large files");
    });
  });

  describe("measured runs", () => {
    it("warns with a projected cost above the threshold", () => {
      // 41 rows × $0.50/row = $20.50
      const text = buildRunWarning({ start: 2, end: 42 }, 2, EXPENSIVE, false)!;
      expect(text).toContain("Estimated cost: ~$20.50");
      expect(text).toContain("based on your last run of 10 rows");
      expect(text).toContain("Consider narrowing your row range first.");
      expect(text).not.toContain("You haven't tested");
    });

    it("returns null below the threshold, at any size", () => {
      // $0.002/row × 5,000 rows = $10 exactly — not "greater than", so no warning.
      expect(buildRunWarning({ start: 2, end: 5001 }, 125, CHEAP, false)).toBeNull();
    });

    it("projects from the row count it is given, not the measured sample size", () => {
      // 1,000 rows × $0.50/row = $500.00 — not the $5.00 the sample itself cost.
      const text = buildRunWarning({ start: 2, end: 1001 }, 25, EXPENSIVE, false)!;
      expect(text).toContain("Estimated cost: ~$500.00");
    });

    it("singularizes a one-row sample", () => {
      const oneRow: MeasuredRun = {
        stats: { ...SAMPLE, rowCount: 1, totalTokenCost: 1 },
        source: "test",
      };
      const text = buildRunWarning({ start: 2, end: 42 }, 2, oneRow, false)!;
      expect(text).toContain("based on your last run of 1 row.");
    });

    it("appends the file caveat when a prompt column is file-kind", () => {
      const text = buildRunWarning({ start: 2, end: 42 }, 2, EXPENSIVE, true)!;
      expect(text).toContain("Unusually large files may throw off this estimate.");
    });
  });

  describe("sidebar reminder", () => {
    it("appends for a multi-chunk run", () => {
      const text = buildRunWarning({ start: 2, end: 42 }, 2, EXPENSIVE, false)!;
      expect(text).toContain("Keep this sidebar open until the run finishes.");
    });

    it("is omitted for a single-chunk run that warns on cost alone", () => {
      const text = buildRunWarning({ start: 2, end: 41 }, 1, EXPENSIVE, false)!;
      expect(text).toContain("Estimated cost:");
      expect(text).not.toContain("Keep this sidebar open");
    });
  });
});
