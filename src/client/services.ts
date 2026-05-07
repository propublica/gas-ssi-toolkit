import type {
  ExtractTextConfig,
  ImportDriveLinksConfig,
  PrepRecipeParams,
  PrepRecipeResult,
  RunConfig,
} from "../shared/types";

export function getSheetHeaders(): Promise<string[]> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((headers: unknown) => resolve(headers as string[]))
      .withFailureHandler((err: Error) => reject(err))
      .getSheetHeaders();
  });
}

export function runBatchAI(config: RunConfig, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .runBatchAI(config, jobId);
  });
}

export function runTool(fn: string, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .runTool(fn, jobId);
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

export function importDriveLinks(config: ImportDriveLinksConfig, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .importDriveLinks(config, jobId);
  });
}

export function extractText(config: ExtractTextConfig, jobId?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler(() => resolve())
      .withFailureHandler((err: Error) => reject(err))
      .extractText(config, jobId);
  });
}

export function getActiveRangeInfo(): Promise<{ start: number; end: number } | null> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) =>
        resolve(result as { start: number; end: number } | null),
      )
      .withFailureHandler((err: Error) => reject(err))
      .getActiveRangeInfo();
  });
}

export function getJobProgress(
  jobId: string,
): Promise<{ message?: string; current?: number; total?: number } | null> {
  return new Promise((resolve, reject) => {
    google.script.run
      .withSuccessHandler((result: unknown) =>
        resolve(result as { message?: string; current?: number; total?: number } | null),
      )
      .withFailureHandler((err: Error) => reject(err))
      .getJobProgress(jobId);
  });
}
