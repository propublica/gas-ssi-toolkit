/**
 * client/tools.ts — Client-side tool catalog.
 *
 * Provides display metadata for tools shown in the sidebar TagList.
 * Hardcoded at build time — the tool list is static compiled code,
 * not user data, so no RPC is needed to populate it.
 *
 * When adding a new tool:
 * 1. Add its ID to ToolId in src/shared/types.ts
 * 2. Add a matching entry to TOOL_REGISTRY in src/server/tools.ts
 * 3. Add a display entry here
 */

import type { ToolId } from "../shared/types";

/**
 * Display metadata for a tool shown in the sidebar TagList.
 * Contains only what the client needs — no payload or kind information.
 */
export interface ToolCatalogEntry {
  id: ToolId;
  name: string;
  description: string;
}

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  {
    id: "google_search",
    name: "Google Search",
    description: "Ground responses in live web search results",
  },
];
