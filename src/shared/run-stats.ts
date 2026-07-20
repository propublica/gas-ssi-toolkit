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

/**
 * Order-independent structural equality. google.script.run's serialization bridge
 * does not preserve object key insertion order when a value round-trips through it
 * (confirmed from a real false-mismatch report: two structurally identical
 * RunStatsConfigSnapshots arrived with different top-level key order), so a
 * JSON.stringify string comparison is not a safe way to compare two values where
 * one of them may have crossed that boundary. Array element order is preserved
 * and does matter (e.g. promptCols' row order changes the assembled prompt) —
 * only object key order is treated as insignificant.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
    );
  }
  return false;
}

export function configsMatch(a: RunStatsConfigSnapshot, b: RunStatsConfigSnapshot): boolean {
  return deepEqual(a, b);
}
