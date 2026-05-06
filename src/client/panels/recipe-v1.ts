import type { NavigationContext, Panel, RecipeDefinition } from "../types";
import type { PrepRecipeParams, RunConfig } from "../../shared/types";
import { prepRecipe, runBatchAI } from "../services";
import { buildRunTemplate } from "./recipe";

type V1State = "idle" | "prepping" | "prepped" | "testing" | "cooking";

type SavedState = {
  inputValues: Record<string, string>;
  v1State: V1State;
  rowRange?: { start: number; end: number };
  preppedRunConfig?: Partial<RunConfig>;
};

export class RecipeV1Panel implements Panel<RecipeDefinition, SavedState> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private container: HTMLElement | null = null;
  private v1State: V1State = "idle";
  private rowRange: { start: number; end: number } | null = null;
  private preppedRunConfig: Partial<RunConfig> | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    definition?: RecipeDefinition,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.container = container;
    this.v1State = savedState?.v1State ?? "idle";
    this.rowRange = savedState?.rowRange ?? null;
    this.preppedRunConfig = savedState?.preppedRunConfig ?? null;

    container.innerHTML = this.template(definition);
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    this.restoreInputValues(container, definition?.inputs ?? [], savedState?.inputValues ?? {});
    this.wireButtons(container);
    this.applyState(container);
  }

  unmount(): SavedState {
    const inputValues: Record<string, string> = {};
    for (const input of this.definition?.inputs ?? []) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      inputValues[input.id] = el?.value ?? "";
    }
    return {
      inputValues,
      v1State: this.v1State,
      rowRange: this.rowRange ?? undefined,
      preppedRunConfig: this.preppedRunConfig ?? undefined,
    };
  }

  private restoreInputValues(
    container: HTMLElement,
    inputs: RecipeDefinition["inputs"],
    savedValues: Record<string, string>,
  ): void {
    for (const input of inputs) {
      const el = container.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      if (el && savedValues[input.id]) el.value = savedValues[input.id];
      el?.addEventListener("input", () => {
        this.v1State = "idle";
        this.rowRange = null;
        this.preppedRunConfig = null;
        this.applyState(container);
      });
    }
  }

  private wireButtons(container: HTMLElement): void {
    container
      .querySelector("#prep-btn")
      ?.addEventListener("click", () => this.handlePrep(container));
    container
      .querySelector("#test-btn")
      ?.addEventListener("click", () => this.handleTest(container));
    container
      .querySelector("#cook-btn")
      ?.addEventListener("click", () => this.handleCook(container));
    container
      .querySelector("#configure-btn")
      ?.addEventListener("click", () => this.handleConfigureAI());
  }

  private applyState(container: HTMLElement): void {
    const prepBtn = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;
    const cookBtn = container.querySelector<HTMLButtonElement>("#cook-btn")!;
    const configBtn = container.querySelector<HTMLButtonElement>("#configure-btn")!;

    prepBtn.disabled = false;
    testBtn.disabled = true;
    cookBtn.disabled = true;
    configBtn.disabled = true;
    prepBtn.textContent = "Prep Recipe";
    testBtn.textContent = "Test ▸ row 2";
    cookBtn.textContent = "Cook ▸ All";
    cookBtn.className = "btn-run";

    switch (this.v1State) {
      case "prepping":
        prepBtn.disabled = true;
        prepBtn.innerHTML = `<span class="btn-spinner"></span>Prepping…`;
        break;
      case "prepped":
        prepBtn.textContent = "Re-prep";
        testBtn.disabled = false;
        cookBtn.disabled = false;
        configBtn.disabled = false;
        break;
      case "testing":
        prepBtn.disabled = true;
        testBtn.disabled = true;
        testBtn.innerHTML = `<span class="btn-spinner"></span>Testing…`;
        cookBtn.disabled = true;
        configBtn.disabled = true;
        break;
      case "cooking":
        prepBtn.disabled = true;
        testBtn.disabled = true;
        cookBtn.disabled = true;
        cookBtn.innerHTML = `<span class="btn-spinner"></span>Cooking…`;
        configBtn.disabled = true;
        break;
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

  private handlePrep(container: HTMLElement): void {
    const params = this.buildPrepParams();
    if (!params) return;
    this.v1State = "prepping";
    this.applyState(container);
    prepRecipe(params).then(
      (result) => {
        this.rowRange = result.rowRange;
        this.preppedRunConfig = {
          ...buildRunTemplate(this.definition?.prepTemplate ?? []),
          ...this.definition?.settings,
          rowRange: result.rowRange,
        };
        this.v1State = "prepped";
        this.applyState(container);
      },
      (err: Error | null) => {
        if (err !== null) globalThis.alert("Error: " + err.message);
        this.v1State = "idle";
        this.applyState(container);
      },
    );
  }

  private handleTest(container: HTMLElement): void {
    if (!this.rowRange || !this.preppedRunConfig) return;
    const config = {
      ...this.preppedRunConfig,
      rowRange: { start: this.rowRange.start, end: this.rowRange.start },
    } as RunConfig;
    this.v1State = "testing";
    this.applyState(container);
    runBatchAI(config).then(
      () => {
        this.v1State = "prepped";
        this.applyState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.v1State = "prepped";
        this.applyState(container);
      },
    );
  }

  private handleCook(container: HTMLElement): void {
    if (!this.rowRange || !this.preppedRunConfig) return;
    const config = { ...this.preppedRunConfig, rowRange: this.rowRange } as RunConfig;
    this.v1State = "cooking";
    this.applyState(container);
    runBatchAI(config).then(
      () => {
        this.v1State = "prepped";
        this.applyState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.v1State = "prepped";
        this.applyState(container);
      },
    );
  }

  private handleConfigureAI(): void {
    if (this.preppedRunConfig) {
      this.nav?.navigate("configure-ai-run", this.preppedRunConfig);
    }
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
        <button id="prep-btn" class="btn-outline">Prep Recipe</button>
        <button id="test-btn" class="btn-outline" disabled>Test ▸ row 2</button>
        <button id="cook-btn" class="btn-run" disabled>Cook ▸ All</button>
        <button id="configure-btn" class="btn-outline" disabled>Configure AI</button>
      </div>
      <p class="field-helper">
        <strong>Prep</strong> — sets up your spreadsheet columns and imports files from Drive.
        <strong>Test</strong> — runs the AI on the first row only so you can check quality before committing.
        <strong>Cook</strong> — runs the AI on every file. Keep the sidebar open until it finishes.
        <strong>Configure AI</strong> — opens the full settings panel to review or adjust before running.
      </p>`;
  }
}
