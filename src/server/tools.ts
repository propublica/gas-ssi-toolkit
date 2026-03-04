/**
 * server/tools.ts — Unified tool registry.
 *
 * Maps every ToolId to its Gemini payload construction data.
 * Record<ToolId, GeminiTool> enforces at compile time that every ToolId
 * has a matching server implementation — adding a new ToolId without a
 * registry entry is a type error.
 *
 * To add a new tool:
 * 1. Add its ID to ToolId in src/shared/types.ts
 * 2. Add an entry here
 * 3. Add a display entry to TOOL_CATALOG in src/client/tools.ts
 */

import type { ToolId } from "../shared/types";
import type { GeminiTool } from "./types";

export const TOOL_REGISTRY: Record<ToolId, GeminiTool> = {
  google_search: { kind: "grounding", id: "google_search" },
};
