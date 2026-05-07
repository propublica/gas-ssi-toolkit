import type { NavigationContext, Panel, RecipeDefinition } from "../types";
import type { PrepRecipeParams, RunConfig } from "../../shared/types";
import { prepRecipe, runBatchAI } from "../services";
import { buildRunTemplate } from "./recipe";
import { jobStore } from "../job-store";

type V3RunState = "idle" | "testing" | "cooking";

export class RecipeV3Panel implements Panel<RecipeDefinition, never> {
  private nav: NavigationContext | null = null;
  private definition: RecipeDefinition | null = null;
  private container: HTMLElement | null = null;
  private step1Complete = false;
  private step2Complete = false;
  private step3Unlocked = false;
  private rowRange: { start: number; end: number } | null = null;
  private preppedRunConfig: RunConfig | null = null;
  private runState: V3RunState = "idle";

  mount(container: HTMLElement, nav: NavigationContext, definition?: RecipeDefinition): void {
    this.nav = nav;
    this.definition = definition ?? null;
    this.container = container;
    this.step1Complete = false;
    this.step2Complete = false;
    this.step3Unlocked = false;
    this.rowRange = null;
    this.preppedRunConfig = null;
    this.runState = "idle";

    container.innerHTML = this.template(definition);
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    this.wireInputResets(container, definition);
    this.wireStepButtons(container);
    this.applyLockState(container);
  }

  unmount(): never {
    return undefined as never;
  }

  private getStep1InputIds(): Set<string> {
    const ids = new Set<string>();
    for (const col of this.definition?.prepTemplate ?? []) {
      if (col.fillStrategy.kind === "list-drive-folder") {
        ids.add(col.fillStrategy.inputId);
      }
    }
    return ids;
  }

  private wireInputResets(container: HTMLElement, definition: RecipeDefinition | undefined): void {
    for (const input of definition?.inputs ?? []) {
      const el = container.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      el?.addEventListener("input", () => {
        this.step3Unlocked = false;
        this.preppedRunConfig = null;
        this.applyLockState(container);
      });
    }
  }

  private wireStepButtons(container: HTMLElement): void {
    container
      .querySelector("#step1-btn")
      ?.addEventListener("click", () => this.handleStep1(container));
    container
      .querySelector("#step2-btn")
      ?.addEventListener("click", () => this.handleStep2(container));
    container
      .querySelector("#test-btn")
      ?.addEventListener("click", () => this.handleTest(container));
    container
      .querySelector("#cook-btn")
      ?.addEventListener("click", () => this.handleCook(container));
    container
      .querySelector("#configure-btn")
      ?.addEventListener("click", () => this.handleConfigureAI());
  }

  private applyLockState(container: HTMLElement): void {
    // Update step state badges and data attributes
    const step1El = container.querySelector<HTMLElement>("[data-step='1']");
    const step2El = container.querySelector<HTMLElement>("[data-step='2']");
    const step3El = container.querySelector<HTMLElement>("[data-step='3']");
    const step1Badge = container.querySelector<HTMLElement>("#step1-badge");
    const step2Badge = container.querySelector<HTMLElement>("#step2-badge");

    if (step1El) step1El.dataset.stepState = this.step1Complete ? "complete" : "active";
    if (step1Badge) step1Badge.textContent = this.step1Complete ? "✓" : "1";

    if (step2El)
      step2El.dataset.stepState = !this.step1Complete
        ? "locked"
        : this.step2Complete
          ? "complete"
          : "active";
    if (step2Badge) step2Badge.textContent = this.step2Complete ? "✓" : "2";

    if (step3El) step3El.dataset.stepState = this.step3Unlocked ? "active" : "locked";

    // Step 2 inputs/button disabled state
    const step2Section = container.querySelector<HTMLElement>("[data-step='2']");
    if (step2Section) {
      const locked = !this.step1Complete;
      step2Section
        .querySelectorAll<HTMLButtonElement | HTMLInputElement>("button, input")
        .forEach((el) => {
          el.disabled = locked;
        });
    }

    // Step 3 buttons
    const step3Section = container.querySelector<HTMLElement>("[data-step='3']");
    if (step3Section) {
      const locked = !this.step3Unlocked;
      const testBtn = container.querySelector<HTMLButtonElement>("#test-btn")!;
      const cookBtn = container.querySelector<HTMLButtonElement>("#cook-btn")!;
      const configBtn = container.querySelector<HTMLButtonElement>("#configure-btn")!;
      const btn = (main: string, sub: string): string =>
        `<span class="recipe-btn-main">${main}</span><span class="recipe-btn-sub">${sub}</span>`;

      if (this.runState === "idle") {
        testBtn.disabled = locked;
        cookBtn.disabled = locked;
        configBtn.disabled = locked;
        testBtn.innerHTML = btn("1. Test", "Check quality on the first 5 rows");
        cookBtn.innerHTML = btn("2. Cook", "Process all imported files");
        configBtn.innerHTML = btn("Configure AI", "Review or adjust settings before running");
      } else if (this.runState === "testing") {
        testBtn.disabled = true;
        testBtn.innerHTML = `<span class="btn-spinner"></span><span class="recipe-btn-main">Testing…</span>`;
        cookBtn.disabled = true;
        configBtn.disabled = true;
      } else if (this.runState === "cooking") {
        testBtn.disabled = true;
        cookBtn.disabled = true;
        cookBtn.innerHTML = `<span class="btn-spinner"></span><span class="recipe-btn-main">Cooking…</span>`;
        configBtn.disabled = true;
      }
    }
  }

