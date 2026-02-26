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

    const input: HTMLInputElement | HTMLTextAreaElement = config.multiline
      ? document.createElement("textarea")
      : document.createElement("input");

    if (input instanceof HTMLInputElement) input.type = "text";
    input.className = "text-input";
    input.value = config.defaultValue;
    if (config.placeholder) input.placeholder = config.placeholder;
    input.disabled = this.locked;

    const unlockBtn = document.createElement("button");
    unlockBtn.type = "button";
    unlockBtn.className = "unlock-btn";
    unlockBtn.textContent = this.locked ? "🔒 Edit" : "🔓 Lock";

    unlockBtn.addEventListener("click", () => {
      this.locked = !this.locked;
      input.disabled = this.locked;
      unlockBtn.textContent = this.locked ? "🔒 Edit" : "🔓 Lock";
      if (!this.locked) {
        config.onUnlock?.();
      }
    });

    const label = document.createElement("span");
    label.className = "field-label";
    label.textContent = config.label;

    if (config.multiline) {
      // Block layout: label + lock button on header row, textarea below
      const header = document.createElement("div");
      header.className = "lockable-field-header";
      header.append(label, unlockBtn);
      container.append(header, input);
    } else {
      // Inline layout: label, input, and lock button all on one row
      const row = document.createElement("div");
      row.className = "lockable-field-row";
      row.append(label, input, unlockBtn);
      container.append(row);
    }

    return input;
  }

  getValue(): string {
    return this.input.value;
  }

  isLocked(): boolean {
    return this.locked;
  }
}
