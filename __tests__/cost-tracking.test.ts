import { computeRunStats } from "../src/server/cost-tracking";
import type { GeminiResponse } from "../src/server/types";

function withUsage(
  promptTokenCount: number,
  candidatesTokenCount: number,
  thoughtsTokenCount?: number,
): GeminiResponse {
  return {
    text: "ok",
    usageMetadata: {
      promptTokenCount,
      candidatesTokenCount,
      thoughtsTokenCount,
      totalTokenCount: promptTokenCount + candidatesTokenCount + (thoughtsTokenCount ?? 0),
    },
  };
}

describe("computeRunStats", () => {
  it("computes rowCount, totalTimeMs, and token totals for a normal case", () => {
    const results = [withUsage(100, 50), withUsage(200, 75)];
    const stats = computeRunStats(results, 4200, "gemini-3.1-flash-lite");
    expect(stats.rowCount).toBe(2);
    expect(stats.totalTimeMs).toBe(4200);
    expect(stats.totalInputTokens).toBe(300);
    expect(stats.totalOutputTokens).toBe(125);
  });

  it("computes token cost using flash-lite standard pricing", () => {
    const results = [withUsage(1_000_000, 1_000_000)];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    // 1M input @ $0.25/M + 1M output @ $1.50/M = $1.75
    expect(stats.totalTokenCost).toBeCloseTo(1.75, 5);
  });

  it("folds thoughtsTokenCount into totalOutputTokens and bills it at the output rate", () => {
    const results = [withUsage(1_000_000, 0, 1_000_000)];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.totalOutputTokens).toBe(1_000_000);
    // 1M input @ $0.25/M + 1M thinking-as-output @ $1.50/M = $1.75
    expect(stats.totalTokenCost).toBeCloseTo(1.75, 5);
  });

  it("does not double-count input when toolUsePromptTokenCount would have been added", () => {
    // promptTokenCount already reflects the complete effective prompt —
    // there is no toolUsePromptTokenCount field on GeminiUsageMetadata to add.
    const results = [withUsage(100_000, 10_000)];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.totalInputTokens).toBe(100_000);
  });

  it("applies the over-200k pricing tier per-request for Pro Preview", () => {
    const results = [withUsage(250_000, 10_000)];
    const stats = computeRunStats(results, 1000, "gemini-3.1-pro-preview");
    // 250k input @ $4.00/M + 10k output @ $18.00/M
    const expected = (250_000 / 1_000_000) * 4.0 + (10_000 / 1_000_000) * 18.0;
    expect(stats.totalTokenCost).toBeCloseTo(expected, 5);
  });

  it("skips results with no usageMetadata (errors) when counting rows and tokens", () => {
    const results: GeminiResponse[] = [withUsage(100, 50), { text: "Error: boom" }];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.rowCount).toBe(1);
    expect(stats.totalInputTokens).toBe(100);
  });

  it("returns a zero-value result when no results have usageMetadata", () => {
    const results: GeminiResponse[] = [{ text: "Error: boom" }, { text: "Error: also boom" }];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.rowCount).toBe(0);
    expect(stats.totalInputTokens).toBe(0);
    expect(stats.totalTokenCost).toBe(0);
  });

  it("sums grounding queries across measured results unconditionally", () => {
    const results: GeminiResponse[] = [
      { ...withUsage(100, 50), groundingMetadata: { webSearchQueries: ["q1", "q2"] } },
      { ...withUsage(100, 50), groundingMetadata: { webSearchQueries: ["q3"] } },
      withUsage(100, 50), // no grounding at all
    ];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.totalGroundingQueries).toBe(3);
    // 3 queries / 1000 * $14.00
    expect(stats.totalGroundingCost).toBeCloseTo(0.042, 5);
  });

  it("has zero grounding cost when no result has groundingMetadata", () => {
    const results = [withUsage(100, 50)];
    const stats = computeRunStats(results, 1000, "gemini-3.1-flash-lite");
    expect(stats.totalGroundingQueries).toBe(0);
    expect(stats.totalGroundingCost).toBe(0);
  });
});
