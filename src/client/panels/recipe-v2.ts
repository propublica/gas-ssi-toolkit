import type { NavigationContext, Panel, RecipeDefinition } from "../types";
import type { PrepRecipeParams, RunConfig } from "../../shared/types";
import { prepRecipe, runBatchAI } from "../services";
import { buildRunTemplate } from "./recipe";

type V2State = "idle" | "testing" | "cooking";

export class RecipeV2Panel implements Panel<
  RecipeDefinition,
  { inputValues: Record<string, string> }
> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private container: HTMLElement | null = null;
  private v2State: V2State = "idle";

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    definition?: RecipeDefinition,
    savedState?: { inputValues: Record<string, string> },
  ): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.container = container;
    this.v2State = "idle";
    container.innerHTML = this.template(definition);
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    this.restoreInputValues(container, definition?.inputs ?? [], savedState?.inputValues ?? {});
    container
      .querySelector("#test-btn")
      ?.addEventListener("click", () => this.handleTest(container));
    container
      .querySelector("#cook-btn")
      ?.addEventListener("click", () => this.handleCook(container));
  }

  unmount(): { inputValues: Record<string, string> } {
    const inputValues: Record<string, string> = {};
    for (const input of this.definition?.inputs ?? []) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      inputValues[input.id] = el?.value ?? "";
    }
    return { inputValues };
  }

  private restoreInputValues(
    container: HTMLElement,
    inputs: RecipeDefinition["inputs"],
    savedValues: Record<string, string>,
  ): void {
    for (const input of inputs) {
      const el = container.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      if (el && savedValues[input.id]) el.value = savedValues[input.id];
    }
  }

  private applyState(container: HTMLElement): void {
    const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;
    const cookBtn = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    testBtn.disabled = false;
    cookBtn.disabled = false;
    testBtn.textContent = "Test ▸ first 10 rows";
    cookBtn.textContent = "Cook ▸ All rows";
    if (this.v2State === "testing") {
      testBtn.disabled = true;
      testBtn.innerHTML = `<span class="btn-spinner"></span>Testing…`;
      cookBtn.disabled = true;
    } else if (this.v2State === "cooking") {
      testBtn.disabled = true;
      cookBtn.disabled = true;
      cookBtn.innerHTML = `<span class="btn-spinner"></span>Cooking…`;
    }
  }

  private buildPrepParams(): PrepRecipeParams | null {
    const inputValues: Record<string, string> = {};
    for (const input of this.definition?.inputs ?? []) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      const value = el?.value.trim() ?? "";
      if (input.required && !value) {
        globalThis.alert(`Please fill in "${input.label}".`);
        return null;
      }
      inputValues[input.id] = value;
    }
    return {
      cols: (this.definition?.prepTemplate ?? []).filter((col) => col.role !== "output"),
      inputValues,
    };
  }

  private handleTest(container: HTMLElement): void {
    const params = this.buildPrepParams();
    if (!params) return;
    this.v2State = "testing";
    this.applyState(container);
    const finish = (): void => {
      this.v2State = "idle";
      this.applyState(container);
    };
    prepRecipe(params)
      .then((result) => {
        const template = buildRunTemplate(this.definition?.prepTemplate ?? []);
        if (!template.promptCols || !template.outputCol) {
          globalThis.alert("Recipe configuration error: missing required columns.");
          finish();
          return Promise.resolve();
        }
        const config = {
          ...template,
          ...this.definition?.settings,
          rowRange: {
            start: result.rowRange.start,
            end: Math.min(result.rowRange.start + 9, result.rowRange.end),
          },
        } as RunConfig;
        return runBatchAI(config);
      })
      .then(finish)
      .catch((err: Error) => {
        globalThis.alert("Error: " + err.message);
        finish();
      });
  }

  private handleCook(container: HTMLElement): void {
    const params = this.buildPrepParams();
    if (!params) return;
    this.v2State = "cooking";
    this.applyState(container);
    const finish = (): void => {
      this.v2State = "idle";
      this.applyState(container);
    };
    prepRecipe(params)
      .then((result) => {
        const template = buildRunTemplate(this.definition?.prepTemplate ?? []);
        if (!template.promptCols || !template.outputCol) {
          globalThis.alert("Recipe configuration error: missing required columns.");
          finish();
          return Promise.resolve();
        }
        const config = {
          ...template,
          ...this.definition?.settings,
          rowRange: result.rowRange,
        } as RunConfig;
        return runBatchAI(config);
      })
      .then(finish)
      .catch((err: Error) => {
        globalThis.alert("Error: " + err.message);
        finish();
      });
  }

  private template(definition: RecipeDefinition | undefined | null): string {
    const inputs = definition?.inputs ?? [];
    const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";
    const introHtml = definition?.intro ? `<p class="recipe-intro">${definition.intro}</p>` : "";
    const inputsHtml = inputs
      .map((input) => {
        const mark = input.required
          ? `<span class="required"> *</span>`
          : `<span class="optional"> (optional)</span>`;
        const helper = input.helperText ? `<p class="field-helper">${input.helperText}</p>` : "";
        return `<div class="field-group">
          <span class="field-label">${input.label}${mark}</span>
          ${helper}
          <input data-input-id="${input.id}" type="text" class="text-input" placeholder="${input.placeholder ?? ""}" />
        </div>`;
      })
      .join("");
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">${title}</span>
      </div>
      ${introHtml}
      ${inputsHtml}
      <div class="panel-buttons">
        <button id="test-btn" class="btn-outline">Test ▸ first 10 rows</button>
        <button id="cook-btn" class="btn-run">Cook ▸ All rows</button>
      </div>
      <p class="field-helper">
        <strong>Test</strong> — sets up columns and runs the AI on the first 10 rows so you can check quality before committing.
        <strong>Cook</strong> — sets up columns and runs the AI on every file in the folder. Keep the sidebar open.
      </p>`;
  }
}
