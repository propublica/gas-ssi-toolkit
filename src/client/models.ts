/**
 * client/models.ts — Client-side model catalog.
 *
 * Provides display metadata for models shown in the sidebar model selector.
 * Hardcoded at build time — the model list is static compiled code,
 * not user data, so no RPC is needed to populate it.
 *
 * When adding a new model:
 * 1. Add its ID to ModelId in src/shared/types.ts
 * 2. Add a display entry here
 */

import type { ModelId } from "../shared/types";

/**
 * Display metadata for a model shown in the sidebar.
 * Contains only what the client needs — no API details or configuration.
 */
export interface ModelCatalogEntry {
  id: ModelId;
  name: string;
  description: string;
}

export const MODEL_CATALOG: ModelCatalogEntry[] = [
  {
    id: "gemini-3.1-flash-lite",
    name: "Gemini 3.1 Flash Lite",
    description:
      "Best for translation, transcription, lightweight data extraction, and document processing at scale. Use when cost and speed matter most.",
  },
  {
    id: "gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    description:
      "Best for rapid agentic loops, complex coding cycles, and iterative multi-step tasks. A great all-rounder for most AI runs.",
  },
  {
    id: "gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro Preview",
    description:
      "Best for precise tool usage and reliable multi-step execution where accuracy and reasoning depth matter most.",
  },
];
