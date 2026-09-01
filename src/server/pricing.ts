/**
 * pricing.ts — Gemini API pricing catalog (Standard tier).
 *
 * Uses Standard synchronous pricing, not the discounted async Batch API tier —
 * this app calls generateContent synchronously via UrlFetchApp.fetchAll, which
 * bills at Standard rates regardless of this codebase's own "runBatchAI" naming.
 *
 * Source: https://ai.google.dev/gemini-api/docs/pricing (fetched 2026-08-31).
 */

import type { ModelId } from "../shared/types";

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  inputPerMillionOver200k?: number;
  outputPerMillionOver200k?: number;
}

export const PRICING_CATALOG: Record<ModelId, ModelPricing> = {
  "gemini-3.1-flash-lite": { inputPerMillion: 0.25, outputPerMillion: 1.5 },
  // Promotional pricing through 12/31/26; reverts to $1.50/$7.50 after.
  "gemini-3.7-flash": { inputPerMillion: 0.75, outputPerMillion: 3.75 },
  "gemini-3.1-pro-preview": {
    inputPerMillion: 2.0,
    outputPerMillion: 12.0,
    inputPerMillionOver200k: 4.0,
    outputPerMillionOver200k: 18.0,
  },
};

/**
 * Google Search grounding is billed per query, separate from token pricing.
 * Ignores the shared monthly free quota (5,000 queries/month, account-wide) —
 * that state is outside this app's visibility, so cost is always computed
 * "as if paid."
 */
export const GROUNDING_PRICE_PER_1000_QUERIES = 14.0;

const PRO_PREVIEW_TIER_THRESHOLD_TOKENS = 200_000;

/** Resolves the correct pricing tier for a single request based on its prompt size. */
export function resolvePricing(
  model: ModelId,
  promptTokenCount: number,
): { inputPerMillion: number; outputPerMillion: number } {
  const base = PRICING_CATALOG[model];
  if (
    promptTokenCount > PRO_PREVIEW_TIER_THRESHOLD_TOKENS &&
    base.inputPerMillionOver200k !== undefined
  ) {
    return {
      inputPerMillion: base.inputPerMillionOver200k,
      outputPerMillion: base.outputPerMillionOver200k ?? base.outputPerMillion,
    };
  }
  return { inputPerMillion: base.inputPerMillion, outputPerMillion: base.outputPerMillion };
}
