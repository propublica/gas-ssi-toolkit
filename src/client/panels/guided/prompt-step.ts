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

  /** gemUrl comes from the GEMINI_GEM_URL Script Property (admin-configured,
   * not sheet/user data) -- omitted from the DOM entirely when unset. */
  constructor(private readonly gemUrl?: string) {}

  getResult(): PromptStepResult | null {
    return this.result;
  }

  hydrate(_savedState: PromptStepSavedState): void {
    this.result = { systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE };
  }

  mount(container: HTMLElement, ctx: StepContext, savedState?: PromptStepSavedState): void {
    const gemLink = this.gemUrl
      ? `<p class="guided-gem-link">Need help writing this? Try our
          <a href="${this.gemUrl}" target="_blank" rel="noopener noreferrer">Gemini Gem prompt assistant ↗</a></p>`
      : "";
    container.innerHTML = `
      ${gemLink}
      <textarea id="gp-prompt-text" class="guided-prompt-textarea"></textarea>
      <button type="button" class="btn-run" id="gp-continue">Import &amp; Continue</button>
    `;
    this.textarea = container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!;
    this.textarea.value = savedState?.promptText ?? "";
    this.continueButton = new AsyncActionButton(
      container.querySelector<HTMLButtonElement>("#gp-continue")!,
      { idleLabel: "Import & Continue", loadingLabel: "Importing..." },
    );

    container.querySelector<HTMLButtonElement>("#gp-continue")!.addEventListener("click", () => {
      this.handleContinue(ctx);
    });
  }

  unmount(): { savedState: PromptStepSavedState; summary: string } | undefined {
    if (!this.textarea) return undefined;
    const promptText = this.textarea.value;
    return { savedState: { promptText }, summary: `Prompt: ${promptText}` };
  }

  private handleContinue(ctx: StepContext): void {
    const promptText = this.textarea!.value.trim();
    if (!promptText) {
      globalThis.alert("Please describe what the AI should do.");
      return;
    }
    this.continueButton!.setLoading();
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
        this.continueButton!.setIdle();
        this.result = { systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE };
        ctx.onComplete();
      },
      (err: Error) => {
        globalThis.alert("Error saving prompt: " + err.message);
        ctx.onError();
        this.continueButton!.setIdle();
      },
    );
  }
}
