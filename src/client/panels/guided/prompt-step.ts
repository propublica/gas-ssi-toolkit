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
    "Set the AI's role and behavior — what it should do and how it should respond — one row at a time.";

  private textarea: HTMLTextAreaElement | null = null;
  private result: PromptStepResult | null = null;
  private continueButton: AsyncActionButton | null = null;

  /** gemUrl comes from the GEMINI_GEM_URL Script Property (admin-configured,
   * not sheet/user data) -- omitted from the DOM entirely when unset. */
  constructor(private readonly gemUrl?: string) {}

  getResult(): PromptStepResult | null {
    return this.result;
  }

  setInteractive(enabled: boolean): void {
    this.continueButton?.setInteractive(enabled);
  }

  hydrate(_savedState: PromptStepSavedState): void {
    this.result = { systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE };
  }

  mount(container: HTMLElement, ctx: StepContext, savedState?: PromptStepSavedState): void {
    container.innerHTML = `
      <div id="gp-gem-link-inline"></div>
      <div id="gp-textarea-slot">
        <textarea id="gp-prompt-text" class="guided-prompt-textarea"></textarea>
      </div>
      <div class="guided-expand-row">
        <button type="button" class="link-btn" id="gp-expand-btn">Expand ⤢</button>
      </div>
      <button type="button" class="btn-run" id="gp-continue">Import &amp; Continue</button>

      <div class="guided-modal-overlay" id="gp-modal-overlay" hidden>
        <div class="guided-modal">
          <div class="guided-modal-header">
            <button type="button" class="guided-modal-close" id="gp-modal-close">Close</button>
          </div>
          <div id="gp-gem-link-modal"></div>
          <div id="gp-modal-textarea-slot"></div>
        </div>
      </div>
    `;
    // Built via DOM APIs (not string-interpolated into innerHTML) so gemUrl's
    // value is only ever assigned to the href *property* -- never parsed as
    // markup, so an embedded quote character can't break out of the
    // attribute and inject a new one (e.g. a value like
    // `https://x" onclick="evil()`).
    const inlineGemLink = this.buildGemLink();
    if (inlineGemLink) container.querySelector("#gp-gem-link-inline")!.appendChild(inlineGemLink);
    const modalGemLink = this.buildGemLink();
    if (modalGemLink) container.querySelector("#gp-gem-link-modal")!.appendChild(modalGemLink);

    this.textarea = container.querySelector<HTMLTextAreaElement>("#gp-prompt-text")!;
    this.textarea.value = savedState?.promptText ?? "";
    this.continueButton = new AsyncActionButton(
      container.querySelector<HTMLButtonElement>("#gp-continue")!,
      { idleLabel: "Import & Continue", loadingLabel: "Importing..." },
    );

    container.querySelector<HTMLButtonElement>("#gp-continue")!.addEventListener("click", () => {
      this.handleContinue(ctx);
    });

    this.wireExpandModal(container);
  }

  /** Moves the single textarea node between the inline slot and the modal --
   * never two separate elements to keep in sync, so "autosave" is automatic
   * and closing the modal at any point loses nothing (per the wireframe). */
  private wireExpandModal(container: HTMLElement): void {
    const inlineSlot = container.querySelector<HTMLElement>("#gp-textarea-slot")!;
    const modalSlot = container.querySelector<HTMLElement>("#gp-modal-textarea-slot")!;
    const overlay = container.querySelector<HTMLElement>("#gp-modal-overlay")!;

    const openModal = (): void => {
      modalSlot.appendChild(this.textarea!);
      overlay.hidden = false;
      this.textarea!.focus();
    };
    const closeModal = (): void => {
      inlineSlot.appendChild(this.textarea!);
      overlay.hidden = true;
    };

    container
      .querySelector<HTMLButtonElement>("#gp-expand-btn")!
      .addEventListener("click", openModal);
    container
      .querySelector<HTMLButtonElement>("#gp-modal-close")!
      .addEventListener("click", closeModal);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });
  }

  /** Guards against a misconfigured GEMINI_GEM_URL Script Property (e.g. a
   * pasted javascript: or data: value) becoming a clickable, executing link.
   * Not a domain allowlist -- the URL is intentionally admin-configurable to
   * any http(s) destination. */
  private isHttpUrl(url: string | undefined): url is string {
    return !!url && /^https?:\/\//i.test(url);
  }

  private buildGemLink(): HTMLElement | null {
    if (!this.isHttpUrl(this.gemUrl)) return null;
    const p = document.createElement("p");
    p.className = "guided-gem-link";
    p.append("Need help writing this? Try our ");
    const a = document.createElement("a");
    a.href = this.gemUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Gemini Gem prompt assistant ↗";
    p.appendChild(a);
    return p;
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
    ctx.onBusyChange(true);
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
        ctx.onBusyChange(false);
        this.continueButton!.setIdle();
        this.result = { systemPromptCol: SYSTEM_PROMPT_COLUMN_TITLE };
        ctx.onComplete();
      },
      (err: Error) => {
        ctx.onBusyChange(false);
        globalThis.alert("Error saving prompt: " + err.message);
        ctx.onError();
        this.continueButton!.setIdle();
      },
    );
  }
}
