import type { NavigationContext, Panel, RecipeDefinition, ColumnDef } from "../types";
import type { ColStrategy, PrepColSpec, PrepRecipeParams, PrepRecipeResult, RunConfig, PromptColumnSpec } from "../../shared/types";
import { LockableField } from "../components/lockable-field";
import { RecipePrepCook } from "../components/recipe-prep-cook";
import { prepRecipe } from "../services";

type ColFieldRefs = {
  colTitle?: LockableField;
  prompt?: LockableField;
  urlInput?: HTMLInputElement;
  appendInputs?: Record<string, HTMLInputElement>;
};

type ColSavedValues = {
  colTitle?: string;
  prompt?: string;
  url?: string;
  appendValues?: Record<string, string>;
};

type SavedState = {
  colValues: ColSavedValues[];
  prepComplete: boolean;
  preppedRunConfig?: Partial<RunConfig>;
};

export class RecipePanel implements Panel<RecipeDefinition, SavedState> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private prepCook: RecipePrepCook | null = null;
  private preppedRunConfig: Partial<RunConfig> | null = null;
  private fields: ColFieldRefs[] = [];

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    definition?: RecipeDefinition,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.fields = [];
    this.preppedRunConfig = savedState?.preppedRunConfig ?? null;

    container.innerHTML = this.template(definition);
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());

    this.mountFields(container, definition?.params?.columns ?? [], savedState);
    this.mountPrepCook(container, savedState?.prepComplete ?? false);
  }

  unmount(): SavedState {
    const colValues: ColSavedValues[] = this.fields.map((f) => ({
      colTitle: f.colTitle?.getValue(),
      prompt: f.prompt?.getValue(),
      url: f.urlInput?.value,
      appendValues: f.appendInputs
        ? Object.fromEntries(
            Object.entries(f.appendInputs).map(([id, el]) => [id, el.value]),
          )
        : undefined,
    }));
    return {
      colValues,
      prepComplete: this.prepCook?.isPrepComplete() ?? false,
      preppedRunConfig: this.preppedRunConfig ?? undefined,
    };
  }

  private mountFields(
    container: HTMLElement,
    columns: ColumnDef[],
    savedState?: SavedState,
  ): void {
    const reset = (): void => this.prepCook?.reset();

    columns.forEach((col, i) => {
      const saved = savedState?.colValues?.[i];
      const refs: ColFieldRefs = {};

      refs.colTitle = new LockableField(
        container.querySelector(`#col-${i}-title-container`)!,
        {
          label: "Column",
          defaultValue: saved?.colTitle ?? col.colTitle.value,
          locked: col.colTitle.locked,
          onUnlock: reset,
        },
      );

      if (col.prompt !== undefined) {
        refs.prompt = new LockableField(
          container.querySelector(`#col-${i}-prompt-container`)!,
          {
            label: "Prompt",
            defaultValue: saved?.prompt ?? col.prompt.value,
            locked: col.prompt.locked,
            multiline: true,
            onUnlock: reset,
          },
        );
      }

      if (col.url !== undefined) {
        const urlEl = container.querySelector<HTMLInputElement>(`#col-${i}-url-input`);
        if (urlEl) {
          if (saved?.url) urlEl.value = saved.url;
          urlEl.addEventListener("input", reset);
          refs.urlInput = urlEl;
        }
      }

      if (col.appendFields?.length) {
        refs.appendInputs = {};
        for (const af of col.appendFields) {
          const el = container.querySelector<HTMLInputElement>(`#col-${i}-append-${af.id}`);
          if (el) {
            if (saved?.appendValues?.[af.id]) el.value = saved.appendValues[af.id];
            refs.appendInputs[af.id] = el;
          }
        }
      }

      this.fields[i] = refs;
    });
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
    const columns = this.definition?.params?.columns ?? [];
    const cols: PrepColSpec[] = [];

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const colTitle = this.fields[i]?.colTitle?.getValue() ?? col.colTitle.value;

      let strategy: ColStrategy;
      switch (col.strategyKind) {
        case "list-drive-folder": {
          const url = this.fields[i]?.urlInput?.value.trim() ?? "";
          if (!url) {
            globalThis.alert(`Please enter a URL for "${col.label}".`);
            return null;
          }
          strategy = { kind: "list-drive-folder", url };
          break;
        }
        case "fill-value": {
          const base = this.fields[i]?.prompt?.getValue() ?? col.prompt?.value ?? "";
          const appended = (col.appendFields ?? [])
            .map((af) => {
              const v = this.fields[i]?.appendInputs?.[af.id]?.value.trim() ?? "";
              return v ? (af.prefix ?? "") + v : "";
            })
            .join("");
          strategy = { kind: "fill-value", value: base + appended };
          break;
        }
        case "create-empty":
          strategy = { kind: "create-empty" };
          break;
      }

      cols.push({ colTitle, strategy });
    }

    return { cols };
  }

  private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
    const columns = this.definition?.params?.columns ?? [];
    const settings = this.definition?.params?.settings ?? {};
    const promptCols: PromptColumnSpec[] = [];
    let systemPromptCol: string | undefined;
    let outputCol = "";

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const resolvedTitle = this.fields[i]?.colTitle?.getValue() ?? col.colTitle.value;

      switch (col.role) {
        case "userPrompt":
          promptCols.push({ col: resolvedTitle, kind: "text" });
          break;
        case "driveLink":
          promptCols.push({ col: resolvedTitle, kind: "file" });
          break;
        case "systemPrompt":
          systemPromptCol = resolvedTitle;
          break;
        case "output":
          outputCol = resolvedTitle;
          break;
      }
    }

    return { promptCols, systemPromptCol, outputCol, rowRange: result.rowRange, ...settings };
  }

  private template(definition: RecipeDefinition | undefined | null): string {
    const columns = definition?.params?.columns ?? [];
    const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";

    const columnSections = columns
      .map((col, i) => {
        const requiredMark = col.required ? ` <span class="required">*</span>` : "";
        const helperHtml = col.helperText ? `<p class="field-helper">${col.helperText}</p>` : "";

        const urlInputHtml =
          col.url !== undefined
            ? `<input id="col-${i}-url-input" type="text" class="text-input"
                placeholder="${col.url.placeholder ?? "Paste Google Drive URL"}" />`
            : "";

        const promptContainerHtml =
          col.prompt !== undefined ? `<div id="col-${i}-prompt-container"></div>` : "";

        const appendFieldsHtml = (col.appendFields ?? [])
          .map(
            (af) =>
              `<div class="append-field">
                <label class="field-label">${af.label}</label>
                <input id="col-${i}-append-${af.id}" type="text" class="text-input"
                  placeholder="${af.placeholder ?? ""}" />
              </div>`,
          )
          .join("");

        return `
          <div class="recipe-section-card">
            <div class="recipe-section-card-title">${col.label}${requiredMark}</div>
            ${helperHtml}
            <div id="col-${i}-title-container"></div>
            ${urlInputHtml}
            ${promptContainerHtml}
            ${appendFieldsHtml}
          </div>`;
      })
      .join("");

    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">${title}</span>
      </div>
      ${columnSections}
      <div id="prep-cook-container"></div>
    `;
  }
}
