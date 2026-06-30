import type { NavigationContext, Panel } from "../types";
import { RECIPES } from "../recipes";

export class RecipesListPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = this.template();
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    RECIPES.forEach((recipe) => {
      container
        .querySelector(`#btn-${recipe.id}`)
        ?.addEventListener("click", () =>
          nav.navigate(recipe.variant ? `recipe-${recipe.variant}` : "recipe", recipe),
        );
    });
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
        ${RECIPES.map(
          (r) => `
          <button id="btn-${r.id}" class="tool-btn">
            <span class="icon">${r.icon}</span>
            <div class="tool-btn-text">
              <span class="tool-btn-name">${r.name}</span>
              <span class="tool-btn-sub">${r.description}</span>
            </div>
          </button>`,
        ).join("")}
        <div class="tool-btn-stub">
          <span class="icon">✨</span>
          <div class="tool-btn-text">
            <span class="tool-btn-name">More recipes coming soon…</span>
          </div>
        </div>
      </div>
    `;
  }
}
