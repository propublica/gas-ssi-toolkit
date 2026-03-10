import type { RunConfig, PrepRecipeParams } from "../shared/types";

declare global {
  interface GoogleScriptRun {
    withSuccessHandler(fn: (result: unknown) => void): this;
    withFailureHandler(fn: (error: Error) => void): this;
    runTool(functionName: string): void;
    getSheetHeaders(): void;
    runBatchAI(config: RunConfig): void;
    prepRecipe(params: PrepRecipeParams): void;
  }

  const google: {
    script: { run: GoogleScriptRun };
  };
}
