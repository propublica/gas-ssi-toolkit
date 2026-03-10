/**
 * config.ts — Central configuration.
 *
 * Matches the CONFIG object from the original Code.gs.
 */

import type { AppConfig } from "./types";

export const CONFIG: AppConfig = {
  API_KEY_PROPERTY: "GEMINI_API_KEY",
  MODEL_NAME: "gemini-3.1-flash-lite-preview",
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
  MAX_OUTPUT_TOKENS: 1024,
};
