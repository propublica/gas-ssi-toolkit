import type { NavigationContext, Panel } from "../types";
import { RECIPES } from "../recipes";

export class RecipesListPanel implements Panel {
  mount(container: HTMLElement, nav: NavigationContext): void {
    container.innerHTML = this.template();
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    RECIPES.forEach((recipe) => {
      container
        .querySelector(`#btn-${recipe.id}`)
        ?.addEventListener("click", () => nav.navigate(recipe.panelId, recipe.params));
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
            <span class="icon">${r.icon}</span> ${r.name}
            <span class="tool-btn-sub">${r.description}</span>
          </button>`,
        ).join("")}
      </div>
    `;
  }
}