  private buildStep1Params(): PrepRecipeParams | null {
    const step1InputIds = this.getStep1InputIds();
    const inputValues: Record<string, string> = {};
    for (const input of (this.definition?.inputs ?? []).filter((i) => step1InputIds.has(i.id))) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      const value = el?.value.trim() ?? "";
      if (input.required && !value) {
        globalThis.alert(`Please fill in "${input.label}".`);
        return null;
      }
      inputValues[input.id] = value;
    }
    return {
      cols: (this.definition?.prepTemplate ?? []).filter((col) => col.role === "file-prompt"),
      inputValues,
    };
  }

  private buildStep2Params(): PrepRecipeParams | null {
    const step1InputIds = this.getStep1InputIds();
    const inputValues: Record<string, string> = {};
    for (const input of (this.definition?.inputs ?? []).filter((i) => !step1InputIds.has(i.id))) {
      const el = this.container?.querySelector<HTMLInputElement>(`[data-input-id="${input.id}"]`);
      const value = el?.value.trim() ?? "";
      if (input.required && !value) {
        globalThis.alert(`Please fill in "${input.label}".`);
        return null;
      }
      inputValues[input.id] = value;
    }
    return {
      cols: (this.definition?.prepTemplate ?? []).filter(
        (col) => col.role === "system-prompt" || col.role === "text-prompt",
      ),
      inputValues,
      rowRange: this.rowRange ?? undefined,
    };
  }

  private handleStep1(container: HTMLElement): void {
    const params = this.buildStep1Params();
    if (!params) return;
    const btn = container.querySelector<HTMLButtonElement>("#step1-btn")!;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span>Importing…`;
    prepRecipe(params).then(
      (result) => {
        this.rowRange = result.rowRange;
        this.step1Complete = true;
        if (this.step2Complete) {
          const template = buildRunTemplate(this.definition?.prepTemplate ?? []);
          if (!template.promptCols || !template.outputCol) {
            globalThis.alert("Recipe configuration error: missing required columns.");
          } else {
            this.step3Unlocked = true;
            this.preppedRunConfig = {
              ...template,
              ...this.definition?.settings,
              rowRange: result.rowRange,
            } as RunConfig;
          }
        }
        btn.disabled = false;
        btn.textContent = "Re-import Files";
        const status = container.querySelector<HTMLElement>("#step1-status");
        if (status) {
          const count = result.rowRange.end - result.rowRange.start + 1;
          status.textContent = `✓ ${count} file${count !== 1 ? "s" : ""} imported to Drive Link column`;
          status.hidden = false;
        }
        this.applyLockState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        btn.disabled = false;
        btn.textContent = "Import Files";
      },
    );
  }

  private handleStep2(container: HTMLElement): void {
    const params = this.buildStep2Params();
    if (!params) return;
    const btn = container.querySelector<HTMLButtonElement>("#step2-btn")!;
    btn.disabled = true;
    btn.innerHTML = `<span class="btn-spinner"></span>Importing…`;
    prepRecipe(params).then(
      () => {
        this.step2Complete = true;
        const template = buildRunTemplate(this.definition?.prepTemplate ?? []);
        if (!template.promptCols || !template.outputCol || !this.rowRange) {
          globalThis.alert("Recipe configuration error: missing required columns.");
        } else {
          this.step3Unlocked = true;
          this.preppedRunConfig = {
            ...template,
            ...this.definition?.settings,
            rowRange: this.rowRange,
          } as RunConfig;
        }
        btn.disabled = false;
        btn.textContent = "Re-import Prompt";
        const status = container.querySelector<HTMLElement>("#step2-status");
        if (status) {
          status.textContent = "✓ Prompt written to System Prompt column";
          status.hidden = false;
        }
        this.applyLockState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        btn.disabled = false;
        btn.textContent = "Import Prompt";
      },
    );
  }

  private handleTest(container: HTMLElement): void {
    if (!this.rowRange || !this.preppedRunConfig) return;
    const config: RunConfig = {
      ...this.preppedRunConfig,
      rowRange: {
        start: this.rowRange.start,
        end: Math.min(this.rowRange.start + 4, this.rowRange.end),
      },
    };
    this.runState = "testing";
    this.applyLockState(container);
    const jobId = `batch-ai-${Date.now()}`;
    const runPromise = runBatchAI(config, jobId);
    jobStore.dispatch(jobId, "Testing 5 rows…", runPromise);
    runPromise.then(
      () => {
        this.runState = "idle";
        this.applyLockState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.runState = "idle";
        this.applyLockState(container);
      },
    );
  }

  private handleCook(container: HTMLElement): void {
    if (!this.rowRange || !this.preppedRunConfig) return;
    const config: RunConfig = { ...this.preppedRunConfig, rowRange: this.rowRange };
    this.runState = "cooking";
    this.applyLockState(container);
    const jobId = `batch-ai-${Date.now()}`;
    const runPromise = runBatchAI(config, jobId);
    jobStore.dispatch(jobId, "Running AI…", runPromise);
    runPromise.then(
      () => {
        this.runState = "idle";
        this.applyLockState(container);
      },
      (err: Error) => {
        globalThis.alert("Error: " + err.message);
        this.runState = "idle";
        this.applyLockState(container);
      },
    );
  }

  private handleConfigureAI(): void {
    if (this.preppedRunConfig) {
      this.nav?.navigate("configure-ai-run", this.preppedRunConfig);
    }
  }

  private template(definition: RecipeDefinition | undefined | null): string {
    const inputs = definition?.inputs ?? [];
    const title = definition ? `${definition.icon} ${definition.name}` : "Recipe";
    const introHtml = definition?.intro ? `<p class="recipe-intro">${definition.intro}</p>` : "";
    const step1InputIds = new Set(
      (definition?.prepTemplate ?? [])
        .filter((col) => col.fillStrategy.kind === "list-drive-folder")
        .map((col) => (col.fillStrategy as { kind: "list-drive-folder"; inputId: string }).inputId),
    );
    const renderInput = (input: RecipeDefinition["inputs"][number]): string => {
      const mark = input.required
        ? `<span class="required"> *</span>`
        : `<span class="optional"> (optional)</span>`;
      const helper = input.helperText ? `<p class="field-helper">${input.helperText}</p>` : "";
      return `<div class="field-group">
        <span class="field-label">${input.label}${mark}</span>
        ${helper}
        <input data-input-id="${input.id}" type="text" class="text-input" placeholder="${input.placeholder ?? ""}" />
      </div>`;
    };
    const step1Inputs = inputs
      .filter((i) => step1InputIds.has(i.id))
      .map(renderInput)
      .join("");
    const step2Inputs = inputs
      .filter((i) => !step1InputIds.has(i.id))
      .map(renderInput)
      .join("");

    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">${title}</span>
      </div>
      ${introHtml}
      <div data-step="1" class="v3-step" data-step-state="active">
        <div class="v3-step-left">
          <div class="v3-step-badge" id="step1-badge">1</div>
          <div class="v3-step-connector"></div>
        </div>
        <div class="v3-step-content">
          <p class="v3-step-label"><strong>Import your documents</strong></p>
          <p class="field-helper">Import files from a Drive folder into your spreadsheet. Each file gets its own row.</p>
          ${step1Inputs}
          <button id="step1-btn" class="btn-outline">Import Files</button>
          <p id="step1-status" class="field-helper" hidden></p>
        </div>
      </div>
      <div data-step="2" class="v3-step" data-step-state="locked">
        <div class="v3-step-left">
          <div class="v3-step-badge" id="step2-badge">2</div>
          <div class="v3-step-connector"></div>
        </div>
        <div class="v3-step-content">
          <p class="v3-step-label"><strong>Set up your prompt</strong></p>
          <p class="field-helper">Configure how the AI should read and summarize your documents.</p>
          ${step2Inputs}
          <button id="step2-btn" class="btn-outline">Import Prompt</button>
          <p id="step2-status" class="field-helper" hidden></p>
        </div>
      </div>
      <div data-step="3" class="v3-step" data-step-state="locked">
        <div class="v3-step-left">
          <div class="v3-step-badge">3</div>
        </div>
        <div class="v3-step-content">
          <p class="v3-step-label"><strong>Run</strong></p>
          <div class="recipe-action-stack">
            <button id="test-btn" class="btn-outline recipe-action-btn">
              <span class="recipe-btn-main">1. Test</span>
              <span class="recipe-btn-sub">Check quality on the first 5 rows</span>
            </button>
            <button id="cook-btn" class="btn-run recipe-action-btn">
              <span class="recipe-btn-main">2. Cook</span>
              <span class="recipe-btn-sub">Process all imported files</span>
            </button>
            <button id="configure-btn" class="btn-outline recipe-action-btn">
              <span class="recipe-btn-main">Configure AI</span>
              <span class="recipe-btn-sub">Review or adjust settings before running</span>
            </button>
          </div>
        </div>
      </div>`;
  }
}
