/**
 * config.ts — Central configuration.
 *
 * Matches the CONFIG object from the original Code.gs.
 */

import type { AppConfig } from "./types";

export const CONFIG: AppConfig = {
  API_KEY_PROPERTY: "GEMINI_API_KEY",
  MODEL_NAME: "gemini-2.0-flash",
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,
};
