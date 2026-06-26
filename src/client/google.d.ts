import type {
  RunConfig,
  PrepRecipeParams,
  PrepRecipeResult,
  ImportDriveLinksConfig,
  ExtractTextConfig,
} from "../shared/types";

declare global {
  interface GoogleScriptRun {
    withSuccessHandler(fn: (result: unknown) => void): this;
    withFailureHandler(fn: (error: Error) => void): this;
    runTool(functionName: string, jobId?: string): void;
    getSheetHeaders(): void;
    runBatchAI(config: RunConfig, jobId?: string): void;
    importDriveLinks(config: ImportDriveLinksConfig, jobId?: string): void;
    extractText(config: ExtractTextConfig, jobId?: string): void;
    prepRecipe(params: PrepRecipeParams): PrepRecipeResult;
    getJobProgress(jobId: string): void;
    getActiveRangeInfo(): void;
    formatMarkdownSelection(): void;
  }

  const google: {
    script: { run: GoogleScriptRun };
  };
}
