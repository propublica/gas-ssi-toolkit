import type { Step, StepContext } from "../../types";
import type { RunConfig } from "../../../shared/types";
import {
  RunControls,
  type PromptConfig,
  type RunControlsSavedState,
} from "../../components/run-controls";

export const GUIDED_OUTPUT_COLUMN_TITLE = "ai_output";

export interface RunStepSavedState {
  runControls?: RunControlsSavedState;
}

/**
 * Terminal step. Never collapses — its flavorText is intentionally empty, since
 * the wireframe places no flavor line here (Model/Tools/row-range/Test/Run speak
 * for themselves). Test never calls ctx.onComplete(); only a successful full
 * Run AI does, and since this is always the last step in GuidedAIInferencePanel's
 * array, StepFlow only flips its checklist icon rather than collapsing it.
 */
export class RunStep implements Step<RunStepSavedState> {
  readonly title = "Run";
  readonly flavorText = "";

  private runControls: RunControls | null = null;

  constructor(
    private readonly getPromptFields: () => Pick<RunConfig, "promptCols" | "systemPromptCol">,
    private readonly onSwitchToFreeform: (config: Partial<RunConfig>) => void,
  ) {}

  mount(container: HTMLElement, ctx: StepContext, savedState?: RunStepSavedState): void {
    container.innerHTML = `
      <div id="gr-run-controls-mount"></div>
      <button type="button" id="gr-switch-to-freeform" class="link-btn">Switch to Freeform</button>
    `;
    this.runControls = new RunControls(container.querySelector("#gr-run-controls-mount")!, {
      getPromptConfig: (): PromptConfig => ({
        ...this.getPromptFields(),
        outputCol: GUIDED_OUTPUT_COLUMN_TITLE,
        wrapPromptsInTags: undefined,
        applyMarkdown: true,
      }),
      onRunSucceeded: (): void => ctx.onComplete(),
      savedState: savedState?.runControls,
    });
    // RunControls no longer checks test-result freshness on its own (Task 1
    // fix removed that internal auto-call to close a mount-time ordering
    // race) — the host must call it explicitly once RunControls's own
    // row-range fetch settles, exactly like ConfigureAIRunPanel does. Without
    // this, restoring a saved lastTest (e.g. after navigating away and back)
    // would leave the test-results UI in whatever raw state its template
    // left it, never re-validated against the live config.
    this.runControls.ready.then(() => this.runControls?.checkTestStatsFreshness());
    container
      .querySelector<HTMLButtonElement>("#gr-switch-to-freeform")!
      .addEventListener("click", () => {
        const runControlsValue = this.runControls!.getValue();
        this.onSwitchToFreeform({
          ...this.getPromptFields(),
          outputCol: GUIDED_OUTPUT_COLUMN_TITLE,
          rowRange: runControlsValue.rowRange,
          tools: runControlsValue.tools,
          includeGrounding: runControlsValue.includeGrounding,
          model: runControlsValue.model,
        });
      });
  }

  unmount(): { savedState: RunStepSavedState; summary: string } | undefined {
    if (!this.runControls) return undefined;
    return { savedState: { runControls: this.runControls.getValue() }, summary: "" };
  }
}
