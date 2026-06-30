/**
 * config.ts — Central configuration.
 *
 * Matches the CONFIG object from the original Code.gs.
 */

import type { AppConfig } from "./types";

export const CONFIG: AppConfig = {
  API_KEY_PROPERTY: "GEMINI_API_KEY",
  DEFAULT_MODEL: "gemini-3.1-flash-lite",
  INLINE_MAX_TOTAL_BYTES: 95 * 1024 * 1024, // 95MB (100MB ceiling × 0.95)
  INLINE_MAX_PDF_BYTES: 47 * 1024 * 1024, // 47MB (50MB ceiling × 0.95)
  INLINE_PREFLIGHT_FACTOR: 4 / 3, // exact base64 expansion ratio
  // MAX_OUTPUT_TOKENS: 1024, // Removed to prevent silent truncation of AI responses.
};
