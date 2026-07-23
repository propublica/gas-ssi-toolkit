/**
 * cost-tracking.ts — Pure cost/usage aggregation from Gemini API responses.
 *
 * No GAS globals. computeRunStats is the sole entry point, called by
 * runBatchAI after every invocation (full run, one chunk, or a Test click)
 * to measure what that invocation actually cost.
 */

import { resolvePricing, GROUNDING_PRICE_PER_1000_QUERIES } from "./pricing";
import type { GeminiResponse } from "./types";
import type { ModelId, RunStats } from "../shared/types";

export function computeRunStats(
  results: GeminiResponse[],
  elapsedMs: number,
  model: ModelId,
): Omit<RunStats, "testedAt" | "config"> {
  const measured = results.filter((r) => r.usageMetadata !== undefined);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalTokenCost = 0;

  for (const result of measured) {
    const usage = result.usageMetadata!;
    const outputTokens = usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0);
    const pricing = resolvePricing(model, usage.promptTokenCount);

    totalInputTokens += usage.promptTokenCount;
    totalOutputTokens += outputTokens;
    totalTokenCost +=
      (usage.promptTokenCount / 1_000_000) * pricing.inputPerMillion +
      (outputTokens / 1_000_000) * pricing.outputPerMillion;
  }

  const totalGroundingQueries = measured.reduce(
    (sum, r) => sum + (r.groundingMetadata?.webSearchQueries?.length ?? 0),
    0,
  );
  const totalGroundingCost = (totalGroundingQueries / 1000) * GROUNDING_PRICE_PER_1000_QUERIES;

  return {
    rowCount: measured.length,
    totalTimeMs: elapsedMs,
    totalInputTokens,
    totalOutputTokens,
    totalTokenCost,
    totalGroundingQueries,
    totalGroundingCost,
  };
}
