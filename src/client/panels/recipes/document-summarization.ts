import type { NavigationContext, Panel } from "../../types";

export class DocumentSummarizationPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">Document Summarization</span>
      </div>
      <div class="section">
        <p>Coming soon.</p>
      </div>
    `;
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
  }

  unmount(): undefined {
    return undefined;
  }
}
