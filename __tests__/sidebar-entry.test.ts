/**
 * @jest-environment jsdom
 *
 * Tests for sidebar-entry.ts — GAS-coupled panel navigation and tool dispatch.
 * Functions are tested by capturing the success/failure handlers they register
 * with google.script.run and invoking them manually, without a GAS runtime.
 *
 * init() is not tested — it contains only addEventListener wiring.
 */

const mockRun = {
  withSuccessHandler: jest.fn().mockReturnThis(),
  withFailureHandler: jest.fn().mockReturnThis(),
  runTool: jest.fn(),
  getSheetHeaders: jest.fn(),
  runBatchAI: jest.fn(),
};
(globalThis as unknown as { google: unknown }).google = { script: { run: mockRun } };
globalThis.alert = jest.fn();

import { showAIPanel, hideAIPanel, dispatchTool } from "../src/client/sidebar-entry";
import { setupConfigPanel } from "./helpers/sidebar-fixtures";

// Captured callbacks — assigned fresh in each beforeEach via mockImplementation.
let capturedSuccess: (v: unknown) => void;
let capturedFailure: (e: Error) => void;

beforeEach(() => {
  jest.clearAllMocks();
  mockRun.withSuccessHandler.mockImplementation((fn: (v: unknown) => void) => {
    capturedSuccess = fn;
    return mockRun;
  });
  mockRun.withFailureHandler.mockImplementation((fn: (e: Error) => void) => {
    capturedFailure = fn;
    return mockRun;
  });
  setupConfigPanel();
});

// ── hideAIPanel ───────────────────────────────────────────────────────────────

describe("hideAIPanel", () => {
  it("hides ai-panel and shows tool-list", () => {
    document.getElementById("ai-panel")!.style.display = "block";
    document.getElementById("tool-list")!.style.display = "none";
    hideAIPanel();
    expect(document.getElementById("ai-panel")!.style.display).toBe("none");
    expect(document.getElementById("tool-list")!.style.display).toBe("block");
  });
});

// ── showAIPanel ───────────────────────────────────────────────────────────────

describe("showAIPanel", () => {
  it("hides tool-list and shows ai-panel", () => {
    showAIPanel();
    expect(document.getElementById("tool-list")!.style.display).toBe("none");
    expect(document.getElementById("ai-panel")!.style.display).toBe("block");
  });

  it("calls getSheetHeaders", () => {
    showAIPanel();
    expect(mockRun.getSheetHeaders).toHaveBeenCalledTimes(1);
  });

  it("on success with headers: shows config-form and builds tag lists", () => {
    showAIPanel();
    capturedSuccess(["col_a", "col_b"]);
    expect(document.getElementById("config-form")!.style.display).toBe("block");
    expect(document.querySelectorAll("#user-prompt-cols .tag")).toHaveLength(2);
    // includeNew=true adds a __new__ tag, so output-col has headers.length + 1
    expect(document.querySelectorAll("#output-col .tag")).toHaveLength(3);
  });

  it("on success with a preset: applies preset after building tag lists", () => {
    showAIPanel({ userPromptCols: ["col_a"] });
    capturedSuccess(["col_a", "col_b"]);
    const selected = document.querySelectorAll("#user-prompt-cols .tag.selected");
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-value")).toBe("col_a");
  });

  it("on success with empty headers: shows no-headers-msg and hides config-form", () => {
    showAIPanel();
    capturedSuccess([]);
    expect(document.getElementById("no-headers-msg")!.style.display).toBe("block");
    expect(document.getElementById("config-form")!.style.display).toBe("none");
  });

  it("on failure: alerts with the error message and hides ai-panel", () => {
    showAIPanel();
    capturedFailure(new Error("Network error"));
    expect(globalThis.alert).toHaveBeenCalledWith("Error loading headers: Network error");
    expect(document.getElementById("ai-panel")!.style.display).toBe("none");
    expect(document.getElementById("tool-list")!.style.display).toBe("block");
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a button with the given innerHTML and a MouseEvent whose currentTarget is that button. */
function makeButtonEvent(html = "Click"): { e: MouseEvent; btn: HTMLButtonElement } {
  const btn = document.createElement("button");
  btn.innerHTML = html;
  document.body.appendChild(btn);
  const e = new MouseEvent("click");
  Object.defineProperty(e, "currentTarget", { value: btn, writable: false });
  return { e, btn };
}

// ── dispatchTool ──────────────────────────────────────────────────────────────

describe("dispatchTool", () => {
  it("adds loading class and sets loading text on the button", () => {
    const { e, btn } = makeButtonEvent("Import");
    dispatchTool(e, "importDriveLinks");
    expect(btn.classList.contains("loading")).toBe(true);
    expect(btn.innerHTML).toContain("Working...");
  });

  it("calls runTool with the given function name", () => {
    const { e } = makeButtonEvent();
    dispatchTool(e, "importDriveLinks");
    expect(mockRun.runTool).toHaveBeenCalledWith("importDriveLinks");
  });

  it("on success: removes loading class and restores original innerHTML", () => {
    const { e, btn } = makeButtonEvent("Import");
    dispatchTool(e, "importDriveLinks");
    capturedSuccess(undefined);
    expect(btn.classList.contains("loading")).toBe(false);
    expect(btn.innerHTML).toBe("Import");
  });

  it("on failure: alerts, removes loading class, restores original innerHTML", () => {
    const { e, btn } = makeButtonEvent("Import");
    dispatchTool(e, "importDriveLinks");
    capturedFailure(new Error("Drive error"));
    expect(globalThis.alert).toHaveBeenCalledWith("Error: Drive error");
    expect(btn.classList.contains("loading")).toBe(false);
    expect(btn.innerHTML).toBe("Import");
  });
});
