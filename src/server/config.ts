/**
 * config.ts — Central configuration.
 *
 * Matches the CONFIG object from the original Code.gs.
 */

import type { AppConfig } from "../shared/types";

export const CONFIG: AppConfig = {
  API_KEY_PROPERTY: "GEMINI_API_KEY",
  MODEL_NAME: "gemini-2.0-flash",
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024, // 25MB Apps Script limit
  COLUMNS: {
    SOURCE_DRIVE: "source_drive",
    SOURCE_TEXT: "source_text",
    SYS_PROMPT: "system_prompt",
    USER_PROMPT: "user_prompt",
    OUTPUT: "ai_inference",
  },
};
