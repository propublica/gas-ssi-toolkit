import type { NavigationContext, Panel } from "../types";
import type {
  RecipeParams,
  PrepRecipeParams,
  PrepRecipeResult,
  RunConfig,
} from "../../shared/types";
import { LockableField } from "../components/lockable-field";
import { RecipePrepCook } from "../components/recipe-prep-cook";
import { prepRecipe } from "../services";

type SavedState = {
  driveFolderValue?: string;
  systemPromptTitle?: string;
  systemPromptValue?: string;
  userPromptTitles?: string[];
  userPromptValues?: string[];
  outputColTitle?: string;
  prepComplete: boolean;
  preppedRunConfig?: Partial<RunConfig>;
};

export class RecipePanel implements Panel<RecipeParams, SavedState> {
  private nav: NavigationContext | null = null;
  private params: RecipeParams | null = null;
  private prepCook: RecipePrepCook | null = null;
  private preppedRunConfig: Partial<RunConfig> | null = null;
  private driveFolderInput: HTMLInputElement | null = null;

  private fields: {
    systemPromptTitle?: LockableField;
    systemPromptValue?: LockableField;
    userPromptTitles: LockableField[];
    userPromptValues: LockableField[];
    outputColTitle?: LockableField;
  } = { userPromptTitles: [], userPromptValues: [] };

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    params?: RecipeParams,
    savedState?: SavedState,
  ): void {
    this.nav = nav;
    this.params = params ?? {};
    this.fields = { userPromptTitles: [], userPromptValues: [] };
    this.preppedRunConfig = savedState?.preppedRunConfig ?? null;

    container.innerHTML = this.template(this.params);

    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());

    this.mountFields(container, this.params, savedState);
    this.mountPrepCook(container, savedState?.prepComplete ?? false);
  }

  unmount(): SavedState {
    return {
      driveFolderValue: this.driveFolderInput?.value,
      systemPromptTitle: this.fields.systemPromptTitle?.getValue(),
      systemPromptValue: this.fields.systemPromptValue?.getValue(),
      userPromptTitles: this.fields.userPromptTitles.map((f) => f.getValue()),
      userPromptValues: this.fields.userPromptValues.map((f) => f.getValue()),
      outputColTitle: this.fields.outputColTitle?.getValue(),
      prepComplete: this.prepCook?.isPrepComplete() ?? false,
      preppedRunConfig: this.preppedRunConfig ?? undefined,
    };
  }

  private mountFields(container: HTMLElement, params: RecipeParams, savedState?: SavedState): void {
    const reset = (): void => this.prepCook?.reset();

    if (params.driveFolder) {
      this.driveFolderInput = container.querySelector<HTMLInputElement>("#drive-folder-input");
      if (savedState?.driveFolderValue && this.driveFolderInput) {
        this.driveFolderInput.value = savedState.driveFolderValue;
      }
      this.driveFolderInput?.addEventListener("input", reset);
    }

    if (params.systemPrompt) {
      this.fields.systemPromptTitle = new LockableField(
        container.querySelector("#system-prompt-title-container")!,
        {
          label: "Column Title",
          defaultValue: savedState?.systemPromptTitle ?? params.systemPrompt.colTitle.value,
          locked: params.systemPrompt.colTitle.locked,
          onUnlock: reset,
        },
      );
      this.fields.systemPromptValue = new LockableField(
        container.querySelector("#system-prompt-value-container")!,
        {
          label: "Prompt",
          defaultValue: savedState?.systemPromptValue ?? params.systemPrompt.prompt.value,
          locked: params.systemPrompt.prompt.locked,
          multiline: true,
          onUnlock: reset,
        },
      );
    }

    if (params.userPrompts) {
      params.userPrompts.forEach((up, i) => {
        this.fields.userPromptTitles[i] = new LockableField(
          container.querySelector(`#user-prompt-title-${i}-container`)!,
          {
            label: "Column Title",
            defaultValue: savedState?.userPromptTitles?.[i] ?? up.colTitle.value,
            locked: up.colTitle.locked,
            onUnlock: reset,
          },
        );
        this.fields.userPromptValues[i] = new LockableField(
          container.querySelector(`#user-prompt-value-${i}-container`)!,
          {
            label: "Prompt",
            defaultValue: savedState?.userPromptValues?.[i] ?? up.prompt.value,
            locked: up.prompt.locked,
            multiline: true,
            onUnlock: reset,
          },
        );
      });
    }

    if (params.outputCol) {
      this.fields.outputColTitle = new LockableField(
        container.querySelector("#output-col-title-container")!,
        {
          label: "Output Column Name",
          defaultValue: savedState?.outputColTitle ?? params.outputCol.colTitle.value,
          locked: params.outputCol.colTitle.locked,
          onUnlock: reset,
        },
      );
    }
  }

  private mountPrepCook(container: HTMLElement, prepComplete: boolean): void {
    this.prepCook = new RecipePrepCook(container.querySelector("#prep-cook-container")!, {
      onPrep: (): Promise<void> => {
        const params = this.buildPrepParams();
        if (!params) return Promise.reject(null); // validation alert already shown; bail silently
        return prepRecipe(params).then((result: PrepRecipeResult) => {
          this.preppedRunConfig = this.buildRunConfig(result);
        });
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
    const result: PrepRecipeParams = {};

    if (params.driveFolder) {
      const url = this.driveFolderInput?.value.trim() ?? "";
      if (!url) {
        globalThis.alert("Please enter a Google Drive folder link.");
        return null;
      }
      result.driveFolder = { url, colTitle: params.driveFolder.colTitle };
    }

    if (params.systemPrompt) {
      result.systemPrompt = {
        colTitle: this.fields.systemPromptTitle?.getValue() ?? params.systemPrompt.colTitle.value,
        value: this.fields.systemPromptValue?.getValue() ?? params.systemPrompt.prompt.value,
      };
    }

    if (params.userPrompts) {
      result.userPrompts = params.userPrompts.map((up, i) => ({
        colTitle: this.fields.userPromptTitles[i]?.getValue() ?? up.colTitle.value,
        value: this.fields.userPromptValues[i]?.getValue() ?? up.prompt.value,
      }));
    }

    if (params.outputCol) {
      result.outputCol = {
        colTitle: this.fields.outputColTitle?.getValue() ?? params.outputCol.colTitle.value,
      };
    }

    return result;
  }

  private buildRunConfig(result: PrepRecipeResult): Partial<RunConfig> {
    return {
      driveFileCols: result.colNames.driveLink ? [result.colNames.driveLink] : undefined,
      systemPromptCol: result.colNames.systemPrompt,
      userPromptCols: result.colNames.userPrompts ?? [],
      outputCol: result.colNames.outputCol ?? "",
      rowRange: result.rowRange,
    };
  }

  private template(params: RecipeParams): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">Recipe</span>
      </div>
      ${
        params.driveFolder
          ? `
      <div class="field-group">
        <span class="field-label">Google Drive Folder Link <span class="required">*</span></span>
        ${params.driveFolder.helperText ? `<p class="field-helper">${params.driveFolder.helperText}</p>` : ""}
        <input id="drive-folder-input" type="text" class="text-input"
          placeholder="Paste Google Drive folder URL or ID" />
      </div>`
          : ""
      }
      ${
        params.systemPrompt
          ? `
      <div class="field-group">
        <span class="field-label">System Prompt</span>
        <div id="system-prompt-title-container"></div>
        <div id="system-prompt-value-container"></div>
      </div>`
          : ""
      }
      ${(params.userPrompts ?? [])
        .map(
          (_, i) => `
      <div class="field-group">
        <span class="field-label">User Prompt</span>
        <div id="user-prompt-title-${i}-container"></div>
        <div id="user-prompt-value-${i}-container"></div>
      </div>`,
        )
        .join("")}
      ${
        params.outputCol
          ? `
      <div class="field-group">
        <span class="field-label">Output Column</span>
        <div id="output-col-title-container"></div>
      </div>`
          : ""
      }
      <div id="prep-cook-container"></div>
    `;
  }
}
