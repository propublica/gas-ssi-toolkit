import type { NavigationContext, Panel } from "../types";
import { runTool } from "../services";
import { jobStore } from "../job-store";

export class ToolListPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = this.template();
    this.wireEvents(container, nav);
  }

  unmount(): undefined {
    return undefined;
  }

  private wireEvents(container: HTMLElement, nav: NavigationContext): void {
    container.querySelector("#btn-run-ai")?.addEventListener("click", () => {
      nav.navigate("configure-ai-run");
    });
    container.querySelector("#btn-recipes")?.addEventListener("click", () => {
      nav.navigate("recipes-list");
    });
    container.querySelector("#btn-import-drive-links")?.addEventListener("click", () => {
      nav.navigate("import-drive-links");
    });
    container.querySelector("#btn-sample-rows")?.addEventListener("click", (e) => {
      this.dispatchTool(e as MouseEvent, "sampleRowsToEvaluation");
    });
    container.querySelector("#btn-extract-text")?.addEventListener("click", () => {
      nav.navigate("extract-text");
    });
  }

  private dispatchTool(e: MouseEvent, fn: string): void {
    const btn = e.currentTarget as HTMLButtonElement;
    const jobId = `${fn}-${Date.now()}`;
    const label = btn.textContent?.trim() ?? fn;
    jobStore
      .dispatch(jobId, label, runTool(fn, jobId))
      .catch((err: Error) => globalThis.alert("Error: " + err.message));
  }

  private template(): string {
    return `
      <div class="section">
        <h3>Main Tools</h3>
        <button id="btn-recipes" class="tool-btn">
          <span class="icon">🥞</span> Recipes
        </button>
        <button id="btn-run-ai" class="tool-btn">
          <span class="icon">▶️</span> Run AI Inference
        </button>
      </div>
      <div class="section">
        <h3>Extras</h3>
        <button id="btn-import-drive-links" class="tool-btn">
          <span class="icon">📂</span> Import Drive Links
        </button>
        <button id="btn-sample-rows" class="tool-btn">
          <span class="icon">🎲</span> Sample Rows
        </button>
        <button id="btn-extract-text" class="tool-btn">
          <span class="icon">📜</span> Extract Text
        </button>
      </div>
      <div class="status-footer">
        <strong>SSI Tools v2.1</strong><br>
        Powered by Gemini 3.1 Flash Lite<br>
        Evaluation Unrestricted Mode
      </div>
    `;
  }
}
