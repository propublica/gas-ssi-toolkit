import type { NavigationContext, Panel } from "../types";

export class RecipesListPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = this.template();
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    container
      .querySelector("#btn-document-summarization")
      ?.addEventListener("click", () => nav.navigate("document-summarization"));
  }

  unmount(): undefined {
    return undefined;
  }

  private template(): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">🥞 Recipes</span>
      </div>
      <div class="section">
        <button id="btn-document-summarization" class="tool-btn">
          <span class="icon">📄</span> Document Summarization
          <span class="tool-btn-sub">Summarize each file in a Google Drive folder</span>
        </button>
      </div>
    `;
  }
}
