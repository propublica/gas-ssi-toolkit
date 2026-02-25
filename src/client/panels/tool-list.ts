import type { NavigationContext, Panel } from "../types";
import { runTool } from "../services";

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
    container.querySelector("#btn-import-drive-links")?.addEventListener("click", (e) => {
      this.dispatchTool(e as MouseEvent, "importDriveLinks");
    });
    container.querySelector("#btn-sample-rows")?.addEventListener("click", (e) => {
      this.dispatchTool(e as MouseEvent, "sampleRowsToEvaluation");
    });
    container.querySelector("#btn-extract-text")?.addEventListener("click", (e) => {
      this.dispatchTool(e as MouseEvent, "extractTextFromSelection");
    });
  }

  private dispatchTool(e: MouseEvent, fn: string): void {
    const btn = e.currentTarget as HTMLButtonElement;
    const orig = btn.innerHTML;
    btn.classList.add("loading");
    btn.innerHTML = '<span class="icon">⏳</span> Working...';
    runTool(fn).then(
      () => {
        btn.classList.remove("loading");
        btn.innerHTML = orig;
      },
      (err: Error) => {
        window.alert("Error: " + err.message);
        btn.classList.remove("loading");
        btn.innerHTML = orig;
      },
    );
  }

  private template(): string {
    return `
      <div class="guide-card">
        <a href="https://docs.google.com/document/d/1BQJzBHiE6L0hvU6NMD0jaQE71VWRpWH-vNQu3UtGjBA/edit?tab=t.66jobsqlduah#heading=h.h5k0s81xpiiq"
            target="_blank" class="guide-link">
          <span>📖</span> View User Guide ↗
        </a>
      </div>
      <div class="section">
        <h3>Main Tools</h3>
        <button id="btn-import-drive-links" class="tool-btn">
          <span class="icon">📂</span> Import Drive Links
        </button>
        <button id="btn-run-ai" class="tool-btn">
          <span class="icon">▶️</span> Run AI Inference
        </button>
        <button id="btn-recipes" class="tool-btn">
          <span class="icon">🥞</span> Recipes
        </button>
      </div>
      <div class="section">
        <h3>Extras</h3>
        <button id="btn-sample-rows" class="tool-btn">
          <span class="icon">🎲</span> Sample Rows
        </button>
        <button id="btn-extract-text" class="tool-btn">
          <span class="icon">📜</span> Extract Text
        </button>
      </div>
      <div class="status-footer">
        <strong>SSI Tools v2.0</strong><br>
        Powered by Gemini 2.0 Flash<br>
        Evaluation Unrestricted Mode
      </div>
    `;
  }
}
