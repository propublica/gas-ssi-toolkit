export interface RecipePrepCookConfig {
  onPrep: () => Promise<void>;
  onCook: () => void | Promise<void>;
  prepComplete?: boolean;
}

export class RecipePrepCook {
  private prepComplete: boolean;
  private prepBtn!: HTMLButtonElement;
  private cookBtn!: HTMLButtonElement;

  constructor(container: HTMLElement, config: RecipePrepCookConfig) {
    this.prepComplete = config.prepComplete ?? false;
    this.render(container, config);
  }

  isPrepComplete(): boolean {
    return this.prepComplete;
  }

  reset(): void {
    this.prepComplete = false;
    this.setIdle();
  }

  private render(container: HTMLElement, config: RecipePrepCookConfig): void {
    container.innerHTML = `
      <div class="panel-buttons">
        <button id="prep-btn" class="btn-prep">Prep Recipe</button>
        <button id="cook-btn" class="btn-cook" disabled>Cook</button>
      </div>
    `;
    this.prepBtn = container.querySelector<HTMLButtonElement>("#prep-btn")!;
    this.cookBtn = container.querySelector<HTMLButtonElement>("#cook-btn")!;

    if (this.prepComplete) this.setPrepComplete();

    this.prepBtn.addEventListener("click", () => this.handlePrep(config.onPrep));
    this.cookBtn.addEventListener("click", () => this.handleCook(config.onCook));
  }

  private handlePrep(onPrep: () => Promise<void>): void {
    this.prepBtn.disabled = true;
    this.prepBtn.textContent = "Prepping...";
    this.cookBtn.disabled = true;

    onPrep().then(
      () => {
        this.prepComplete = true;
        this.setPrepComplete();
      },
      (err: Error | null) => {
        if (err !== null) globalThis.alert("Error: " + err.message);
        this.setIdle();
      },
    );
  }

  private handleCook(onCook: () => void | Promise<void>): void {
    const result = onCook();
    if (result instanceof Promise) {
      this.prepBtn.disabled = true;
      this.cookBtn.disabled = true;
      this.cookBtn.textContent = "Cooking...";
      result.then(
        () => this.setPrepComplete(),
        (err: Error) => {
          globalThis.alert("Error: " + err.message);
          this.setPrepComplete();
        },
      );
    }
  }

  private setIdle(): void {
    this.prepBtn.disabled = false;
    this.prepBtn.textContent = "Prep Recipe";
    this.cookBtn.disabled = true;
    this.cookBtn.textContent = "Cook";
  }

  private setPrepComplete(): void {
    this.prepBtn.disabled = false;
    this.prepBtn.textContent = "Re-prep";
    this.cookBtn.disabled = false;
    this.cookBtn.textContent = "Cook";
  }
}
