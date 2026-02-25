/// <reference types="node" />
/**
 * Shared DOM fixtures and setup utilities for sidebar tests.
 * Used by sidebar.test.ts and sidebar-entry.test.ts.
 *
 * FULL_SIDEBAR_HTML is read from src/Sidebar.html at test time so fixtures
 * stay structurally in sync with the real template — no manual drift.
 */

import { readFileSync } from "fs";
import { resolve } from "path";
import { buildTagList, buildSingleTagList, applyPreset } from "../../src/client/sidebar";

/**
 * The sidebar HTML template with {{STYLES}} and {{SCRIPTS}} placeholders
 * stripped. Structurally identical to what the browser receives at runtime.
 */
export const FULL_SIDEBAR_HTML = readFileSync(resolve(__dirname, "../../src/Sidebar.html"), "utf-8")
  .replace("{{STYLES}}", "")
  .replace("{{SCRIPTS}}", "");

const DEFAULT_HEADERS = [
  "col_a",
  "col_b",
  "col_c",
  "source_drive",
  "system_prompt",
  "ai_inference",
];

/**
 * Sets FULL_SIDEBAR_HTML on document.body and populates all four tag
 * containers with the given headers.
 */
export function setupConfigPanel(headers: string[] = DEFAULT_HEADERS): void {
  document.body.innerHTML = FULL_SIDEBAR_HTML;
  buildTagList(document.getElementById("user-prompt-cols")!, headers);
  buildTagList(document.getElementById("drive-file-cols")!, headers);
  buildSingleTagList(document.getElementById("system-prompt-col")!, headers, false);
  buildSingleTagList(document.getElementById("output-col")!, headers, true);
}

export interface SetupOpts {
  headers?: string[];
  userPrompt?: string[];
  drive?: string[];
  system?: string;
  output?: string;
  newOutputName?: string;
  rowRange?: { start: number; end: number };
}

/**
 * Calls setupConfigPanel, then uses applyPreset to pre-select values.
 * Promoted from the local helper in assembleRunConfig tests.
 */
export function setupWithSelections({
  headers,
  userPrompt = [],
  drive = [],
  system,
  output,
  newOutputName,
  rowRange,
}: SetupOpts = {}): void {
  setupConfigPanel(headers);
  if (userPrompt.length) applyPreset({ userPromptCols: userPrompt });
  if (drive.length) applyPreset({ driveFileCols: drive });
  if (system) applyPreset({ systemPromptCol: system });
  if (output) applyPreset({ outputCol: output });
  if (rowRange) applyPreset({ rowRange });
  if (newOutputName !== undefined) {
    const newBtn = document.querySelector<HTMLButtonElement>('#output-col [data-value="__new__"]')!;
    newBtn.click();
    (document.getElementById("new-col-input") as HTMLInputElement).value = newOutputName;
  }
}
