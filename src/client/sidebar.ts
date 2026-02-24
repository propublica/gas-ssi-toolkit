import type { RunConfig } from "../shared/types";

/**
 * Renders multi-select tag buttons into a container.
 * Exported for testing.
 */
export function buildTagList(container: HTMLElement, headers: string[], selected?: string[]): void {
  void container;
  void headers;
  void selected;
}

/**
 * Renders single-select tag buttons into a container.
 * includeNew: append a "+ New column" tag with data-value="__new__".
 * Exported for testing.
 */
export function buildSingleTagList(
  container: HTMLElement,
  headers: string[],
  includeNew: boolean,
  selected?: string,
): void {
  void container;
  void headers;
  void includeNew;
  void selected;
}

/**
 * Applies a RunConfig preset by marking matching tags as selected.
 * Exported for testing.
 */
export function applyPreset(preset: Partial<RunConfig>): void {
  void preset;
}

/**
 * Reads current panel DOM state and returns a validated RunConfig.
 * Returns null and shows an alert if required fields are missing.
 * Exported for testing.
 */
export function assembleRunConfig(): RunConfig | null {
  return null;
}

/**
 * Shows/hides the row range inputs based on the selected radio.
 * Exported for testing.
 */
export function handleRowRangeChange(): void {}

/**
 * Wires all event listeners. Called once at the end of the script.
 * Not exported — not unit-tested (couples to google.script.run).
 */
function init(): void {}

init();
