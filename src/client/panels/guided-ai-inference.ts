import type { NavigationContext, Panel, StepFlowSavedState } from "../types";
import type { RunConfig } from "../../shared/types";
import { StepFlow } from "../components/step-flow";
import { InputsStep } from "./guided/inputs-step";
import { PromptStep } from "./guided/prompt-step";
import { RunStep } from "./guided/run-step";
import { getSheetHeaders } from "../services";
import { PanelLoader } from "../components/panel-loader";

export class GuidedAIInferencePanel implements Panel<undefined, StepFlowSavedState> {
  private stepFlow: StepFlow | null = null;
  private nav: NavigationContext | null = null;

  mount(
    container: HTMLElement,
    nav: NavigationContext,
    _params?: undefined,
    savedState?: StepFlowSavedState,
  ): void {
    this.nav = nav;
    container.innerHTML = this.template();
    container.querySelector("#back-btn")?.addEventListener("click", () => nav.back());

    const loader = new PanelLoader(container);
    loader.setState({ status: "loading", message: "Loading columns..." });

    getSheetHeaders()
      .then(
        (headers) => {
          const promptStep = new PromptStep();
          const inputsStep = new InputsStep(headers);
          const runStep = new RunStep(
            () => ({
              promptCols: inputsStep.getResult()?.promptCols ?? [],
              systemPromptCol: promptStep.getResult()?.systemPromptCol,
            }),
            (config: Partial<RunConfig>) => nav.navigate("configure-ai-run", config),
          );
          this.stepFlow = new StepFlow(
            container.querySelector("#steps-container")!,
            [inputsStep, promptStep, runStep],
            savedState,
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
    return this.stepFlow?.getValue();
  }

  private template(): string {
    return `
      <div class="panel-header">
        <button id="back-btn" class="back-btn">← Back</button>
        <span class="panel-title">🧭 Guided AI Inference</span>
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
