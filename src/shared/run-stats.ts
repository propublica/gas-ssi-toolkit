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
    // google.script.run serializes parameters through a JSON-like bridge that can
    // coerce an undefined property to null in transit — normalize both to undefined
    // so a value that only crossed that RPC boundary on one side of a comparison
    // (e.g. the server's copy of a RunConfig vs. the client's live component state)
    // doesn't register as a config change.
    systemPromptCol: config.systemPromptCol ?? undefined,
    tools: config.tools ?? [],
    prefixWithColName: config.prefixWithColName ?? false,
    model: config.model ?? undefined,
  };
}

export function configsMatch(a: RunStatsConfigSnapshot, b: RunStatsConfigSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
