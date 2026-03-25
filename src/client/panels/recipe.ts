import type { NavigationContext, Panel, RecipeDefinition } from "../types";
import type { ColumnSpec, PromptAppendField, RecipeParams } from "../types";
import type { PrepRecipeParams, PrepRecipeResult, RunConfig } from "../../shared/types";
import { LockableField } from "../components/lockable-field";
import { RecipePrepCook } from "../components/recipe-prep-cook";
import { prepRecipe } from "../services";

type ColumnSavedState = {
  colTitle?: string;
  url?: string;
  prompt?: string;
  appendFieldValues?: Record<string, string>; // keyed by PromptAppendField.id
};

type SavedState = {
  columnStates: ColumnSavedState[];
  prepComplete: boolean;
  preppedRunConfig?: Partial<RunConfig>;
};

export class RecipePanel implements Panel<RecipeDefinition, SavedState> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private params: RecipeParams | null = null;
  private prepCook: RecipePrepCook | null = null;
  private preppedRunConfig: Partial<RunConfig> | null = null;

  private columnFields: Array<{
    colTitle?: LockableField;
    url?: LockableField;
    prompt?: LockableField;
    appendFieldInputs?: Map<string, HTMLTextAreaElement>;
  }> = [];

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    definition?: RecipeDefinition,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.params = definition?.params ?? { columns: [] };
    this.columnFields = [];
    this.preppedRunConfig = savedState?.preppedRunConfig ?? null;

    container.innerHTML = this.template(this.definition);

    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());

    this.mountFields(container, this.params, savedState);
    this.mountPrepCook(container, savedState?.prepComplete ?? false);
  }

  unmount(): SavedState {
    const columnStates: ColumnSavedState[] = this.columnFields.map((cf) => {
      const state: ColumnSavedState = {};
      if (cf.colTitle) state.colTitle = cf.colTitle.getValue();
      if (cf.url) state.url = cf.url.getValue();
      if (cf.prompt) state.prompt = cf.prompt.getValue();
      if (cf.appendFieldInputs) {
        const appendFieldValues: Record<string, string> = {};
        cf.appendFieldInputs.forEach((el, id) => {
          appendFieldValues[id] = el.value;
        });
        state.appendFieldValues = appendFieldValues;
      }
      return state;
    });

    return {
      columnStates,
      prepComplete: this.prepCook?.isPrepComplete() ?? false,
      preppedRunConfig: this.preppedRunConfig ?? undefined,
    };
  }

  private mountFields(
    container: HTMLElement,
    params: RecipeParams,
    savedState?: SavedState,
  ): void {
    const reset = (): void => this.prepCook?.reset();

    params.columns.forEach((col, i) => {
      const colFields: (typeof this.columnFields)[number] = {};

      // Mount colTitle LockableField for all column kinds
      const colTitleContainer = container.querySelector<HTMLElement>(`#col-title-${i}-container`);
      if (colTitleContainer) {
        colFields.colTitle = new LockableField(colTitleContainer, {
          label: "Column",
          defaultValue: savedState?.columnStates?.[i]?.colTitle ?? col.colTitle.value,
          locked: col.colTitle.locked ?? true,
          onUnlock: reset,
        });
      }

      if (col.kind === "drive-file-folder" || col.kind === "drive-file-constant") {
        const urlContainer = container.querySelector<HTMLElement>(`#col-url-${i}-container`);
        if (urlContainer) {
          colFields.url = new LockableField(urlContainer, {
            label: "URL",
            defaultValue: savedState?.columnStates?.[i]?.url ?? col.url.value,
            locked: col.url.locked ?? true,
            placeholder: col.url.placeholder,
            onUnlock: reset,
          });
        }
      }

      if (col.kind === "system-prompt" || col.kind === "user-prompt") {
        const promptContainer = container.querySelector<HTMLElement>(
          `#col-prompt-${i}-container`,
        );
        if (promptContainer) {
          colFields.prompt = new LockableField(promptContainer, {
            label: "Prompt",
            defaultValue: savedState?.columnStates?.[i]?.prompt ?? col.prompt.value,
            locked: col.prompt.locked ?? true,
            multiline: true,
            onUnlock: reset,
          });
        }

        if (col.appendFields && col.appendFields.length > 0) {
          colFields.appendFieldInputs = new Map<string, HTMLTextAreaElement>();
          col.appendFields.forEach((af: PromptAppendField) => {
            const textarea = container.querySelector<HTMLTextAreaElement>(
              `#append-field-${i}-${af.id}`,
            )!;
            const savedVal = savedState?.columnStates?.[i]?.appendFieldValues?.[af.id];
            if (savedVal !== undefined) textarea.value = savedVal;
            textarea.addEventListener("input", reset);
            colFields.appendFieldInputs!.set(af.id, textarea);
          });
        }
      }

      this.columnFields[i] = colFields;
    });
  }

  private mountPrepCook(container: HTMLElement, prepComplete: boolean): void {
    this.prepCook = new RecipePrepCook(container.querySelector("#prep-cook-container")!, {
      onPrep: async (): Promise<void> => {
        const params = this.buildPrepParams();
        if (!params) throw null; // validation alert already shown; bail silently

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
    const params = this.params!;
    const columns: PrepRecipeParams["columns"] = [];

    for (let i = 0; i < params.columns.length; i++) {
      const col = params.columns[i];
      const cf = this.columnFields[i];
      const colTitle = cf?.colTitle?.getValue() ?? col.colTitle.value;

      switch (col.kind) {
        case "drive-file-folder": {
          const url = cf?.url?.getValue()?.trim() ?? "";
          if (!url) {
            globalThis.alert("Please enter a Google Drive folder link.");
            return null;
          }
          columns.push({ kind: "drive-file-folder", colTitle, url });
          break;
        }
        case "drive-file-constant": {
          const url = cf?.url?.getValue()?.trim() ?? "";
          if (!url) break; // optional field — skip silently
          columns.push({ kind: "drive-file-constant", colTitle, url });
          break;
        }
        case "system-prompt":
        case "user-prompt": {
          let text = cf?.prompt?.getValue() ?? col.prompt.value;
          if (col.appendFields) {
            for (const af of col.appendFields) {
              const textarea = cf?.appendFieldInputs?.get(af.id);
              const val = textarea?.value?.trim() ?? "";
              if (!val) {
                globalThis.alert(`Please fill in "${af.label}".`);
                return null;
              }
              text += (af.prefix ?? "") + val;
            }
          }
          columns.push({ kind: col.kind, colTitle, text });
          break;
        }
        case "output": {
          columns.push({ kind: "output", colTitle });
          break;
        }
      }
    }

    return { columns, settings: this.definition?.params?.settings };
  }

  private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
    const userPromptParts: RunConfig["userPromptParts"] = [];
    let systemPromptCol: string | undefined;
    let outputCol = "";

    for (const col of result.columns) {
      switch (col.kind) {
        case "drive-file-folder":
        case "drive-file-constant":
          userPromptParts.push({ kind: "file", col: col.colTitle });
          break;
        case "user-prompt":
          userPromptParts.push({ kind: "text", col: col.colTitle });
          break;
        case "system-prompt":
          systemPromptCol = col.colTitle;
          break;
        case "output":
          outputCol = col.colTitle;
          break;
      }
    }

    return {
      userPromptParts,
      systemPromptCol,
      outputCol,
      rowRange: result.rowRange,
      tools: result.settings?.tools,
      applyMarkdown: result.settings?.applyMarkdown,
      includeGrounding: result.settings?.includeGrounding,
    };
  }

  private template(definition: RecipeDefinition | null): string {
    const params = definition?.params ?? { columns: [] };
    const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";

    const sectionTitle = (col: ColumnSpec): string => {
      switch (col.kind) {
        case "drive-file-folder":
          return "Drive Folder";
        case "drive-file-constant":
          return "Drive File";
        case "system-prompt":
          return "System Prompt";
        case "user-prompt":
          return "User Prompt";
        case "output":
          return "Output Column";
      }
    };

    const columnCards = params.columns
      .map((col, i) => {
        const appendFieldsHtml =
          col.kind === "system-prompt" || col.kind === "user-prompt"
            ? (col.appendFields ?? [])
                .map(
                  (af) => `
          <div class="append-field-group">
            <label class="field-label" for="append-field-${i}-${af.id}">${af.label}</label>
            <textarea id="append-field-${i}-${af.id}" class="text-input"${af.placeholder ? ` placeholder="${af.placeholder}"` : ""}></textarea>
          </div>`,
                )
                .join("")
            : "";

        const urlContainerHtml =
          col.kind === "drive-file-folder" || col.kind === "drive-file-constant"
            ? `<div id="col-url-${i}-container"></div>`
            : "";

        const promptContainerHtml =
          col.kind === "system-prompt" || col.kind === "user-prompt"
            ? `<div id="col-prompt-${i}-container"></div>${appendFieldsHtml}`
            : "";

        return `
      <div class="recipe-section-card">
        <div class="recipe-section-card-title">${sectionTitle(col)}</div>
        ${col.helperText ? `<p class="field-helper">${col.helperText}</p>` : ""}
        <div id="col-title-${i}-container"></div>
        ${urlContainerHtml}
        ${promptContainerHtml}
      </div>`;
      })
      .join("");

    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">${title}</span>
      </div>
      ${columnCards}
      <div id="prep-cook-container"></div>
    `;
  }
}
