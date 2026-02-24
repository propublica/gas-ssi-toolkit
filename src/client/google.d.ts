import type { RunConfig } from "../../shared/types";

interface GoogleScriptRun {
  withSuccessHandler(fn: (result: unknown) => void): this;
  withFailureHandler(fn: (error: Error | string) => void): this;
  runTool(functionName: string): void;
  getSheetHeaders(): void;
  runBatchAI(config: RunConfig): void;
}

declare const google: {
  script: { run: GoogleScriptRun };
};
