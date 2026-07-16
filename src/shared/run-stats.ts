/**
 * run-stats.ts — Config-snapshot utilities shared by client and server.
 *
 * Both sides need to agree on exactly which RunConfig fields affect cost;
 * living here (not shared/types.ts, which is types-only) keeps that single
 * definition from drifting between the server's stats-write path and the
 * client's staleness check.
 */

import type { RunConfig, RunStatsConfigSnapshot } from "./types";

export function buildConfigSnapshot(config: Partial<RunConfig>): RunStatsConfigSnapshot {
  return {
    promptCols: config.promptCols ?? [],
    systemPromptCol: config.systemPromptCol,
    tools: config.tools ?? [],
    prefixWithColName: config.prefixWithColName ?? false,
    model: config.model,
  };
}

export function configsMatch(a: RunStatsConfigSnapshot, b: RunStatsConfigSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
