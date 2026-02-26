export interface LockableFieldConfig {
  label: string;
  defaultValue: string;
  locked?: boolean; // defaults to true
  placeholder?: string;
  multiline?: boolean;
  onUnlock?: () => void;
}

export class LockableField {
  private locked: boolean;
  private readonly input: HTMLInputElement | HTMLTextAreaElement;

  constructor(container: HTMLElement, config: LockableFieldConfig) {
    this.locked = config.locked ?? true;
    this.input = this.render(container, config);
  }

  private render(
    container: HTMLElement,
    config: LockableFieldConfig,
  ): HTMLInputElement | HTMLTextAreaElement {
    container.innerHTML = "";

    const header = document.createElement("div");
    header.className = "lockable-field-header";

    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = config.label;

    const unlockBtn = document.createElement("button");
    unlockBtn.type = "button";
    unlockBtn.className = "unlock-btn";
    unlockBtn.textContent = this.locked ? "🔒 Edit" : "🔓 Lock";

    header.append(label, unlockBtn);

    const input: HTMLInputElement | HTMLTextAreaElement = config.multiline
      ? document.createElement("textarea")
      : document.createElement("input");

    if (input instanceof HTMLInputElement) input.type = "text";
    input.className = "text-input";
    input.value = config.defaultValue;
    if (config.placeholder) input.placeholder = config.placeholder;
    input.disabled = this.locked;

    unlockBtn.addEventListener("click", () => {
      this.locked = !this.locked;
      input.disabled = this.locked;
      unlockBtn.textContent = this.locked ? "🔒 Edit" : "🔓 Lock";
      if (!this.locked) {
        config.onUnlock?.();
      }
    });

    container.append(header, input);
    return input;
  }

  getValue(): string {
    return this.input.value;
  }

  isLocked(): boolean {
    return this.locked;
  }
}
