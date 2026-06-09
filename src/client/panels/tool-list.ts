import type { NavigationContext, Panel } from "../types";
import { runTool } from "../services";
import { jobStore } from "../job-store";
import { RECIPES } from "../recipes";

export class ToolListPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = this.template();
    this.wireEvents(container, nav);
  }

  unmount(): undefined {
    return undefined;
  }

  private wireEvents(container: HTMLElement, nav: NavigationContext): void {
    const documentSummarization = RECIPES.find((r) => r.id === "document-summarization");
    container.querySelector("#btn-document-summarization")?.addEventListener("click", () => {
      if (documentSummarization) nav.navigate("recipe", documentSummarization);
    });
    container.querySelector("#btn-run-ai")?.addEventListener("click", () => {
      nav.navigate("configure-ai-run");
    });
    container.querySelector("#btn-import-drive-links")?.addEventListener("click", () => {
      nav.navigate("import-drive-links");
    });
    container.querySelector("#btn-extract-text")?.addEventListener("click", () => {
      nav.navigate("extract-text");
    });
    container.querySelector("#btn-sample-rows")?.addEventListener("click", (e) => {
      this.dispatchTool(e as MouseEvent, "sampleRowsToEvaluation");
    });
  }

  private dispatchTool(e: MouseEvent, fn: string): void {
    const btn = e.currentTarget as HTMLButtonElement;
    const jobId = `${fn}-${Date.now()}`;
    const label =
      btn
        .querySelector<HTMLSpanElement>(".tool-btn-text > span:first-child")
        ?.textContent?.trim() ?? fn;
    jobStore
      .dispatch(jobId, label, runTool(fn, jobId))
      .catch((err: Error) => globalThis.alert("Error: " + err.message));
  }

  private template(): string {
    return `
      <p class="home-prompt">I want to...</p>
      <button id="btn-document-summarization" class="tool-btn">
        <span class="icon">📄</span>
        <span class="tool-btn-text">
          <span>Summarize a Drive folder</span>
          <span class="tool-btn-sub">For FOIA drops, court filings, doc sets</span>
        </span>
      </button>
      <button id="btn-run-ai" class="tool-btn">
        <span class="icon">▶️</span>
        <span class="tool-btn-text">
          <span>Run AI across my spreadsheet</span>
          <span class="tool-btn-sub">Your prompts, your data, your tools — totally freeform</span>
        </span>
      </button>
      <button id="btn-import-drive-links" class="tool-btn">
        <span class="icon">📂</span>
        <span class="tool-btn-text">
          <span>Import files from a Drive folder</span>
          <span class="tool-btn-sub">Track progress through doc dumps</span>
        </span>
      </button>
      <button id="btn-extract-text" class="tool-btn">
        <span class="icon">📜</span>
        <span class="tool-btn-text">
          <span>Extract text from files</span>
          <span class="tool-btn-sub">Import text from PDFs, images, and Docs</span>
        </span>
      </button>
      <button id="btn-sample-rows" class="tool-btn">
        <span class="icon">🎲</span>
        <span class="tool-btn-text">
          <span>Pull a random sample</span>
          <span class="tool-btn-sub">Get a sense of what you have</span>
        </span>
      </button>
      <div class="status-footer">
        <strong>SSI Tools v2.1</strong><br>
        Powered by Gemini 3.1 Flash Lite<br>
        Evaluation Unrestricted Mode
      </div>
    `;
  }
}
