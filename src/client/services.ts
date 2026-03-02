import type { PrepRecipeParams, PrepRecipeResult, RunConfig } from "../shared/types";

export function getSheetHeaders(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((headers: unknown) => resolve(headers as string[]))
      .withFailureHandler((err: Error) => reject(err))
      .getSheetHeaders();
  });
}

export function runBatchAI(config: RunConfig): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .runBatchAI(config);
  });
}

export function runTool(fn: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .runTool(fn);
  });
}

export function prepRecipe(params: PrepRecipeParams): Promise<PrepRecipeResult> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) => resolve(result as PrepRecipeResult))
      .withFailureHandler((err: Error) => reject(err))
      .prepRecipe(params);
  });
}
