/**
 * GAS-coupled entry point for the sidebar.
 *
 * This file wires DOM events to google.script.run and is the Rollup entry
 * point for the client bundle. It is excluded from coverage collection for
 * the same reason src/server/index.ts is excluded — it is deeply coupled to
 * the GAS sandbox runtime and cannot be unit-tested.
 *
 * Pure helpers live in sidebar.ts and are fully unit-tested.
 */

import type { RunConfig } from "../shared/types";
import {
  buildTagList,
  buildSingleTagList,
  applyPreset,
  assembleRunConfig,
  handleRowRangeChange,
} from "./sidebar";

// ── Panel navigation ──────────────────────────────────────────────────────────

function showAIPanel(preset?: Partial<RunConfig>): void {
  document.getElementById("tool-list")!.style.display = "none";
  document.getElementById("ai-panel")!.style.display = "block";
  document.getElementById("config-form")!.style.display = "none";
  document.getElementById("no-headers-msg")!.style.display = "none";

  google.script.run
    .withSuccessHandler((headers: unknown) => {
      const hs = headers as string[];
      if (!hs || hs.length === 0) {
        document.getElementById("no-headers-msg")!.style.display = "block";
        return;
      }
      buildTagList(document.getElementById("user-prompt-cols")!, hs);
      buildTagList(document.getElementById("drive-file-cols")!, hs);
      buildSingleTagList(document.getElementById("system-prompt-col")!, hs, false);
      buildSingleTagList(document.getElementById("output-col")!, hs, true);
      if (preset) applyPreset(preset);
      document.getElementById("config-form")!.style.display = "block";
    })
    .withFailureHandler((msg: Error) => {
      alert("Error loading headers: " + msg.message);
      hideAIPanel();
    })
    .getSheetHeaders();
}

function hideAIPanel(): void {
  document.getElementById("ai-panel")!.style.display = "none";
  document.getElementById("tool-list")!.style.display = "block";
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

function dispatchTool(e: MouseEvent, fn: string): void {
  const btn = e.currentTarget as HTMLButtonElement;
  const orig = btn.innerHTML;
  btn.classList.add("loading");
  btn.innerHTML = '<span class="icon">⏳</span> Working...';
  google.script.run
    .withSuccessHandler(() => {
      btn.classList.remove("loading");
      btn.innerHTML = orig;
    })
    .withFailureHandler((msg: Error) => {
      alert("Error: " + msg.message);
      btn.classList.remove("loading");
      btn.innerHTML = orig;
    })
    .runTool(fn);
}

// ── Run AI ────────────────────────────────────────────────────────────────────

function runAI(): void {
  const config = assembleRunConfig();
  if (!config) return;

  const btn = document.getElementById("run-btn") as HTMLButtonElement;
  btn.disabled = true;
  btn.textContent = "Running...";

  google.script.run
    .withSuccessHandler(() => {
      btn.disabled = false;
      btn.textContent = "Run AI";
      hideAIPanel();
    })
    .withFailureHandler((msg: Error) => {
      alert("Error: " + msg.message);
      btn.disabled = false;
      btn.textContent = "Run AI";
    })
    .runBatchAI(config);
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Wires all event listeners. Called once at the end of the script.
 */
function init(): void {
  document
    .getElementById("btn-import-drive-links")
    ?.addEventListener("click", (e) => dispatchTool(e as MouseEvent, "importDriveLinks"));

  document.getElementById("btn-run-ai")?.addEventListener("click", () => showAIPanel());

  document
    .getElementById("btn-sample-rows")
    ?.addEventListener("click", (e) => dispatchTool(e as MouseEvent, "sampleRowsToEvaluation"));

  document
    .getElementById("btn-extract-text")
    ?.addEventListener("click", (e) => dispatchTool(e as MouseEvent, "extractTextFromSelection"));

  document.getElementById("back-btn")?.addEventListener("click", () => hideAIPanel());
  document.getElementById("cancel-btn")?.addEventListener("click", () => hideAIPanel());
  document.getElementById("run-btn")?.addEventListener("click", () => runAI());

  document
    .querySelectorAll<HTMLInputElement>('input[name="row-range"]')
    .forEach((radio) => radio.addEventListener("change", handleRowRangeChange));
}

init();
