import type { NavigationContext, Panel, StepFlowSavedState } from "../types";
import type { RunConfig } from "../../shared/types";
import { StepFlow } from "../components/step-flow";
import { InputsStep } from "./guided/inputs-step";
import { PromptStep } from "./guided/prompt-step";
import { RunStep } from "./guided/run-step";
import { getSheetHeaders, getGeminiGemUrl } from "../services";
import { PanelLoader } from "../components/panel-loader";

export class GuidedAIInferencePanel implements Panel<undefined, StepFlowSavedState> {
  private stepFlow: StepFlow | null = null;
  private inputsStep: InputsStep | null = null;
  private runStep: RunStep | null = null;
  private nav: NavigationContext | null = null;
  private isEditingGuardActive = false;
  private isRefreshing = false;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    _params?: undefined,
    savedState?: StepFlowSavedState,
  ): void {
    this.nav = nav;
    this.inputsStep = null;
    this.runStep = null;
    container.innerHTML = this.template();
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());
    container
      .querySelector("#refresh-btn")
      ?.addEventListener("click", () => this.handleRefresh(container));

    const loader = new PanelLoader(container);
    loader.setState({ status: "loading", message: "Loading columns..." });

    Promise.all([getSheetHeaders(), getGeminiGemUrl().catch(() => undefined)])
      .then(
        ([headers, gemUrl]) => {
          const promptStep = new PromptStep(gemUrl);
          const inputsStep = new InputsStep(headers);
          this.inputsStep = inputsStep;
          const runStep = new RunStep(
            () => ({
              promptCols: inputsStep.getResult()?.promptCols ?? [],
              systemPromptCol: promptStep.getResult()?.systemPromptCol,
            }),
            (config: Partial<RunConfig>) => nav.navigate("configure-ai-run", config),
          );
          this.runStep = runStep;
          this.stepFlow = new StepFlow(
            container.querySelector("#steps-container")!,
            [inputsStep, promptStep, runStep],
            savedState,
            {
              onEditingChange: (isEditing) => {
                this.isEditingGuardActive = isEditing;
                this.updateRefreshButtonState(container);
              },
            },
          );
        },
        (err: Error) => {
          globalThis.alert("Error loading headers: " + err.message);
          this.nav?.back();
        },
      )
      .finally(() => loader.setState({ status: "idle" }));
  }

  unmount(): StepFlowSavedState | undefined {
    const value = this.stepFlow?.getValue();
    this.stepFlow?.destroy();
    return value;
  }

  private updateRefreshButtonState(container: HTMLElement): void {
    const btn = container.querySelector<HTMLButtonElement>("#refresh-btn")!;
    btn.disabled = this.isRefreshing || this.isEditingGuardActive;
  }

  private handleRefresh(container: HTMLElement): void {
    const btn = container.querySelector<HTMLButtonElement>("#refresh-btn")!;
    btn.classList.add("spinning");
    this.isRefreshing = true;
    this.updateRefreshButtonState(container);
    Promise.all([
      getSheetHeaders().then(
        (headers) => this.inputsStep?.updateHeaders(headers),
        (err: Error) => globalThis.alert("Error refreshing columns: " + err.message),
      ),
      this.runStep?.refreshRowRange(),
    ])
      .then(() => this.runStep?.checkTestStatsFreshness())
      .finally(() => {
        btn.classList.remove("spinning");
        this.isRefreshing = false;
        this.updateRefreshButtonState(container);
      });
  }

  private template(): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">🧭 Guided AI Inference</span>
        <button id="refresh-btn" class="refresh-btn" title="Refresh columns">↻</button>
      </div>
      <p class="recipe-intro">Walk through each stage of Spreadsheet Inference.</p>
      <div id="panel-loader" class="panel-loader" hidden>
        <div class="panel-loader__bar-wrap" hidden>
          <div class="panel-loader__bar-fill"></div>
        </div>
        <div class="panel-loader__spinner" hidden></div>
        <p class="panel-loader__message"></p>
      </div>
      <div id="steps-container"></div>
    `;
  }
}
