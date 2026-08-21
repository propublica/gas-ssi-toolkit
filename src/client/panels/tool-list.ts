import type { NavigationContext, Panel } from "../types";
import { runTool, formatMarkdownSelection } from "../services";
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
    container.querySelector("#btn-guided-ai")?.addEventListener("click", () => {
      nav.navigate("guided-ai-inference");
    });
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
    container.querySelector("#btn-format-markdown")?.addEventListener("click", () => {
      const btn = container.querySelector<HTMLButtonElement>("#btn-format-markdown")!;
      const originalHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="icon">📝</span> Formatting...';
      formatMarkdownSelection()
        .catch((err: Error) => globalThis.alert("Error: " + err.message))
        .finally(() => {
          btn.disabled = false;
          btn.innerHTML = originalHtml;
        });
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
        <h3>AI</h3>
        <button id="btn-guided-ai" class="tool-btn">
          <span class="icon">🧭</span>
          <div class="tool-btn-text">
            <span class="tool-btn-name">Guided</span>
            <span class="tool-btn-sub">Not sure where to begin? Start here.</span>
          </div>
        </button>
        <button id="btn-run-ai" class="tool-btn">
          <span class="icon">▶️</span>
          <div class="tool-btn-text">
            <span class="tool-btn-name">Freeform</span>
            <span class="tool-btn-sub">Full control over inputs, prompts and settings</span>
          </div>
        </button>
        <button id="btn-recipes" class="tool-btn">
          <span class="icon">🥞</span>
          <div class="tool-btn-text">
            <span class="tool-btn-name">Recipes</span>
            <span class="tool-btn-sub">Ready-made presets for common tasks</span>
          </div>
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
        <button id="btn-format-markdown" class="tool-btn">
          <span class="icon">📝</span> Format Markdown
        </button>
      </div>
      <div class="status-footer">
        <strong>SSI Toolkit v6</strong>
      </div>
    `;
  }
}
