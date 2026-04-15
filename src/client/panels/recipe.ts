import type { NavigationContext, Panel, RecipeDefinition, UserInput } from "../types";
import type {
  PrepColSpec,
  PrepRecipeParams,
  PrepRecipeResult,
  PromptColumnSpec,
  RunConfig,
} from "../../shared/types";
import { RecipePrepCook } from "../components/recipe-prep-cook";
import { prepRecipe } from "../services";

function buildRunTemplate(cols: PrepColSpec[]): Partial<RunConfig> {
  const promptCols: PromptColumnSpec[] = [];
  let systemPromptCol: string | undefined;
  let outputCol: string | undefined;

  for (const col of cols) {
    switch (col.role?.kind) {
      case "file-prompt":
        promptCols.push({ col: col.colTitle, kind: "file" });
        break;
      case "text-prompt":
        promptCols.push({ col: col.colTitle, kind: "text" });
        break;
      case "system-prompt":
        systemPromptCol = col.colTitle;
        break;
      case "output":
        outputCol = col.colTitle;
        break;
    }
  }
  return { promptCols, systemPromptCol, outputCol };
}

type SavedState = {
  inputValues: Record<string, string>;
  prepComplete: boolean;
  preppedRunConfig?: Partial<RunConfig>;
};

export class RecipePanel implements Panel<RecipeDefinition, SavedState> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private prepCook: RecipePrepCook | null = null;
  private preppedRunConfig: Partial<RunConfig> | null = null;
  private container: HTMLElement | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    definition?: RecipeDefinition,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.container = container;
    this.preppedRunConfig = savedState?.preppedRunConfig ?? null;

    container.innerHTML = this.template(definition);
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());

    this.restoreInputValues(container, definition?.inputs ?? [], savedState?.inputValues ?? {});
    this.mountPrepCook(container, savedState?.prepComplete ?? false);
  }

  unmount(): SavedState {
    const inputs = this.definition?.inputs ?? [];
    const inputValues: Record<string, string> = {};
    for (const input of inputs) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      inputValues[input.id] = el?.value ?? "";
    }
    return {
      inputValues,
      prepComplete: this.prepCook?.isPrepComplete() ?? false,
      preppedRunConfig: this.preppedRunConfig ?? undefined,
    };
  }

  private restoreInputValues(
    container: HTMLElement,
    inputs: UserInput[],
    savedValues: Record<string, string>,
  ): void {
    for (const input of inputs) {
      const el = container.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      if (el && savedValues[input.id]) el.value = savedValues[input.id];
      el?.addEventListener("input", () => this.prepCook?.reset());
    }
  }

  private mountPrepCook(container: HTMLElement, prepComplete: boolean): void {
    this.prepCook = new RecipePrepCook(container.querySelector("#prep-cook-container")!, {
      onPrep: async (): Promise<void> => {
        const params = this.buildPrepParams();
        if (!params) throw null;
        const result = await prepRecipe(params);
        this.preppedRunConfig = this.buildRunConfig(result);
      },
      onCook: (): void => {
        if (this.preppedRunConfig) {
          this.nav?.navigate("configure-ai-run", this.preppedRunConfig);
        }
      },
      prepComplete,
    });
  }

  private buildPrepParams(): PrepRecipeParams | null {
    const inputs = this.definition?.inputs ?? [];
    const inputValues: Record<string, string> = {};

    for (const input of inputs) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      const value = el?.value.trim() ?? "";
      if (input.required && !value) {
        globalThis.alert(`Please fill in "${input.label}".`);
        return null;
      }
      inputValues[input.id] = value;
    }

    return {
      cols: this.definition?.prepTemplate ?? [],
      inputValues,
    };
  }

  private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
    return {
      ...buildRunTemplate(this.definition?.prepTemplate ?? []),
      ...this.definition?.settings,
      rowRange: result.rowRange,
    };
  }

  private template(definition: RecipeDefinition | undefined | null): string {
    const inputs = definition?.inputs ?? [];
    const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";

    const inputsHtml = inputs
      .map((input) => {
        const requiredMark = input.required ? `<span class="required"> *</span>` : "";
        const helperHtml = input.helperText
          ? `<p class="field-helper">${input.helperText}</p>`
          : "";
        return `
          <div class="recipe-input-field">
            <label class="recipe-input-label">${input.label}</label>${requiredMark}
            ${helperHtml}
            <input
              data-input-id="${input.id}"
              type="text"
              class="text-input"
              placeholder="${input.placeholder ?? ""}"
            />
          </div>`;
      })
      .join("");

    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">${title}</span>
      </div>
      ${inputsHtml}
      <div id="prep-cook-container"></div>
    `;
  }
}
