import type { Step, StepContext } from "../../types";
import { AsyncActionButton } from "../../components/async-action-button";
import { prepRecipe } from "../../services";

export const SYSTEM_PROMPT_COLUMN_TITLE = "System Prompt";

export interface PromptStepSavedState {
  promptText: string;
}

export interface PromptStepResult {
  systemPromptCol: string;
}

export class PromptStep implements Step<PromptStepSavedState> {
  readonly title = "Tell the AI what to do";
  readonly flavorText =
    "Set the AI's role and behavior — what it should do and how it should respond.";

  private textarea: HTMLTextAreaElement | null = null;
  private result: PromptStepResult | null = null;
  private continueButton: AsyncActionButton | null = null;

  getResult(): PromptStepResult | null {
    return this.result;
  }

  hydrate(_savedState: PromptStepSavedState): void {
    this.result = { systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE };
  }

  mount(container: HTMLElement, ctx: StepContext, savedState?: PromptStepSavedState): void {
    container.innerHTML = `
      <textarea id="gp-prompt-text" class="guided-prompt-textarea"></textarea>
      <button type="button" class="btn-run" id="gp-continue">Import &amp; Continue</button>
    `;
    this.textarea = container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!;
    this.textarea.value = savedState?.promptText ?? "";
    this.continueButton = new AsyncActionButton(
      container.querySelector<HTMLButtonElement>("#gp-continue")!,
      {
        idleLabel: "Import & Continue",
        loadingLabel: "Importing...",
        doneLabel: "Import & Continue",
      },
    );

    container.querySelector<HTMLButtonElement>("#gp-continue")!.addEventListener("click", () => {
      this.handleContinue(ctx);
    });
  }

  unmount(): { savedState: PromptStepSavedState; summary: string } | undefined {
    if (!this.textarea) return undefined;
    const promptText = this.textarea.value;
    const summary = promptText.length > 60 ? promptText.slice(0, 60) + "…" : promptText;
    return { savedState: { promptText }, summary };
  }

  private handleContinue(ctx: StepContext): void {
    const promptText = this.textarea!.value.trim();
    if (!promptText) {
      globalThis.alert("Please describe what the AI should do.");
      return;
    }
    this.continueButton?.setLoading();
    prepRecipe({
      cols: [
        {
          colTitle: SYSTEM_PROMPT_COLUMN_TITLE,
          fillStrategy: { kind: "fill-value", value: promptText },
        },
      ],
      inputValues: {},
    }).then(
      () => {
        this.result = { systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE };
        ctx.onComplete();
      },
      (err: Error) => {
        globalThis.alert("Error saving prompt: " + err.message);
        ctx.onError();
        this.continueButton?.setIdle();
      },
    );
  }
}
