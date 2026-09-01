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
 * Terminal step. Never collapses on its OWN completion -- its flavorText is
 * intentionally empty, since the wireframe places no flavor line here
 * (Model/Tools/row-range/Test/Run speak for themselves). Test never calls
 * ctx.onComplete(); only a successful full Run AI does, and since this is
 * always the last step in GuidedAIInferencePanel's array, StepFlow only flips
 * its checklist icon rather than collapsing it. It CAN still be collapsed
 * from outside, though: editing an earlier step while this one is open
 * temporarily relocks it (StepFlow.editStep()), reopening it verbatim on
 * Cancel or via the normal walk-forward on a successful recommit.
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
      onBusyChange: ctx.onBusyChange,
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
          // Must match the constants passed to RunControls via getPromptConfig()
          // above -- Guided AI Inference always runs with markdown formatting on
          // and no explicit tag-wrapping override.
          applyMarkdown: true,
          wrapPromptsInTags: undefined,
        });
      });
  }

  unmount(): { savedState: RunStepSavedState; summary: string } | undefined {
    if (!this.runControls) return undefined;
    return { savedState: { runControls: this.runControls.getValue() }, summary: "" };
  }

  /** Mirrors ConfigureAIRunPanel's refresh behavior for the Run step's own
   * RunControls. No-op before this step's first mount -- there's nothing live
   * to refresh. After a relock (this step can be unmounted and walked back to,
   * per StepFlow.relockStepsAfter), `runControls` is non-null but points at a
   * discarded instance whose DOM is no longer displayed; refreshing it is
   * harmless, since the next mount() builds a fresh RunControls from saved
   * state and discards this one. Same for checkTestStatsFreshness() below. */
  refreshRowRange(): Promise<void> {
    return this.runControls?.refreshRowRange() ?? Promise.resolve();
  }

  checkTestStatsFreshness(): void {
    this.runControls?.checkTestStatsFreshness();
  }

  setInteractive(enabled: boolean): void {
    this.runControls?.setInteractive(enabled);
  }
}
